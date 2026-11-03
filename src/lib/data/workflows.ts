import type { Session } from "@/lib/auth";
import { DataError } from "@/lib/data/goals";
import { listPersonalTemplates } from "@/lib/data/templates";
import type {
  ActionApproval,
  ActionRecord,
  PersonalTemplate,
  Task,
  TaskResult,
  Workflow,
  WorkflowRun,
  WorkflowRunStep,
  WorkflowVersion,
} from "@/lib/types";

/**
 * Workflow reads.
 *
 * Every query is owner-scoped by Row Level Security. A run keeps its own copy of
 * the workflow name, version and steps, so a deleted or edited workflow never
 * changes what an existing run shows.
 */

const LOAD_ERROR =
  "We couldn't load that workflow just now. Refresh the page to try again.";

export async function listWorkflows(session: Session): Promise<Workflow[]> {
  const { data, error } = await session.supabase
    .from("workflows")
    .select("*")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("listWorkflows failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }

  return (data ?? []) as Workflow[];
}

export type WorkflowDetail = {
  workflow: Workflow;
  versions: Pick<WorkflowVersion, "version" | "created_at" | "name" | "steps">[];
  runs: WorkflowRun[];
  templates: PersonalTemplate[];
};

export async function getWorkflowDetail(
  session: Session,
  workflowId: string,
): Promise<WorkflowDetail | null> {
  const { data: workflow, error } = await session.supabase
    .from("workflows")
    .select("*")
    .eq("id", workflowId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error) {
    console.error("getWorkflowDetail failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!workflow) return null;

  const [versionsResult, runsResult, templates] = await Promise.all([
    session.supabase
      .from("workflow_versions")
      .select("version, created_at, name, steps")
      .eq("workflow_id", workflowId)
      .order("version", { ascending: false }),
    session.supabase
      .from("workflow_runs")
      .select("*")
      .eq("workflow_id", workflowId)
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(10),
    listPersonalTemplates(session),
  ]);

  if (versionsResult.error || runsResult.error) {
    console.error(
      "getWorkflowDetail children failed:",
      versionsResult.error?.message ?? runsResult.error?.message,
    );
    throw new DataError(LOAD_ERROR);
  }

  return {
    workflow: workflow as Workflow,
    versions: (versionsResult.data ?? []) as Pick<
      WorkflowVersion,
      "version" | "created_at" | "name" | "steps"
    >[],
    runs: (runsResult.data ?? []) as WorkflowRun[],
    templates,
  };
}

export type RunWork = {
  goalTitle: string | null;
  completed: { id: string; title: string; content: string }[];
  selected: { id: string; title: string; content: string }[];
};

export type WorkflowRunDetail = {
  run: WorkflowRun;
  steps: WorkflowRunStep[];
  actions: ActionRecord[];
  approvals: ActionApproval[];
  work: RunWork;
  /** True when the workflow still exists and has a newer version than this run. */
  workflowMissing: boolean;
  latestVersion: number | null;
};

export async function getWorkflowRun(
  session: Session,
  runId: string,
): Promise<WorkflowRunDetail | null> {
  const { data: run, error } = await session.supabase
    .from("workflow_runs")
    .select("*")
    .eq("id", runId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error) {
    console.error("getWorkflowRun failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!run) return null;

  const runRow = run as WorkflowRun;

  const [stepsResult, actionsResult] = await Promise.all([
    session.supabase
      .from("workflow_run_steps")
      .select("*")
      .eq("run_id", runId)
      .order("position", { ascending: true }),
    session.supabase
      .from("action_records")
      .select("*")
      .eq("run_id", runId)
      .order("created_at", { ascending: true }),
  ]);

  if (stepsResult.error || actionsResult.error) {
    console.error(
      "getWorkflowRun children failed:",
      stepsResult.error?.message ?? actionsResult.error?.message,
    );
    throw new DataError(LOAD_ERROR);
  }

  const steps = (stepsResult.data ?? []) as WorkflowRunStep[];
  const actions = (actionsResult.data ?? []) as ActionRecord[];
  const actionIds = actions.map((action) => action.id);

  const approvalsResult = actionIds.length
    ? await session.supabase
        .from("action_approvals")
        .select("*")
        .in("action_id", actionIds)
    : { data: [] as ActionApproval[], error: null };

  if (approvalsResult.error) {
    console.error("getWorkflowRun approvals failed:", approvalsResult.error.message);
    throw new DataError(LOAD_ERROR);
  }

  let goalTitle: string | null = null;
  let completed: { id: string; title: string; content: string }[] = [];
  let latestVersion: number | null = null;

  if (runRow.goal_id) {
    const [goalResult, tasksResult] = await Promise.all([
      session.supabase
        .from("goals")
        .select("title")
        .eq("id", runRow.goal_id)
        .eq("user_id", session.user.id)
        .maybeSingle(),
      session.supabase
        .from("tasks")
        .select("id, title, status")
        .eq("goal_id", runRow.goal_id)
        .eq("user_id", session.user.id)
        .eq("status", "completed")
        .order("created_at", { ascending: true })
        .limit(50),
    ]);

    if (goalResult.error || tasksResult.error) {
      console.error(
        "getWorkflowRun work failed:",
        goalResult.error?.message ?? tasksResult.error?.message,
      );
      throw new DataError(LOAD_ERROR);
    }

    goalTitle = (goalResult.data as { title: string } | null)?.title ?? null;
    const tasks = (tasksResult.data ?? []) as Pick<Task, "id" | "title">[];

    const resultsResult = tasks.length
      ? await session.supabase
          .from("task_results")
          .select("task_id, content")
          .in(
            "task_id",
            tasks.map((task) => task.id),
          )
      : { data: [] as Pick<TaskResult, "task_id" | "content">[], error: null };

    if (resultsResult.error) {
      console.error("getWorkflowRun results failed:", resultsResult.error.message);
      throw new DataError(LOAD_ERROR);
    }

    const contents = new Map(
      (resultsResult.data ?? []).map((row) => [
        (row as Pick<TaskResult, "task_id" | "content">).task_id,
        (row as Pick<TaskResult, "task_id" | "content">).content,
      ]),
    );

    completed = tasks.map((task) => ({
      id: task.id,
      title: task.title,
      content: contents.get(task.id) ?? "",
    }));
  }

  if (runRow.workflow_id) {
    const { data: workflow } = await session.supabase
      .from("workflows")
      .select("current_version")
      .eq("id", runRow.workflow_id)
      .eq("user_id", session.user.id)
      .maybeSingle();

    latestVersion = (workflow as { current_version: number } | null)?.current_version ?? null;
  }

  const selectedIds = new Set(
    steps
      .filter((step) => step.kind === "user_input")
      .map((step) => step.output)
      .flatMap((output) => {
        if (typeof output !== "object" || output === null) return [];
        const ids = (output as { selected_task_ids?: unknown }).selected_task_ids;
        return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
      }),
  );

  return {
    run: runRow,
    steps,
    actions,
    approvals: (approvalsResult.data ?? []) as ActionApproval[],
    work: {
      goalTitle,
      completed,
      selected: completed.filter((task) => selectedIds.has(task.id)),
    },
    workflowMissing: runRow.workflow_id === null,
    latestVersion,
  };
}
