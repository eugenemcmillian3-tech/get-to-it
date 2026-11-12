import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTIFICATION_PREFS,
  PERMISSION_MATRIX,
  ROLE_LABELS,
  assignableRoles,
  can,
  canAssignTask,
  canDeleteComment,
  canDeleteTask,
  canEditTask,
  canLeaveWorkspace,
  canRemoveMember,
  eventLabel,
  formatWorkspaceTime,
  inboxWhen,
  memberLabel,
  memberStatusLabel,
  normalizedAssignee,
  normalizeNotificationPrefs,
  notificationPrefsSchema,
  personalGoalShareSchema,
  progressPercent,
  sortMembers,
  statusCounts,
  workspaceCommentSchema,
  workspaceCreateSchema,
  workspaceErrorMessage,
  workspaceGoalSchema,
  workspaceInviteSchema,
  workspaceProgress,
  workspaceTaskSchema,
  workspaceTaskUpdateSchema,
} from "@/lib/workspaces";
import type { WorkspaceMember, WorkspaceRole } from "@/lib/types";

const OWNER: WorkspaceRole = "owner";
const ADMIN: WorkspaceRole = "admin";
const MEMBER: WorkspaceRole = "member";
const ME = "11111111-1111-4111-8111-111111111111";
const THEM = "22222222-2222-4222-8222-222222222222";
const GOAL = "33333333-3333-4333-8333-333333333333";
const TASK = "44444444-4444-4444-8444-444444444444";

describe("the permission matrix", () => {
  it("has a row for every permission, with all three roles answered", () => {
    const permissions = PERMISSION_MATRIX.map((row) => row.permission);
    expect(new Set(permissions).size).toBe(permissions.length);

    for (const row of PERMISSION_MATRIX) {
      expect(typeof row.allowed.owner).toBe("boolean");
      expect(typeof row.allowed.admin).toBe("boolean");
      expect(typeof row.allowed.member).toBe("boolean");
    }
  });

  it("gives membership and deletion to the owner alone", () => {
    for (const permission of [
      "workspace.settings",
      "workspace.delete",
      "members.invite",
      "members.remove",
      "members.changeRole",
    ] as const) {
      expect(can(OWNER, permission)).toBe(true);
      expect(can(ADMIN, permission)).toBe(false);
      expect(can(MEMBER, permission)).toBe(false);
    }
  });

  it("lets admins manage shared goals and assignments, not membership", () => {
    expect(can(ADMIN, "goals.create")).toBe(true);
    expect(can(ADMIN, "goals.delete")).toBe(true);
    expect(can(ADMIN, "tasks.assignOthers")).toBe(true);
    expect(can(ADMIN, "tasks.delete")).toBe(true);
    expect(can(ADMIN, "members.invite")).toBe(false);
    expect(can(ADMIN, "workspace.settings")).toBe(false);
  });

  it("keeps members inside the shared work", () => {
    expect(can(MEMBER, "tasks.create")).toBe(true);
    expect(can(MEMBER, "comments.write")).toBe(true);
    expect(can(MEMBER, "tasks.updateOwn")).toBe(true);
    expect(can(MEMBER, "tasks.assignOthers")).toBe(false);
    expect(can(MEMBER, "tasks.updateAny")).toBe(false);
    expect(can(MEMBER, "goals.create")).toBe(false);
    expect(can(MEMBER, "comments.deleteAny")).toBe(false);
  });

  it("denies everything to someone with no role", () => {
    expect(can(null, "comments.write")).toBe(false);
    expect(can(undefined, "members.leave")).toBe(false);
  });

  it("lets only an owner hand out roles", () => {
    expect(assignableRoles(OWNER)).toEqual(["owner", "admin", "member"]);
    expect(assignableRoles(ADMIN)).toEqual([]);
    expect(assignableRoles(MEMBER)).toEqual([]);
  });
});

describe("task assignment rules", () => {
  it("lets anyone leave a task unassigned or take it themselves", () => {
    for (const role of [OWNER, ADMIN, MEMBER]) {
      expect(canAssignTask(role, ME, null)).toBe(true);
      expect(canAssignTask(role, ME, ME)).toBe(true);
    }
  });

  it("only lets owners and admins assign someone else", () => {
    expect(canAssignTask(OWNER, ME, THEM)).toBe(true);
    expect(canAssignTask(ADMIN, ME, THEM)).toBe(true);
    expect(canAssignTask(MEMBER, ME, THEM)).toBe(false);
    expect(canAssignTask(null, ME, THEM)).toBe(false);
  });

  it("lets a member edit only a task assigned to them", () => {
    expect(canEditTask(MEMBER, ME, { assignee_id: ME })).toBe(true);
    expect(canEditTask(MEMBER, ME, { assignee_id: THEM })).toBe(false);
    expect(canEditTask(MEMBER, ME, { assignee_id: null })).toBe(false);
    expect(canEditTask(ADMIN, ME, { assignee_id: THEM })).toBe(true);
    expect(canEditTask(OWNER, ME, { assignee_id: null })).toBe(true);
  });

  it("only lets owners and admins delete a task", () => {
    expect(canDeleteTask(OWNER)).toBe(true);
    expect(canDeleteTask(ADMIN)).toBe(true);
    expect(canDeleteTask(MEMBER)).toBe(false);
  });
});

describe("comments", () => {
  it("lets an author delete their own comment", () => {
    expect(canDeleteComment(MEMBER, ME, ME)).toBe(true);
    expect(canDeleteComment(MEMBER, ME, THEM)).toBe(false);
    expect(canDeleteComment(MEMBER, ME, null)).toBe(false);
  });

  it("lets admins and owners delete anyone's comment", () => {
    expect(canDeleteComment(ADMIN, ME, THEM)).toBe(true);
    expect(canDeleteComment(OWNER, ME, null)).toBe(true);
  });

  it("validates the comment body", () => {
    expect(
      workspaceCommentSchema.safeParse({
        workspace_id: GOAL,
        task_id: TASK,
        body: "  Looks good to me.  ",
      }).success,
    ).toBe(true);
    expect(
      workspaceCommentSchema.safeParse({
        workspace_id: GOAL,
        task_id: TASK,
        body: "   ",
      }).success,
    ).toBe(false);
    expect(
      workspaceCommentSchema.safeParse({
        workspace_id: GOAL,
        task_id: TASK,
        body: "x".repeat(1001),
      }).success,
    ).toBe(false);
  });
});

describe("leaving and removal", () => {
  it("does not let the owner leave", () => {
    expect(canLeaveWorkspace(OWNER)).toBe(false);
    expect(canLeaveWorkspace(ADMIN)).toBe(true);
    expect(canLeaveWorkspace(MEMBER)).toBe(true);
    expect(canLeaveWorkspace(null)).toBe(false);
  });

  it("lets an owner remove admins and members, never another owner", () => {
    expect(canRemoveMember(OWNER, ADMIN)).toBe(true);
    expect(canRemoveMember(OWNER, MEMBER)).toBe(true);
    expect(canRemoveMember(OWNER, OWNER)).toBe(false);
    expect(canRemoveMember(ADMIN, MEMBER)).toBe(false);
  });

  it("explains the last-owner resolution instead of pretending", () => {
    expect(workspaceErrorMessage("last-owner")).toContain("Make someone else the owner");
    expect(workspaceErrorMessage("use-leave")).toContain("Leave workspace");
  });
});

describe("member labels", () => {
  const members: WorkspaceMember[] = [
    {
      user_id: THEM,
      display_name: "Zoe",
      role: "member",
      status: "left",
      joined_at: "2026-01-01T00:00:00.000Z",
    },
    {
      user_id: ME,
      display_name: "Ada",
      role: "owner",
      status: "active",
      joined_at: "2026-01-01T00:00:00.000Z",
    },
    {
      user_id: GOAL,
      display_name: "Bea",
      role: "admin",
      status: "active",
      joined_at: "2026-01-01T00:00:00.000Z",
    },
  ];

  it("keeps former members in the list but not by name", () => {
    expect(memberLabel(members[0])).toBe("Former member");
    expect(memberLabel(members[1])).toBe("Ada");
    expect(memberStatusLabel("removed")).toBe("Removed");
  });

  it("sorts active members by role, then name", () => {
    const sorted = sortMembers(members);
    expect(sorted.map((member) => member.display_name)).toEqual(["Ada", "Bea", "Zoe"]);
  });
});

describe("shared progress", () => {
  const goals = [
    { id: GOAL, archived_at: null },
    { id: TASK, archived_at: "2026-01-01T00:00:00.000Z" },
  ];

  it("counts nothing when there is no work", () => {
    expect(workspaceProgress([], [], ME)).toMatchObject({
      goalsTotal: 0,
      tasksTotal: 0,
      percent: 0,
    });
  });

  it("ignores archived goals and their tasks", () => {
    const tasks = [
      { goal_id: GOAL, status: "completed" as const, assignee_id: ME },
      { goal_id: TASK, status: "todo" as const, assignee_id: ME },
    ];
    const progress = workspaceProgress(goals, tasks, ME);
    expect(progress.goalsTotal).toBe(1);
    expect(progress.tasksTotal).toBe(1);
    expect(progress.myTasksTotal).toBe(1);
    expect(progress.percent).toBe(100);
  });

  it("counts a goal as done only when it has tasks and all are complete", () => {
    const tasks = [
      { goal_id: GOAL, status: "completed" as const, assignee_id: THEM },
      { goal_id: GOAL, status: "in_progress" as const, assignee_id: ME },
    ];
    expect(workspaceProgress(goals, tasks, ME).goalsDone).toBe(0);
    expect(workspaceProgress(goals, tasks, ME).percent).toBe(50);
    expect(workspaceProgress([goals[0]], [], ME).goalsDone).toBe(0);
  });

  it("never exceeds the 0–100 range", () => {
    expect(progressPercent(0, 0)).toBe(0);
    expect(progressPercent(5, 2)).toBe(100);
    expect(progressPercent(-1, 4)).toBe(0);
    expect(progressPercent(Number.NaN, 4)).toBe(0);
  });

  it("counts statuses", () => {
    expect(
      statusCounts([
        { status: "todo" },
        { status: "todo" },
        { status: "completed" },
      ]),
    ).toEqual({ todo: 2, in_progress: 0, completed: 1 });
  });
});

describe("creating and inviting", () => {
  it("requires a real workspace name", () => {
    expect(workspaceCreateSchema.safeParse({ name: "A" }).success).toBe(false);
    expect(workspaceCreateSchema.safeParse({ name: "  Crew  " }).success).toBe(true);
    expect(
      workspaceCreateSchema.safeParse({ name: "x".repeat(81) }).success,
    ).toBe(false);
  });

  it("trims the description and accepts an empty one", () => {
    const parsed = workspaceCreateSchema.safeParse({
      name: "Crew",
      description: "   ",
    });
    expect(parsed.success && parsed.data.description).toBe("");
  });

  it("accepts only admin or member as an invited role", () => {
    const base = { workspace_id: GOAL, email: "Teammate@Example.com" };
    expect(workspaceInviteSchema.safeParse({ ...base, role: "member" }).success).toBe(true);
    expect(workspaceInviteSchema.safeParse({ ...base, role: "admin" }).success).toBe(true);
    // Ownership is transferred, never invited.
    expect(workspaceInviteSchema.safeParse({ ...base, role: "owner" }).success).toBe(false);
  });

  it("rejects a malformed invitation address", () => {
    expect(
      workspaceInviteSchema.safeParse({
        workspace_id: GOAL,
        email: "not-an-email",
        role: "member",
      }).success,
    ).toBe(false);
  });
});

describe("shared goals and the copy confirmation", () => {
  it("validates a shared goal", () => {
    expect(
      workspaceGoalSchema.safeParse({
        workspace_id: GOAL,
        title: "Ship it",
        desired_outcome: "The page is live",
      }).success,
    ).toBe(true);
    expect(
      workspaceGoalSchema.safeParse({
        workspace_id: GOAL,
        title: "Sh",
        desired_outcome: "Live",
      }).success,
    ).toBe(false);
  });

  it("refuses to copy a personal goal without the explicit tick", () => {
    expect(
      personalGoalShareSchema.safeParse({
        workspace_id: GOAL,
        goal_id: TASK,
        confirmed: false,
      }).success,
    ).toBe(false);

    expect(
      personalGoalShareSchema.safeParse({
        workspace_id: GOAL,
        goal_id: TASK,
        confirmed: true,
      }).success,
    ).toBe(true);
  });
});

describe("tasks", () => {
  it("accepts an unassigned task", () => {
    const parsed = workspaceTaskSchema.safeParse({
      workspace_id: GOAL,
      goal_id: TASK,
      title: "Draft the copy",
      assignee_id: "",
    });
    expect(parsed.success).toBe(true);
    expect(normalizedAssignee("")).toBeNull();
    expect(normalizedAssignee("  ")).toBeNull();
    expect(normalizedAssignee(THEM)).toBe(THEM);
  });

  it("validates the status when editing", () => {
    expect(
      workspaceTaskUpdateSchema.safeParse({
        workspace_id: GOAL,
        goal_id: TASK,
        task_id: TASK,
        title: "Draft the copy",
        status: "completed",
        assignee_id: THEM,
      }).success,
    ).toBe(true);

    expect(
      workspaceTaskUpdateSchema.safeParse({
        workspace_id: GOAL,
        goal_id: TASK,
        task_id: TASK,
        title: "Draft the copy",
        status: "done",
        assignee_id: "",
      }).success,
    ).toBe(false);
  });
});

describe("notification preferences", () => {
  it("defaults every switch to on", () => {
    expect(normalizeNotificationPrefs(null)).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(normalizeNotificationPrefs({ notify_comments: false })).toEqual({
      notify_assignments: true,
      notify_comments: false,
      notify_membership: true,
      notify_incidents: true,
    });
  });

  it("accepts all-off", () => {
    expect(
      notificationPrefsSchema.safeParse({
        assignments: false,
        comments: false,
        membership: false,
        incidents: false,
      }).success,
    ).toBe(true);
  });
});

describe("labels and error copy", () => {
  it("uses role names the page also shows", () => {
    expect(ROLE_LABELS.owner).toBe("Owner");
    expect(ROLE_LABELS.admin).toBe("Admin");
    expect(ROLE_LABELS.member).toBe("Member");
  });

  it("names each audit kind", () => {
    expect(eventLabel("role_changed")).toBe("Role changed");
    expect(eventLabel("member_removed")).toBe("Member removed");
    expect(eventLabel("something-else")).toBe("Workspace activity");
  });

  it("does not leak whether an address has an account", () => {
    const message = workspaceErrorMessage("invalid-invitation");
    expect(message).toContain("expired");
    expect(message.toLowerCase()).not.toContain("account exists");
  });

  it("says when only the owner may act", () => {
    expect(workspaceErrorMessage("not-owner")).toBe("Only the owner can do that.");
  });

  it("formats times deterministically in UTC", () => {
    expect(formatWorkspaceTime("2026-11-02T09:05:00.000Z")).toBe("Nov 2, 9:05 AM");
    expect(formatWorkspaceTime("nope")).toBe("");
  });

  it("describes recent inbox times relative to now", () => {
    const now = new Date("2026-11-02T12:00:00.000Z");
    expect(inboxWhen("2026-11-02T11:59:40.000Z", now)).toBe("just now");
    expect(inboxWhen("2026-11-02T11:30:00.000Z", now)).toBe("30 min ago");
    expect(inboxWhen("2026-11-02T10:00:00.000Z", now)).toBe("2 hours ago");
    expect(inboxWhen("2026-10-30T10:00:00.000Z", now)).toBe("Oct 30, 10:00 AM");
  });
});
