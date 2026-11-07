"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { FormState } from "@/lib/action-state";
import { getSession, type Session } from "@/lib/auth";
import {
  firstErrorMessage,
  isUuid,
  readText,
} from "@/lib/validation";
import {
  normalizedAssignee,
  notificationPrefsSchema,
  personalGoalShareSchema,
  workspaceCommentSchema,
  workspaceCreateSchema,
  workspaceErrorMessage,
  workspaceGoalSchema,
  workspaceInviteSchema,
  workspaceRoleSchema,
  workspaceSettingsSchema,
  workspaceTaskSchema,
  workspaceTaskUpdateSchema,
} from "@/lib/workspaces";

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That item isn't available to you any more.";
const NO_PERMISSION =
  "Your role in this workspace doesn't allow that. Nothing was changed.";

type RpcPayload = {
  ok?: boolean;
  code?: string;
  workspace_id?: string;
  token?: string;
  expires_at?: string;
  role?: string;
};

/**
 * Calls one of the role-checking functions from 0012.
 *
 * The database is the boundary: each function re-reads the caller's role, so a
 * request that gets past the UI still cannot exceed what the role allows.
 */
async function callWorkspaceFunction(
  session: Session,
  name: string,
  args: Record<string, unknown>,
): Promise<RpcPayload> {
  const { data, error } = await session.supabase.rpc(name, args);

  if (error) {
    console.error(`${name} failed:`, error.message);
    return { ok: false, code: undefined };
  }

  return (data ?? {}) as RpcPayload;
}

/** Maps a database refusal onto the same plain-language reasons the UI uses. */
function failureMessage(message: string | undefined): string {
  const text = (message ?? "").toLowerCase();
  if (text.includes("row-level security") || text.includes("permission denied")) {
    return NO_PERMISSION;
  }
  if (text.includes("members may only assign") || text.includes("may only assign")) {
    return workspaceErrorMessage("not-assignable");
  }
  if (text.includes("assignee")) {
    return workspaceErrorMessage("assignee-not-member");
  }
  if (text.includes("workspace-seat-limit") || text.includes("seat limit")) {
    return workspaceErrorMessage("seat-limit");
  }
  return "That didn't work. Nothing was changed — try again.";
}

function workspacePath(workspaceId: string): string {
  return `/workspace/${workspaceId}`;
}

function refreshWorkspace(workspaceId: string, goalId?: string): void {
  revalidatePath("/workspace");
  revalidatePath(workspacePath(workspaceId));
  if (goalId) {
    revalidatePath(`${workspacePath(workspaceId)}/goals/${goalId}`);
  }
}

export async function createWorkspaceAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const parsed = workspaceCreateSchema.safeParse({
    name: readText(formData, "name"),
    description: readText(formData, "description"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstErrorMessage(parsed.error) };
  }

  const payload = await callWorkspaceFunction(session, "create_workspace", {
    p_name: parsed.data.name,
    p_description: parsed.data.description,
  });

  if (payload.ok !== true || !payload.workspace_id) {
    return {
      status: "error",
      message: payload.code ? workspaceErrorMessage(payload.code) : failureMessage(undefined),
    };
  }

  revalidatePath("/workspace");
  redirect(workspacePath(payload.workspace_id));
}

export async function updateWorkspaceSettingsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const parsed = workspaceSettingsSchema.safeParse({
    workspace_id: readText(formData, "workspace_id"),
    name: readText(formData, "name"),
    description: readText(formData, "description"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstErrorMessage(parsed.error) };
  }

  const payload = await callWorkspaceFunction(session, "update_workspace_settings", {
    p_workspace_id: parsed.data.workspace_id,
    p_name: parsed.data.name,
    p_description: parsed.data.description,
  });

  if (payload.ok !== true) {
    return { status: "error", message: workspaceErrorMessage(payload.code) };
  }

  refreshWorkspace(parsed.data.workspace_id);
  return { status: "success", message: "Workspace settings saved.", nonce: Date.now() };
}

export async function inviteWorkspaceMemberAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const parsed = workspaceInviteSchema.safeParse({
    workspace_id: readText(formData, "workspace_id"),
    email: readText(formData, "invitee_email"),
    role: readText(formData, "role"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstErrorMessage(parsed.error) };
  }

  const payload = await callWorkspaceFunction(session, "create_workspace_invitation", {
    p_workspace_id: parsed.data.workspace_id,
    p_email: parsed.data.email,
    p_role: parsed.data.role,
  });

  if (payload.ok !== true || !payload.token) {
    return { status: "error", message: workspaceErrorMessage(payload.code) };
  }

  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const path = `/workspace/join/${payload.token}`;
  const link = host ? `${protocol}://${host}${path}` : path;

  revalidatePath(workspacePath(parsed.data.workspace_id));
  return {
    status: "success",
    message:
      "Invitation ready. Send this link to them yourself — GET TO IT does not send email.",
    link,
    nonce: Date.now(),
  };
}

export async function cancelWorkspaceInvitationAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const invitationId = readText(formData, "invitation_id");
  const workspaceId = readText(formData, "workspace_id");
  if (!isUuid(invitationId) || !isUuid(workspaceId)) return;

  const payload = await callWorkspaceFunction(session, "cancel_workspace_invitation", {
    p_invitation_id: invitationId,
  });

  if (payload.ok !== true) return;
  refreshWorkspace(workspaceId);
}

export async function respondToWorkspaceInvitationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const token = readText(formData, "token");
  if (!token) {
    return { status: "error", message: workspaceErrorMessage("invalid-invitation") };
  }

  const declining = readText(formData, "intent") === "decline";

  const payload = await callWorkspaceFunction(
    session,
    declining ? "decline_workspace_invitation" : "accept_workspace_invitation",
    { p_token: token },
  );

  if (payload.ok !== true) {
    return { status: "error", message: workspaceErrorMessage(payload.code) };
  }

  revalidatePath("/workspace");
  if (declining) {
    return {
      status: "success",
      message: "Invitation declined. Nothing was joined.",
      nonce: Date.now(),
    };
  }

  redirect(payload.workspace_id ? workspacePath(payload.workspace_id) : "/workspace");
}

export async function setMemberRoleAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const workspaceId = readText(formData, "workspace_id");
  const userId = readText(formData, "user_id");
  const parsedRole = workspaceRoleSchema.safeParse(readText(formData, "role"));

  if (!isUuid(workspaceId) || !isUuid(userId) || !parsedRole.success) {
    return { status: "error", message: workspaceErrorMessage("invalid-role") };
  }

  const payload = await callWorkspaceFunction(session, "set_workspace_member_role", {
    p_workspace_id: workspaceId,
    p_user_id: userId,
    p_role: parsedRole.data,
  });

  if (payload.ok !== true) {
    return { status: "error", message: workspaceErrorMessage(payload.code) };
  }

  refreshWorkspace(workspaceId);
  return {
    status: "success",
    message:
      parsedRole.data === "owner"
        ? "Ownership transferred. You are now an admin here."
        : "Role updated.",
    nonce: Date.now(),
  };
}

export async function removeWorkspaceMemberAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const workspaceId = readText(formData, "workspace_id");
  const userId = readText(formData, "user_id");
  if (!isUuid(workspaceId) || !isUuid(userId)) {
    return { status: "error", message: NOT_AVAILABLE };
  }

  const payload = await callWorkspaceFunction(session, "remove_workspace_member", {
    p_workspace_id: workspaceId,
    p_user_id: userId,
  });

  if (payload.ok !== true) {
    return { status: "error", message: workspaceErrorMessage(payload.code) };
  }

  refreshWorkspace(workspaceId);
  return {
    status: "success",
    message:
      "Access removed. Their assignments were cleared; their comments and anything they created stay with the workspace.",
    nonce: Date.now(),
  };
}

export async function leaveWorkspaceAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const workspaceId = readText(formData, "workspace_id");
  if (!isUuid(workspaceId)) {
    return { status: "error", message: NOT_AVAILABLE };
  }

  const payload = await callWorkspaceFunction(session, "leave_workspace", {
    p_workspace_id: workspaceId,
  });

  if (payload.ok !== true) {
    return { status: "error", message: workspaceErrorMessage(payload.code) };
  }

  revalidatePath("/workspace");
  redirect("/workspace");
}

export async function deleteWorkspaceAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const workspaceId = readText(formData, "workspace_id");
  const confirmation = readText(formData, "confirm_name");
  const workspaceName = readText(formData, "workspace_name");

  if (!isUuid(workspaceId)) {
    return { status: "error", message: NOT_AVAILABLE };
  }

  if (confirmation !== workspaceName) {
    return {
      status: "error",
      message: "Type the workspace name exactly to confirm deletion.",
    };
  }

  const payload = await callWorkspaceFunction(session, "delete_workspace", {
    p_workspace_id: workspaceId,
  });

  if (payload.ok !== true) {
    return { status: "error", message: workspaceErrorMessage(payload.code) };
  }

  revalidatePath("/workspace");
  redirect("/workspace");
}

export async function setNotificationPrefsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const workspaceId = readText(formData, "workspace_id");
  if (!isUuid(workspaceId)) {
    return { status: "error", message: NOT_AVAILABLE };
  }

  const parsed = notificationPrefsSchema.safeParse({
    assignments: readText(formData, "notify_assignments") === "on",
    comments: readText(formData, "notify_comments") === "on",
    membership: readText(formData, "notify_membership") === "on",
  });
  if (!parsed.success) {
    return { status: "error", message: firstErrorMessage(parsed.error) };
  }

  const payload = await callWorkspaceFunction(session, "set_workspace_notification_prefs", {
    p_workspace_id: workspaceId,
    p_assignments: parsed.data.assignments,
    p_comments: parsed.data.comments,
    p_membership: parsed.data.membership,
  });

  if (payload.ok !== true) {
    return { status: "error", message: workspaceErrorMessage(payload.code) };
  }

  refreshWorkspace(workspaceId);
  return {
    status: "success",
    message: "Notification preferences saved for this workspace.",
    nonce: Date.now(),
  };
}

export async function markNotificationsReadAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const workspaceId = readText(formData, "workspace_id");
  if (!isUuid(workspaceId)) return;

  await callWorkspaceFunction(session, "mark_workspace_notifications_read", {
    p_workspace_id: workspaceId,
  });
  refreshWorkspace(workspaceId);
}

export async function createWorkspaceGoalAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const parsed = workspaceGoalSchema.safeParse({
    workspace_id: readText(formData, "workspace_id"),
    title: readText(formData, "title"),
    desired_outcome: readText(formData, "desired_outcome"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstErrorMessage(parsed.error) };
  }

  const { error } = await session.supabase.from("workspace_goals").insert({
    workspace_id: parsed.data.workspace_id,
    title: parsed.data.title,
    desired_outcome: parsed.data.desired_outcome,
    created_by: session.user.id,
  });

  if (error) {
    console.error("createWorkspaceGoalAction failed:", error.message);
    return { status: "error", message: failureMessage(error.message) };
  }

  refreshWorkspace(parsed.data.workspace_id);
  return { status: "success", message: "Shared goal created.", nonce: Date.now() };
}

/**
 * Copying a personal goal in.
 *
 * The confirmation is required in the form and checked again here; ownership of
 * the source goal is checked against the signed-in person. Only the title and
 * outcome are copied, and the new row belongs to the workspace.
 */
export async function sharePersonalGoalAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const parsed = personalGoalShareSchema.safeParse({
    workspace_id: readText(formData, "workspace_id"),
    goal_id: readText(formData, "goal_id"),
    confirmed: readText(formData, "confirm_copy") === "on",
  });
  if (!parsed.success) {
    return { status: "error", message: firstErrorMessage(parsed.error) };
  }

  const { data: source, error: sourceError } = await session.supabase
    .from("goals")
    .select("id, title, desired_outcome")
    .eq("id", parsed.data.goal_id)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (sourceError) {
    console.error("sharePersonalGoalAction lookup failed:", sourceError.message);
    return { status: "error", message: failureMessage(sourceError.message) };
  }
  if (!source) {
    return {
      status: "error",
      message: "That goal isn't one of yours. Nothing was copied.",
    };
  }

  const { error } = await session.supabase.from("workspace_goals").insert({
    workspace_id: parsed.data.workspace_id,
    title: source.title as string,
    desired_outcome: source.desired_outcome as string,
    created_by: session.user.id,
    source_goal_id: source.id as string,
  });

  if (error) {
    console.error("sharePersonalGoalAction failed:", error.message);
    return { status: "error", message: failureMessage(error.message) };
  }

  refreshWorkspace(parsed.data.workspace_id);
  return {
    status: "success",
    message:
      "Copied into the workspace. Your personal goal and its saved work were not touched or shared.",
    nonce: Date.now(),
  };
}

export async function archiveWorkspaceGoalAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const workspaceId = readText(formData, "workspace_id");
  const goalId = readText(formData, "goal_id");
  const restore = readText(formData, "intent") === "restore";
  if (!isUuid(workspaceId) || !isUuid(goalId)) return;

  const { error } = await session.supabase
    .from("workspace_goals")
    .update({ archived_at: restore ? null : new Date().toISOString() })
    .eq("id", goalId)
    .eq("workspace_id", workspaceId);

  if (error) {
    console.error("archiveWorkspaceGoalAction failed:", error.message);
    return;
  }

  refreshWorkspace(workspaceId, goalId);
}

export async function deleteWorkspaceGoalAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const workspaceId = readText(formData, "workspace_id");
  const goalId = readText(formData, "goal_id");
  if (!isUuid(workspaceId) || !isUuid(goalId)) return;

  const { error } = await session.supabase
    .from("workspace_goals")
    .delete()
    .eq("id", goalId)
    .eq("workspace_id", workspaceId);

  if (error) {
    console.error("deleteWorkspaceGoalAction failed:", error.message);
    return;
  }

  refreshWorkspace(workspaceId);
  redirect(workspacePath(workspaceId));
}

export async function createWorkspaceTaskAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const parsed = workspaceTaskSchema.safeParse({
    workspace_id: readText(formData, "workspace_id"),
    goal_id: readText(formData, "goal_id"),
    title: readText(formData, "title"),
    assignee_id: readText(formData, "assignee_id"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstErrorMessage(parsed.error) };
  }

  const assignee = normalizedAssignee(parsed.data.assignee_id);
  if (assignee !== null && !isUuid(assignee)) {
    return { status: "error", message: workspaceErrorMessage("assignee-not-member") };
  }

  const { error } = await session.supabase.from("workspace_tasks").insert({
    workspace_id: parsed.data.workspace_id,
    goal_id: parsed.data.goal_id,
    title: parsed.data.title,
    assignee_id: assignee,
    created_by: session.user.id,
  });

  if (error) {
    console.error("createWorkspaceTaskAction failed:", error.message);
    return { status: "error", message: failureMessage(error.message) };
  }

  refreshWorkspace(parsed.data.workspace_id, parsed.data.goal_id);
  return {
    status: "success",
    message: assignee ? "Task added and assigned." : "Task added.",
    nonce: Date.now(),
  };
}

export async function updateWorkspaceTaskAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const parsed = workspaceTaskUpdateSchema.safeParse({
    workspace_id: readText(formData, "workspace_id"),
    goal_id: readText(formData, "goal_id"),
    task_id: readText(formData, "task_id"),
    title: readText(formData, "title"),
    status: readText(formData, "status"),
    assignee_id: readText(formData, "assignee_id"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstErrorMessage(parsed.error) };
  }

  const assignee = normalizedAssignee(parsed.data.assignee_id);
  if (assignee !== null && !isUuid(assignee)) {
    return { status: "error", message: workspaceErrorMessage("assignee-not-member") };
  }

  const { data, error } = await session.supabase
    .from("workspace_tasks")
    .update({
      title: parsed.data.title,
      status: parsed.data.status,
      assignee_id: assignee,
    })
    .eq("id", parsed.data.task_id)
    .eq("workspace_id", parsed.data.workspace_id)
    .eq("goal_id", parsed.data.goal_id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("updateWorkspaceTaskAction failed:", error.message);
    return { status: "error", message: failureMessage(error.message) };
  }
  if (!data) {
    return {
      status: "error",
      message: "That task isn't one you can change. Nothing was updated.",
    };
  }

  refreshWorkspace(parsed.data.workspace_id, parsed.data.goal_id);
  return { status: "success", message: "Task updated.", nonce: Date.now() };
}

export async function deleteWorkspaceTaskAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const workspaceId = readText(formData, "workspace_id");
  const goalId = readText(formData, "goal_id");
  const taskId = readText(formData, "task_id");
  if (!isUuid(workspaceId) || !isUuid(goalId) || !isUuid(taskId)) return;

  const { error } = await session.supabase
    .from("workspace_tasks")
    .delete()
    .eq("id", taskId)
    .eq("workspace_id", workspaceId)
    .eq("goal_id", goalId);

  if (error) {
    console.error("deleteWorkspaceTaskAction failed:", error.message);
    return;
  }

  refreshWorkspace(workspaceId, goalId);
}

export async function addWorkspaceCommentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const parsed = workspaceCommentSchema.safeParse({
    workspace_id: readText(formData, "workspace_id"),
    task_id: readText(formData, "task_id"),
    body: readText(formData, "body"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstErrorMessage(parsed.error) };
  }

  const { error } = await session.supabase.from("workspace_task_comments").insert({
    workspace_id: parsed.data.workspace_id,
    task_id: parsed.data.task_id,
    author_id: session.user.id,
    body: parsed.data.body,
  });

  if (error) {
    console.error("addWorkspaceCommentAction failed:", error.message);
    return { status: "error", message: failureMessage(error.message) };
  }

  const goalId = readText(formData, "goal_id");
  refreshWorkspace(parsed.data.workspace_id, isUuid(goalId) ? goalId : undefined);
  return { status: "success", message: "Comment posted.", nonce: Date.now() };
}

export async function deleteWorkspaceCommentAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const workspaceId = readText(formData, "workspace_id");
  const goalId = readText(formData, "goal_id");
  const commentId = readText(formData, "comment_id");
  if (!isUuid(workspaceId) || !isUuid(commentId)) return;

  const { error } = await session.supabase
    .from("workspace_task_comments")
    .delete()
    .eq("id", commentId)
    .eq("workspace_id", workspaceId);

  if (error) {
    console.error("deleteWorkspaceCommentAction failed:", error.message);
    return;
  }

  refreshWorkspace(workspaceId, isUuid(goalId) ? goalId : undefined);
}
