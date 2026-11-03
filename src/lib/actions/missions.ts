"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { MissionState } from "@/lib/action-state";
import { finishAiRequest, reserveAiRequest } from "@/lib/ai/limits";
import { DEFAULT_AI_MODEL, isAiModel } from "@/lib/ai/models";
import { chatWithOllama, ollamaErrorMessage } from "@/lib/ai/ollama";
import { getSession, type Session } from "@/lib/auth";
import { getMissionDetail } from "@/lib/data/missions";
import {
  buildAssistanceMessages,
  canApproveShare,
  canContribute,
  canDeleteEvidence,
  canDeleteOutcome,
  canManageMissions,
  canRecordDecision,
  canResolveReport,
  canReviewSuggestion,
  isSuggestionKind,
  missionCreateSchema,
  missionDecisionSchema,
  missionEvidenceSchema,
  missionOutcomeSchema,
  missionReportSchema,
  missionShareSchema,
  missionSuggestionReviewSchema,
  missionTaskSchema,
  missionUpdateSchema,
  sanitizeSuggestion,
  shareBlockers,
  type OutcomeSummary,
} from "@/lib/missions";
import { sourceUrlProblem } from "@/lib/radar";
import { firstErrorMessage, isUuid, readText } from "@/lib/validation";
import type { WorkspaceRole } from "@/lib/types";

/**
 * Mission actions.
 *
 * The database policies are the security boundary: each write below is also
 * scoped to the caller's active membership and role. These checks exist so the
 * person gets a plain explanation instead of a silent refusal.
 *
 * No action publishes, sends, contacts anyone, allocates a service, or scores a
 * person. The only network call is one explicitly requested AI suggestion.
 */

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That mission isn't available to you.";
const NO_PERMISSION =
  "Your role in this workspace doesn't allow that. Nothing was changed.";
const ASSIST_TIMEOUT_MS = 45_000;

function fail(message: string, remaining?: number): MissionState {
  return { status: "error", message, remaining, nonce: Date.now() };
}

function done(message: string, remaining?: number): MissionState {
  return { status: "success", message, remaining, nonce: Date.now() };
}

function refresh(workspaceId: string, missionId?: string): void {
  revalidatePath(`/workspace/${workspaceId}/missions`);
  if (missionId) revalidatePath(`/workspace/${workspaceId}/missions/${missionId}`);
}

/** The caller's active role in the workspace, or null. */
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
    console.error("roleIn failed:", error.message);
    return null;
  }

  return (data as { role: WorkspaceRole } | null)?.role ?? null;
}

function permissionFailure(): MissionState {
  return fail(NO_PERMISSION);
}

function uuidOrNull(value: string): string | null {
  const trimmed = value.trim();
  return isUuid(trimmed) ? trimmed : null;
}

// ---------------------------------------------------------------------------
// Creating and defining a mission
// ---------------------------------------------------------------------------

export async function createMissionAction(
  _previous: MissionState,
  formData: FormData,
): Promise<MissionState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = missionCreateSchema.safeParse({
    workspace_id: readText(formData, "workspace_id"),
    title: readText(formData, "title"),
    category: readText(formData, "category"),
    problem: readText(formData, "problem"),
    stakeholders: readText(formData, "stakeholders"),
    desired_outcome: readText(formData, "desired_outcome"),
    constraints: readText(formData, "constraints"),
    review_at: readText(formData, "review_at"),
  });

  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const input = parsed.data;
  const role = await roleIn(session, input.workspace_id);
  if (!canManageMissions(role)) return permissionFailure();

  const { data: mission, error } = await session.supabase
    .from("missions")
    .insert({
      workspace_id: input.workspace_id,
      created_by: session.user.id,
      title: input.title,
      category: input.category,
      problem: input.problem,
      stakeholders: input.stakeholders,
      desired_outcome: input.desired_outcome,
      constraints: input.constraints,
      review_at: input.review_at === "" ? null : input.review_at,
      decision_owner_id: session.user.id,
      status: "draft",
    })
    .select("id")
    .single();

  if (error || !mission) {
    console.error("createMissionAction failed:", error?.message);
    return fail("We couldn't create that mission. Nothing changed.");
  }

  refresh(input.workspace_id, mission.id as string);
  redirect(`/workspace/${input.workspace_id}/missions/${mission.id}`);
}

/** Status, decision owner and review date. Owner or admin only. */
export async function updateMissionAction(
  _previous: MissionState,
  formData: FormData,
): Promise<MissionState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = missionUpdateSchema.safeParse({
    workspace_id: readText(formData, "workspace_id"),
    mission_id: readText(formData, "mission_id"),
    status: readText(formData, "status"),
    decision_owner_id: readText(formData, "decision_owner_id"),
    review_at: readText(formData, "review_at"),
  });

  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const input = parsed.data;
  const role = await roleIn(session, input.workspace_id);
  if (!canManageMissions(role)) return permissionFailure();

  const ownerId = uuidOrNull(input.decision_owner_id);
  if (input.decision_owner_id !== "" && ownerId === null) {
    return fail("Choose one of the workspace members as the decision owner.");
  }

  if (ownerId) {
    const { data: member } = await session.supabase
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", input.workspace_id)
      .eq("user_id", ownerId)
      .eq("status", "active")
      .maybeSingle();

    if (!member) return fail("The decision owner has to be an active member.");
  }

  const { error } = await session.supabase
    .from("missions")
    .update({
      status: input.status,
      decision_owner_id: ownerId,
      review_at: input.review_at === "" ? null : input.review_at,
    })
    .eq("id", input.mission_id)
    .eq("workspace_id", input.workspace_id);

  if (error) {
    console.error("updateMissionAction failed:", error.message);
    return fail("We couldn't update that mission. Nothing changed.");
  }

  refresh(input.workspace_id, input.mission_id);
  return done("Mission updated. Review dates are reminders, not deadlines.");
}

// ---------------------------------------------------------------------------
// Evidence and assumptions
// ---------------------------------------------------------------------------

export async function addEvidenceAction(
  _previous: MissionState,
  formData: FormData,
): Promise<MissionState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = missionEvidenceSchema.safeParse({
    workspace_id: readText(formData, "workspace_id"),
    mission_id: readText(formData, "mission_id"),
    kind: readText(formData, "kind"),
    text: readText(formData, "text"),
    source_url: readText(formData, "source_url"),
    contains_personal_story: readText(formData, "contains_personal_story") === "yes",
    consent_note: readText(formData, "consent_note"),
  });

  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const input = parsed.data;
  const role = await roleIn(session, input.workspace_id);
  if (!canContribute(role)) return permissionFailure();

  const url = input.source_url.trim();
  if (url !== "") {
    const problem = sourceUrlProblem(url);
    if (problem) return fail(problem);
  }

  if (input.contains_personal_story && input.consent_note.length < 10) {
    return fail(
      "A personal story needs a recorded consent note of at least 10 characters before it can be stored.",
    );
  }

  const { error } = await session.supabase.from("mission_evidence").insert({
    mission_id: input.mission_id,
    workspace_id: input.workspace_id,
    author_id: session.user.id,
    kind: input.kind,
    text: input.text,
    source_url: url === "" ? null : url,
    contains_personal_story: input.contains_personal_story,
    consent_note: input.contains_personal_story ? input.consent_note : null,
    consent_recorded_by: input.contains_personal_story ? session.user.id : null,
    consent_at: input.contains_personal_story ? new Date().toISOString() : null,
  });

  if (error) {
    console.error("addEvidenceAction failed:", error.message);
    return fail("We couldn't save that. Nothing changed.");
  }

  refresh(input.workspace_id, input.mission_id);
  return done(
    input.kind === "assumption"
      ? "Assumption recorded as an assumption. It stays labelled that way."
      : "Evidence recorded with its source. It is not treated as proof of impact.",
  );
}

export async function deleteEvidenceAction(
  _previous: MissionState,
  formData: FormData,
): Promise<MissionState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const missionId = readText(formData, "mission_id");
  const evidenceId = readText(formData, "evidence_id");
  if (!isUuid(workspaceId) || !isUuid(missionId) || !isUuid(evidenceId)) {
    return fail(NOT_AVAILABLE);
  }

  const { data: evidence } = await session.supabase
    .from("mission_evidence")
    .select("author_id, workspace_id, mission_id")
    .eq("id", evidenceId)
    .maybeSingle();

  if (!evidence) return fail(NOT_AVAILABLE);

  const role = await roleIn(session, workspaceId);
  if (!canDeleteEvidence(role, session.user.id, evidence.author_id as string | null)) {
    return permissionFailure();
  }

  const { error } = await session.supabase
    .from("mission_evidence")
    .delete()
    .eq("id", evidenceId)
    .eq("workspace_id", workspaceId);

  if (error) {
    console.error("deleteEvidenceAction failed:", error.message);
    return fail("We couldn't remove that. Nothing changed.");
  }

  refresh(workspaceId, missionId);
  return done("Removed for everyone. A deleted contribution cannot be restored.");
}

// ---------------------------------------------------------------------------
// Human decisions
// ---------------------------------------------------------------------------

export async function addDecisionAction(
  _previous: MissionState,
  formData: FormData,
): Promise<MissionState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = missionDecisionSchema.safeParse({
    workspace_id: readText(formData, "workspace_id"),
    mission_id: readText(formData, "mission_id"),
    title: readText(formData, "title"),
    summary: readText(formData, "summary"),
    decided_by: readText(formData, "decided_by"),
    dissent: readText(formData, "dissent"),
  });

  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const input = parsed.data;
  const role = await roleIn(session, input.workspace_id);
  if (!canRecordDecision(role)) return permissionFailure();

  const { data: approver } = await session.supabase
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", input.workspace_id)
    .eq("user_id", input.decided_by)
    .eq("status", "active")
    .maybeSingle();

  if (!approver) return fail("Record who approved it: choose an active member.");

  const { error } = await session.supabase.from("mission_decisions").insert({
    mission_id: input.mission_id,
    workspace_id: input.workspace_id,
    created_by: session.user.id,
    title: input.title,
    summary: input.summary,
    decided_by: input.decided_by,
    dissent: input.dissent === "" ? null : input.dissent,
  });

  if (error) {
    console.error("addDecisionAction failed:", error.message);
    return fail("We couldn't record that decision. Nothing changed.");
  }

  refresh(input.workspace_id, input.mission_id);
  return done(
    "Decision recorded with the person who approved it. Dissent, if any, stays visible.",
  );
}

// ---------------------------------------------------------------------------
// Shared tasks
// ---------------------------------------------------------------------------

export async function addMissionTaskAction(
  _previous: MissionState,
  formData: FormData,
): Promise<MissionState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = missionTaskSchema.safeParse({
    workspace_id: readText(formData, "workspace_id"),
    mission_id: readText(formData, "mission_id"),
    title: readText(formData, "title"),
    assignee_id: readText(formData, "assignee_id"),
  });

  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const input = parsed.data;
  const role = await roleIn(session, input.workspace_id);
  if (!canContribute(role)) return permissionFailure();

  const assignee = uuidOrNull(input.assignee_id);
  if (assignee) {
    const { data: member } = await session.supabase
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", input.workspace_id)
      .eq("user_id", assignee)
      .eq("status", "active")
      .maybeSingle();

    if (!member) return fail("Choose an active member, or leave the task unassigned.");
  }

  const { error } = await session.supabase.from("mission_tasks").insert({
    mission_id: input.mission_id,
    workspace_id: input.workspace_id,
    created_by: session.user.id,
    title: input.title,
    assignee_id: assignee,
  });

  if (error) {
    console.error("addMissionTaskAction failed:", error.message);
    return fail("We couldn't add that task. Nothing changed.");
  }

  refresh(input.workspace_id, input.mission_id);
  return done("Task added as shared work. Finishing it counts as work, not impact.");
}

/** Owners and admins may update any task; a member may update their own. */
export async function setMissionTaskStatusAction(
  _previous: MissionState,
  formData: FormData,
): Promise<MissionState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const missionId = readText(formData, "mission_id");
  const taskId = readText(formData, "task_id");
  const status = readText(formData, "status");

  if (!isUuid(workspaceId) || !isUuid(missionId) || !isUuid(taskId)) {
    return fail(NOT_AVAILABLE);
  }
  if (status !== "todo" && status !== "in_progress" && status !== "completed") {
    return fail("That status isn't available.");
  }

  const { data: task } = await session.supabase
    .from("mission_tasks")
    .select("assignee_id, workspace_id")
    .eq("id", taskId)
    .maybeSingle();

  if (!task) return fail(NOT_AVAILABLE);

  const role = await roleIn(session, workspaceId);
  if (!canContribute(role)) return permissionFailure();
  if (
    role === "member" &&
    task.assignee_id !== null &&
    task.assignee_id !== session.user.id
  ) {
    return fail("Only the assignee, an admin or the owner can update this task.");
  }

  const { error } = await session.supabase
    .from("mission_tasks")
    .update({
      status,
      completed_at: status === "completed" ? new Date().toISOString() : null,
    })
    .eq("id", taskId)
    .eq("workspace_id", workspaceId);

  if (error) {
    console.error("setMissionTaskStatusAction failed:", error.message);
    return fail("We couldn't update that task. Nothing changed.");
  }

  refresh(workspaceId, missionId);
  return done("Task updated.");
}

// ---------------------------------------------------------------------------
// Impact tracking: four separate records
// ---------------------------------------------------------------------------

export async function addOutcomeAction(
  _previous: MissionState,
  formData: FormData,
): Promise<MissionState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = missionOutcomeSchema.safeParse({
    workspace_id: readText(formData, "workspace_id"),
    mission_id: readText(formData, "mission_id"),
    kind: readText(formData, "kind"),
    text: readText(formData, "text"),
    source_url: readText(formData, "source_url"),
  });

  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const input = parsed.data;
  const role = await roleIn(session, input.workspace_id);
  if (!canContribute(role)) return permissionFailure();

  const url = input.source_url.trim();
  if (url !== "") {
    const problem = sourceUrlProblem(url);
    if (problem) return fail(problem);
  }
  if (input.kind === "verified" && url === "") {
    return fail("A verified outcome needs a source someone else can check.");
  }

  const { error } = await session.supabase.from("mission_outcomes").insert({
    mission_id: input.mission_id,
    workspace_id: input.workspace_id,
    reported_by: session.user.id,
    kind: input.kind,
    text: input.text,
    source_url: url === "" ? null : url,
    verified_by: input.kind === "verified" ? session.user.id : null,
    verified_at: input.kind === "verified" ? new Date().toISOString() : null,
  });

  if (error) {
    console.error("addOutcomeAction failed:", error.message);
    return fail("We couldn't record that outcome. Nothing changed.");
  }

  refresh(input.workspace_id, input.mission_id);
  return done(
    "Recorded. Work completed, outputs, participant reports and verified outcomes stay in separate lists.",
  );
}

export async function deleteOutcomeAction(
  _previous: MissionState,
  formData: FormData,
): Promise<MissionState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const missionId = readText(formData, "mission_id");
  const outcomeId = readText(formData, "outcome_id");
  if (!isUuid(workspaceId) || !isUuid(missionId) || !isUuid(outcomeId)) {
    return fail(NOT_AVAILABLE);
  }

  const { data: outcome } = await session.supabase
    .from("mission_outcomes")
    .select("reported_by, workspace_id")
    .eq("id", outcomeId)
    .maybeSingle();

  if (!outcome) return fail(NOT_AVAILABLE);

  const role = await roleIn(session, workspaceId);
  if (!canDeleteOutcome(role, session.user.id, outcome.reported_by as string | null)) {
    return permissionFailure();
  }

  const { error } = await session.supabase
    .from("mission_outcomes")
    .delete()
    .eq("id", outcomeId)
    .eq("workspace_id", workspaceId);

  if (error) {
    console.error("deleteOutcomeAction failed:", error.message);
    return fail("We couldn't remove that outcome. Nothing changed.");
  }

  refresh(workspaceId, missionId);
  return done("Outcome removed.");
}

// ---------------------------------------------------------------------------
// AI assistance: one labelled suggestion per explicit request
// ---------------------------------------------------------------------------

export async function requestAssistanceAction(
  _previous: MissionState,
  formData: FormData,
): Promise<MissionState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const missionId = readText(formData, "mission_id");
  const kind = readText(formData, "kind");

  if (!isUuid(workspaceId) || !isUuid(missionId)) return fail(NOT_AVAILABLE);
  if (!isSuggestionKind(kind)) return fail("That assistance option isn't available.");

  const role = await roleIn(session, workspaceId);
  if (!canContribute(role)) return permissionFailure();

  const detail = await getMissionDetail(session, workspaceId, missionId);
  if (!detail) return fail(NOT_AVAILABLE);

  const requestedModel = readText(formData, "model");
  const model = isAiModel(requestedModel) ? requestedModel : DEFAULT_AI_MODEL;

  const reserved = await reserveAiRequest(session, "mission_assist", model);
  if (!reserved.ok) return fail(reserved.message);

  const { id: requestId, remaining } = reserved.reservation;

  let body: string;

  try {
    const reply = await chatWithOllama({
      model,
      messages: buildAssistanceMessages(kind, detail),
      temperature: 0.4,
      timeoutMs: ASSIST_TIMEOUT_MS,
    });

    const cleaned = sanitizeSuggestion(reply.content);

    if (cleaned === null) {
      await finishAiRequest(session, requestId, "failed", "unusable-suggestion");
      return fail(
        "The reply was too short or too garbled to keep as a suggestion. Nothing was saved.",
        remaining,
      );
    }

    body = cleaned;
    await finishAiRequest(session, requestId, "succeeded", undefined, reply.tokens);
  } catch (error) {
    await finishAiRequest(session, requestId, "failed", "provider-error");
    console.error("requestAssistanceAction model call failed");
    return fail(ollamaErrorMessage(error), remaining);
  }

  const { error } = await session.supabase.from("mission_suggestions").insert({
    mission_id: missionId,
    workspace_id: workspaceId,
    requested_by: session.user.id,
    kind,
    body,
    model,
    status: "proposed",
  });

  if (error) {
    console.error("requestAssistanceAction insert failed:", error.message);
    return fail("The suggestion couldn't be saved, so nothing was kept.", remaining);
  }

  refresh(workspaceId, missionId);
  return done(
    "Suggestion saved as an AI suggestion. It is not a decision, a vote or a participant's view.",
    remaining,
  );
}

export async function reviewSuggestionAction(
  _previous: MissionState,
  formData: FormData,
): Promise<MissionState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = missionSuggestionReviewSchema.safeParse({
    workspace_id: readText(formData, "workspace_id"),
    mission_id: readText(formData, "mission_id"),
    suggestion_id: readText(formData, "suggestion_id"),
    intent: readText(formData, "intent"),
    note: readText(formData, "note"),
  });

  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const input = parsed.data;
  const role = await roleIn(session, input.workspace_id);
  if (!canContribute(role)) return permissionFailure();

  const now = new Date().toISOString();

  if (input.intent === "challenge") {
    if (!canChallenge(role)) return permissionFailure();
    if (input.note.length < 5) {
      return fail("Say what is wrong or missing, so the challenge can be understood.");
    }

    const { error } = await session.supabase
      .from("mission_suggestions")
      .update({
        status: "challenged",
        challenge_note: input.note,
        challenged_by: session.user.id,
        challenged_at: now,
      })
      .eq("id", input.suggestion_id)
      .eq("workspace_id", input.workspace_id);

    if (error) {
      console.error("reviewSuggestionAction challenge failed:", error.message);
      return fail("We couldn't record that challenge. Nothing changed.");
    }

    refresh(input.workspace_id, input.mission_id);
    return done(
      "Challenge recorded next to the suggestion. The original wording stays visible.",
    );
  }

  if (!canReviewSuggestion(role)) return permissionFailure();

  const { error } = await session.supabase
    .from("mission_suggestions")
    .update({
      status: input.intent === "accept" ? "accepted" : "rejected",
      reviewed_by: session.user.id,
      reviewed_at: now,
    })
    .eq("id", input.suggestion_id)
    .eq("workspace_id", input.workspace_id);

  if (error) {
    console.error("reviewSuggestionAction failed:", error.message);
    return fail("We couldn't record that review. Nothing changed.");
  }

  refresh(input.workspace_id, input.mission_id);
  return done(
    input.intent === "accept"
      ? "Marked accepted by a person. It is still an AI suggestion, not a decision."
      : "Marked rejected. The suggestion stays readable for the record.",
  );
}

function canChallenge(role: WorkspaceRole | null): boolean {
  return canContribute(role);
}

// ---------------------------------------------------------------------------
// Sharing, consent and reports
// ---------------------------------------------------------------------------

/**
 * Records who approved what would be shared, and with whom. Nothing is sent or
 * published: this build has no publishing channel.
 */
export async function approveMissionShareAction(
  _previous: MissionState,
  formData: FormData,
): Promise<MissionState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = missionShareSchema.safeParse({
    workspace_id: readText(formData, "workspace_id"),
    mission_id: readText(formData, "mission_id"),
    scope: readText(formData, "scope"),
    confirmed: readText(formData, "confirmed") === "yes",
  });

  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const input = parsed.data;
  const role = await roleIn(session, input.workspace_id);
  if (!canApproveShare(role)) return permissionFailure();

  if (!input.confirmed) {
    return fail("Tick the confirmation box to record a share approval.");
  }

  const detail = await getMissionDetail(session, input.workspace_id, input.mission_id);
  if (!detail) return fail(NOT_AVAILABLE);

  const blockers = shareBlockers({
    role,
    evidence: detail.evidence,
    scope: input.scope,
  });

  if (blockers.length > 0) return fail(blockers.join(" "));

  const { error } = await session.supabase
    .from("missions")
    .update({
      share_scope: input.scope,
      share_approved_by: session.user.id,
      share_approved_at: new Date().toISOString(),
    })
    .eq("id", input.mission_id)
    .eq("workspace_id", input.workspace_id);

  if (error) {
    console.error("approveMissionShareAction failed:", error.message);
    return fail("We couldn't record that approval. Nothing changed.");
  }

  refresh(input.workspace_id, input.mission_id);
  return done(
    "Approval recorded with your name. Nothing was published or sent; this build has no sharing channel.",
  );
}

export async function reportMissionAction(
  _previous: MissionState,
  formData: FormData,
): Promise<MissionState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = missionReportSchema.safeParse({
    workspace_id: readText(formData, "workspace_id"),
    mission_id: readText(formData, "mission_id"),
    reason: readText(formData, "reason"),
  });

  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const input = parsed.data;
  const role = await roleIn(session, input.workspace_id);
  if (!canContribute(role)) return permissionFailure();

  const { error } = await session.supabase.from("mission_reports").insert({
    mission_id: input.mission_id,
    workspace_id: input.workspace_id,
    reported_by: session.user.id,
    reason: input.reason,
  });

  if (error) {
    console.error("reportMissionAction failed:", error.message);
    return fail("We couldn't record that report. Nothing changed.");
  }

  refresh(input.workspace_id, input.mission_id);
  return done(
    "Report recorded for the workspace owner and admins. It stays inside this workspace.",
  );
}

export async function resolveMissionReportAction(
  _previous: MissionState,
  formData: FormData,
): Promise<MissionState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const missionId = readText(formData, "mission_id");
  const reportId = readText(formData, "report_id");

  if (!isUuid(workspaceId) || !isUuid(missionId) || !isUuid(reportId)) {
    return fail(NOT_AVAILABLE);
  }

  const role = await roleIn(session, workspaceId);
  if (!canResolveReport(role)) return permissionFailure();

  const { error } = await session.supabase
    .from("mission_reports")
    .update({ resolved_at: new Date().toISOString(), resolved_by: session.user.id })
    .eq("id", reportId)
    .eq("workspace_id", workspaceId);

  if (error) {
    console.error("resolveMissionReportAction failed:", error.message);
    return fail("We couldn't resolve that report. Nothing changed.");
  }

  refresh(workspaceId, missionId);
  return done("Report marked resolved. The record is kept.");
}

/** Kept for the page's impact section. Never used to claim social impact. */
export type MissionImpactCounts = OutcomeSummary;
