import type { Session } from "@/lib/auth";
import { DataError } from "@/lib/data/goals";
import type {
  FutureActionLink,
  FuturePath,
  FutureScenario,
} from "@/lib/types";

/**
 * Future Path reads.
 *
 * Every query is owner-scoped by Row Level Security and by an explicit
 * `user_id` filter. A path never reads another person's goal, tasks, learning
 * records or AI conversations; the optional goal link is checked on write.
 */

const LOAD_ERROR =
  "We couldn't load that future path just now. Refresh the page to try again.";

export async function listFuturePaths(session: Session): Promise<FuturePath[]> {
  const { data, error } = await session.supabase
    .from("future_paths")
    .select("*")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("listFuturePaths failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }

  return (data ?? []) as FuturePath[];
}

export type FuturePathDetail = {
  path: FuturePath;
  scenarios: FutureScenario[];
  actions: FutureActionLink[];
};

export async function getFuturePathDetail(
  session: Session,
  pathId: string,
): Promise<FuturePathDetail | null> {
  const { data: path, error } = await session.supabase
    .from("future_paths")
    .select("*")
    .eq("id", pathId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error) {
    console.error("getFuturePathDetail failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!path) return null;

  const [scenariosResult, actionsResult] = await Promise.all([
    session.supabase
      .from("future_scenarios")
      .select("*")
      .eq("path_id", pathId)
      .eq("user_id", session.user.id),
    session.supabase
      .from("future_actions")
      .select("*")
      .eq("path_id", pathId)
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: true }),
  ]);

  if (scenariosResult.error || actionsResult.error) {
    console.error(
      "getFuturePathDetail children failed:",
      scenariosResult.error?.message ?? actionsResult.error?.message,
    );
    throw new DataError(LOAD_ERROR);
  }

  return {
    path: path as FuturePath,
    scenarios: (scenariosResult.data ?? []) as FutureScenario[],
    actions: (actionsResult.data ?? []) as FutureActionLink[],
  };
}
