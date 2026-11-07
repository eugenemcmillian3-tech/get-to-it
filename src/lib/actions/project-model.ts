"use server";

import { revalidatePath } from "next/cache";
import type { BuildState } from "@/lib/action-state";
import { getSession } from "@/lib/auth";
import { secretLikeProblem } from "@/lib/build-room";
import {
  EXPERIMENT_KINDS,
  SCENARIO_KINDS,
  buildExperimentPlan,
  buildProjectModel,
  buildScenarioAnalysis,
  executeExperiment,
  validateExperimentInput,
  validateScenarioInput,
  type ExperimentKind,
  type ExperimentPlan,
  type ProjectModelInput,
  type ScenarioAnalysis,
  type ScenarioKind,
} from "@/lib/project-model";
import { buildModelSource, modelStaleness } from "@/lib/project-model-source";
import {
  getProjectModelWorkspace,
  modelFiles,
  modelInputForWorkspace,
  type ProjectModelWorkspace,
} from "@/lib/data/project-model";
import { isUuid, readText } from "@/lib/validation";

/**
 * Phase 33 actions.
 *
 * A model is derived from stored project records, never from a model call. The
 * current source digest is checked before a scenario or experiment is added.
 * Experiments only inspect stored source; none contact a provider or external
 * service. Task creation goes through an owner-checked database function that
 * requires prior experiment approval.
 */

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That project isn't available to you.";
const STALE = "This project model is stale. Refresh it before analysing or running an experiment.";
const REFUSED = "That action was refused. Nothing changed.";

function fail(message: string): BuildState {
  return { status: "error", message: message.slice(0, 1_000), nonce: Date.now() };
}

function done(message: string, link?: string): BuildState {
  return { status: "success", message: message.slice(0, 1_000), link, nonce: Date.now() };
}

function refresh(projectId: string): void {
  revalidatePath(`/build/${projectId}/model`);
  revalidatePath(`/build/${projectId}`);
  revalidatePath(`/build/${projectId}/room`);
}

function modelContext(workspace: ProjectModelWorkspace): {
  input: ProjectModelInput;
  source: ReturnType<typeof buildModelSource>;
} {
  const input: ProjectModelInput = modelInputForWorkspace(workspace);
  return { input, source: buildModelSource(input) };
}

function rpcMessage(error: { message?: string } | null, fallback = REFUSED): string {
  const message = error?.message ?? "";
  const allowed = [
    "experiment approval is required",
    "experiment not found",
    "the experiment is canceled",
    "the experiment already created a project task",
    "an experiment limit",
    "project not found",
    "invalid source digest",
    "invalid project model",
  ];
  return allowed.some((prefix) => message.includes(prefix)) ? message : fallback;
}

export async function createProjectModelAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  if (!isUuid(projectId)) return fail(NOT_AVAILABLE);

  const workspace = await getProjectModelWorkspace(session, projectId);
  if (!workspace) return fail(NOT_AVAILABLE);
  const { input, source } = modelContext(workspace);
  const model = buildProjectModel(input);

  const { data, error } = await session.supabase.rpc("create_app_project_model_version", {
    p_project_id: projectId,
    p_spec_version: source.spec_version,
    p_app_version: source.app_version,
    p_source_digest: source.source_digest,
    p_source_revision: source,
    p_model: model,
    p_assumptions: model.assumptions,
    p_missing_information: model.missing_information,
  });

  if (error) {
    console.error("createProjectModelAction failed:", error.message);
    return fail(rpcMessage(error, "We couldn't save that project model. Nothing changed."));
  }

  refresh(projectId);
  const version = Number(data ?? 0);
  return done(
    `Project model version ${version || "new"} saved from spec version ${source.spec_version} and project version ${source.app_version}. Static evidence only.`,
    `/build/${projectId}/model`,
  );
}

export async function createChangeScenarioAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const modelId = readText(formData, "model_id");
  const kind = readText(formData, "kind") as ScenarioKind;
  const question = readText(formData, "question");
  const target = readText(formData, "target");
  if (!isUuid(projectId) || !isUuid(modelId)) return fail(NOT_AVAILABLE);
  if (!SCENARIO_KINDS.includes(kind)) return fail("Choose a supported change scenario.");
  const validation = validateScenarioInput({ kind, question, target });
  if (validation) return fail(validation);
  if (secretLikeProblem(question) || secretLikeProblem(target)) {
    return fail("Remove the secret-like value before saving this scenario.");
  }

  const workspace = await getProjectModelWorkspace(session, projectId);
  if (!workspace) return fail(NOT_AVAILABLE);
  const record = workspace.models.find((model) => model.id === modelId);
  if (!record) return fail(NOT_AVAILABLE);

  const { source } = modelContext(workspace);
  const stale = modelStaleness(record, source);
  if (stale.stale) return fail(`${STALE} ${stale.reasons.join(" ")}`);

  const analysis = buildScenarioAnalysis(record.model, { kind, question, target });
  const { error } = await session.supabase.from("app_change_scenarios").insert({
    project_id: projectId,
    model_id: record.id,
    user_id: session.user.id,
    kind,
    question: question.trim(),
    target: target.trim(),
    basis: "static_model",
    analysis,
  });

  if (error) {
    console.error("createChangeScenarioAction failed:", error.message);
    return fail("We couldn't save that scenario. Nothing changed.");
  }

  refresh(projectId);
  return done(
    `${analysis.affected.length} potentially affected component(s) found from static evidence. No runtime behavior is claimed.`,
  );
}

export async function createExperimentAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const scenarioId = readText(formData, "scenario_id");
  const kind = readText(formData, "kind") as ExperimentKind;
  const requested = Number(readText(formData, "requested_requests") || "1");
  const duration = Number(readText(formData, "max_duration_ms") || "15000");
  if (!isUuid(projectId) || !isUuid(scenarioId)) return fail(NOT_AVAILABLE);
  if (!EXPERIMENT_KINDS.includes(kind)) return fail("Choose a supported experiment.");

  const workspace = await getProjectModelWorkspace(session, projectId);
  if (!workspace) return fail(NOT_AVAILABLE);
  const scenario = workspace.scenarios.find((record) => record.id === scenarioId);
  const model = scenario ? workspace.models.find((record) => record.id === scenario.model_id) : null;
  if (!scenario || !model) return fail(NOT_AVAILABLE);

  const { source } = modelContext(workspace);
  const stale = modelStaleness(model, source);
  if (stale.stale) return fail(`${STALE} ${stale.reasons.join(" ")}`);

  const validation = validateExperimentInput({
    kind,
    target: scenario.target,
    requested_requests: requested,
    max_duration_ms: duration,
  });
  if (validation) return fail(validation);

  const analysis = scenario.analysis as ScenarioAnalysis;
  const plan: ExperimentPlan = buildExperimentPlan(model.model, analysis, {
    kind,
    target: scenario.target,
    requested_requests: requested,
    max_duration_ms: duration,
  });

  const { error } = await session.supabase.from("app_change_experiments").insert({
    project_id: projectId,
    scenario_id: scenario.id,
    model_id: model.id,
    user_id: session.user.id,
    kind,
    status: "proposed",
    target: scenario.target,
    data_handling: "source_code_only",
    requested_requests: requested,
    max_duration_ms: duration,
    plan,
    task_title: plan.task_title,
    task_description: plan.task_description,
    scope_paths: plan.scope_paths,
  });

  if (error) {
    console.error("createExperimentAction failed:", error.message);
    if (error.message.includes("experiment limit")) {
      return fail("This scenario already has the maximum of 4 experiments.");
    }
    if (error.message.includes("duplicate")) {
      return fail("That experiment already exists for this scenario and target.");
    }
    return fail("We couldn't create that experiment. Nothing changed.");
  }

  refresh(projectId);
  return done(
    "Experiment proposed. It cannot run or become a task until you approve it. Synthetic requests stay blocked without an isolated runner.",
  );
}

export async function approveExperimentAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const experimentId = readText(formData, "experiment_id");
  if (!isUuid(projectId) || !isUuid(experimentId)) return fail(NOT_AVAILABLE);

  const { data, error } = await session.supabase
    .from("app_change_experiments")
    .update({
      status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: session.user.id,
    })
    .eq("id", experimentId)
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .is("approved_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("approveExperimentAction failed:", error.message);
    return fail("We couldn't approve that experiment. Nothing changed.");
  }
  if (!data) return fail("That experiment is not available or was already approved.");

  refresh(projectId);
  return done("Experiment approved. It still does not change project files or production behavior.");
}

export async function runExperimentAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const experimentId = readText(formData, "experiment_id");
  if (!isUuid(projectId) || !isUuid(experimentId)) return fail(NOT_AVAILABLE);

  const workspace = await getProjectModelWorkspace(session, projectId);
  if (!workspace) return fail(NOT_AVAILABLE);
  const experiment = workspace.experiments.find((record) => record.id === experimentId);
  if (!experiment) return fail(NOT_AVAILABLE);
  if (!experiment.approved_at) return fail("Approve the experiment before running it.");
  if (experiment.status === "canceled") return fail("That experiment was canceled.");
  if (experiment.task_id) return fail("That experiment already became a project task.");

  const started = Date.now();
  const outcome = executeExperiment(experiment.plan, modelFiles(workspace.files), {
    authRequired: workspace.project.auth_requirements === "supabase",
  });
  const duration = Date.now() - started;

  const { error } = await session.supabase
    .from("app_change_experiments")
    .update({
      status: outcome.status,
      observations: outcome.observations,
      note: outcome.note,
      executed_at: new Date().toISOString(),
      duration_ms: duration,
    })
    .eq("id", experimentId)
    .eq("project_id", projectId)
    .eq("user_id", session.user.id);

  if (error) {
    console.error("runExperimentAction failed:", error.message);
    return fail("The experiment result couldn't be recorded. Nothing was changed in the project.");
  }

  refresh(projectId);
  return done(
    `Experiment recorded as ${outcome.status}. ${outcome.note} No external service or production user data was used.`,
  );
}

export async function convertExperimentAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const experimentId = readText(formData, "experiment_id");
  if (!isUuid(projectId) || !isUuid(experimentId)) return fail(NOT_AVAILABLE);

  const workspace = await getProjectModelWorkspace(session, projectId);
  if (!workspace || !workspace.experiments.some((experiment) => experiment.id === experimentId)) {
    return fail(NOT_AVAILABLE);
  }

  const { error } = await session.supabase.rpc("create_app_build_task_from_experiment", {
    p_experiment_id: experimentId,
  });
  if (error) {
    console.error("convertExperimentAction failed:", error.message);
    return fail(rpcMessage(error, "We couldn't create a project task from this experiment."));
  }

  refresh(projectId);
  return done(
    "Project task created in the Build Room. No files, deployment or production behavior changed.",
    `/build/${projectId}/room`,
  );
}
