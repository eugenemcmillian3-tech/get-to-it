import type { Session } from "@/lib/auth";
import { DataError } from "@/lib/data/goals";
import {
  buildExportBundle,
  type ExportBundle,
  type ExportPreferences,
  type ExportReflection,
  type ExportSource,
} from "@/lib/export";
import type { FocusSessionStatus } from "@/lib/types";

/**
 * Reads only the signed-in person's rows, and only the columns the export format
 * documents. Every query is filtered by `user_id` and every table is owner-only
 * under Row Level Security, so a foreign row cannot be returned even if a filter
 * were forgotten.
 */

const LOAD_ERROR =
  "We couldn't build your export just now. Nothing was downloaded — try again.";

export const EXPORT_ROW_LIMITS = {
  goals: 500,
  tasks: 2_000,
  results: 2_000,
  reflections: 300,
  focusSessions: 2_000,
} as const;

type GoalRow = ExportSource["goals"][number];
type TaskRow = ExportSource["tasks"][number];

export async function buildMyExport(session: Session): Promise<ExportBundle> {
  const { data: goals, error: goalsError } = await session.supabase
    .from("goals")
    .select(
      "id, title, desired_outcome, deadline, time_available_minutes, blocker, category, archived_at, created_at",
    )
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: true })
    .limit(EXPORT_ROW_LIMITS.goals);

  if (goalsError) {
    console.error("buildMyExport goals failed:", goalsError.message);
    throw new DataError(LOAD_ERROR);
  }

  const goalRows = (goals ?? []) as GoalRow[];
  const goalIds = goalRows.map((goal) => goal.id);

  const tasksResult = goalIds.length
    ? await session.supabase
        .from("tasks")
        .select(
          "id, goal_id, title, status, completed_at, instructions, first_action, expected_deliverable, estimated_minutes, origin, created_at",
        )
        .eq("user_id", session.user.id)
        .in("goal_id", goalIds)
        .order("created_at", { ascending: true })
        .limit(EXPORT_ROW_LIMITS.tasks)
    : { data: [] as TaskRow[], error: null };

  if (tasksResult.error) {
    console.error("buildMyExport tasks failed:", tasksResult.error.message);
    throw new DataError(LOAD_ERROR);
  }

  const taskRows = (tasksResult.data ?? []) as TaskRow[];
  const taskIds = taskRows.map((task) => task.id);

  const [resultsResult, reflectionsResult, preferencesResult, focusResult] =
    await Promise.all([
      taskIds.length
        ? session.supabase
            .from("task_results")
            .select("task_id, content, updated_at")
            .eq("user_id", session.user.id)
            .in("task_id", taskIds)
            .limit(EXPORT_ROW_LIMITS.results)
        : Promise.resolve({ data: [], error: null }),
      session.supabase
        .from("weekly_checkins")
        .select("week_start, moved_forward, got_in_the_way, next_step, updated_at")
        .eq("user_id", session.user.id)
        .order("week_start", { ascending: false })
        .limit(EXPORT_ROW_LIMITS.reflections),
      session.supabase
        .from("user_preferences")
        .select(
          "session_length_minutes, work_days, work_start, work_end, task_size, communication_style, help_topics, personalization_enabled, updated_at",
        )
        .eq("user_id", session.user.id)
        .maybeSingle(),
      session.supabase
        .from("focus_sessions")
        .select(
          "goal_id, task_id, status, started_at, finished_at, accumulated_seconds, segment_started_at",
        )
        .eq("user_id", session.user.id)
        .order("started_at", { ascending: false })
        .limit(EXPORT_ROW_LIMITS.focusSessions),
    ]);

  if (
    resultsResult.error ||
    reflectionsResult.error ||
    preferencesResult.error ||
    focusResult.error
  ) {
    console.error(
      "buildMyExport children failed:",
      resultsResult.error?.message ??
        reflectionsResult.error?.message ??
        preferencesResult.error?.message ??
        focusResult.error?.message,
    );
    throw new DataError(LOAD_ERROR);
  }

  const now = Date.now();
  const focusSessions = (
    (focusResult.data ?? []) as {
      goal_id: string;
      task_id: string;
      status: FocusSessionStatus;
      started_at: string;
      finished_at: string | null;
      accumulated_seconds: number;
      segment_started_at: string | null;
    }[]
  ).map((session) => {
    const runningSeconds =
      session.segment_started_at === null
        ? 0
        : Math.max(
            0,
            Math.floor((now - new Date(session.segment_started_at).getTime()) / 1000),
          );
    const seconds = Math.min(28_800, session.accumulated_seconds + runningSeconds);

    return {
      goal_id: session.goal_id,
      task_id: session.task_id,
      status: session.status,
      started_at: session.started_at,
      finished_at: session.finished_at,
      seconds,
    };
  });

  const preferences = preferencesResult.data as ExportPreferences | null;

  return buildExportBundle({
    goals: goalRows,
    tasks: taskRows,
    results: (resultsResult.data ?? []) as {
      task_id: string;
      content: string;
      updated_at: string;
    }[],
    reflections: (reflectionsResult.data ?? []) as ExportReflection[],
    preferences,
    focusSessions,
  });
}

/** The small state an import needs in order to plan without overwriting. */
export async function getImportExistingState(session: Session): Promise<{
  goalTitles: string[];
  reflectionWeeks: string[];
  hasPreferences: boolean;
}> {
  const [goalsResult, reflectionsResult, preferencesResult] = await Promise.all([
    session.supabase
      .from("goals")
      .select("title")
      .eq("user_id", session.user.id)
      .limit(EXPORT_ROW_LIMITS.goals),
    session.supabase
      .from("weekly_checkins")
      .select("week_start")
      .eq("user_id", session.user.id)
      .limit(EXPORT_ROW_LIMITS.reflections),
    session.supabase
      .from("user_preferences")
      .select("user_id")
      .eq("user_id", session.user.id)
      .maybeSingle(),
  ]);

  if (goalsResult.error || reflectionsResult.error || preferencesResult.error) {
    console.error(
      "getImportExistingState failed:",
      goalsResult.error?.message ??
        reflectionsResult.error?.message ??
        preferencesResult.error?.message,
    );
    throw new DataError(LOAD_ERROR);
  }

  return {
    goalTitles: ((goalsResult.data ?? []) as { title: string }[]).map((row) => row.title),
    reflectionWeeks: ((reflectionsResult.data ?? []) as { week_start: string }[]).map(
      (row) => row.week_start,
    ),
    hasPreferences: preferencesResult.data !== null,
  };
}
