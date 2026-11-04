import type { Session } from "@/lib/auth";
import type {
  ComposioAction,
  ComposioConnection,
  ComposioGrant,
  ComposioTool,
} from "@/lib/composio/contracts";
import { DataError } from "@/lib/data/goals";

/**
 * Owner-scoped Composio reads. RLS and the explicit user filter both apply.
 * No provider call happens here, so opening the page cannot spend tool credits.
 */

const LOAD_ERROR = "We couldn't load the connections just now. Refresh the page to try again.";

export type ComposioTaskOption = {
  id: string;
  role: string;
  position: number;
  status: string;
  objective: string;
};

export type ComposioUsage = {
  calls: number;
  writes: number;
  calls_limit: number;
  writes_limit: number;
};

export type ComposioPageData = {
  project: { id: string; name: string };
  connections: ComposioConnection[];
  tools: ComposioTool[];
  grants: ComposioGrant[];
  actions: ComposioAction[];
  tasks: ComposioTaskOption[];
  usage: ComposioUsage;
};

export async function getComposioPage(
  session: Session,
  projectId: string,
): Promise<ComposioPageData | null> {
  const { data: project, error: projectError } = await session.supabase
    .from("app_projects")
    .select("id, name")
    .eq("id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (projectError) {
    console.error("getComposioPage project failed:", projectError.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!project) return null;

  const [connections, tools, grants, tasks, actions, usage] = await Promise.all([
    session.supabase
      .from("app_composio_connections")
      .select("id, project_id, toolkit, account_label, status, last_verified_at, created_at")
      .eq("project_id", projectId)
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false }),
    session.supabase
      .from("app_composio_tools")
      .select("id, connection_id, toolkit, tool_slug, name, description")
      .eq("project_id", projectId)
      .eq("user_id", session.user.id)
      .order("name", { ascending: true }),
    session.supabase
      .from("app_composio_tool_grants")
      .select("id, connection_id, tool_slug, role, enabled")
      .eq("project_id", projectId)
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: true }),
    session.supabase
      .from("app_team_tasks")
      .select("id, role, position, status, objective")
      .eq("project_id", projectId)
      .eq("user_id", session.user.id)
      .order("position", { ascending: true })
      .limit(24),
    session.supabase.rpc("composio_list_actions", { p_project_id: projectId }),
    session.supabase.rpc("composio_usage", { p_project_id: projectId }),
  ]);

  for (const result of [connections, tools, grants, tasks]) {
    if (result.error) {
      console.error("getComposioPage read failed:", result.error.message);
      throw new DataError(LOAD_ERROR);
    }
  }

  const actionRows =
    actions.error || !actions.data || (actions.data as { ok?: boolean }).ok !== true
      ? []
      : ((actions.data as { actions?: ComposioAction[] }).actions ?? []);

  const usageRow =
    usage.error || !usage.data || (usage.data as { ok?: boolean }).ok !== true
      ? { calls: 0, writes: 0, calls_limit: 100, writes_limit: 25 }
      : (usage.data as ComposioUsage);

  return {
    project,
    connections: (connections.data ?? []) as unknown as ComposioConnection[],
    tools: (tools.data ?? []) as unknown as ComposioTool[],
    grants: (grants.data ?? []) as unknown as ComposioGrant[],
    actions: actionRows,
    tasks: (tasks.data ?? []) as unknown as ComposioTaskOption[],
    usage: usageRow,
  };
}
