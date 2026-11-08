import type { Session } from "@/lib/auth";
import { summariseModelHealth } from "@/lib/agent-team";
import {
  MODEL_HEALTH_SAMPLE_SIZE,
  type TeamEventRecord,
  type TeamIntegrationRecord,
  type TeamModelHealth,
  type TeamModelSample,
  type TeamRunRecord,
  type TeamTaskRecord,
} from "@/lib/agent-team";
import { DataError } from "@/lib/data/goals";

/**
 * Agent-team reads. Every query is owner-scoped here and by RLS.
 * Task outputs and integration logs are bounded in the database.
 */

const LOAD_ERROR =
  "We couldn't load the agent team just now. Refresh the page to try again.";

export type AppTeamDetail = {
  project: { id: string; name: string; current_version: number };
  run: TeamRunRecord | null;
  tasks: TeamTaskRecord[];
  integration: TeamIntegrationRecord | null;
  events: TeamEventRecord[];
  /** Retry and failure counts per role and model, measured across this project. */
  modelHealth: TeamModelHealth[];
};

export async function getAppTeam(
  session: Session,
  projectId: string,
): Promise<AppTeamDetail | null> {
  const { data: project, error: projectError } = await session.supabase
    .from("app_projects")
    .select("id, name, current_version")
    .eq("id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (projectError) {
    console.error("getAppTeam project failed:", projectError.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!project) return null;

  const { data: run, error: runError } = await session.supabase
    .from("app_team_runs")
    .select("*")
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (runError) {
    console.error("getAppTeam run failed:", runError.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!run) {
    return { project, run: null, tasks: [], integration: null, events: [], modelHealth: [] };
  }

  // Model health is account-wide, not per project: the six models are shared,
  // and a project holds at most one run of about seven tasks, so a per-project
  // rate could never fill the sample floor. Only finished model tasks count,
  // because a fixture run never calls a model.
  const healthQuery = session.supabase
    .from("app_team_tasks")
    .select("role, model, status, retries, retry_reason")
    .eq("user_id", session.user.id)
    .not("model", "is", null)
    .in("status", ["completed", "awaiting_review", "failed"])
    .order("finished_at", { ascending: false })
    .limit(MODEL_HEALTH_SAMPLE_SIZE);

  const [tasks, integration, events, health] = await Promise.all([
    session.supabase
      .from("app_team_tasks")
      .select("*")
      .eq("run_id", run.id)
      .eq("user_id", session.user.id)
      .order("position", { ascending: true }),
    session.supabase
      .from("app_team_integrations")
      .select("*")
      .eq("run_id", run.id)
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    session.supabase
      .from("app_team_events")
      .select("*")
      .eq("run_id", run.id)
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(30),
    healthQuery,
  ]);

  for (const result of [tasks, integration, events, health]) {
    if (result.error) {
      console.error("getAppTeam child failed:", result.error.message);
      throw new DataError(LOAD_ERROR);
    }
  }

  return {
    project,
    run: run as TeamRunRecord,
    tasks: (tasks.data ?? []) as TeamTaskRecord[],
    integration: (integration.data as TeamIntegrationRecord | null) ?? null,
    events: (events.data ?? []) as TeamEventRecord[],
    modelHealth: summariseModelHealth((health.data ?? []) as TeamModelSample[]),
  };
}
