import type { Session } from "@/lib/auth";
import { DataError } from "@/lib/data/goals";
import { currentWeekStart } from "@/lib/focus";
import {
  pickNextStep,
  summarizeProgress,
  type NextStep,
  type ProgressGoal,
  type ProgressSnapshot,
  type ProgressTask,
} from "@/lib/progress";
import type {
  FocusSessionView,
  FocusSnapshot,
  FocusTotals,
  WeeklyCheckin,
} from "@/lib/types";

const LOAD_ERROR =
  "We couldn't load your progress just now. Refresh the page to try again.";

type FocusRpcPayload = {
  ok?: boolean;
  code?: string;
  session?: FocusSessionView | null;
  totals?: Partial<FocusTotals>;
};

/**
 * The server's view of the timer. Elapsed time is calculated in Postgres from
 * stored timestamps, so nothing here trusts the browser for a total.
 */
export async function getFocusSnapshot(
  session: Session,
): Promise<FocusSnapshot> {
  const { data, error } = await session.supabase.rpc("focus_snapshot");

  if (error) {
    console.error("getFocusSnapshot failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }

  const payload = (data ?? {}) as FocusRpcPayload;
  const totals = payload.totals ?? {};

  return {
    session: payload.session ?? null,
    totals: {
      today_seconds: Number(totals.today_seconds ?? 0),
      week_seconds: Number(totals.week_seconds ?? 0),
      total_seconds: Number(totals.total_seconds ?? 0),
      session_count: Number(totals.session_count ?? 0),
    },
  };
}

export type DashboardData = {
  progress: ProgressSnapshot;
  nextStep: NextStep | null;
  activeSession: { session: FocusSessionView; taskTitle: string } | null;
};

/** Everything the dashboard needs, in one round of queries. */
export async function getDashboardData(
  session: Session,
): Promise<DashboardData> {
  const userId = session.user.id;

  const [goalsResult, tasksResult, resultsResult, focus] = await Promise.all([
    // Archived goals are set aside, so they never drive the next-step card or
    // the progress figures.
    session.supabase
      .from("goals")
      .select("id, title")
      .eq("user_id", userId)
      .is("archived_at", null),
    session.supabase
      .from("tasks")
      .select(
        "id, goal_id, title, status, sort_order, created_at, updated_at, first_action, estimated_minutes",
      )
      .eq("user_id", userId),
    session.supabase
      .from("task_results")
      .select("task_id, content")
      .eq("user_id", userId),
    getFocusSnapshot(session),
  ]);

  if (goalsResult.error || tasksResult.error || resultsResult.error) {
    console.error(
      "getDashboardData failed:",
      goalsResult.error?.message ??
        tasksResult.error?.message ??
        resultsResult.error?.message,
    );
    throw new DataError(LOAD_ERROR);
  }

  const goals = (goalsResult.data ?? []) as ProgressGoal[];
  const activeGoalIds = new Set(goals.map((goal) => goal.id));
  const tasks = ((tasksResult.data ?? []) as ProgressTask[]).filter((task) =>
    activeGoalIds.has(task.goal_id),
  );

  const savedWorkTaskIds = (
    (resultsResult.data ?? []) as { task_id: string; content: string }[]
  )
    .filter((row) => row.content.trim() !== "")
    .map((row) => row.task_id);

  const openSession = focus.session;
  const activeSession = openSession
    ? {
        session: openSession,
        taskTitle:
          tasks.find((task) => task.id === openSession.task_id)?.title ??
          "a task",
      }
    : null;

  return {
    progress: summarizeProgress(goals, tasks, savedWorkTaskIds, focus.totals),
    nextStep: pickNextStep(goals, tasks),
    activeSession,
  };
}

/** This week's reflection, if there is one. The week comes from the server. */
export async function getCurrentCheckin(
  session: Session,
): Promise<WeeklyCheckin | null> {
  const weekStart = currentWeekStart();

  const { data, error } = await session.supabase
    .from("weekly_checkins")
    .select(
      "id, week_start, moved_forward, got_in_the_way, next_step, updated_at",
    )
    .eq("user_id", session.user.id)
    .eq("week_start", weekStart)
    .maybeSingle();

  if (error) {
    console.error("getCurrentCheckin failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }

  return (data as WeeklyCheckin | null) ?? null;
}
