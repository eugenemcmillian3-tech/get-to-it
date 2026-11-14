import type { Session } from "@/lib/auth";
import { DataError } from "@/lib/data/goals";
import { isUuid } from "@/lib/validation";
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

export type CapabilityReviewRecord = {
  id: string;
  eval_id: string;
  version_id: string;
  workspace_id: string;
  requested_by: string;
  reviewer_id: string;
  status: "requested" | "completed" | "declined";
  findings: string | null;
  limitations: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CapabilityReviewer = {
  user_id: string;
  display_name: string;
};

export type CapabilityReviewStats = {
  runs: number;
  verified: number;
  partial: number;
  failed: number;
  errored: number;
  contaminated: number;
  unsupported_claims: number;
  permission_violations: number;
  human_interventions: number;
  average_cost_cents: number;
  average_latency_ms: number;
};

export type CapabilityReviewBrief = {
  ok: boolean;
  code?: string;
  review?: {
    id: string;
    status: CapabilityReviewRecord["status"];
    findings: string | null;
    limitations: string | null;
    reviewed_at: string | null;
    requested_by: string;
    reviewer_id: string;
  };
  evaluation?: {
    id: string;
    name: string;
    description: string;
    dataset_version: string;
    experiment_question: string;
  };
  version?: {
    id: string;
    label: string;
    number: number;
    baseline_kind: string;
    model_version: string;
    orchestration_version: string;
    prompt_version: string;
    dataset_version: string;
    human_assistance: string;
    autonomy_permission: string;
  };
  totals?: CapabilityReviewStats;
  splits?: { split: string; trials: number; verified: number; contaminated: number }[];
  domains?: {
    domain: string;
    trials: number;
    verified: number;
    contaminated: number;
    failure_category: string | null;
  }[];
};

export type AssignedCapabilityReview = CapabilityReviewRecord & {
  evalName: string;
  versionLabel: string;
};

export type CapabilityReviewDetail = {
  review: CapabilityReviewRecord;
  brief: CapabilityReviewBrief | null;
  isReviewer: boolean;
  isOwner: boolean;
};

export type CapabilityEvalDetail = {
  evaluation: CapabilityEvalRecord;
  versions: CapabilityVersionRecord[];
  tasks: CapabilityTaskRecord[];
  runs: CapabilityRunRecord[];
  humanBaselines: CapabilityHumanBaselineRecord[];
  linkedExperimentName: string | null;
  linkedWorkspaceId: string | null;
  reviewers: CapabilityReviewer[];
  reviews: CapabilityReviewRecord[];
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
  let linkedWorkspaceId: string | null = null;
  let reviewers: CapabilityReviewer[] = [];
  const record = evaluation as CapabilityEvalRecord;
  if (record.linked_experiment_id) {
    const { data: experiment } = await session.supabase
      .from("experiments")
      .select("id, question, workspace_id")
      .eq("id", record.linked_experiment_id)
      .maybeSingle();
    const row = experiment as { question?: string; workspace_id?: string } | null;
    linkedExperimentName = row?.question ?? null;
    linkedWorkspaceId = row?.workspace_id ?? null;
  }

  if (linkedWorkspaceId) {
    const { data: directory } = await session.supabase.rpc("workspace_member_directory", {
      p_workspace_id: linkedWorkspaceId,
    });
    const payload = (directory ?? {}) as {
      ok?: boolean;
      members?: { user_id: string; display_name: string; status: string }[];
    };
    reviewers = (payload.members ?? [])
      .filter((member) => member.status === "active" && member.user_id !== session.user.id)
      .map((member) => ({ user_id: member.user_id, display_name: member.display_name }));
  }

  const { data: reviews, error: reviewsError } = await session.supabase
    .from("capability_eval_reviews")
    .select("*")
    .eq("eval_id", evalId)
    .order("created_at", { ascending: false });
  if (reviewsError) {
    console.error("getCapabilityEvalDetail reviews failed:", reviewsError.message);
    throw new DataError(LOAD_ERROR);
  }

  return {
    evaluation: record,
    versions: (versions.data ?? []) as CapabilityVersionRecord[],
    tasks: (tasks.data ?? []) as CapabilityTaskRecord[],
    runs: (runs.data ?? []) as CapabilityRunRecord[],
    humanBaselines: (humanBaselines.data ?? []) as CapabilityHumanBaselineRecord[],
    linkedExperimentName,
    linkedWorkspaceId,
    reviewers,
    reviews: (reviews ?? []) as CapabilityReviewRecord[],
  };
}

export async function listAssignedCapabilityReviews(
  session: Session,
): Promise<AssignedCapabilityReview[]> {
  const { data, error } = await session.supabase
    .from("capability_eval_reviews")
    .select("*")
    .eq("reviewer_id", session.user.id)
    .eq("status", "requested")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    console.error("listAssignedCapabilityReviews failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }
  const rows = (data ?? []) as CapabilityReviewRecord[];
  return Promise.all(
    rows.map(async (review) => {
      const { data: brief } = await session.supabase.rpc("capability_eval_review_brief", {
        p_review_id: review.id,
      });
      const payload = (brief ?? {}) as CapabilityReviewBrief;
      return {
        ...review,
        evalName: payload.evaluation?.name ?? "Capability evaluation",
        versionLabel: payload.version?.label ?? "Version",
      };
    }),
  );
}

export async function getCapabilityReview(
  session: Session,
  reviewId: string,
): Promise<CapabilityReviewDetail | null> {
  if (!isUuid(reviewId)) return null;
  const { data, error } = await session.supabase
    .from("capability_eval_reviews")
    .select("*")
    .eq("id", reviewId)
    .maybeSingle();
  if (error) {
    console.error("getCapabilityReview failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!data) return null;
  const review = data as CapabilityReviewRecord;
  const { data: brief } = await session.supabase.rpc("capability_eval_review_brief", {
    p_review_id: review.id,
  });
  return {
    review,
    brief: (brief ?? null) as CapabilityReviewBrief | null,
    isReviewer: review.reviewer_id === session.user.id,
    isOwner: review.requested_by === session.user.id,
  };
}
