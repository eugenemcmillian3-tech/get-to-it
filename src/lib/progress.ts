import type { FocusTotals, TaskStatus } from "@/lib/types";

export type TaskCounts = {
  total: number;
  todo: number;
  inProgress: number;
  completed: number;
  percentComplete: number;
};

export function summarizeTaskStatuses(
  tasks: { status: TaskStatus }[],
): TaskCounts {
  const total = tasks.length;
  let todo = 0;
  let inProgress = 0;
  let completed = 0;

  for (const task of tasks) {
    if (task.status === "completed") completed += 1;
    else if (task.status === "in_progress") inProgress += 1;
    else todo += 1;
  }

  return {
    total,
    todo,
    inProgress,
    completed,
    percentComplete: total === 0 ? 0 : Math.round((completed / total) * 100),
  };
}

export function formatProgress(counts: TaskCounts): string {
  if (counts.total === 0) return "No tasks yet";
  const noun = counts.total === 1 ? "task" : "tasks";
  return `${counts.completed} of ${counts.total} ${noun} complete`;
}

/* -------------------------------------------------------------------------
 * Progress overview
 *
 * Four separate facts, reported separately: completed tasks, tasks with saved
 * work, completed goals and recorded focus time. There is deliberately no
 * combined "productivity" or "wellbeing" number — nothing here judges a week.
 * ---------------------------------------------------------------------- */

export type ProgressGoal = { id: string; title: string };

export type ProgressTask = {
  id: string;
  goal_id: string;
  title: string;
  status: TaskStatus;
  sort_order: number;
  created_at: string;
  updated_at: string;
  first_action: string | null;
  estimated_minutes: number | null;
};

export type ProgressSnapshot = {
  totalGoals: number;
  /** Goals with at least one task and nothing left open. */
  completedGoals: number;
  completedTasks: number;
  openTasks: number;
  /** Tasks with a non-empty saved workspace. */
  savedWork: number;
  focusSeconds: number;
  focusSessions: number;
};

export function summarizeProgress(
  goals: ProgressGoal[],
  tasks: ProgressTask[],
  savedWorkTaskIds: string[],
  focus: FocusTotals,
): ProgressSnapshot {
  const completedTasks = tasks.filter((task) => task.status === "completed");

  let completedGoals = 0;
  for (const goal of goals) {
    const goalTasks = tasks.filter((task) => task.goal_id === goal.id);
    if (
      goalTasks.length > 0 &&
      goalTasks.every((task) => task.status === "completed")
    ) {
      completedGoals += 1;
    }
  }

  return {
    totalGoals: goals.length,
    completedGoals,
    completedTasks: completedTasks.length,
    openTasks: tasks.length - completedTasks.length,
    savedWork: new Set(savedWorkTaskIds).size,
    focusSeconds: Math.max(0, focus.total_seconds),
    focusSessions: Math.max(0, focus.session_count),
  };
}

/* -------------------------------------------------------------------------
 * "Continue where you left off"
 *
 * One unfinished task, chosen predictably: something already in progress, else
 * the first thing on the list. No streaks, no days-missed counters.
 * ---------------------------------------------------------------------- */

export type NextStep = {
  taskId: string;
  goalId: string;
  taskTitle: string;
  goalTitle: string;
  status: TaskStatus;
  smallerStep: string;
};

/** A smaller version of the task, for when the real one feels too big. */
export function smallerStepFor(
  task: Pick<ProgressTask, "title" | "first_action" | "estimated_minutes">,
): string {
  const firstAction = task.first_action?.trim();
  if (firstAction) return `Just the first action: ${firstAction}`;

  if (task.estimated_minutes !== null && task.estimated_minutes > 30) {
    return `Give it ten minutes: open “${task.title}” and stop when the timer ends.`;
  }

  return `Open “${task.title}” and write one sentence. That counts.`;
}

export function pickNextStep(
  goals: ProgressGoal[],
  tasks: ProgressTask[],
): NextStep | null {
  const open = tasks.filter((task) => task.status !== "completed");
  if (open.length === 0) return null;

  const inProgress = open
    .filter((task) => task.status === "in_progress")
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at));

  const picked =
    inProgress[0] ??
    [...open].sort(
      (a, b) =>
        a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at),
    )[0];

  const goal = goals.find((candidate) => candidate.id === picked.goal_id);
  if (!goal) return null;

  return {
    taskId: picked.id,
    goalId: picked.goal_id,
    taskTitle: picked.title,
    goalTitle: goal.title,
    status: picked.status,
    smallerStep: smallerStepFor(picked),
  };
}
