import type { Session } from "@/lib/auth";
import { DataError } from "@/lib/data/goals";
import type {
  CapabilityEvalRecord,
  CapabilityHumanBaselineRecord,
  CapabilityRunRecord,
  CapabilityTaskRecord,
  CapabilityVersionRecord,
} from "@/lib/capability-eval";

/**
 * Phase 38 capability evaluation reads. Every query is owner-scoped here and by
 * RLS. Answer keys are never selected: the table has no client policy at all.
 */

const LOAD_ERROR =
  "We couldn't load the capability evaluation just now. Refresh the page to try again.";

export type CapabilityEvalSummary = CapabilityEvalRecord & {
  task_count: number;
  run_count: number;
  held_out_runs: number;
  contaminated_runs: number;
};

export type CapabilityEvalDetail = {
  evaluation: CapabilityEvalRecord;
  versions: CapabilityVersionRecord[];
  tasks: CapabilityTaskRecord[];
  runs: CapabilityRunRecord[];
  humanBaselines: CapabilityHumanBaselineRecord[];
  linkedExperimentName: string | null;
};

export async function listCapabilityEvals(
  session: Session,
): Promise<CapabilityEvalSummary[]> {
  const { data: evaluations, error } = await session.supabase
    .from("capability_evals")
    .select("*")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("listCapabilityEvals failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }
  const rows = (evaluations ?? []) as CapabilityEvalRecord[];
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const [tasks, runs] = await Promise.all([
    session.supabase
      .from("capability_eval_tasks")
      .select("id, eval_id")
      .eq("user_id", session.user.id)
      .in("eval_id", ids),
    session.supabase
      .from("capability_eval_runs")
      .select("eval_id, split, contaminated")
      .eq("user_id", session.user.id)
      .in("eval_id", ids),
  ]);

  for (const result of [tasks, runs]) {
    if (result.error) {
      console.error("listCapabilityEvals child failed:", result.error.message);
      throw new DataError(LOAD_ERROR);
    }
  }

  const runRows = (runs.data ?? []) as { eval_id: string; split: string; contaminated: boolean }[];
  return rows.map((evaluation) => {
    const evaluationRuns = runRows.filter((run) => run.eval_id === evaluation.id);
    return {
      ...evaluation,
      task_count: (tasks.data ?? []).filter((task) => task.eval_id === evaluation.id).length,
      run_count: evaluationRuns.length,
      held_out_runs: evaluationRuns.filter((run) => run.split === "held_out").length,
      contaminated_runs: evaluationRuns.filter((run) => run.contaminated).length,
    };
  });
}

export async function getCapabilityEvalDetail(
  session: Session,
  evalId: string,
): Promise<CapabilityEvalDetail | null> {
  const { data: evaluation, error } = await session.supabase
    .from("capability_evals")
    .select("*")
    .eq("id", evalId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error) {
    console.error("getCapabilityEvalDetail evaluation failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!evaluation) return null;

  const [versions, tasks, runs, humanBaselines] = await Promise.all([
    session.supabase
      .from("capability_eval_versions")
      .select("*")
      .eq("eval_id", evalId)
      .eq("user_id", session.user.id)
      .order("version", { ascending: true }),
    session.supabase
      .from("capability_eval_tasks")
      .select("*")
      .eq("eval_id", evalId)
      .eq("user_id", session.user.id)
      .order("domain", { ascending: true })
      .order("difficulty", { ascending: true }),
    session.supabase
      .from("capability_eval_runs")
      .select("*")
      .eq("eval_id", evalId)
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: true })
      .limit(1_000),
    session.supabase
      .from("capability_eval_human_baselines")
      .select("*")
      .eq("eval_id", evalId)
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: true }),
  ]);

  for (const result of [versions, tasks, runs, humanBaselines]) {
    if (result.error) {
      console.error("getCapabilityEvalDetail child failed:", result.error.message);
      throw new DataError(LOAD_ERROR);
    }
  }

  let linkedExperimentName: string | null = null;
  const record = evaluation as CapabilityEvalRecord;
  if (record.linked_experiment_id) {
    const { data: experiment } = await session.supabase
      .from("experiments")
      .select("id, question")
      .eq("id", record.linked_experiment_id)
      .eq("user_id", session.user.id)
      .maybeSingle();
    linkedExperimentName = (experiment as { question?: string } | null)?.question ?? null;
  }

  return {
    evaluation: record,
    versions: (versions.data ?? []) as CapabilityVersionRecord[],
    tasks: (tasks.data ?? []) as CapabilityTaskRecord[],
    runs: (runs.data ?? []) as CapabilityRunRecord[],
    humanBaselines: (humanBaselines.data ?? []) as CapabilityHumanBaselineRecord[],
    linkedExperimentName,
  };
}
