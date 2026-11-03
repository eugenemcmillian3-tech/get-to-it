import type { Session } from "@/lib/auth";
import { DataError } from "@/lib/data/goals";
import { preferencesFromRow } from "@/lib/preferences";
import type {
  DailyPlan,
  DailyPlanCandidate,
  Goal,
  Task,
  UserPreferences,
} from "@/lib/types";

const LOAD_ERROR =
  "We couldn't load your preferences just now. Refresh the page to try again.";

/**
 * The saved preferences, or every field empty when nothing was saved yet.
 * Reading never creates a row and never guesses a value.
 */
export async function getPreferences(
  session: Session,
): Promise<UserPreferences> {
  const { data, error } = await session.supabase
    .from("user_preferences")
    .select(
      "user_id, session_length_minutes, work_days, work_start, work_end, task_size, communication_style, help_topics, personalization_enabled, updated_at",
    )
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error) {
    console.error("getPreferences failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }

  return preferencesFromRow(
    (data as Partial<UserPreferences> | null) ?? null,
    session.user.id,
  );
}

/**
 * Open tasks from active goals, with their goal title, for the daily plan.
 * Only the person's own rows are requested, and completed tasks are excluded.
 */
export async function getDailyPlanCandidates(
  session: Session,
): Promise<DailyPlanCandidate[]> {
  const { data: goals, error: goalsError } = await session.supabase
    .from("goals")
    .select("id, title")
    .eq("user_id", session.user.id)
    .is("archived_at", null);

  if (goalsError) {
    console.error("getDailyPlanCandidates goals failed:", goalsError.message);
    throw new DataError(LOAD_ERROR);
  }

  const goalRows = (goals ?? []) as Pick<Goal, "id" | "title">[];
  if (goalRows.length === 0) return [];

  const { data: tasks, error: tasksError } = await session.supabase
    .from("tasks")
    .select("id, title, status, estimated_minutes, goal_id")
    .eq("user_id", session.user.id)
    .in(
      "goal_id",
      goalRows.map((goal) => goal.id),
    )
    .neq("status", "completed")
    .order("created_at", { ascending: true });

  if (tasksError) {
    console.error("getDailyPlanCandidates tasks failed:", tasksError.message);
    throw new DataError(LOAD_ERROR);
  }

  const titleById = new Map(goalRows.map((goal) => [goal.id, goal.title]));

  return ((tasks ?? []) as Pick<
    Task,
    "id" | "title" | "status" | "estimated_minutes" | "goal_id"
  >[]).map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    estimated_minutes: task.estimated_minutes,
    goal_id: task.goal_id,
    goal_title: titleById.get(task.goal_id) ?? "Goal",
  }));
}

/** One approved plan for a day, or null. */
export async function getDailyPlan(
  session: Session,
  day: string,
): Promise<DailyPlan | null> {
  const { data, error } = await session.supabase
    .from("daily_plans")
    .select(
      "id, day, minutes_available, task_ids, total_minutes, unknown_estimates, over_limit, created_at, updated_at",
    )
    .eq("user_id", session.user.id)
    .eq("day", day)
    .maybeSingle();

  if (error) {
    console.error("getDailyPlan failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }

  return (data as DailyPlan | null) ?? null;
}
