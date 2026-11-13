import type { Session } from "@/lib/auth";
import { DataError } from "@/lib/data/goals";
import { PERFORMANCE_CLAIMS, type PerformanceClaim } from "@/lib/performance-program";

const LOAD_ERROR =
  "We couldn't load the performance program just now. Refresh the page to try again.";

export type PerformanceProgramSummary = {
  id: string;
  title: string;
  status: "draft" | "registered" | "closed";
  scope: "one_family" | "all_families";
  taskFamily: string;
  familyKeys: string[];
  supportedClaim: PerformanceClaim;
  claimText: string;
  baselineLabel: string;
  candidateLabel: string;
  trials: number;
  tasks: number;
  expectedRows: number;
  trialRows: number;
  baselineRows: number;
  candidateRows: number;
  humanReferences: number;
  disagreements: number;
  registeredAt: string | null;
  createdAt: string;
};

export type PerformanceTrialStat = {
  rows: number;
  tasks: number;
  passes: number;
  partials: number;
  fails: number;
  meanScore: number;
  meanCostCents: number;
  meanCostUnits: number;
  medianDurationMs: number | null;
  maxCostCents: number;
  maxDurationMs: number;
  humanAssisted: number;
};

export type PerformanceProgram = {
  id: string;
  workspaceId: string;
  title: string;
  question: string;
  scope: "one_family" | "all_families";
  familyKeys: string[];
  taskFamily: string;
  status: "draft" | "registered" | "closed";
  inclusionRules: string;
  exclusionRules: string;
  scoringMethod: string;
  baselineLabel: string;
  baselinePolicy: string;
  candidateLabel: string;
  candidatePolicy: string;
  permittedTools: string[];
  timeLimitSeconds: number;
  costLimitCents: number;
  trials: number;
  humanAssistancePolicy: string;
  failureCriteria: string;
  supportedClaim: PerformanceClaim;
  claimText: string;
  minimumEffect: number;
  noninferiorityMargin: number;
  maxDisagreements: number;
  fingerprint: string | null;
  registeredAt: string | null;
  registeredBy: string | null;
  closedAt: string | null;
  createdAt: string;
  distribution: {
    suite: string;
    version: string;
    digest: string;
    taskKeys: string[];
  };
};

export type PerformanceFamilyResult = {
  key: string;
  version: string;
  suiteDigest: string;
  taskKeys: string[];
  tasks: number;
  expectedRows: number;
  baseline: PerformanceTrialStat;
  candidate: PerformanceTrialStat;
  effect: PerformanceReport["effect"];
  claim: {
    supported: boolean;
    verdict: PerformanceReport["claims"]["verdict"];
    complete: boolean;
    reasons: string[];
  };
};

export type PerformanceReport = {
  program: PerformanceProgram;
  family: { key: string; version: string; suiteDigest: string; taskKeys: string[]; description: string };
  families: PerformanceFamilyResult[];
  plan: { tasks: number; trials: number; expectedRows: number };
  baseline: PerformanceTrialStat;
  candidate: PerformanceTrialStat;
  effect: {
    scoreGain: number;
    costReductionPct: number | null;
    latencyReductionPct: number | null;
    withinNoninferiority: boolean;
    assistanceMatched: boolean;
    withinLimits: boolean;
  };
  reviews: { reviewed: number; disagreements: number; maxDisagreements: number };
  humanReferences: { count: number; participants: number };
  claims: {
    registered: PerformanceClaim;
    supported: boolean;
    pooled: boolean;
    verdict: "supported" | "not_supported" | "awaiting_evidence";
    complete: boolean;
    reasons: string[];
    refused: { claim: string; reason: string }[];
  };
};

type SummaryPayload = {
  ok?: boolean;
  code?: string;
  total?: number;
  programs?: Record<string, unknown>[];
};

type ReportPayload = {
  ok?: boolean;
  code?: string;
  program?: Record<string, unknown>;
  family?: {
    key: string;
    version: string;
    suite_digest: string;
    task_keys: string[];
    description: string;
  };
  families?: {
    key: string;
    version: string;
    digest: string;
    task_keys: string[];
    tasks: number;
    expected_rows: number;
    baseline: Record<string, unknown>;
    candidate: Record<string, unknown>;
    effect: {
      score_gain: number;
      cost_reduction_pct: number | null;
      latency_reduction_pct: number | null;
      within_noninferiority: boolean;
      assistance_matched: boolean;
      within_limits: boolean;
    };
    claim: {
      supported: boolean;
      verdict: PerformanceReport["claims"]["verdict"];
      complete: boolean;
      reasons: string[];
    };
  }[];
  plan?: { tasks: number; trials: number; expected_rows: number };
  baseline?: Record<string, unknown>;
  candidate?: Record<string, unknown>;
  effect?: {
    score_gain: number;
    cost_reduction_pct: number | null;
    latency_reduction_pct: number | null;
    within_noninferiority: boolean;
    assistance_matched: boolean;
    within_limits: boolean;
  };
  reviews?: {
    reviewed: number;
    disagreements: number;
    max_disagreements: number;
  };
  human_references?: { count: number; participants: number };
  claims?: {
    registered: PerformanceClaim;
    supported: boolean;
    pooled?: boolean;
    verdict: PerformanceReport["claims"]["verdict"];
    complete: boolean;
    reasons: string[];
    refused: { claim: string; reason: string }[];
  };
};

function claimOf(value: unknown): PerformanceClaim {
  return PERFORMANCE_CLAIMS.includes(value as PerformanceClaim)
    ? (value as PerformanceClaim)
    : "benchmark";
}

function number(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function trialStat(value: Record<string, unknown> | undefined): PerformanceTrialStat {
  const row = value ?? {};
  const median = row.median_duration_ms;
  return {
    rows: number(row.rows),
    tasks: number(row.tasks),
    passes: number(row.passes),
    partials: number(row.partials),
    fails: number(row.fails),
    meanScore: number(row.mean_score),
    meanCostCents: number(row.mean_cost_cents),
    meanCostUnits: number(row.mean_cost_units),
    medianDurationMs: typeof median === "number" ? median : null,
    maxCostCents: number(row.max_cost_cents),
    maxDurationMs: number(row.max_duration_ms),
    humanAssisted: number(row.human_assisted),
  };
}

function effectOf(
  value:
    | {
        score_gain?: number;
        cost_reduction_pct?: number | null;
        latency_reduction_pct?: number | null;
        within_noninferiority?: boolean;
        assistance_matched?: boolean;
        within_limits?: boolean;
      }
    | undefined,
): PerformanceReport["effect"] {
  return {
    scoreGain: number(value?.score_gain),
    costReductionPct:
      typeof value?.cost_reduction_pct === "number" ? value.cost_reduction_pct : null,
    latencyReductionPct:
      typeof value?.latency_reduction_pct === "number" ? value.latency_reduction_pct : null,
    withinNoninferiority: Boolean(value?.within_noninferiority),
    assistanceMatched: Boolean(value?.assistance_matched),
    withinLimits: Boolean(value?.within_limits),
  };
}

function programOf(row: Record<string, unknown>): PerformanceProgram {
  const distribution = (row.distribution ?? {}) as {
    suite?: string;
    version?: string;
    digest?: string;
    task_keys?: string[];
  };
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    title: String(row.title),
    question: String(row.question),
    scope: row.scope === "all_families" ? "all_families" : "one_family",
    familyKeys: (row.family_keys as string[] | null) ?? [String(row.task_family)],
    taskFamily: String(row.task_family),
    status: row.status as PerformanceProgram["status"],
    inclusionRules: String(row.inclusion_rules),
    exclusionRules: String(row.exclusion_rules),
    scoringMethod: String(row.scoring_method),
    baselineLabel: String(row.baseline_label),
    baselinePolicy: String((row.baseline_config as { policy?: string } | null)?.policy ?? "shipped"),
    candidateLabel: String(row.candidate_label),
    candidatePolicy: String((row.candidate_config as { policy?: string } | null)?.policy ?? ""),
    permittedTools: (row.permitted_tools as string[] | null) ?? [],
    timeLimitSeconds: number(row.time_limit_seconds),
    costLimitCents: number(row.cost_limit_cents),
    trials: number(row.trials),
    humanAssistancePolicy: String(row.human_assistance_policy),
    failureCriteria: String(row.failure_criteria),
    supportedClaim: claimOf(row.supported_claim),
    claimText: String(row.claim_text),
    minimumEffect: number(row.minimum_effect),
    noninferiorityMargin: number(row.noninferiority_margin),
    maxDisagreements: number(row.max_disagreements),
    fingerprint: (row.fingerprint as string | null) ?? null,
    registeredAt: (row.registered_at as string | null) ?? null,
    registeredBy: (row.registered_by as string | null) ?? null,
    closedAt: (row.closed_at as string | null) ?? null,
    createdAt: String(row.created_at),
    distribution: {
      suite: String(distribution.suite ?? ""),
      version: String(distribution.version ?? ""),
      digest: String(distribution.digest ?? ""),
      taskKeys: distribution.task_keys ?? [],
    },
  };
}

/**
 * The workspace's registered programs, newest first. Reads only, and only for
 * members: the RPC checks the membership itself.
 */
export async function listPerformancePrograms(
  session: Session,
  workspaceId: string,
): Promise<{ workspaceId: string; programs: PerformanceProgramSummary[] } | null> {
  const { data: workspace, error } = await session.supabase
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) {
    console.error("performance program workspace read failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!workspace) return null;

  const { data, error: readError } = await session.supabase.rpc("workspace_performance_programs", {
    p_workspace_id: workspaceId,
  });
  if (readError) {
    console.error("performance program list read failed:", readError.message);
    throw new DataError(LOAD_ERROR);
  }

  const payload = (data ?? {}) as SummaryPayload;
  if (!payload.ok) {
    if (payload.code === "no-workspace" || payload.code === "unauthenticated") return null;
    console.error("performance program list refused:", payload.code);
    throw new DataError(LOAD_ERROR);
  }

  return {
    workspaceId,
    programs: (payload.programs ?? []).map((row) => ({
      id: String(row.id),
      title: String(row.title),
      status: row.status as PerformanceProgramSummary["status"],
      scope: row.scope === "all_families" ? "all_families" : "one_family",
      taskFamily: String(row.task_family),
      familyKeys: (row.family_keys as string[] | null) ?? [String(row.task_family)],
      supportedClaim: claimOf(row.supported_claim),
      claimText: String(row.claim_text),
      baselineLabel: String(row.baseline_label),
      candidateLabel: String(row.candidate_label),
      trials: number(row.trials),
      tasks: number(row.tasks),
      expectedRows: number(row.expected_rows),
      trialRows: number(row.trial_rows),
      baselineRows: number(row.baseline_rows),
      candidateRows: number(row.candidate_rows),
      humanReferences: number(row.human_references),
      disagreements: number(row.disagreements),
      registeredAt: (row.registered_at as string | null) ?? null,
      createdAt: String(row.created_at),
    })),
  };
}

/**
 * One program and the numbers recorded against it. The claim verdict comes from
 * Postgres, re-derived from the rows, so the page cannot show a supported claim
 * the evidence no longer supports.
 */
export async function readPerformanceReport(
  session: Session,
  programId: string,
): Promise<PerformanceReport | null> {
  const { data, error } = await session.supabase.rpc("workspace_performance_report", {
    p_program_id: programId,
  });
  if (error) {
    console.error("performance report read failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }

  const payload = (data ?? {}) as ReportPayload;
  if (!payload.ok) {
    if (payload.code === "no-workspace" || payload.code === "unauthenticated" || payload.code === "not-found") {
      return null;
    }
    console.error("performance report refused:", payload.code);
    throw new DataError(LOAD_ERROR);
  }
  if (!payload.program || !payload.family || !payload.effect || !payload.claims) {
    throw new DataError(LOAD_ERROR);
  }

  return {
    program: programOf(payload.program),
    family: {
      key: payload.family.key,
      version: payload.family.version,
      suiteDigest: payload.family.suite_digest,
      taskKeys: payload.family.task_keys,
      description: payload.family.description,
    },
    families: (payload.families ?? []).map((row) => ({
      key: row.key,
      version: row.version,
      suiteDigest: row.digest,
      taskKeys: row.task_keys ?? [],
      tasks: number(row.tasks),
      expectedRows: number(row.expected_rows),
      baseline: trialStat(row.baseline),
      candidate: trialStat(row.candidate),
      effect: effectOf(row.effect),
      claim: {
        supported: Boolean(row.claim?.supported),
        verdict: row.claim?.verdict ?? "awaiting_evidence",
        complete: Boolean(row.claim?.complete),
        reasons: row.claim?.reasons ?? [],
      },
    })),
    plan: {
      tasks: payload.plan?.tasks ?? 0,
      trials: payload.plan?.trials ?? 0,
      expectedRows: payload.plan?.expected_rows ?? 0,
    },
    baseline: trialStat(payload.baseline),
    candidate: trialStat(payload.candidate),
    effect: effectOf(payload.effect),
    reviews: {
      reviewed: payload.reviews?.reviewed ?? 0,
      disagreements: payload.reviews?.disagreements ?? 0,
      maxDisagreements: payload.reviews?.max_disagreements ?? 0,
    },
    humanReferences: {
      count: payload.human_references?.count ?? 0,
      participants: payload.human_references?.participants ?? 0,
    },
    claims: {
      registered: payload.claims.registered,
      supported: Boolean(payload.claims.supported),
      pooled: Boolean(payload.claims.pooled),
      verdict: payload.claims.verdict,
      complete: Boolean(payload.claims.complete),
      reasons: payload.claims.reasons ?? [],
      refused: payload.claims.refused ?? [],
    },
  };
}

export type ReviewableTrial = {
  id: string;
  config: "baseline" | "candidate";
  taskKey: string;
  trial: number;
  outcome: "pass" | "partial" | "fail";
  score: number;
  recordedBy: string;
};

/**
 * Trials a person is allowed to review: not their own, and not the registrar's.
 * The trigger enforces the same rule, so this list is only a convenience.
 */
export async function listReviewableTrials(
  session: Session,
  report: PerformanceReport,
): Promise<ReviewableTrial[]> {
  const { data, error } = await session.supabase
    .from("performance_trials")
    .select("id, config, task_key, trial, outcome, score, recorded_by")
    .eq("program_id", report.program.id)
    .order("config", { ascending: true })
    .order("task_key", { ascending: true })
    .order("trial", { ascending: true })
    .limit(60);
  if (error) {
    console.error("performance review list read failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }

  return ((data ?? []) as {
    id: string;
    config: "baseline" | "candidate";
    task_key: string;
    trial: number;
    outcome: "pass" | "partial" | "fail";
    score: number;
    recorded_by: string;
  }[])
    .filter(
      (row) => row.recorded_by !== session.user.id && row.recorded_by !== report.program.registeredBy,
    )
    .map((row) => ({
      id: row.id,
      config: row.config,
      taskKey: row.task_key,
      trial: row.trial,
      outcome: row.outcome,
      score: row.score,
      recordedBy: row.recorded_by,
    }));
}
