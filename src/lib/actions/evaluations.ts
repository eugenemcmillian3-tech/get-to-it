"use server";

import { revalidatePath } from "next/cache";
import type { BuildState } from "@/lib/action-state";
import { isSafeProjectPath } from "@/lib/app-builder";
import { getSession } from "@/lib/auth";
import {
  EVAL_LIMITS,
  EVAL_REVIEW_STATUSES,
  EVALUATION_FIXTURE_FILES,
  buildCapabilityProfileDrafts,
  buildConfigurationRecommendation,
  evaluateFixture,
  planEvaluationRuns,
  seedEvaluationConfigurations,
  seedEvaluationTasks,
  type EvalReviewStatus,
  type EvalSnapshotFile,
  type EvaluationBudgetRecord,
  type EvaluationCapabilityProfileRecord,
  type EvaluationConfigurationRecord,
  type EvaluationRunRecord,
  type EvaluationTaskRecord,
  type EvaluationWorkspaceRecord,
} from "@/lib/evaluations";
import { isUuid, readText } from "@/lib/validation";

/**
 * Phase 32 evaluation actions.
 *
 * These actions write evaluation evidence only. They never call a provider,
 * never spend credits, and never change production routing, roles or prompts.
 * A recommendation records a proposal (and rollback snapshot) that the owner
 * must explicitly approve; even approval does not apply anything.
 */

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That evaluation workspace isn't available to you.";

type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

function fail(message: string): BuildState {
  return { status: "error", message, nonce: Date.now() };
}

function done(message: string): BuildState {
  return { status: "success", message, nonce: Date.now() };
}

function refresh(workspaceId?: string): void {
  revalidatePath("/evaluations");
  if (workspaceId) revalidatePath(`/evaluations/${workspaceId}`);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

async function ownerWorkspace(
  session: Session,
  workspaceId: string,
): Promise<EvaluationWorkspaceRecord | null> {
  if (!isUuid(workspaceId)) return null;
  const { data, error } = await session.supabase
    .from("app_eval_workspaces")
    .select("*")
    .eq("id", workspaceId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (error) {
    console.error("ownerWorkspace failed:", error.message);
    return null;
  }
  return (data as EvaluationWorkspaceRecord | null) ?? null;
}

function readSnapshot(files: unknown): EvalSnapshotFile[] | null {
  if (!Array.isArray(files) || files.length < 1 || files.length > EVAL_LIMITS.maxSnapshotFiles) {
    return null;
  }
  const snapshot: EvalSnapshotFile[] = [];
  let total = 0;
  for (const file of files) {
    if (
      typeof file !== "object" ||
      file === null ||
      typeof (file as { path?: unknown }).path !== "string" ||
      typeof (file as { content?: unknown }).content !== "string"
    ) {
      return null;
    }
    const path = (file as EvalSnapshotFile).path;
    const content = (file as EvalSnapshotFile).content;
    if (!isSafeProjectPath(path) || content.length > EVAL_LIMITS.maxFileChars) return null;
    total += content.length;
    if (total > EVAL_LIMITS.maxSnapshotChars) return null;
    snapshot.push({ path, content });
  }
  return snapshot;
}

export async function createEvaluationAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const name = readText(formData, "name").trim();
  const description = readText(formData, "description").trim();
  const projectId = readText(formData, "source_project_id").trim();
  const permissionConfirmed = readText(formData, "permission_confirmed") === "on";

  if (name.length < 3) return fail("Give the evaluation a name with at least 3 characters.");
  if (description.length > 1000) return fail("Keep the description under 1000 characters.");
  if (projectId && !isUuid(projectId)) return fail("Choose a valid source project.");

  let snapshot: EvalSnapshotFile[] | null = null;
  let sourceVersion = 0;
  let sourceProjectId: string | null = null;

  if (projectId) {
    if (!permissionConfirmed) {
      return fail("Confirm that you are allowed to use this project snapshot for evaluation.");
    }
    const { data: project } = await session.supabase
      .from("app_projects")
      .select("id, current_version")
      .eq("id", projectId)
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (!project) return fail("That project isn't available to you.");

    const requestedVersion = Number(readText(formData, "source_version"));
    let versionQuery = session.supabase
      .from("app_versions")
      .select("version, files")
      .eq("project_id", projectId)
      .eq("user_id", session.user.id);
    if (Number.isInteger(requestedVersion) && requestedVersion > 0) {
      versionQuery = versionQuery.eq("version", requestedVersion);
    } else {
      versionQuery = versionQuery.order("version", { ascending: false }).limit(1);
    }

    const { data: version, error: versionError } = await versionQuery.maybeSingle();
    if (versionError) {
      console.error("createEvaluationAction version failed:", versionError.message);
      return fail("We couldn't read that project snapshot.");
    }
    if (!version) return fail("Generate the project before using it as an evaluation snapshot.");

    snapshot = readSnapshot(version.files);
    if (!snapshot) {
      return fail("That snapshot has unsafe paths or exceeds the evaluation size limits.");
    }
    sourceVersion = version.version;
    sourceProjectId = project.id;
  } else {
    snapshot = EVALUATION_FIXTURE_FILES.map((file) => ({ ...file }));
  }

  const { data: workspace, error } = await session.supabase
    .from("app_eval_workspaces")
    .insert({
      user_id: session.user.id,
      name,
      description,
      source_project_id: sourceProjectId,
      source_kind: sourceProjectId ? "project" : "synthetic",
      source_version: sourceVersion,
      permission_confirmed: permissionConfirmed,
      status: "draft",
    })
    .select("*")
    .single();

  if (error || !workspace) {
    console.error("createEvaluationAction workspace failed:", error?.message);
    return fail("We couldn't create the evaluation workspace. Nothing was saved.");
  }

  const tasks = seedEvaluationTasks().map((task) => ({
    workspace_id: workspace.id,
    user_id: session.user.id,
    category: task.category,
    split: task.split,
    title: task.title,
    input_snapshot: snapshot,
    snapshot_version: sourceVersion,
    expected_output: task.expected_output,
    acceptance_checks: task.acceptance_checks,
    allowed_tools: task.allowed_tools,
    runtime_seconds: task.runtime_seconds,
    request_limit: task.request_limit,
  }));
  const configurations = seedEvaluationConfigurations().map((configuration) => ({
    workspace_id: workspace.id,
    user_id: session.user.id,
    ...configuration,
  }));

  const [tasksResult, configurationsResult] = await Promise.all([
    session.supabase.from("app_eval_tasks").insert(tasks),
    session.supabase.from("app_eval_configurations").insert(configurations),
  ]);

  if (tasksResult.error || configurationsResult.error) {
    console.error(
      "createEvaluationAction seed failed:",
      tasksResult.error?.message,
      configurationsResult.error?.message,
    );
    refresh();
    return fail(
      "The evaluation tasks couldn't be seeded. The workspace was left in draft and cannot run; create a new one.",
    );
  }

  const { error: activateError } = await session.supabase
    .from("app_eval_workspaces")
    .update({ status: "active" })
    .eq("id", workspace.id)
    .eq("user_id", session.user.id);
  if (activateError) {
    console.error("createEvaluationAction activate failed:", activateError.message);
    refresh();
    return fail(
      "The workspace was created but could not be activated. It was left in draft and cannot run.",
    );
  }

  refresh();
  return {
    ...done(
      `Evaluation created with ${tasks.length} tasks and ${configurations.length} configurations. Approve a run budget to compare them.`,
    ),
    link: `/evaluations/${workspace.id}`,
  };
}

export async function approveEvaluationBudgetAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const workspace = await ownerWorkspace(session, workspaceId);
  if (!workspace) return fail(NOT_AVAILABLE);

  const requestedRuns = Number(readText(formData, "approved_runs"));
  if (
    !Number.isInteger(requestedRuns) ||
    requestedRuns < EVAL_LIMITS.minBudgetRuns ||
    requestedRuns > EVAL_LIMITS.maxBudgetRuns
  ) {
    return fail(
      `Approve a whole number between ${EVAL_LIMITS.minBudgetRuns} and ${EVAL_LIMITS.maxBudgetRuns} runs.`,
    );
  }
  const approvedRuns = requestedRuns;

  const { data: existing } = await session.supabase
    .from("app_eval_budgets")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  const used = (existing as EvaluationBudgetRecord | null)?.used_runs ?? 0;
  if (approvedRuns < used) {
    return fail(`This budget already used ${used} runs. Approve at least that many.`);
  }

  const { error } = await session.supabase.from("app_eval_budgets").upsert(
    {
      workspace_id: workspaceId,
      user_id: session.user.id,
      approved_runs: approvedRuns,
      used_runs: used,
      status: used >= approvedRuns ? "exhausted" : "approved",
      approved_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id" },
  );

  if (error) {
    console.error("approveEvaluationBudgetAction failed:", error.message);
    return fail("We couldn't record that budget approval. Nothing was run.");
  }

  refresh(workspaceId);
  return done(
    `Run budget approved: ${approvedRuns} trials, ${used} already used. No paid provider call is made in fixture mode.`,
  );
}

export async function runEvaluationAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const workspace = await ownerWorkspace(session, workspaceId);
  if (!workspace) return fail(NOT_AVAILABLE);
  if (workspace.status !== "active") {
    return fail("This evaluation workspace is incomplete and cannot run. Create a new one.");
  }

  const trials = clamp(
    Number(readText(formData, "trials")),
    EVAL_LIMITS.minTrials,
    EVAL_LIMITS.maxTrials,
  );

  const [tasksResult, configsResult, budgetResult, runsResult] = await Promise.all([
    session.supabase
      .from("app_eval_tasks")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("user_id", session.user.id),
    session.supabase
      .from("app_eval_configurations")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("user_id", session.user.id)
      .eq("status", "active"),
    session.supabase
      .from("app_eval_budgets")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("user_id", session.user.id)
      .maybeSingle(),
    session.supabase
      .from("app_eval_runs")
      .select("id, task_id, config_id, trial")
      .eq("workspace_id", workspaceId)
      .eq("user_id", session.user.id),
  ]);

  for (const result of [tasksResult, configsResult, budgetResult, runsResult]) {
    if (result.error) {
      console.error("runEvaluationAction read failed:", result.error.message);
      return fail("We couldn't load the evaluation plan.");
    }
  }

  const tasks = (tasksResult.data ?? []) as EvaluationTaskRecord[];
  const configurations = (configsResult.data ?? []) as EvaluationConfigurationRecord[];
  const budget = (budgetResult.data as EvaluationBudgetRecord | null) ?? null;
  const runs = (runsResult.data ?? []) as Pick<
    EvaluationRunRecord,
    "task_id" | "config_id" | "trial"
  >[];

  const plan = planEvaluationRuns({ tasks, configurations, trials, existingRuns: runs, budget });
  if (!plan.ok) return fail(plan.reason);

  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const configById = new Map(configurations.map((config) => [config.id, config]));

  const evidence = plan.planned.map((item) => {
    const task = taskById.get(item.task_id);
    const configuration = configById.get(item.config_id);
    if (!task || !configuration) throw new Error("evaluation plan lost a task or configuration");
    const result = evaluateFixture({ task, config: configuration, trial: item.trial });
    return {
      workspace_id: workspaceId,
      task_id: task.id,
      config_id: configuration.id,
      user_id: session.user.id,
      category: task.category,
      split: task.split,
      trial: item.trial,
      ...result,
      human_review_status: "pending" as const,
      human_review_note: "",
      reviewed_at: null,
    };
  });

  const { error: insertError } = await session.supabase.from("app_eval_runs").insert(evidence);
  if (insertError) {
    console.error("runEvaluationAction insert failed:", insertError.message);
    return fail("The runs couldn't be recorded. The approved budget was not consumed.");
  }

  const failed = evidence.filter((run) => run.status !== "passed").length;
  refresh(workspaceId);
  return done(
    `Recorded ${evidence.length} trial(s) across ${tasks.length} task(s) and ${configurations.length} configuration(s). ${failed} did not pass and remain available to inspect.`,
  );
}

export async function reviewEvaluationRunAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const runId = readText(formData, "run_id");
  const workspace = await ownerWorkspace(session, workspaceId);
  if (!workspace || !isUuid(runId)) return fail(NOT_AVAILABLE);

  const reviewStatus = readText(formData, "review_status") as EvalReviewStatus;
  if (!EVAL_REVIEW_STATUSES.includes(reviewStatus)) return fail("Choose a valid review decision.");
  const note = readText(formData, "review_note").trim();
  if (note.length > EVAL_LIMITS.maxReviewNote) {
    return fail(`Keep the review note under ${EVAL_LIMITS.maxReviewNote} characters.`);
  }

  const { data: run } = await session.supabase
    .from("app_eval_runs")
    .select("id")
    .eq("id", runId)
    .eq("workspace_id", workspaceId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (!run) return fail(NOT_AVAILABLE);

  const { error } = await session.supabase
    .from("app_eval_runs")
    .update({
      human_review_status: reviewStatus,
      human_review_note: note,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", runId)
    .eq("workspace_id", workspaceId)
    .eq("user_id", session.user.id);

  if (error) {
    console.error("reviewEvaluationRunAction failed:", error.message);
    return fail("We couldn't save the review. The run evidence is unchanged.");
  }

  refresh(workspaceId);
  return done("Human review recorded. The deterministic result was not changed.");
}

export async function refreshCapabilityProfilesAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const workspace = await ownerWorkspace(session, workspaceId);
  if (!workspace) return fail(NOT_AVAILABLE);

  const [runsResult, profilesResult, configsResult] = await Promise.all([
    session.supabase
      .from("app_eval_runs")
      .select("id, config_id, category, status")
      .eq("workspace_id", workspaceId)
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: true })
      .limit(500),
    session.supabase
      .from("app_eval_capability_profiles")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("user_id", session.user.id)
      .order("version", { ascending: false }),
    session.supabase
      .from("app_eval_configurations")
      .select("id, label")
      .eq("workspace_id", workspaceId)
      .eq("user_id", session.user.id)
      .order("label", { ascending: true }),
  ]);

  if (runsResult.error || profilesResult.error || configsResult.error) {
    console.error(
      "refreshCapabilityProfilesAction read failed:",
      runsResult.error?.message,
      profilesResult.error?.message,
      configsResult.error?.message,
    );
    return fail("We couldn't load run evidence for the capability profiles.");
  }

  const drafts = buildCapabilityProfileDrafts(
    (runsResult.data ?? []) as Pick<
      EvaluationRunRecord,
      "id" | "config_id" | "category" | "status"
    >[],
    (configsResult.data ?? []) as Pick<EvaluationConfigurationRecord, "id" | "label">[],
  );
  const latest = new Map<string, EvaluationCapabilityProfileRecord>();
  for (const profile of (profilesResult.data ?? []) as EvaluationCapabilityProfileRecord[]) {
    const key = `${profile.config_id}:${profile.profile_key}`;
    if (!latest.has(key)) latest.set(key, profile);
  }

  const inserts = drafts.flatMap((draft) => {
    const previous = latest.get(`${draft.config_id}:${draft.profile_key}`);
    const sameEvidence =
      previous &&
      previous.summary === draft.summary &&
      previous.evidence_run_ids.length === draft.evidence_run_ids.length &&
      previous.evidence_run_ids.every((id, index) => id === draft.evidence_run_ids[index]);
    if (sameEvidence) return [];
    return [
      {
        workspace_id: workspaceId,
        config_id: draft.config_id,
        user_id: session.user.id,
        profile_key: draft.profile_key,
        version: (previous?.version ?? 0) + 1,
        label: draft.label,
        summary: draft.summary,
        suitable_for: draft.suitable_for,
        requires_review: draft.requires_review,
        evidence_run_ids: draft.evidence_run_ids,
        limitations: draft.limitations,
        status: "draft",
      },
    ];
  });

  if (inserts.length === 0) {
    refresh(workspaceId);
    return done("Capability profiles are already current for the recorded evidence.");
  }

  const { error } = await session.supabase
    .from("app_eval_capability_profiles")
    .insert(inserts);
  if (error) {
    console.error("refreshCapabilityProfilesAction insert failed:", error.message);
    return fail("We couldn't write the capability profiles.");
  }

  refresh(workspaceId);
  return done(
    `Recorded ${inserts.length} new capability profile version(s). Each cites evidence run IDs and its limitations.`,
  );
}

export async function proposeEvaluationChangeAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const workspace = await ownerWorkspace(session, workspaceId);
  if (!workspace) return fail(NOT_AVAILABLE);

  const [tasksResult, configsResult, runsResult, existingResult] = await Promise.all([
    session.supabase
      .from("app_eval_tasks")
      .select("id, title")
      .eq("workspace_id", workspaceId)
      .eq("user_id", session.user.id),
    session.supabase
      .from("app_eval_configurations")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("user_id", session.user.id),
    session.supabase
      .from("app_eval_runs")
      .select("id, task_id, config_id, status")
      .eq("workspace_id", workspaceId)
      .eq("user_id", session.user.id),
    session.supabase
      .from("app_eval_recommendations")
      .select("id, title")
      .eq("workspace_id", workspaceId)
      .eq("user_id", session.user.id)
      .eq("status", "proposed")
      .limit(1)
      .maybeSingle(),
  ]);

  for (const result of [tasksResult, configsResult, runsResult, existingResult]) {
    if (result.error) {
      console.error("proposeEvaluationChangeAction read failed:", result.error.message);
      return fail("We couldn't load comparison evidence.");
    }
  }

  if (existingResult.data) {
    return fail("A recommendation is already awaiting your decision. Approve or reject it first.");
  }

  const recommendation = buildConfigurationRecommendation(
    (tasksResult.data ?? []) as Pick<EvaluationTaskRecord, "id" | "title">[],
    (configsResult.data ?? []) as EvaluationConfigurationRecord[],
    (runsResult.data ?? []) as Pick<
      EvaluationRunRecord,
      "id" | "task_id" | "config_id" | "status"
    >[],
  );
  if (!recommendation) {
    return fail(
      "There isn't enough comparable evidence yet. Run at least two configurations on the same two tasks, then try again.",
    );
  }

  const { error } = await session.supabase.from("app_eval_recommendations").insert({
    workspace_id: workspaceId,
    user_id: session.user.id,
    status: "proposed",
    ...recommendation,
  });
  if (error) {
    console.error("proposeEvaluationChangeAction insert failed:", error.message);
    return fail("We couldn't record the recommendation. No configuration was changed.");
  }

  refresh(workspaceId);
  return done(
    "Recommendation proposed. Production routing is unchanged; approval records a decision only and the rollback snapshot is preserved.",
  );
}

export async function decideEvaluationChangeAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const recommendationId = readText(formData, "recommendation_id");
  const decision = readText(formData, "decision");
  const workspace = await ownerWorkspace(session, workspaceId);
  if (!workspace || !isUuid(recommendationId)) return fail(NOT_AVAILABLE);
  if (decision !== "approve" && decision !== "reject") return fail("Choose approve or reject.");

  const { data: recommendation } = await session.supabase
    .from("app_eval_recommendations")
    .select("id, status")
    .eq("id", recommendationId)
    .eq("workspace_id", workspaceId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (!recommendation) return fail(NOT_AVAILABLE);
  if (recommendation.status !== "proposed") {
    return fail("That recommendation already has a decision.");
  }

  const { error } = await session.supabase
    .from("app_eval_recommendations")
    .update({
      status: decision === "approve" ? "approved" : "rejected",
      approved_at: decision === "approve" ? new Date().toISOString() : null,
    })
    .eq("id", recommendationId)
    .eq("workspace_id", workspaceId)
    .eq("user_id", session.user.id);

  if (error) {
    console.error("decideEvaluationChangeAction failed:", error.message);
    return fail("We couldn't record that decision. Nothing was applied.");
  }

  refresh(workspaceId);
  return done(
    decision === "approve"
      ? "Recommendation approved and recorded. Production routing, roles and prompts are still unchanged; apply the change deliberately using the preserved rollback snapshot."
      : "Recommendation rejected. Production configuration is unchanged.",
  );
}
