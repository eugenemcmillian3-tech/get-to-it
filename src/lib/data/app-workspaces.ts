import type { Session } from "@/lib/auth";
import type { AppWorkspace, AppWorkspaceRun } from "@/lib/types";
import { DataError } from "@/lib/data/goals";

/**
 * Preview workspace reads. Owner-scoped here and by RLS.
 * Runs are read newest first; logs and diffs are already bounded in the database.
 */

const LOAD_ERROR =
  "We couldn't load the preview workspace just now. Refresh the page to try again.";

export type AppWorkspaceDetail = {
  workspace: AppWorkspace | null;
  runs: AppWorkspaceRun[];
};

export async function getAppWorkspace(
  session: Session,
  projectId: string,
): Promise<AppWorkspaceDetail> {
  const { data: workspace, error } = await session.supabase
    .from("app_workspaces")
    .select("*")
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error) {
    console.error("getAppWorkspace failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!workspace) return { workspace: null, runs: [] };

  const { data: runs, error: runsError } = await session.supabase
    .from("app_workspace_runs")
    .select("*")
    .eq("workspace_id", (workspace as AppWorkspace).id)
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false })
    .limit(12);

  if (runsError) {
    console.error("getAppWorkspace runs failed:", runsError.message);
    throw new DataError(LOAD_ERROR);
  }

  return {
    workspace: workspace as AppWorkspace,
    runs: (runs ?? []) as AppWorkspaceRun[],
  };
}
