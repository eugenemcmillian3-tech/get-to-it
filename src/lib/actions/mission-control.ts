"use server";

import { revalidatePath } from "next/cache";
import type { MissionState } from "@/lib/action-state";
import { getSession, type Session } from "@/lib/auth";
import {
  MISSION_APPROVAL_KINDS,
  approvalKindNote,
  canManageMissionControl,
  missionAgentJobSchema,
  missionApprovalDecisionSchema,
  missionApprovalSchema,
  missionJobDependencySchema,
  missionLimitsSchema,
  missionMilestoneDependencySchema,
  missionMilestoneSchema,
} from "@/lib/mission-control";
import { firstErrorMessage, isUuid, readText } from "@/lib/validation";
import type { WorkspaceRole } from "@/lib/types";

/**
 * Phase 34 actions.
 *
 * These actions orchestrate records and the bounded job RPCs. They do not run
 * arbitrary code, call an external service, deploy, or let an agent approve a
 * permission increase. Each write is scoped to the active workspace role and is
 * also protected by RLS.
 */

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That mission isn't available to you.";
const NO_PERMISSION =
  "Your role in this workspace doesn't allow that. Nothing was changed.";

function fail(message: string): MissionState {
  return { status: "error", message, nonce: Date.now() };
}

function done(message: string): MissionState {
  return { status: "success", message, nonce: Date.now() };
}

function refresh(workspaceId: string, missionId: string): void {
  revalidatePath(`/workspace/${workspaceId}/missions`);
  revalidatePath(`/workspace/${workspaceId}/missions/${missionId}`);
  revalidatePath(`/workspace/${workspaceId}/missions/${missionId}/control`);
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
    console.error("mission control roleIn failed:", error.message);
    return null;
  }
  return (data as { role: WorkspaceRole } | null)?.role ?? null;
}

function uuidOrNull(value: string): string | null {
  const trimmed = value.trim();
  return isUuid(trimmed) ? trimmed : null;
}

function dateOrNull(value: string): string | null {
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

async function managerIn(
  session: Session,
  workspaceId: string,
): Promise<boolean> {
  return canManageMissionControl(await roleIn(session, workspaceId));
}

async function missionExists(
  session: Session,
  workspaceId: string,
  missionId: string,
): Promise<boolean> {
  const { data } = await session.supabase
    .from("missions")
    .select("id")
    .eq("id", missionId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return Boolean(data);
}

function rpcFailure(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const value = result as { ok?: boolean; code?: string; limit?: number };
  if (value.ok !== false) return null;
  switch (value.code) {
    case "forbidden":
      return NO_PERMISSION;
    case "dependency-pending":
      return "A dependency has not completed. The job stays paused.";
    case "dependency-failed":
      return "A dependency failed or was cancelled. Downstream work stays paused.";
    case "duplicate-work":
      return "The same work is already assigned in this mission. No duplicate was started.";
    case "mission-concurrency":
      return `The mission already has ${value.limit ?? "its maximum"} job(s) running.`;
    case "mission-job-limit":
      return `The mission's job limit (${value.limit ?? "configured"}) has been reached.`;
    case "mission-call-limit":
      return `The mission's agent-call limit (${value.limit ?? "configured"}) has been reached.`;
    case "mission-runtime-limit":
      return `The mission's runtime limit (${value.limit ?? "configured"} seconds) would be exceeded.`;
    case "self-approval":
      return "A separate person must decide this request. You cannot approve your own request.";
    case "agent-approval":
      return "An agent cannot approve a request or widen its own permissions.";
    case "already-decided":
      return "That approval was already decided.";
    case "completed-artifact-preserved":
      return "A completed job and its saved artifact are preserved. It cannot be cancelled.";
    default:
      return "That transition was refused. Nothing was changed.";
  }
}

// ---------------------------------------------------------------------------
// Limits and project links
// ---------------------------------------------------------------------------

export async function updateMissionLimitsAction(
  _previous: MissionState,
  formData: FormData,
): Promise<MissionState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = missionLimitsSchema.safeParse({
    workspace_id: readText(formData, "workspace_id"),
    mission_id: readText(formData, "mission_id"),
    max_parallel_jobs: readText(formData, "max_parallel_jobs"),
    max_agent_jobs: readText(formData, "max_agent_jobs"),
    max_runtime_seconds: readText(formData, "max_runtime_seconds"),
    max_agent_calls: readText(formData, "max_agent_calls"),
  });
  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const input = parsed.data;
  if (!(await managerIn(session, input.workspace_id))) return fail(NO_PERMISSION);

  const { error } = await session.supabase
    .from("missions")
    .update({
      max_parallel_jobs: input.max_parallel_jobs,
      max_agent_jobs: input.max_agent_jobs,
      max_runtime_seconds: input.max_runtime_seconds,
      max_agent_calls: input.max_agent_calls,
    })
    .eq("id", input.mission_id)
    .eq("workspace_id", input.workspace_id);

  if (error) {
    console.error("updateMissionLimitsAction failed:", error.message);
    return fail("We couldn't save those limits. Nothing changed.");
  }

  refresh(input.workspace_id, input.mission_id);
  return done("Mission limits saved. Project limits still apply on top of them.");
}

export async function linkMissionProjectAction(
  _previous: MissionState,
  formData: FormData,
): Promise<MissionState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const missionId = readText(formData, "mission_id");
  const projectId = readText(formData, "project_id");
  const label = readText(formData, "label").trim();

  if (!isUuid(workspaceId) || !isUuid(missionId) || !isUuid(projectId)) {
    return fail(NOT_AVAILABLE);
  }
  if (!(await managerIn(session, workspaceId))) return fail(NO_PERMISSION);
  if (!(await missionExists(session, workspaceId, missionId))) return fail(NOT_AVAILABLE);

  const { data: project } = await session.supabase
    .from("app_projects")
    .select("id, name")
    .eq("id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (!project) {
    return fail("You can only link a project you can already access. Nothing was linked.");
  }

  const { error } = await session.supabase.from("mission_projects").insert({
    mission_id: missionId,
    workspace_id: workspaceId,
    project_id: projectId,
    label: (label || (project.name as string)).slice(0, 160),
    linked_by: session.user.id,
  });

  if (error) {
    console.error("linkMissionProjectAction failed:", error.message);
    return fail(
      error.code === "23505"
        ? "That project is already linked to this mission."
        : "We couldn't link that project. Nothing changed.",
    );
  }

  refresh(workspaceId, missionId);
  return done("Project linked explicitly. No project, task or job was created.");
}

export async function unlinkMissionProjectAction(
  _previous: MissionState,
  formData: FormData,
): Promise<MissionState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const workspaceId = readText(formData, "workspace_id");
  const missionId = readText(formData, "mission_id");
  const linkId = readText(formData, "link_id");
  if (!isUuid(workspaceId) || !isUuid(missionId) || !isUuid(linkId)) {
    return fail(NOT_AVAILABLE);
  }
  if (!(await managerIn(session, workspaceId))) return fail(NO_PERMISSION);

  const { error } = await session.supabase
    .from("mission_projects")
    .delete()
    .eq("id", linkId)
    .eq("mission_id", missionId);

  if (error) {
    console.error("unlinkMissionProjectAction failed:", error.message);
    return fail("We couldn't unlink that project. Nothing changed.");
  }

  refresh(workspaceId, missionId);
  return done("Project unlinked. The project itself was not changed.");
}

// ---------------------------------------------------------------------------
// Deliverables and dependencies
// ---------------------------------------------------------------------------

export async function createMilestoneAction(
  _previous: MissionState,
  formData: FormData,
): Promise<MissionState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = missionMilestoneSchema.safeParse({
    workspace_id: readText(formData, "workspace_id"),
    mission_id: readText(formData, "mission_id"),
    title: readText(formData, "title"),
    description: readText(formData, "description"),
    owner_id: readText(formData, "owner_id"),
    due_at: readText(formData, "due_at"),
    review_at: readText(formData, "review_at"),
    position: readText(formData, "position") || "0",
  });
  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const input = parsed.data;
  if (!(await managerIn(session, input.workspace_id))) return fail(NO_PERMISSION);

  const ownerId = uuidOrNull(input.owner_id);
  if (input.owner_id !== "" && ownerId === null) {
    return fail("Choose an active workspace member as the accountable owner.");
  }
  if (ownerId) {
    const { data: member } = await session.supabase
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", input.workspace_id)
      .eq("user_id", ownerId)
      .eq("status", "active")
      .maybeSingle();
    if (!member) return fail("The accountable owner has to be an active member.");
  }

  const { error } = await session.supabase.from("mission_milestones").insert({
    mission_id: input.mission_id,
    workspace_id: input.workspace_id,
    title: input.title,
    description: input.description,
    owner_id: ownerId,
    due_at: dateOrNull(input.due_at),
    review_at: dateOrNull(input.review_at),
    position: input.position,
    created_by: session.user.id,
  });

  if (error) {
    console.error("createMilestoneAction failed:", error.message);
    return fail("We couldn't add that deliverable. Nothing changed.");
  }

  refresh(input.workspace_id, input.mission_id);
  return done("Deliverable added with its owner and review point. Dates are targets, not promises.");
}

export async function setMilestoneStatusAction(
  _previous: MissionState,
  formData: FormData,
): Promise<MissionState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const missionId = readText(formData, "mission_id");
  const milestoneId = readText(formData, "milestone_id");
  const status = readText(formData, "status");
  if (!isUuid(workspaceId) || !isUuid(missionId) || !isUuid(milestoneId)) {
    return fail(NOT_AVAILABLE);
  }
  if (!["planned", "in_progress", "blocked", "done", "cancelled"].includes(status)) {
    return fail("That deliverable status isn't available.");
  }
  if (!(await managerIn(session, workspaceId))) return fail(NO_PERMISSION);

  const { error } = await session.supabase
    .from("mission_milestones")
    .update({ status })
    .eq("id", milestoneId)
    .eq("mission_id", missionId)
    .eq("workspace_id", workspaceId);

  if (error) {
    console.error("setMilestoneStatusAction failed:", error.message);
    return fail("We couldn't update that deliverable. Nothing changed.");
  }

  refresh(workspaceId, missionId);
  return done("Deliverable updated. Blocked or cancelled dependencies pause downstream jobs.");
}

export async function addMilestoneDependencyAction(
  _previous: MissionState,
  formData: FormData,
): Promise<MissionState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = missionMilestoneDependencySchema.safeParse({
    workspace_id: readText(formData, "workspace_id"),
    mission_id: readText(formData, "mission_id"),
    milestone_id: readText(formData, "milestone_id"),
    depends_on_id: readText(formData, "depends_on_id"),
  });
  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const input = parsed.data;
  if (input.milestone_id === input.depends_on_id) {
    return fail("A deliverable cannot depend on itself.");
  }
  if (!(await managerIn(session, input.workspace_id))) return fail(NO_PERMISSION);

  const { error } = await session.supabase.from("mission_milestone_dependencies").insert({
    mission_id: input.mission_id,
    workspace_id: input.workspace_id,
    milestone_id: input.milestone_id,
    depends_on_id: input.depends_on_id,
    created_by: session.user.id,
  });

  if (error) {
    console.error("addMilestoneDependencyAction failed:", error.message);
    return fail(
      error.code === "23505"
        ? "That dependency is already recorded."
        : "We couldn't add that dependency. Nothing changed.",
    );
  }

  refresh(input.workspace_id, input.mission_id);
  return done("Dependency added. The dependent deliverable cannot start until it is done.");
}

// ---------------------------------------------------------------------------
// Agent jobs over the existing Build Room queue
// ---------------------------------------------------------------------------

export async function createAgentJobAction(
  _previous: MissionState,
  formData: FormData,
): Promise<MissionState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = missionAgentJobSchema.safeParse({
    workspace_id: readText(formData, "workspace_id"),
    mission_id: readText(formData, "mission_id"),
    project_id: readText(formData, "project_id"),
    milestone_id: readText(formData, "milestone_id"),
    source_task_id: readText(formData, "source_task_id"),
    title: readText(formData, "title"),
    objective: readText(formData, "objective"),
    role: readText(formData, "role"),
    budget_seconds: readText(formData, "budget_seconds"),
    budget_calls: readText(formData, "budget_calls"),
    dedupe_key: readText(formData, "dedupe_key"),
  });
  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const input = parsed.data;
  if (!(await managerIn(session, input.workspace_id))) return fail(NO_PERMISSION);

  const { data: link } = await session.supabase
    .from("mission_projects")
    .select("project_id")
    .eq("mission_id", input.mission_id)
    .eq("project_id", input.project_id)
    .maybeSingle();
  if (!link) return fail("Link the project to the mission before assigning agent work.");

  const milestoneId = uuidOrNull(input.milestone_id);
  if (input.milestone_id !== "" && milestoneId === null) {
    return fail("Choose a deliverable in this mission, or leave it unassigned.");
  }
  const sourceTaskId = uuidOrNull(input.source_task_id);
  if (input.source_task_id !== "" && sourceTaskId === null) {
    return fail("Choose an existing project task, or leave it empty.");
  }
  if (sourceTaskId) {
    const { data: task } = await session.supabase
      .from("app_build_tasks")
      .select("id, project_id")
      .eq("id", sourceTaskId)
      .eq("project_id", input.project_id)
      .maybeSingle();
    if (!task) return fail("That project task is not available for this project.");
  }

  const { error } = await session.supabase.from("mission_agent_jobs").insert({
    mission_id: input.mission_id,
    workspace_id: input.workspace_id,
    project_id: input.project_id,
    milestone_id: milestoneId,
    source_task_id: sourceTaskId,
    title: input.title,
    objective: input.objective,
    role: input.role,
    dedupe_key: input.dedupe_key,
    budget_seconds: input.budget_seconds,
    budget_calls: input.budget_calls,
    created_by: session.user.id,
  });

  if (error) {
    console.error("createAgentJobAction failed:", error.message);
    return fail(
      error.code === "23505"
        ? "That work is already assigned in this mission. No duplicate job was created."
        : "We couldn't assign that job. Nothing changed.",
    );
  }

  refresh(input.workspace_id, input.mission_id);
  return done("Job queued inside its project and mission limits. It has not started.");
}

export async function addJobDependencyAction(
  _previous: MissionState,
  formData: FormData,
): Promise<MissionState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = missionJobDependencySchema.safeParse({
    workspace_id: readText(formData, "workspace_id"),
    mission_id: readText(formData, "mission_id"),
    job_id: readText(formData, "job_id"),
    depends_on_job_id: readText(formData, "depends_on_job_id"),
  });
  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const input = parsed.data;
  if (input.job_id === input.depends_on_job_id) {
    return fail("A job cannot depend on itself.");
  }
  if (!(await managerIn(session, input.workspace_id))) return fail(NO_PERMISSION);

  const { error } = await session.supabase.from("mission_job_dependencies").insert({
    mission_id: input.mission_id,
    workspace_id: input.workspace_id,
    job_id: input.job_id,
    depends_on_job_id: input.depends_on_job_id,
    created_by: session.user.id,
  });

  if (error) {
    console.error("addJobDependencyAction failed:", error.message);
    return fail(
      error.code === "23505"
        ? "That job dependency is already recorded."
        : "We couldn't add that job dependency. Nothing changed.",
    );
  }

  refresh(input.workspace_id, input.mission_id);
  return done("Job dependency added. The dependent job cannot start early.");
}

export async function claimAgentJobAction(
  _previous: MissionState,
  formData: FormData,
): Promise<MissionState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const workspaceId = readText(formData, "workspace_id");
  const missionId = readText(formData, "mission_id");
  const jobId = readText(formData, "job_id");
  if (!isUuid(workspaceId) || !isUuid(missionId) || !isUuid(jobId)) {
    return fail(NOT_AVAILABLE);
  }

  const { data, error } = await session.supabase.rpc("mission_control_claim_job", {
    p_job_id: jobId,
  });
  if (error) {
    console.error("claimAgentJobAction failed:", error.message);
    return fail("We couldn't start that job. Nothing changed.");
  }
  const refusal = rpcFailure(data);
  if (refusal) return fail(refusal);

  refresh(workspaceId, missionId);
  return done("Job started inside the mission's concurrency, call and runtime limits.");
}

export async function finishAgentJobAction(
  _previous: MissionState,
  formData: FormData,
): Promise<MissionState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const workspaceId = readText(formData, "workspace_id");
  const missionId = readText(formData, "mission_id");
  const jobId = readText(formData, "job_id");
  const status = readText(formData, "status");
  const note = readText(formData, "note").trim();
  if (!isUuid(workspaceId) || !isUuid(missionId) || !isUuid(jobId)) {
    return fail(NOT_AVAILABLE);
  }
  if (status !== "completed" && status !== "failed") {
    return fail("Choose completed or failed. Use cancel for cancellation.");
  }

  const output =
    note === ""
      ? null
      : {
          test_evidence: note.slice(0, 1000),
          recorded_at: new Date().toISOString(),
        };

  const { data, error } = await session.supabase.rpc("mission_control_finish_job", {
    p_job_id: jobId,
    p_status: status,
    p_note: note,
    p_output: output,
  });
  if (error) {
    console.error("finishAgentJobAction failed:", error.message);
    return fail("We couldn't finish that job. Nothing changed.");
  }
  const refusal = rpcFailure(data);
  if (refusal) return fail(refusal);

  refresh(workspaceId, missionId);
  return done(
    status === "completed"
      ? "Job completed. Its saved evidence stays with the mission."
      : "Job marked failed. Downstream jobs are paused and completed artifacts are untouched.",
  );
}

export async function cancelAgentJobAction(
  _previous: MissionState,
  formData: FormData,
): Promise<MissionState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const workspaceId = readText(formData, "workspace_id");
  const missionId = readText(formData, "mission_id");
  const jobId = readText(formData, "job_id");
  if (!isUuid(workspaceId) || !isUuid(missionId) || !isUuid(jobId)) {
    return fail(NOT_AVAILABLE);
  }

  const { data, error } = await session.supabase.rpc("mission_control_cancel_job", {
    p_job_id: jobId,
  });
  if (error) {
    console.error("cancelAgentJobAction failed:", error.message);
    return fail("We couldn't cancel that job. Nothing changed.");
  }
  const refusal = rpcFailure(data);
  if (refusal) return fail(refusal);

  refresh(workspaceId, missionId);
  return done("Job cancelled. Downstream jobs were cancelled and completed artifacts kept.");
}

export async function cancelMissionJobsAction(
  _previous: MissionState,
  formData: FormData,
): Promise<MissionState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const workspaceId = readText(formData, "workspace_id");
  const missionId = readText(formData, "mission_id");
  if (!isUuid(workspaceId) || !isUuid(missionId)) return fail(NOT_AVAILABLE);

  const { data, error } = await session.supabase.rpc("mission_control_cancel_mission", {
    p_mission_id: missionId,
  });
  if (error) {
    console.error("cancelMissionJobsAction failed:", error.message);
    return fail("We couldn't cancel the mission's jobs. Nothing changed.");
  }
  const refusal = rpcFailure(data);
  if (refusal) return fail(refusal);

  refresh(workspaceId, missionId);
  const count = (data as { cancelled?: number } | null)?.cancelled ?? 0;
  return done(`Cancelled ${count} unfinished job(s). Completed artifacts were kept.`);
}

// ---------------------------------------------------------------------------
// Separate approvals
// ---------------------------------------------------------------------------

export async function requestMissionApprovalAction(
  _previous: MissionState,
  formData: FormData,
): Promise<MissionState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = missionApprovalSchema.safeParse({
    workspace_id: readText(formData, "workspace_id"),
    mission_id: readText(formData, "mission_id"),
    kind: readText(formData, "kind"),
    summary: readText(formData, "summary"),
    scope: readText(formData, "scope"),
  });
  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const input = parsed.data;
  const role = await roleIn(session, input.workspace_id);
  if (!role) return fail(NO_PERMISSION);
  if (input.kind === "permission_increase" && !canManageMissionControl(role)) {
    return fail("Only an owner or admin can request a permission increase for agent work.");
  }
  if (!(await missionExists(session, input.workspace_id, input.mission_id))) {
    return fail(NOT_AVAILABLE);
  }

  const { error } = await session.supabase.from("mission_approvals").insert({
    mission_id: input.mission_id,
    workspace_id: input.workspace_id,
    kind: input.kind,
    summary: input.summary,
    scope: input.scope,
    requested_by: session.user.id,
    requested_by_kind: "human",
    created_by: session.user.id,
  });

  if (error) {
    console.error("requestMissionApprovalAction failed:", error.message);
    return fail("We couldn't record that request. Nothing changed.");
  }

  refresh(input.workspace_id, input.mission_id);
  return done(
    `${MISSION_APPROVAL_KINDS.includes(input.kind) ? approvalKindNote(input.kind) : "Request recorded."} A different owner or admin must decide it.`,
  );
}

export async function decideMissionApprovalAction(
  _previous: MissionState,
  formData: FormData,
): Promise<MissionState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = missionApprovalDecisionSchema.safeParse({
    workspace_id: readText(formData, "workspace_id"),
    mission_id: readText(formData, "mission_id"),
    approval_id: readText(formData, "approval_id"),
    decision: readText(formData, "decision"),
    note: readText(formData, "note"),
  });
  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const input = parsed.data;
  const { data, error } = await session.supabase.rpc("mission_control_decide_approval", {
    p_approval_id: input.approval_id,
    p_decision: input.decision,
    p_note: input.note,
  });
  if (error) {
    console.error("decideMissionApprovalAction failed:", error.message);
    return fail("We couldn't record that decision. Nothing changed.");
  }
  const refusal = rpcFailure(data);
  if (refusal) return fail(refusal);

  refresh(input.workspace_id, input.mission_id);
  return done(
    input.decision === "approved"
      ? "Approval recorded by a separate person. No external write or deployment was performed."
      : "Request rejected. The record stays visible.",
  );
}
