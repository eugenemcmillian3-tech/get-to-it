"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ExperimentState } from "@/lib/action-state";
import {
  AppBuildError,
  buildProjectFiles,
  buildSpecDraft,
  intakeProblems,
} from "@/lib/app-builder";
import { getSession, type Session } from "@/lib/auth";
import type { Experiment } from "@/lib/experiments";
import {
  EXPERIMENT_NOTES,
  HIGH_STAKES_REFUSAL,
  experimentApprovalDecisionSchema,
  experimentApprovalSchema,
  experimentFeedbackSchema,
  experimentInputSchema,
  experimentObservationSchema,
  experimentReadiness,
  experimentReviewSchema,
  highStakesProblem,
  prototypeIntake,
} from "@/lib/experiments";
import { firstErrorMessage, isUuid, readText } from "@/lib/validation";
import type { WorkspaceRole } from "@/lib/types";

/**
 * Phase 35 actions.
 *
 * Every write is scoped to workspace membership and repeated by RLS. The
 * actions do not send outreach, publish anything, charge anyone, run generated
 * code or deploy. An approved prototype is an ordinary app-builder project and
 * still needs the existing sandbox, test and deployment approvals.
 */

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That experiment isn't available to you.";
const NO_PERMISSION =
  "Your role in this workspace doesn't allow that. Nothing was changed.";

function fail(message: string): ExperimentState {
  return { status: "error", message, nonce: Date.now() };
}

function done(message: string): ExperimentState {
  return { status: "success", message, nonce: Date.now() };
}

function refresh(workspaceId: string, experimentId?: string): void {
  revalidatePath(`/workspace/${workspaceId}/experiments`);
  if (experimentId) {
    revalidatePath(`/workspace/${workspaceId}/experiments/${experimentId}`);
  }
}

async function roleIn(
  session: Session,
  workspaceId: string,
): Promise<WorkspaceRole | null> {
  const { data, error } = await session.supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", session.user.id)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    console.error("experiment roleIn failed:", error.message);
    return null;
  }
  return (data as { role: WorkspaceRole } | null)?.role ?? null;
}

async function experimentIn(
  session: Session,
  workspaceId: string,
  experimentId: string,
): Promise<Experiment | null> {
  const { data, error } = await session.supabase
    .from("experiments")
    .select("*")
    .eq("id", experimentId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    console.error("experiment lookup failed:", error.message);
    return null;
  }
  return (data as Experiment | null) ?? null;
}

function uuidOrNull(value: string): string | null {
  return isUuid(value.trim()) ? value.trim() : null;
}

async function ownsRecord(
  session: Session,
  table: string,
  id: string,
): Promise<boolean> {
  const { data } = await session.supabase
    .from(table)
    .select("id")
    .eq("id", id)
    .eq("user_id", session.user.id)
    .maybeSingle();
  return Boolean(data);
}

async function appendEvent(
  session: Session,
  experiment: Pick<Experiment, "id" | "workspace_id">,
  kind: string,
  detail: string,
): Promise<void> {
  const { error } = await session.supabase.from("experiment_events").insert({
    experiment_id: experiment.id,
    workspace_id: experiment.workspace_id,
    actor_id: session.user.id,
    kind,
    detail: detail.slice(0, 1000),
  });
  if (error) {
    console.error("append experiment event failed:", error.message);
  }
}

// ---------------------------------------------------------------------------
// Experiment record
// ---------------------------------------------------------------------------

export async function createExperimentAction(
  _previous: ExperimentState,
  formData: FormData,
): Promise<ExperimentState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = experimentInputSchema.safeParse({
    workspace_id: readText(formData, "workspace_id"),
    mission_id: readText(formData, "mission_id"),
    future_path_id: readText(formData, "future_path_id"),
    radar_signal_id: readText(formData, "radar_signal_id"),
    learning_goal_id: readText(formData, "learning_goal_id"),
    outcome_review_id: readText(formData, "outcome_review_id"),
    question: readText(formData, "question"),
    hypothesis: readText(formData, "hypothesis"),
    target_users: readText(formData, "target_users"),
    evidence_available: readText(formData, "evidence_available"),
    assumptions: readText(formData, "assumptions"),
    proposed_prototype: readText(formData, "proposed_prototype"),
    success_criteria: readText(formData, "success_criteria"),
    failure_criteria: readText(formData, "failure_criteria"),
    time_limit_minutes: readText(formData, "time_limit_minutes"),
    resource_limit: readText(formData, "resource_limit"),
    privacy_requirements: readText(formData, "privacy_requirements"),
    consent_requirements: readText(formData, "consent_requirements"),
    stop_conditions: readText(formData, "stop_conditions"),
    ai_disclosure: readText(formData, "ai_disclosure"),
    review_at: readText(formData, "review_at"),
    high_stakes: readText(formData, "high_stakes") === "yes",
  });

  if (!parsed.success) return fail(firstErrorMessage(parsed.error));
  const input = parsed.data;

  const refusal = highStakesProblem(input.high_stakes);
  if (refusal) return fail(refusal);

  if (!(await roleIn(session, input.workspace_id))) return fail(NO_PERMISSION);

  if (input.mission_id !== "") {
    const { data: mission } = await session.supabase
      .from("missions")
      .select("id")
      .eq("id", input.mission_id)
      .eq("workspace_id", input.workspace_id)
      .maybeSingle();
    if (!mission) return fail("That mission is not in this workspace.");
  }

  const linked: [string, string, string][] = [
    ["future_paths", input.future_path_id, "future path"],
    ["radar_signals", input.radar_signal_id, "radar signal"],
    ["goals", input.learning_goal_id, "learning goal"],
    ["outcome_reviews", input.outcome_review_id, "outcome review"],
  ];

  for (const [table, id, label] of linked) {
    if (id !== "" && !(await ownsRecord(session, table, id))) {
      return fail(`That ${label} isn't one of your records. Nothing was created.`);
    }
  }

  const readiness = experimentReadiness(input);

  const { data: created, error } = await session.supabase
    .from("experiments")
    .insert({
      workspace_id: input.workspace_id,
      mission_id: uuidOrNull(input.mission_id),
      future_path_id: uuidOrNull(input.future_path_id),
      radar_signal_id: uuidOrNull(input.radar_signal_id),
      learning_goal_id: uuidOrNull(input.learning_goal_id),
      outcome_review_id: uuidOrNull(input.outcome_review_id),
      created_by: session.user.id,
      question: input.question,
      hypothesis: input.hypothesis,
      target_users: input.target_users,
      evidence_available: input.evidence_available,
      assumptions: input.assumptions,
      proposed_prototype: input.proposed_prototype,
      success_criteria: input.success_criteria,
      failure_criteria: input.failure_criteria,
      time_limit_minutes: input.time_limit_minutes,
      resource_limit: input.resource_limit,
      privacy_requirements: input.privacy_requirements,
      consent_requirements: input.consent_requirements,
      stop_conditions: input.stop_conditions,
      ai_disclosure: input.ai_disclosure,
      high_stakes: false,
      review_at: input.review_at,
      status: readiness.ready ? "ready" : "draft",
    })
    .select("id")
    .single();

  if (error || !created) {
    console.error("createExperimentAction failed:", error?.message);
    return fail("We couldn't save that experiment. Nothing was created.");
  }

  const experimentId = created.id as string;
  await appendEvent(
    session,
    { id: experimentId, workspace_id: input.workspace_id },
    "created",
    "Experiment record created. No participant, result or prototype was invented.",
  );

  refresh(input.workspace_id, experimentId);
  redirect(`/workspace/${input.workspace_id}/experiments/${experimentId}`);
}

// ---------------------------------------------------------------------------
// Observations and consented feedback
// ---------------------------------------------------------------------------

export async function addExperimentObservationAction(
  _previous: ExperimentState,
  formData: FormData,
): Promise<ExperimentState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = experimentObservationSchema.safeParse({
    workspace_id: readText(formData, "workspace_id"),
    experiment_id: readText(formData, "experiment_id"),
    kind: readText(formData, "kind"),
    text: readText(formData, "text"),
    source: readText(formData, "source"),
  });
  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const input = parsed.data;
  if (!(await roleIn(session, input.workspace_id))) return fail(NO_PERMISSION);
  const experiment = await experimentIn(
    session,
    input.workspace_id,
    input.experiment_id,
  );
  if (!experiment) return fail(NOT_AVAILABLE);

  const { error } = await session.supabase.from("experiment_observations").insert({
    experiment_id: input.experiment_id,
    workspace_id: input.workspace_id,
    author_id: session.user.id,
    kind: input.kind,
    text: input.text,
    source: input.source,
  });

  if (error) {
    console.error("addExperimentObservationAction failed:", error.message);
    return fail("We couldn't append that observation. Nothing changed.");
  }

  await appendEvent(
    session,
    experiment,
    "observation_added",
    `Appended a ${input.kind.replace("_", " ")} observation.`,
  );
  refresh(input.workspace_id, input.experiment_id);
  return done("Observation appended. Earlier observations were not changed.");
}

export async function addExperimentFeedbackAction(
  _previous: ExperimentState,
  formData: FormData,
): Promise<ExperimentState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = experimentFeedbackSchema.safeParse({
    workspace_id: readText(formData, "workspace_id"),
    experiment_id: readText(formData, "experiment_id"),
    kind: readText(formData, "kind"),
    participant_reference: readText(formData, "participant_reference"),
    text: readText(formData, "text"),
    identifiable: readText(formData, "identifiable") === "yes",
    consent_confirmed: readText(formData, "consent_confirmed") === "yes",
    consent_note: readText(formData, "consent_note"),
    permission_to_quote: readText(formData, "permission_to_quote") === "yes",
  });
  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const input = parsed.data;
  if (!input.consent_confirmed) {
    return fail(
      "Record consent before storing feedback. Without consent nothing is saved.",
    );
  }
  if (input.identifiable) {
    if (input.consent_note.trim().length < 10) {
      return fail("Describe the consent for identifiable feedback in at least 10 characters.");
    }
    if (!input.permission_to_quote) {
      return fail("Identifiable feedback needs explicit permission to quote it.");
    }
  }

  if (!(await roleIn(session, input.workspace_id))) return fail(NO_PERMISSION);
  const experiment = await experimentIn(
    session,
    input.workspace_id,
    input.experiment_id,
  );
  if (!experiment) return fail(NOT_AVAILABLE);

  const { error } = await session.supabase.from("experiment_feedback").insert({
    experiment_id: input.experiment_id,
    workspace_id: input.workspace_id,
    author_id: session.user.id,
    kind: input.kind,
    participant_reference: input.participant_reference,
    text: input.text,
    identifiable: input.identifiable,
    consent_confirmed: true,
    consent_note: input.consent_note,
    permission_to_quote: input.permission_to_quote,
  });

  if (error) {
    console.error("addExperimentFeedbackAction failed:", error.message);
    return fail("We couldn't save that feedback. Nothing changed.");
  }

  await appendEvent(
    session,
    experiment,
    "feedback_added",
    `Consented ${input.kind} feedback recorded.`,
  );
  refresh(input.workspace_id, input.experiment_id);
  return done(
    "Consented feedback recorded. It is kept separate from measured observations.",
  );
}

// ---------------------------------------------------------------------------
// Separate approvals
// ---------------------------------------------------------------------------

function approvalFailure(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const value = data as { ok?: boolean; code?: string };
  if (value.ok !== false) return null;
  switch (value.code) {
    case "forbidden":
      return NO_PERMISSION;
    case "self-approval":
      return "A separate owner or admin must decide this request. You cannot approve your own request.";
    case "agent-approval":
      return "An agent request needs a human decision.";
    case "not-pending":
      return "That approval was already decided.";
    case "invalid-decision":
      return "Choose approved or rejected.";
    default:
      return "That approval wasn't available. Nothing changed.";
  }
}

export async function requestExperimentApprovalAction(
  _previous: ExperimentState,
  formData: FormData,
): Promise<ExperimentState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = experimentApprovalSchema.safeParse({
    workspace_id: readText(formData, "workspace_id"),
    experiment_id: readText(formData, "experiment_id"),
    kind: readText(formData, "kind"),
    summary: readText(formData, "summary"),
    scope: readText(formData, "scope"),
  });
  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const input = parsed.data;
  if (input.kind === "high_stakes") return fail(HIGH_STAKES_REFUSAL);
  if (!(await roleIn(session, input.workspace_id))) return fail(NO_PERMISSION);
  const experiment = await experimentIn(
    session,
    input.workspace_id,
    input.experiment_id,
  );
  if (!experiment) return fail(NOT_AVAILABLE);

  const { error } = await session.supabase.from("experiment_approvals").insert({
    experiment_id: input.experiment_id,
    workspace_id: input.workspace_id,
    kind: input.kind,
    summary: input.summary,
    scope: input.scope,
    requested_by: session.user.id,
    requested_by_kind: "human",
  });

  if (error) {
    console.error("requestExperimentApprovalAction failed:", error.message);
    return fail("We couldn't record that request. Nothing changed.");
  }

  await appendEvent(
    session,
    experiment,
    "approval_requested",
    `${input.kind}: ${input.summary}`,
  );
  refresh(input.workspace_id, input.experiment_id);
  return done(
    "Approval requested. A different owner or admin must decide it, and approval performs no external action.",
  );
}

export async function decideExperimentApprovalAction(
  _previous: ExperimentState,
  formData: FormData,
): Promise<ExperimentState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = experimentApprovalDecisionSchema.safeParse({
    workspace_id: readText(formData, "workspace_id"),
    experiment_id: readText(formData, "experiment_id"),
    approval_id: readText(formData, "approval_id"),
    decision: readText(formData, "decision"),
    note: readText(formData, "note"),
  });
  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const input = parsed.data;
  const { data, error } = await session.supabase.rpc("experiment_decide_approval", {
    p_approval_id: input.approval_id,
    p_decision: input.decision,
    p_note: input.note,
  });

  if (error) {
    console.error("decideExperimentApprovalAction failed:", error.message);
    return fail("We couldn't record that decision. Nothing changed.");
  }
  const refusal = approvalFailure(data);
  if (refusal) return fail(refusal);

  refresh(input.workspace_id, input.experiment_id);
  return done(
    input.decision === "approved"
      ? "Approval recorded by a separate person. No outreach, publication, payment or deployment was performed."
      : "Request rejected. The record stays visible.",
  );
}

// ---------------------------------------------------------------------------
// Prototype promotion through the normal app builder
// ---------------------------------------------------------------------------

export async function approveExperimentPrototypeAction(
  _previous: ExperimentState,
  formData: FormData,
): Promise<ExperimentState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const experimentId = readText(formData, "experiment_id");
  if (!isUuid(workspaceId) || !isUuid(experimentId)) return fail(NOT_AVAILABLE);

  const role = await roleIn(session, workspaceId);
  if (!role) return fail(NO_PERMISSION);

  const experiment = await experimentIn(session, workspaceId, experimentId);
  if (!experiment) return fail(NOT_AVAILABLE);

  if (experiment.prototype_project_id) {
    return fail("This experiment already has an approved prototype project.");
  }

  const intake = prototypeIntake(experiment);
  const problems = intakeProblems(intake);
  if (problems.length > 0) return fail(problems.join(" "));

  let spec;
  try {
    spec = buildSpecDraft(intake);
    buildProjectFiles(spec, { name: intake.name, purpose: intake.purpose });
  } catch (error) {
    if (error instanceof AppBuildError) return fail(error.message);
    throw error;
  }

  const { data: project, error: projectError } = await session.supabase
    .from("app_projects")
    .insert({
      user_id: session.user.id,
      workspace_id: workspaceId,
      name: intake.name,
      purpose: intake.purpose,
      target_users: intake.target_users,
      workflows: intake.workflows,
      required_pages: intake.required_pages,
      entities: intake.entities,
      auth_requirements: intake.auth_requirements,
      integrations: intake.integrations,
      design_preferences: intake.design_preferences,
      definition_of_done: intake.definition_of_done,
      status: "spec_draft",
    })
    .select("id")
    .single();

  if (projectError || !project) {
    console.error("approveExperimentPrototypeAction project failed:", projectError?.message);
    return fail("We couldn't create a normal app project. Nothing was linked.");
  }

  const projectId = project.id as string;
  const { error: specError } = await session.supabase.from("app_specs").insert({
    project_id: projectId,
    user_id: session.user.id,
    version: 1,
    spec,
  });

  if (specError) {
    await session.supabase
      .from("app_projects")
      .delete()
      .eq("id", projectId)
      .eq("user_id", session.user.id);
    console.error("approveExperimentPrototypeAction spec failed:", specError.message);
    return fail("The specification could not be saved, so the project was removed.");
  }

  const { data: approval, error: approvalError } = await session.supabase.rpc(
    "experiment_approve_prototype",
    { p_experiment_id: experimentId, p_project_id: projectId },
  );

  const refusal = approvalError
    ? null
    : approvalFailure(approval);
  if (approvalError || refusal) {
    await session.supabase
      .from("app_projects")
      .delete()
      .eq("id", projectId)
      .eq("user_id", session.user.id);
    console.error(
      "approveExperimentPrototypeAction approval failed:",
      approvalError?.message ?? refusal,
    );
    return fail(refusal ?? "The approval couldn't be recorded. The project was removed.");
  }

  refresh(workspaceId, experimentId);
  revalidatePath("/build");
  revalidatePath(`/build/${projectId}`);
  redirect(`/build/${projectId}`);
}

// ---------------------------------------------------------------------------
// Outcome review and human decision
// ---------------------------------------------------------------------------

export async function saveExperimentReviewAction(
  _previous: ExperimentState,
  formData: FormData,
): Promise<ExperimentState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = experimentReviewSchema.safeParse({
    workspace_id: readText(formData, "workspace_id"),
    experiment_id: readText(formData, "experiment_id"),
    built: readText(formData, "built"),
    observed: readText(formData, "observed"),
    failed: readText(formData, "failed"),
    unknown: readText(formData, "unknown"),
    decision: readText(formData, "decision"),
    decision_note: readText(formData, "decision_note"),
  });
  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const input = parsed.data;
  const role = await roleIn(session, input.workspace_id);
  if (!role) return fail(NO_PERMISSION);

  const experiment = await experimentIn(
    session,
    input.workspace_id,
    input.experiment_id,
  );
  if (!experiment) return fail(NOT_AVAILABLE);
  if (
    experiment.created_by !== session.user.id &&
    role !== "owner" &&
    role !== "admin"
  ) {
    return fail(NO_PERMISSION);
  }

  const { data: existing } = await session.supabase
    .from("experiment_reviews")
    .select("id, decision")
    .eq("experiment_id", input.experiment_id)
    .eq("workspace_id", input.workspace_id)
    .maybeSingle();

  if (existing && (existing as { decision: string }).decision !== "undecided") {
    return fail("This review already has a decision. It cannot be rewritten.");
  }

  const decided = input.decision !== "undecided";
  const payload = {
    built: input.built,
    observed: input.observed,
    failed: input.failed,
    unknown: input.unknown,
    decision: input.decision,
    decision_note: input.decision_note,
    decided_by: decided ? session.user.id : null,
    decided_at: decided ? new Date().toISOString() : null,
  };

  if (existing) {
    const { error } = await session.supabase
      .from("experiment_reviews")
      .update(payload)
      .eq("id", (existing as { id: string }).id)
      .eq("workspace_id", input.workspace_id);
    if (error) {
      console.error("saveExperimentReviewAction update failed:", error.message);
      return fail("We couldn't save that review. Nothing changed.");
    }
  } else {
    const { error } = await session.supabase.from("experiment_reviews").insert({
      experiment_id: input.experiment_id,
      workspace_id: input.workspace_id,
      ...payload,
    });
    if (error) {
      console.error("saveExperimentReviewAction insert failed:", error.message);
      return fail("We couldn't start that review. Nothing changed.");
    }
  }

  const nextStatus =
    input.decision === "stop"
      ? "stopped"
      : decided
        ? "completed"
        : "awaiting_review";
  const { error: statusError } = await session.supabase
    .from("experiments")
    .update({ status: nextStatus })
    .eq("id", input.experiment_id)
    .eq("workspace_id", input.workspace_id);

  if (statusError) {
    console.error("saveExperimentReviewAction status failed:", statusError.message);
  }

  await appendEvent(
    session,
    experiment,
    decided ? "review_decided" : "review_saved",
    decided
      ? `Human decision: ${input.decision}. ${input.decision_note}`.trim()
      : "Review notes saved without a decision.",
  );

  refresh(input.workspace_id, input.experiment_id);
  return done(
    decided
      ? `Decision recorded: ${input.decision}. ${EXPERIMENT_NOTES.outcomeHonesty}`
      : "Review notes saved. The decision stays open and can be recorded later.",
  );
}
