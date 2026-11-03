import type { TaskStatus } from "@/lib/types";
import type { Goal, Profile, Task, TaskResult } from "@/lib/types";
import type { Session } from "@/lib/auth";
import {
  GOAL_LIST_PAGE_SIZE,
  pageBounds,
  sanitizeSearchTerm,
  type GoalListFilters,
} from "@/lib/templates/helpers";

export class DataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataError";
  }
}

const LOAD_ERROR =
  "We couldn't load your data just now. Refresh the page to try again.";

export async function getProfile(
  session: Session,
): Promise<Profile | null> {
  const { data, error } = await session.supabase
    .from("profiles")
    .select("id, display_name, created_at")
    .eq("id", session.user.id)
    .maybeSingle();

  if (error) throw new DataError(LOAD_ERROR);
  return (data as Profile | null) ?? null;
}

export async function listGoals(session: Session): Promise<Goal[]> {
  const { data, error } = await session.supabase
    .from("goals")
    .select("*")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false });

  if (error) throw new DataError(LOAD_ERROR);
  return (data ?? []) as Goal[];
}

export type GoalPage = {
  goals: Goal[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
};

/**
 * One bounded page of goals, filtered server-side.
 *
 * Searching, the state filter (active, archived or both) and the category
 * filter all happen in the query, so a long list never loads whole. The total
 * is counted first so the page number can be clamped honestly.
 */
export async function listGoalsPage(
  session: Session,
  filters: GoalListFilters,
): Promise<GoalPage> {
  const userId = session.user.id;
  const term = sanitizeSearchTerm(filters.q);

  const buildFiltered = () => {
    let query = session.supabase
      .from("goals")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    if (filters.state === "active") query = query.is("archived_at", null);
    if (filters.state === "archived") query = query.not("archived_at", "is", null);
    if (filters.category !== "all") query = query.eq("category", filters.category);
    if (term) {
      query = query.or(
        `title.ilike.%${term}%,desired_outcome.ilike.%${term}%`,
      );
    }

    return query;
  };

  const countResult = await buildFiltered();
  if (countResult.error) {
    console.error("listGoalsPage count failed:", countResult.error.message);
    throw new DataError(LOAD_ERROR);
  }
  // A head request with an exact count: no rows travel for the total.
  const total = countResult.count ?? 0;

  const bounds = pageBounds(filters.page, GOAL_LIST_PAGE_SIZE, total);

  let pageQuery = session.supabase.from("goals").select("*").eq("user_id", userId);
  if (filters.state === "active") pageQuery = pageQuery.is("archived_at", null);
  if (filters.state === "archived") {
    pageQuery = pageQuery.not("archived_at", "is", null);
  }
  if (filters.category !== "all") {
    pageQuery = pageQuery.eq("category", filters.category);
  }
  if (term) {
    pageQuery = pageQuery.or(
      `title.ilike.%${term}%,desired_outcome.ilike.%${term}%`,
    );
  }

  const { data, error } = await pageQuery
    .order("created_at", { ascending: false })
    .range(bounds.from, bounds.to);

  if (error) {
    console.error("listGoalsPage failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }

  return {
    goals: (data ?? []) as Goal[],
    total,
    page: bounds.page,
    pageCount: bounds.pageCount,
    pageSize: GOAL_LIST_PAGE_SIZE,
  };
}

export async function listTaskStatuses(
  session: Session,
): Promise<{ goal_id: string; status: TaskStatus }[]> {
  const { data, error } = await session.supabase
    .from("tasks")
    .select("goal_id, status")
    .eq("user_id", session.user.id);

  if (error) throw new DataError(LOAD_ERROR);
  return (data ?? []) as { goal_id: string; status: TaskStatus }[];
}

export async function getGoalDetail(
  session: Session,
  goalId: string,
): Promise<{ goal: Goal; tasks: Task[] } | null> {
  const { data: goal, error: goalError } = await session.supabase
    .from("goals")
    .select("*")
    .eq("id", goalId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (goalError) throw new DataError(LOAD_ERROR);
  if (!goal) return null;

  const { data: tasks, error: tasksError } = await session.supabase
    .from("tasks")
    .select("*")
    .eq("goal_id", goalId)
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: true });

  if (tasksError) throw new DataError(LOAD_ERROR);

  return { goal: goal as Goal, tasks: (tasks ?? []) as Task[] };
}

export async function getTaskWorkspace(
  session: Session,
  goalId: string,
  taskId: string,
): Promise<{ goal: Goal; task: Task; result: TaskResult | null } | null> {
  const { data: task, error: taskError } = await session.supabase
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .eq("goal_id", goalId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (taskError) throw new DataError(LOAD_ERROR);
  if (!task) return null;

  const { data: goal, error: goalError } = await session.supabase
    .from("goals")
    .select("*")
    .eq("id", goalId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (goalError) throw new DataError(LOAD_ERROR);
  if (!goal) return null;

  const { data: result, error: resultError } = await session.supabase
    .from("task_results")
    .select("*")
    .eq("task_id", taskId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (resultError) throw new DataError(LOAD_ERROR);

  return {
    goal: goal as Goal,
    task: task as Task,
    result: (result as TaskResult | null) ?? null,
  };
}
