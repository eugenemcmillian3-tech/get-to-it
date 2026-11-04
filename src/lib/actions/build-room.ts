"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { BuildState } from "@/lib/action-state";
import { getSession } from "@/lib/auth";
import {
  integrationChecks,
  secretLikeProblem,
  type BuildRoomChangeset,
  type BuildRoomData,
} from "@/lib/build-room";
import { getBuildRoom } from "@/lib/data/build-room";
import { isUuid, readText } from "@/lib/validation";

/**
 * Phase 28 actions.
 *
 * All permission, review-digest, conflict and merge checks live in the database
 * functions. These actions validate form shape and never bypass those checks.
 */

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That project isn't available to you.";
const REFUSED = "That action was refused. Nothing changed.";

function fail(message: string): BuildState {
  return { status: "error", message: message.slice(0, 1_000), nonce: Date.now() };
}

function done(message: string): BuildState {
  return { status: "success", message: message.slice(0, 1_000), nonce: Date.now() };
}

function raw(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function refresh(projectId: string): void {
  revalidatePath(`/build/${projectId}/room`);
  revalidatePath(`/build/${projectId}`);
}

function rpcMessage(error: { message?: string } | null, fallback = REFUSED): string {
  const message = error?.message ?? "";
  const allowed = [
    "project access denied",
    "project owner required",
    "maintainer access required",
    "reviewer access required",
    "contributor access required",
    "changeset not found",
    "agent task not found",
    "task not found",
    "this changeset is not",
    "this changeset is closed",
    "this changeset is not awaiting review",
    "you cannot review your own changeset",
    "approval is stale",
    "integration checks must pass",
    "unsafe project path",
    "file content is too large",
    "changeset title",
    "comment must",
    "comments cannot contain a secret",
    "share links last",
    "invalid token",
    "only the owner",
    "only the author",
    "only the creator",
    "the project owner cannot be removed",
    "the assignee is not a project member",
    "task scope must reference",
    "the agent task has no reviewable output",
    "agent output contains a path",
    "merged project must contain",
    "changeset is not approved",
    "changeset is not in conflict",
  ];
  return allowed.some((prefix) => message.includes(prefix)) ? message : fallback;
}

export async function linkWorkspaceAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const workspaceId = readText(formData, "workspace_id");
  if (!isUuid(projectId) || !isUuid(workspaceId)) return fail(NOT_AVAILABLE);
  const { error } = await session.supabase.rpc("link_app_workspace", {
    p_project_id: projectId,
    p_workspace_id: workspaceId,
  });
  if (error) return fail(rpcMessage(error));
  refresh(projectId);
  return done("Workspace linked. Active workspace members now have mapped project roles.");
}

export async function addMemberAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const userId = readText(formData, "user_id");
  const role = readText(formData, "role");
  if (!isUuid(projectId) || !isUuid(userId)) return fail(NOT_AVAILABLE);
  if (!["maintainer", "contributor", "reviewer", "viewer"].includes(role)) return fail("Choose a valid project role.");
  const { error } = await session.supabase.rpc("add_app_project_member", {
    p_project_id: projectId,
    p_user_id: userId,
    p_role: role,
  });
  if (error) return fail(rpcMessage(error));
  refresh(projectId);
  return done("Project access granted.");
}

export async function removeMemberAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const userId = readText(formData, "user_id");
  if (!isUuid(projectId) || !isUuid(userId)) return fail(NOT_AVAILABLE);
  const { error } = await session.supabase.rpc("remove_app_project_member", {
    p_project_id: projectId,
    p_user_id: userId,
  });
  if (error) return fail(rpcMessage(error));
  refresh(projectId);
  return done("Access removed. Existing comments stay attributed, but the member can no longer read or act on the project.");
}

export async function createBuildTaskAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  if (!isUuid(projectId)) return fail(NOT_AVAILABLE);
  const title = readText(formData, "title");
  const description = readText(formData, "description");
  const kind = readText(formData, "assignee_kind");
  const assigneeId = readText(formData, "assignee_id");
  const agentRole = readText(formData, "agent_role");
  const scopePaths = formData.getAll("scope_paths").filter((value): value is string => typeof value === "string").slice(0, 12);
  if (secretLikeProblem(title) || secretLikeProblem(description)) return fail("Remove the secret-like value first.");
  if (!["human", "agent"].includes(kind)) return fail("Choose human or agent assignment.");
  if (kind === "human" && !isUuid(assigneeId)) return fail("Choose a project member.");
  if (kind === "agent" && !["coordinator", "frontend", "backend", "data", "qa", "security"].includes(agentRole)) {
    return fail("Choose an agent role.");
  }
  const { error } = await session.supabase.rpc("create_app_build_task", {
    p_project_id: projectId,
    p_title: title,
    p_description: description,
    p_assignee_kind: kind,
    p_assignee_id: kind === "human" ? assigneeId : null,
    p_agent_role: kind === "agent" ? agentRole : null,
    p_scope_paths: scopePaths,
  });
  if (error) return fail(rpcMessage(error));
  refresh(projectId);
  return done("Task added to the shared human and agent board.");
}

export async function cancelBuildTaskAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const taskId = readText(formData, "task_id");
  if (!isUuid(projectId) || !isUuid(taskId)) return fail(NOT_AVAILABLE);
  const { error } = await session.supabase.rpc("cancel_app_build_task", { p_task_id: taskId });
  if (error) return fail(rpcMessage(error));
  refresh(projectId);
  return done("Task cancelled. No remaining action from this task will run.");
}

export async function createChangesetAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const title = readText(formData, "title");
  const description = readText(formData, "description");
  const path = readText(formData, "path");
  const content = raw(formData, "content");
  if (!isUuid(projectId)) return fail(NOT_AVAILABLE);
  if (secretLikeProblem(content) || secretLikeProblem(title)) return fail("Remove the secret-like value first.");
  const { error } = await session.supabase.rpc("create_app_changeset", {
    p_project_id: projectId,
    p_title: title,
    p_description: description,
    p_path: path,
    p_content: content,
  });
  if (error) return fail(rpcMessage(error));
  refresh(projectId);
  return done("Changeset created in isolation. It has not changed the project.");
}

export async function updateChangesetAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const changesetId = readText(formData, "changeset_id");
  const title = readText(formData, "title");
  const description = readText(formData, "description");
  const path = readText(formData, "path");
  const content = raw(formData, "content");
  if (!isUuid(projectId) || !isUuid(changesetId)) return fail(NOT_AVAILABLE);
  if (secretLikeProblem(content) || secretLikeProblem(title)) return fail("Remove the secret-like value first.");
  const { error } = await session.supabase.rpc("update_app_changeset", {
    p_changeset_id: changesetId,
    p_title: title,
    p_description: description,
    p_path: path,
    p_content: content,
  });
  if (error) return fail(rpcMessage(error));
  refresh(projectId);
  return done("Changeset updated. Any earlier approval and checks were invalidated.");
}

export async function submitChangesetAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const changesetId = readText(formData, "changeset_id");
  if (!isUuid(projectId) || !isUuid(changesetId)) return fail(NOT_AVAILABLE);
  const { error } = await session.supabase.rpc("submit_app_changeset", { p_changeset_id: changesetId });
  if (error) return fail(rpcMessage(error));
  refresh(projectId);
  return done("Submitted for review.");
}

export async function runChangesetChecksAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const changesetId = readText(formData, "changeset_id");
  if (!isUuid(projectId) || !isUuid(changesetId)) return fail(NOT_AVAILABLE);
  const room = await getBuildRoom(session, projectId);
  const changeset = room?.changesets.find((item) => item.id === changesetId);
  if (!changeset) return fail(NOT_AVAILABLE);
  const checks = integrationChecks(changeset.files, changeset.title);
  const { error } = await session.supabase.rpc("set_app_changeset_checks", {
    p_changeset_id: changesetId,
    p_checks: checks,
  });
  if (error) return fail(rpcMessage(error));
  refresh(projectId);
  return checks.every((check) => check.status === "passed")
    ? done("Integration checks passed. A human review is still required.")
    : fail("One or more integration checks failed. Review the result before merging.");
}

export async function reviewChangesetAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const changesetId = readText(formData, "changeset_id");
  const decision = readText(formData, "decision");
  const note = readText(formData, "note");
  if (!isUuid(projectId) || !isUuid(changesetId)) return fail(NOT_AVAILABLE);
  if (!["approve", "request_changes"].includes(decision)) return fail("Choose approve or request changes.");
  if (secretLikeProblem(note)) return fail("Remove the secret-like value from the review note.");
  const { error } = await session.supabase.rpc("review_app_changeset", {
    p_changeset_id: changesetId,
    p_decision: decision,
    p_note: note,
  });
  if (error) return fail(rpcMessage(error));
  refresh(projectId);
  return done(decision === "approve" ? "Approved. The digest is tied to this exact content." : "Changes requested.");
}

export async function mergeChangesetAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const changesetId = readText(formData, "changeset_id");
  if (!isUuid(projectId) || !isUuid(changesetId)) return fail(NOT_AVAILABLE);
  const { data, error } = await session.supabase.rpc("merge_app_changeset", { p_changeset_id: changesetId });
  if (error) return fail(rpcMessage(error));
  const result = (data ?? {}) as { ok?: boolean; version?: number; conflicts?: string[] };
  if (result.ok !== true) {
    return fail(`Conflict on ${result.conflicts?.join(", ") || "a changed file"}. No files were written. Rebase and review again.`);
  }
  refresh(projectId);
  return done(`Integrated as app version ${result.version ?? "new"}.`);
}

export async function rebaseChangesetAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const changesetId = readText(formData, "changeset_id");
  if (!isUuid(projectId) || !isUuid(changesetId)) return fail(NOT_AVAILABLE);
  const { error } = await session.supabase.rpc("rebase_app_changeset", { p_changeset_id: changesetId });
  if (error) return fail(rpcMessage(error));
  refresh(projectId);
  return done("Changeset rebased. Run checks and request a fresh review before merging.");
}

export async function cancelChangesetAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const changesetId = readText(formData, "changeset_id");
  if (!isUuid(projectId) || !isUuid(changesetId)) return fail(NOT_AVAILABLE);
  const { error } = await session.supabase.rpc("cancel_app_changeset", { p_changeset_id: changesetId });
  if (error) return fail(rpcMessage(error));
  refresh(projectId);
  return done("Changeset cancelled. No file was changed.");
}

export async function agentChangesetAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const taskId = readText(formData, "task_id");
  if (!isUuid(projectId) || !isUuid(taskId)) return fail(NOT_AVAILABLE);
  const { error } = await session.supabase.rpc("create_agent_changeset_from_task", { p_task_id: taskId });
  if (error) return fail(rpcMessage(error));
  refresh(projectId);
  return done("Agent output imported as an isolated changeset. A human reviewer must approve it.");
}

export async function addCommentAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const changesetId = readText(formData, "changeset_id");
  const filePath = readText(formData, "file_path");
  const body = raw(formData, "body");
  if (!isUuid(projectId)) return fail(NOT_AVAILABLE);
  if (secretLikeProblem(body)) return fail("Remove the secret-like value first.");
  const { error } = await session.supabase.rpc("add_app_build_comment", {
    p_project_id: projectId,
    p_changeset_id: isUuid(changesetId) ? changesetId : null,
    p_file_path: filePath || null,
    p_body: body,
  });
  if (error) return fail(rpcMessage(error));
  refresh(projectId);
  return done("Comment added.");
}

export async function createShareAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const hours = Number(readText(formData, "hours"));
  if (!isUuid(projectId)) return fail(NOT_AVAILABLE);
  if (!Number.isInteger(hours) || hours < 1 || hours > 168) return fail("Choose 1 to 168 hours.");
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { error } = await session.supabase.rpc("create_app_share_link", {
    p_project_id: projectId,
    p_token_hash: tokenHash,
    p_hours: hours,
  });
  if (error) return fail(rpcMessage(error));
  refresh(projectId);
  return {
    status: "success",
    message: "Expiring read-only share link created. It shows the approved brief only, never files or comments.",
    link: `/share/${token}`,
    nonce: Date.now(),
  };
}

export async function heartbeatAction(projectId: string): Promise<void> {
  const session = await getSession();
  if (!session || !isUuid(projectId)) return;
  await session.supabase.rpc("touch_app_presence", { p_project_id: projectId });
}

export type BuildRoomSnapshot = BuildRoomData;
export type BuildRoomChange = BuildRoomChangeset;
