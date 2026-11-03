import type { Session } from "@/lib/auth";
import { DataError } from "@/lib/data/goals";
import type { RadarSignal, RadarTopic } from "@/lib/types";

/**
 * Radar reads.
 *
 * Every query is owner-scoped by RLS and by an explicit `user_id` filter. A
 * signal never joins to another person's goal, task or workspace.
 */

const LOAD_ERROR =
  "We couldn't load the radar just now. Refresh the page to try again.";

const SIGNAL_LIMIT = 100;

export async function listRadarTopics(session: Session): Promise<RadarTopic[]> {
  const { data, error } = await session.supabase
    .from("radar_topics")
    .select("*")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("listRadarTopics failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }

  return (data ?? []) as RadarTopic[];
}

export async function listRadarSignals(
  session: Session,
  options: { dismissed?: boolean } = {},
): Promise<RadarSignal[]> {
  const { data, error } = await session.supabase
    .from("radar_signals")
    .select("*")
    .eq("user_id", session.user.id)
    .order("published_on", { ascending: false })
    .limit(SIGNAL_LIMIT);

  if (error) {
    console.error("listRadarSignals failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }

  const signals = (data ?? []) as RadarSignal[];
  const wantDismissed = options.dismissed === true;

  return signals.filter((signal) =>
    wantDismissed ? signal.dismissed_at !== null : signal.dismissed_at === null,
  );
}

export async function getRadarSignal(
  session: Session,
  signalId: string,
): Promise<RadarSignal | null> {
  const { data, error } = await session.supabase
    .from("radar_signals")
    .select("*")
    .eq("id", signalId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error) {
    console.error("getRadarSignal failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }

  return (data as RadarSignal | null) ?? null;
}
