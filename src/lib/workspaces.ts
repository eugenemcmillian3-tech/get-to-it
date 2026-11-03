import { z } from "zod";
import { inviteEmailSchema } from "@/lib/partner";
import type {
  TaskStatus,
  WorkspaceEventKind,
  WorkspaceGoal,
  WorkspaceMember,
  WorkspaceMemberStatus,
  WorkspaceNotificationPrefs,
  WorkspaceRole,
  WorkspaceTask,
} from "@/lib/types";
import { taskStatusSchema } from "@/lib/validation";

/**
 * Phase 13 rules that are worth testing without a database: the role matrix,
 * who may assign or edit what, how progress is counted, and the wording the UI
 * uses. The database enforces the same rules again — this module is not the
 * security boundary, it is the explanation of it.
 */

export const WORKSPACE_NAME_MIN = 2;
export const WORKSPACE_NAME_MAX = 80;
export const WORKSPACE_DESCRIPTION_MAX = 500;
export const WORKSPACE_GOAL_TITLE_MAX = 160;
export const WORKSPACE_COMMENT_MAX = 1000;
export const WORKSPACE_TASK_TITLE_MAX = 200;
export const WORKSPACE_INVITE_DAYS = 7;

export const WORKSPACE_ROLES: WorkspaceRole[] = ["owner", "admin", "member"];

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

export const ROLE_DESCRIPTIONS: Record<WorkspaceRole, string> = {
  owner: "Membership, roles, workspace settings and deletion.",
  admin: "Shared goals, tasks and assignments.",
  member: "Participates in the shared work that is there.",
};

export const ROLE_RANK: Record<WorkspaceRole, number> = {
  owner: 0,
  admin: 1,
  member: 2,
};

export type WorkspacePermission =
  | "workspace.settings"
  | "workspace.delete"
  | "members.invite"
  | "members.remove"
  | "members.changeRole"
  | "members.leave"
  | "goals.create"
  | "goals.edit"
  | "goals.delete"
  | "tasks.create"
  | "tasks.assignOthers"
  | "tasks.updateAny"
  | "tasks.updateOwn"
  | "tasks.delete"
  | "comments.write"
  | "comments.deleteAny"
  | "prefs.own";

export type PermissionRow = {
  permission: WorkspacePermission;
  label: string;
  allowed: Record<WorkspaceRole, boolean>;
};

/**
 * The matrix in WORKSPACES.md, as data. The UI renders this and the tests check
 * it, so the documented table and the shipped rules cannot drift apart.
 */
export const PERMISSION_MATRIX: readonly PermissionRow[] = [
  {
    permission: "workspace.settings",
    label: "Rename the workspace and edit its description",
    allowed: { owner: true, admin: false, member: false },
  },
  {
    permission: "workspace.delete",
    label: "Delete the workspace",
    allowed: { owner: true, admin: false, member: false },
  },
  {
    permission: "members.invite",
    label: "Invite a member",
    allowed: { owner: true, admin: false, member: false },
  },
  {
    permission: "members.remove",
    label: "Remove a member",
    allowed: { owner: true, admin: false, member: false },
  },
  {
    permission: "members.changeRole",
    label: "Change a member's role",
    allowed: { owner: true, admin: false, member: false },
  },
  {
    permission: "members.leave",
    label: "Leave the workspace",
    allowed: { owner: true, admin: true, member: true },
  },
  {
    permission: "goals.create",
    label: "Create a shared goal",
    allowed: { owner: true, admin: true, member: false },
  },
  {
    permission: "goals.edit",
    label: "Edit or archive a shared goal",
    allowed: { owner: true, admin: true, member: false },
  },
  {
    permission: "goals.delete",
    label: "Delete a shared goal",
    allowed: { owner: true, admin: true, member: false },
  },
  {
    permission: "tasks.create",
    label: "Add a task",
    allowed: { owner: true, admin: true, member: true },
  },
  {
    permission: "tasks.assignOthers",
    label: "Assign a task to anyone",
    allowed: { owner: true, admin: true, member: false },
  },
  {
    permission: "tasks.updateAny",
    label: "Update any task",
    allowed: { owner: true, admin: true, member: false },
  },
  {
    permission: "tasks.updateOwn",
    label: "Update a task assigned to you",
    allowed: { owner: true, admin: true, member: true },
  },
  {
    permission: "tasks.delete",
    label: "Delete a task",
    allowed: { owner: true, admin: true, member: false },
  },
  {
    permission: "comments.write",
    label: "Comment on a task",
    allowed: { owner: true, admin: true, member: true },
  },
  {
    permission: "comments.deleteAny",
    label: "Delete anyone's comment",
    allowed: { owner: true, admin: true, member: false },
  },
  {
    permission: "prefs.own",
    label: "Choose your own notification preferences",
    allowed: { owner: true, admin: true, member: true },
  },
];

export function can(
  role: WorkspaceRole | null | undefined,
  permission: WorkspacePermission,
): boolean {
  if (!role) return false;
  const row = PERMISSION_MATRIX.find((entry) => entry.permission === permission);
  return row ? row.allowed[role] : false;
}

/** Roles an actor may hand out. Only an owner changes roles at all. */
export function assignableRoles(role: WorkspaceRole | null | undefined): WorkspaceRole[] {
  return role === "owner" ? ["owner", "admin", "member"] : [];
}

export function canAssignTask(
  role: WorkspaceRole | null | undefined,
  actorId: string,
  assigneeId: string | null,
): boolean {
  if (!role) return false;
  if (assigneeId === null) return true;
  if (assigneeId === actorId) return true;
  return role === "owner" || role === "admin";
}

export function canEditTask(
  role: WorkspaceRole | null | undefined,
  actorId: string,
  task: Pick<WorkspaceTask, "assignee_id">,
): boolean {
  if (!role) return false;
  if (role === "owner" || role === "admin") return true;
  return task.assignee_id === actorId;
}

export function canDeleteTask(role: WorkspaceRole | null | undefined): boolean {
  return can(role, "tasks.delete");
}

export function canDeleteComment(
  role: WorkspaceRole | null | undefined,
  actorId: string,
  authorId: string | null,
): boolean {
  if (!role) return false;
  if (role === "owner" || role === "admin") return true;
  return authorId !== null && authorId === actorId;
}

/**
 * The only owner cannot leave: there would be nobody to administer the
 * workspace. Their resolution is to transfer ownership first, or delete it.
 */
export function canLeaveWorkspace(role: WorkspaceRole | null | undefined): boolean {
  return role === "admin" || role === "member";
}

export function canRemoveMember(
  role: WorkspaceRole | null | undefined,
  targetRole: WorkspaceRole | null | undefined,
): boolean {
  if (role !== "owner") return false;
  return targetRole === "admin" || targetRole === "member";
}

export function memberStatusLabel(status: WorkspaceMemberStatus): string {
  switch (status) {
    case "active":
      return "Active";
    case "left":
      return "Left";
    case "removed":
      return "Removed";
    default:
      return "";
  }
}

/**
 * A person who left keeps their comments, but not their name in the shared
 * view: "Former member" is honest and does not pretend they are still here.
 */
export function memberLabel(member: Pick<WorkspaceMember, "display_name" | "status">): string {
  return member.status === "active" ? member.display_name : "Former member";
}

export function sortMembers<T extends Pick<WorkspaceMember, "role" | "status" | "display_name">>(
  members: T[],
): T[] {
  return [...members].sort((a, b) => {
    if (a.status !== b.status) return a.status === "active" ? -1 : 1;
    const rank = ROLE_RANK[a.role] - ROLE_RANK[b.role];
    if (rank !== 0) return rank;
    return a.display_name.localeCompare(b.display_name);
  });
}

export type WorkspaceProgress = {
  goalsTotal: number;
  goalsDone: number;
  tasksTotal: number;
  tasksDone: number;
  myTasksTotal: number;
  myTasksDone: number;
  percent: number;
};

export function progressPercent(done: number, total: number): number {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((done / total) * 100)));
}

/**
 * Counts workspace rows only. Archived goals and their tasks are left out, and a
 * goal counts as done only when it has at least one task and every task is
 * complete — the same rule as personal goals.
 */
export function workspaceProgress(
  goals: Pick<WorkspaceGoal, "id" | "archived_at">[],
  tasks: Pick<WorkspaceTask, "goal_id" | "status" | "assignee_id">[],
  meId: string,
): WorkspaceProgress {
  const activeGoals = goals.filter((goal) => goal.archived_at === null);
  const activeIds = new Set(activeGoals.map((goal) => goal.id));
  const visibleTasks = tasks.filter((task) => activeIds.has(task.goal_id));

  const tasksTotal = visibleTasks.length;
  const tasksDone = visibleTasks.filter((task) => task.status === "completed").length;

  const goalsDone = activeGoals.filter((goal) => {
    const own = visibleTasks.filter((task) => task.goal_id === goal.id);
    return own.length > 0 && own.every((task) => task.status === "completed");
  }).length;

  const mine = visibleTasks.filter((task) => task.assignee_id === meId);

  return {
    goalsTotal: activeGoals.length,
    goalsDone,
    tasksTotal,
    tasksDone,
    myTasksTotal: mine.length,
    myTasksDone: mine.filter((task) => task.status === "completed").length,
    percent: progressPercent(tasksDone, tasksTotal),
  };
}

export function statusCounts(tasks: Pick<WorkspaceTask, "status">[]): Record<TaskStatus, number> {
  const counts: Record<TaskStatus, number> = {
    todo: 0,
    in_progress: 0,
    completed: 0,
  };
  for (const task of tasks) counts[task.status] += 1;
  return counts;
}

export const DEFAULT_NOTIFICATION_PREFS: WorkspaceNotificationPrefs = {
  notify_assignments: true,
  notify_comments: true,
  notify_membership: true,
};

export function normalizeNotificationPrefs(
  row: Partial<WorkspaceNotificationPrefs> | null | undefined,
): WorkspaceNotificationPrefs {
  return {
    notify_assignments: row?.notify_assignments ?? true,
    notify_comments: row?.notify_comments ?? true,
    notify_membership: row?.notify_membership ?? true,
  };
}

/** Deliveries are in-app only; there is no email, SMS or push channel. */
export const NOTIFICATION_CHANNEL_NOTE =
  "Notifications appear in this workspace's inbox only. GET TO IT sends no email, SMS or push messages.";

export const COPY_CONFIRMATION_LABEL =
  "Copy this personal goal's title and outcome into the workspace";

export const COPY_CONFIRMATION_HELP =
  "Only the title and desired outcome are copied, and only into this workspace. Your personal goal, its tasks, saved work and notes stay private and stay where they are.";

export const SOURCES_NOTE =
  "Workspace progress counts workspace rows only. It is not computed from anyone's personal goals, saved work or focus sessions.";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const uuidSchema = z
  .string()
  .trim()
  .regex(UUID_PATTERN, "That link doesn't look right.");

export const workspaceNameSchema = z
  .string()
  .trim()
  .min(WORKSPACE_NAME_MIN, "Give the workspace a name.")
  .max(WORKSPACE_NAME_MAX, "Keep the name under 80 characters.");

export const workspaceDescriptionSchema = z
  .string()
  .trim()
  .max(WORKSPACE_DESCRIPTION_MAX, "Keep the description under 500 characters.");

export const workspaceCreateSchema = z.object({
  name: workspaceNameSchema,
  description: workspaceDescriptionSchema.default(""),
});

export type WorkspaceCreateInput = z.infer<typeof workspaceCreateSchema>;

export const workspaceSettingsSchema = workspaceCreateSchema.extend({
  workspace_id: uuidSchema,
});

export const workspaceInviteSchema = z.object({
  workspace_id: uuidSchema,
  email: inviteEmailSchema,
  role: z.enum(["admin", "member"]),
});

export const workspaceRoleSchema = z.enum(["owner", "admin", "member"]);

export const workspaceGoalSchema = z.object({
  workspace_id: uuidSchema,
  title: z
    .string()
    .trim()
    .min(3, "Give the shared goal a short title.")
    .max(WORKSPACE_GOAL_TITLE_MAX, "Keep the title under 160 characters."),
  desired_outcome: z
    .string()
    .trim()
    .min(5, "Describe what done looks like, even roughly.")
    .max(2000, "Keep the outcome under 2000 characters."),
});

/**
 * Sharing a personal goal is a copy, and the person has to say so explicitly.
 * The checkbox is the confirmation; a missing tick is a refused action, not a
 * default.
 */
export const personalGoalShareSchema = z.object({
  workspace_id: uuidSchema,
  goal_id: uuidSchema,
  confirmed: z.boolean(),
}).refine((value) => value.confirmed, {
  message: "Tick the confirmation box to copy a personal goal into this workspace.",
  path: ["confirmed"],
});

export const workspaceTaskSchema = z.object({
  workspace_id: uuidSchema,
  goal_id: uuidSchema,
  title: z
    .string()
    .trim()
    .min(2, "Give the task a short, specific name.")
    .max(WORKSPACE_TASK_TITLE_MAX, "Keep task names under 200 characters."),
  assignee_id: z.string().trim().default(""),
});

export const workspaceTaskUpdateSchema = workspaceTaskSchema.extend({
  task_id: uuidSchema,
  status: taskStatusSchema,
});

export const workspaceCommentSchema = z.object({
  workspace_id: uuidSchema,
  task_id: uuidSchema,
  body: z
    .string()
    .trim()
    .min(1, "Write a comment before posting.")
    .max(WORKSPACE_COMMENT_MAX, "Keep comments under 1000 characters."),
});

export const notificationPrefsSchema = z.object({
  assignments: z.boolean(),
  comments: z.boolean(),
  membership: z.boolean(),
});

export function normalizedAssignee(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export const EVENT_LABELS: Record<WorkspaceEventKind, string> = {
  workspace_created: "Workspace created",
  workspace_renamed: "Workspace settings changed",
  member_invited: "Invitation created",
  invitation_cancelled: "Invitation cancelled",
  member_joined: "Member joined",
  role_changed: "Role changed",
  member_removed: "Member removed",
  member_left: "Member left",
  goal_created: "Shared goal created",
  goal_shared: "Personal goal copied in",
};

export function eventLabel(kind: string): string {
  return EVENT_LABELS[kind as WorkspaceEventKind] ?? "Workspace activity";
}

/** Plain-language reasons, kept short and free of blame. */
export function workspaceErrorMessage(code: string | undefined): string {
  switch (code) {
    case "unauthenticated":
      return "Your session expired. Sign in again.";
    case "not-owner":
      return "Only the owner can do that.";
    case "no-workspace":
      return "That workspace isn't available to you.";
    case "no-member":
      return "That person isn't an active member of this workspace.";
    case "last-owner":
      return "A workspace needs an owner. Make someone else the owner first — or delete the workspace.";
    case "use-leave":
      return "Use “Leave workspace” to leave it yourself.";
    case "invalid-invitation":
      return "That invitation didn't work. It may have expired, been used, or be for a different account.";
    case "invalid-role":
      return "Choose one of the available roles.";
    case "invalid-name":
      return "Give the workspace a name of 2 to 80 characters.";
    case "description-too-long":
      return "Keep the description under 500 characters.";
    case "invalid-email":
      return "That email doesn't look right.";
    case "own-email":
      return "That's your own address. Invite someone else.";
    case "already-member":
      return "They're already a member of this workspace.";
    case "already-invited":
      return "There's already a pending invitation for that address.";
    case "no-invitation":
      return "That invitation is no longer pending.";
    case "assignee-not-member":
      return "Choose an active member, or leave the task unassigned.";
    case "not-assignable":
      return "You can assign tasks to yourself or leave them unassigned.";
    default:
      return "That didn't work. Nothing was changed — try again.";
  }
}

/** A deterministic time label, so server and client render the same text. */
export function formatWorkspaceTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

/** Short relative label for the inbox; falls back to the absolute time. */
export function inboxWhen(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) {
    const hours = Math.floor(minutes / 60);
    return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  return formatWorkspaceTime(iso);
}
