import type { Session } from "@/lib/auth";
import { DataError } from "@/lib/data/goals";
import type {
  Workspace,
  WorkspaceComment,
  WorkspaceEvent,
  WorkspaceGoal,
  WorkspaceInvitation,
  WorkspaceMember,
  WorkspaceNotification,
  WorkspaceNotificationPrefs,
  WorkspaceRole,
  WorkspaceTask,
} from "@/lib/types";

/**
 * Workspace reads.
 *
 * Every query relies on the row-level policies from 0012, which require an
 * active membership. Names for teammates come from `workspace_member_directory`
 * because profiles are private to their owner; the function refuses anyone who
 * is not a member of that workspace.
 */

const LOAD_ERROR =
  "We couldn't load that workspace just now. Refresh the page to try again.";

export type MyWorkspace = {
  id: string;
  name: string;
  description: string | null;
  role: WorkspaceRole;
  created_at: string;
};

type MembershipRow = {
  role: WorkspaceRole;
  workspace: {
    id: string;
    name: string;
    description: string | null;
    created_at: string;
  } | null;
};

export async function listMyWorkspaces(session: Session): Promise<MyWorkspace[]> {
  const { data, error } = await session.supabase
    .from("workspace_members")
    .select("role, workspace:workspaces (id, name, description, created_at)")
    .eq("user_id", session.user.id)
    .eq("status", "active");

  if (error) {
    console.error("listMyWorkspaces failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }

  const rows = (data ?? []) as unknown as MembershipRow[];

  return rows
    .filter((row): row is MembershipRow & { workspace: NonNullable<MembershipRow["workspace"]> } =>
      row.workspace !== null,
    )
    .map((row) => ({
      id: row.workspace.id,
      name: row.workspace.name,
      description: row.workspace.description,
      role: row.role,
      created_at: row.workspace.created_at,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type WorkspaceOverview = {
  workspace: Workspace;
  myRole: WorkspaceRole;
  members: WorkspaceMember[];
  goals: WorkspaceGoal[];
  tasks: WorkspaceTask[];
  events: WorkspaceEvent[];
  invitations: WorkspaceInvitation[];
  unread: WorkspaceNotification[];
  prefs: WorkspaceNotificationPrefs | null;
  copyCandidates: { id: string; title: string; desired_outcome: string }[];
};

export async function getWorkspaceOverview(
  session: Session,
  workspaceId: string,
): Promise<WorkspaceOverview | null> {
  const { data: workspace, error } = await session.supabase
    .from("workspaces")
    .select("id, name, description, created_by, created_at, updated_at")
    .eq("id", workspaceId)
    .maybeSingle();

  if (error) {
    console.error("getWorkspaceOverview workspace failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!workspace) return null;

  const [membership, directory] = await Promise.all([
    session.supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", session.user.id)
      .eq("status", "active")
      .maybeSingle(),
    session.supabase.rpc("workspace_member_directory", {
      p_workspace_id: workspaceId,
    }),
  ]);

  if (membership.error || !membership.data) return null;
  if (directory.error) {
    console.error("workspace_member_directory failed:", directory.error.message);
    throw new DataError(LOAD_ERROR);
  }

  const myRole = (membership.data as { role: WorkspaceRole }).role;
  const directoryPayload = (directory.data ?? {}) as {
    ok?: boolean;
    members?: WorkspaceMember[];
  };
  const members = directoryPayload.members ?? [];

  const [goalsResult, tasksResult, eventsResult, prefsResult, unreadResult] =
    await Promise.all([
      session.supabase
        .from("workspace_goals")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false }),
      session.supabase
        .from("workspace_tasks")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: true }),
      session.supabase
        .from("workspace_events")
        .select("id, workspace_id, actor_id, kind, subject_user_id, detail, created_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(12),
      session.supabase
        .from("workspace_notification_prefs")
        .select("notify_assignments, notify_comments, notify_membership")
        .eq("workspace_id", workspaceId)
        .eq("user_id", session.user.id)
        .maybeSingle(),
      session.supabase
        .from("workspace_notifications")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("user_id", session.user.id)
        .is("read_at", null)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

  for (const result of [goalsResult, tasksResult, eventsResult, prefsResult, unreadResult]) {
    if (result.error) {
      console.error("getWorkspaceOverview failed:", result.error.message);
      throw new DataError(LOAD_ERROR);
    }
  }

  const invitationsResult =
    myRole === "owner"
      ? await session.supabase
          .from("workspace_invitations")
          .select("id, invitee_email, role, token, status, created_at, expires_at")
          .eq("workspace_id", workspaceId)
          .eq("status", "pending")
          .order("created_at", { ascending: false })
      : { data: [] as WorkspaceInvitation[], error: null };

  if (invitationsResult.error) {
    console.error(
      "workspace invitations failed:",
      invitationsResult.error.message,
    );
    throw new DataError(LOAD_ERROR);
  }

  // Only an owner or admin may copy a personal goal in, so only they need the
  // list. It is read directly from their own goals, never through the workspace.
  const copyResult =
    myRole === "owner" || myRole === "admin"
      ? await session.supabase
          .from("goals")
          .select("id, title, desired_outcome")
          .eq("user_id", session.user.id)
          .is("archived_at", null)
          .order("created_at", { ascending: false })
          .limit(25)
      : { data: [], error: null };

  if (copyResult.error) {
    console.error("workspace copy candidates failed:", copyResult.error.message);
    throw new DataError(LOAD_ERROR);
  }

  return {
    workspace: workspace as Workspace,
    myRole,
    members,
    goals: (goalsResult.data ?? []) as WorkspaceGoal[],
    tasks: (tasksResult.data ?? []) as WorkspaceTask[],
    events: (eventsResult.data ?? []) as WorkspaceEvent[],
    invitations: (invitationsResult.data ?? []) as WorkspaceInvitation[],
    unread: (unreadResult.data ?? []) as WorkspaceNotification[],
    prefs: (prefsResult.data as WorkspaceNotificationPrefs | null) ?? null,
    copyCandidates:
      (copyResult.data as { id: string; title: string; desired_outcome: string }[]) ?? [],
  };
}

export type WorkspaceGoalDetail = {
  workspace: Workspace;
  goal: WorkspaceGoal;
  tasks: WorkspaceTask[];
  comments: WorkspaceComment[];
  members: WorkspaceMember[];
  myRole: WorkspaceRole;
};

export async function getWorkspaceGoalDetail(
  session: Session,
  workspaceId: string,
  goalId: string,
): Promise<WorkspaceGoalDetail | null> {
  const { data: workspace, error } = await session.supabase
    .from("workspaces")
    .select("id, name, description, created_by, created_at, updated_at")
    .eq("id", workspaceId)
    .maybeSingle();

  if (error) {
    console.error("getWorkspaceGoalDetail workspace failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!workspace) return null;

  const [goalResult, membership, directory] = await Promise.all([
    session.supabase
      .from("workspace_goals")
      .select("*")
      .eq("id", goalId)
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    session.supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", session.user.id)
      .eq("status", "active")
      .maybeSingle(),
    session.supabase.rpc("workspace_member_directory", {
      p_workspace_id: workspaceId,
    }),
  ]);

  if (goalResult.error) {
    console.error("getWorkspaceGoalDetail goal failed:", goalResult.error.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!goalResult.data || !membership.data) return null;

  const myRole = (membership.data as { role: WorkspaceRole }).role;
  const members =
    ((directory.data ?? {}) as { members?: WorkspaceMember[] }).members ?? [];

  const { data: tasks, error: tasksError } = await session.supabase
    .from("workspace_tasks")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("goal_id", goalId)
    .order("created_at", { ascending: true });

  if (tasksError) {
    console.error("getWorkspaceGoalDetail tasks failed:", tasksError.message);
    throw new DataError(LOAD_ERROR);
  }

  const taskRows = (tasks ?? []) as WorkspaceTask[];
  const taskIds = taskRows.map((task) => task.id);

  const commentsResult = taskIds.length
    ? await session.supabase
        .from("workspace_task_comments")
        .select("id, workspace_id, task_id, author_id, body, created_at")
        .eq("workspace_id", workspaceId)
        .in("task_id", taskIds)
        .order("created_at", { ascending: true })
        .limit(200)
    : { data: [] as WorkspaceComment[], error: null };

  if (commentsResult.error) {
    console.error("getWorkspaceGoalDetail comments failed:", commentsResult.error.message);
    throw new DataError(LOAD_ERROR);
  }

  return {
    workspace: workspace as Workspace,
    goal: goalResult.data as WorkspaceGoal,
    tasks: taskRows,
    comments: (commentsResult.data ?? []) as WorkspaceComment[],
    members,
    myRole,
  };
}

export type InvitationPreview = {
  workspace_name: string;
  inviter_name: string;
  role: "admin" | "member";
  expires_at: string;
};

export async function getInvitationPreview(
  session: Session,
  token: string,
): Promise<InvitationPreview | null> {
  const { data, error } = await session.supabase.rpc(
    "workspace_invitation_preview",
    { p_token: token },
  );

  if (error) {
    console.error("workspace_invitation_preview failed:", error.message);
    return null;
  }

  const payload = (data ?? {}) as { ok?: boolean } & Partial<InvitationPreview>;
  if (payload.ok !== true) return null;

  return {
    workspace_name: payload.workspace_name ?? "a workspace",
    inviter_name: payload.inviter_name ?? "A teammate",
    role: payload.role ?? "member",
    expires_at: payload.expires_at ?? "",
  };
}

export async function getMyNotificationCount(session: Session): Promise<number> {
  const { count, error } = await session.supabase
    .from("workspace_notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", session.user.id)
    .is("read_at", null);

  if (error) {
    console.error("getMyNotificationCount failed:", error.message);
    return 0;
  }

  return count ?? 0;
}
