import type { Session } from "@/lib/auth";
import { DataError } from "@/lib/data/goals";
import type {
  EvaluationBudgetRecord,
  EvaluationCapabilityProfileRecord,
  EvaluationConfigurationRecord,
  EvaluationRecommendationRecord,
  EvaluationRunRecord,
  EvaluationTaskRecord,
  EvaluationWorkspaceRecord,
} from "@/lib/evaluations";

/**
 * Phase 32 evaluation reads. Every query is owner-scoped here and by RLS.
 * Lists are bounded; details load only one workspace.
 */

const LOAD_ERROR =
  "We couldn't load the evaluation workspace just now. Refresh the page to try again.";

export type EvaluationWorkspaceSummary = EvaluationWorkspaceRecord & {
  budget: EvaluationBudgetRecord | null;
  task_count: number;
  run_count: number;
  failed_run_count: number;
};

export type EvaluationDetail = {
  workspace: EvaluationWorkspaceRecord;
  sourceProjectName: string | null;
  tasks: EvaluationTaskRecord[];
  configurations: EvaluationConfigurationRecord[];
  budget: EvaluationBudgetRecord | null;
  runs: EvaluationRunRecord[];
  profiles: EvaluationCapabilityProfileRecord[];
  recommendations: EvaluationRecommendationRecord[];
};

export async function listEvaluationWorkspaces(
  session: Session,
): Promise<EvaluationWorkspaceSummary[]> {
  const { data: workspaces, error } = await session.supabase
    .from("app_eval_workspaces")
    .select("*")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("listEvaluationWorkspaces failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }
  const rows = (workspaces ?? []) as EvaluationWorkspaceRecord[];
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const [budgets, tasks, runs] = await Promise.all([
    session.supabase
      .from("app_eval_budgets")
      .select("*")
      .eq("user_id", session.user.id)
      .in("workspace_id", ids),
    session.supabase
      .from("app_eval_tasks")
      .select("id, workspace_id")
      .eq("user_id", session.user.id)
      .in("workspace_id", ids),
    session.supabase
      .from("app_eval_runs")
      .select("id, workspace_id, status")
      .eq("user_id", session.user.id)
      .in("workspace_id", ids),
  ]);

  for (const result of [budgets, tasks, runs]) {
    if (result.error) {
      console.error("listEvaluationWorkspaces child failed:", result.error.message);
      throw new DataError(LOAD_ERROR);
    }
  }

  const budgetByWorkspace = new Map(
    ((budgets.data ?? []) as EvaluationBudgetRecord[]).map((budget) => [
      budget.workspace_id,
      budget,
    ]),
  );
  const runRows = (runs.data ?? []) as { workspace_id: string; status: string }[];

  return rows.map((workspace) => {
    const workspaceRuns = runRows.filter((run) => run.workspace_id === workspace.id);
    return {
      ...workspace,
      budget: budgetByWorkspace.get(workspace.id) ?? null,
      task_count: (tasks.data ?? []).filter((task) => task.workspace_id === workspace.id).length,
      run_count: workspaceRuns.length,
      failed_run_count: workspaceRuns.filter((run) => run.status !== "passed").length,
    };
  });
}

export async function getEvaluationDetail(
  session: Session,
  workspaceId: string,
): Promise<EvaluationDetail | null> {
  const { data: workspace, error } = await session.supabase
    .from("app_eval_workspaces")
    .select("*")
    .eq("id", workspaceId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error) {
    console.error("getEvaluationDetail workspace failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!workspace) return null;

  const [tasks, configurations, budgets, runs, profiles, recommendations] =
    await Promise.all([
      session.supabase
        .from("app_eval_tasks")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("user_id", session.user.id)
        .order("split", { ascending: true })
        .order("created_at", { ascending: true }),
      session.supabase
        .from("app_eval_configurations")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("user_id", session.user.id)
        .order("version", { ascending: false }),
      session.supabase
        .from("app_eval_budgets")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("user_id", session.user.id)
        .maybeSingle(),
      session.supabase
        .from("app_eval_runs")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: true })
        .limit(500),
      session.supabase
        .from("app_eval_capability_profiles")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("user_id", session.user.id)
        .order("profile_key", { ascending: true })
        .order("version", { ascending: false }),
      session.supabase
        .from("app_eval_recommendations")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

  for (const result of [tasks, configurations, budgets, runs, profiles, recommendations]) {
    if (result.error) {
      console.error("getEvaluationDetail child failed:", result.error.message);
      throw new DataError(LOAD_ERROR);
    }
  }

  const sourceProjectId = (workspace as EvaluationWorkspaceRecord).source_project_id;
  let sourceProjectName: string | null = null;
  if (sourceProjectId) {
    const { data: project, error: projectError } = await session.supabase
      .from("app_projects")
      .select("name")
      .eq("id", sourceProjectId)
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (projectError) {
      console.error("getEvaluationDetail source project failed:", projectError.message);
      throw new DataError(LOAD_ERROR);
    }
    sourceProjectName = project?.name ?? null;
  }

  return {
    workspace: workspace as EvaluationWorkspaceRecord,
    sourceProjectName,
    tasks: (tasks.data ?? []) as EvaluationTaskRecord[],
    configurations: (configurations.data ?? []) as EvaluationConfigurationRecord[],
    budget: (budgets.data as EvaluationBudgetRecord | null) ?? null,
    runs: (runs.data ?? []) as EvaluationRunRecord[],
    profiles: (profiles.data ?? []) as EvaluationCapabilityProfileRecord[],
    recommendations: (recommendations.data ?? []) as EvaluationRecommendationRecord[],
  };
}
