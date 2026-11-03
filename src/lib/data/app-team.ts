import type { Session } from "@/lib/auth";
import type {
  TeamEventRecord,
  TeamIntegrationRecord,
  TeamRunRecord,
  TeamTaskRecord,
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
    return { project, run: null, tasks: [], integration: null, events: [] };
  }

  const [tasks, integration, events] = await Promise.all([
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
  ]);

  for (const result of [tasks, integration, events]) {
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
  };
}
