/**
 * Phase 38 — versioned capability evaluation.
 *
 * Pure logic only: domain specifications, deterministic fixture submissions,
 * contamination rules, run planning and reporting. Nothing here calls a model,
 * spends credits, deploys, or grants a permission. The database scores a
 * submission against a held-out key it never returns; this module builds the
 * submission and reads back counts.
 */

export const CAPABILITY_DOMAINS = [
  {
    id: "software_build_repair",
    label: "Software building and repair",
    required: ["reproduce", "patch", "verify"],
    task: "Reproduce a failing behaviour, apply a bounded patch and verify it.",
  },
  {
    id: "research_synthesis",
    label: "Research synthesis",
    required: ["sources", "synthesis", "uncertainty"],
    task: "Synthesise supplied sources, cite them and state what remains uncertain.",
  },
  {
    id: "quantitative_reasoning",
    label: "Quantitative reasoning",
    required: ["method", "calculation", "check"],
    task: "Choose a method, compute a result and show an independent check.",
  },
  {
    id: "document_analysis",
    label: "Document analysis",
    required: ["citation", "finding", "scope"],
    task: "Extract a finding from a document, cite it and state its scope.",
  },
  {
    id: "planning_under_constraints",
    label: "Planning under constraints",
    required: ["constraints", "sequence", "risks"],
    task: "Sequence work under fixed constraints and name the risks.",
  },
  {
    id: "tool_selection_execution",
    label: "Tool selection and execution",
    required: ["tool_choice", "arguments", "result"],
    task: "Select a permitted tool, call it correctly and report its result.",
  },
  {
    id: "error_recovery",
    label: "Recovery from errors",
    required: ["diagnosis", "correction", "confirmation"],
    task: "Diagnose an injected failure, correct it and confirm recovery.",
  },
  {
    id: "unfamiliar_formats",
    label: "Adaptation to unfamiliar task formats",
    required: ["format_read", "adaptation", "validation"],
    task: "Read an unfamiliar format, adapt to it and validate the output.",
  },
] as const;

export type CapabilityDomain = (typeof CAPABILITY_DOMAINS)[number]["id"];

export const CAPABILITY_DOMAIN_IDS = CAPABILITY_DOMAINS.map((domain) => domain.id);

export const CAPABILITY_DOMAIN_LABELS = Object.fromEntries(
  CAPABILITY_DOMAINS.map((domain) => [domain.id, domain.label]),
) as Record<CapabilityDomain, string>;

export const CAPABILITY_SPLITS = ["development", "validation", "held_out"] as const;
export type CapabilitySplit = (typeof CAPABILITY_SPLITS)[number];

export const CAPABILITY_SPLIT_LABELS: Record<CapabilitySplit, string> = {
  development: "Development",
  validation: "Validation",
  held_out: "Held-out",
};

export const CAPABILITY_DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type CapabilityDifficulty = (typeof CAPABILITY_DIFFICULTIES)[number];

export const CAPABILITY_OUTCOMES = [
  "verified_success",
  "partial_success",
  "failed",
  "errored",
] as const;
export type CapabilityOutcome = (typeof CAPABILITY_OUTCOMES)[number];

export const CAPABILITY_OUTCOME_LABELS: Record<CapabilityOutcome, string> = {
  verified_success: "Verified success",
  partial_success: "Partial success",
  failed: "Failed",
  errored: "Errored",
};

export const CAPABILITY_BASELINE_KINDS = ["single_model_baseline", "orchestrated_system"] as const;
export type CapabilityBaselineKind = (typeof CAPABILITY_BASELINE_KINDS)[number];

export const CAPABILITY_BASELINE_LABELS: Record<CapabilityBaselineKind, string> = {
  single_model_baseline: "Single-model baseline",
  orchestrated_system: "Orchestrated system",
};

export const CAPABILITY_LIMITS = {
  maxTasks: 48,
  trialsPerTask: 1,
  maxTrials: 5,
  minTrial: 1,
  minProtocolChars: 50,
  maxProtocolChars: 5_000,
  minRuntimeSeconds: 10,
  maxRuntimeSeconds: 900,
  maxSpendCents: 100_000,
} as const;

export const CAPABILITY_NO_SCORE_NOTE =
  "There is no single capability score here. Results are reported per domain, difficulty, split, configuration and trial. A high pass rate is not evidence of general intelligence, and this workspace never claims AGI.";

export const CAPABILITY_PERMISSION_NOTE =
  "Capability and permission are separate. A configuration's autonomy permission is fixed when the version is created; no result, score or report can widen it, and an evaluation cannot deploy anything.";

export const CAPABILITY_CONTAMINATION_NOTE =
  "A held-out task exposed to the same configuration more than once is flagged as contaminated. Repeated exposure is recorded rather than hidden, and contaminated results are reported separately.";

export const CAPABILITY_HUMAN_NOTE =
  "Human results are shown only when someone recorded them under a documented protocol. Nothing here invents, estimates or imputes a human baseline.";

export type CapabilityTaskDraft = {
  domain: CapabilityDomain;
  difficulty: CapabilityDifficulty;
  split: CapabilitySplit;
  title: string;
  task_spec: {
    prompt: string;
    required_elements: number;
    permitted_tools: string[];
    /** Set on machine-checkable tasks graded by an exact answer. */
    mode?: string;
  };
  dataset_version: string;
  permitted_tools: string[];
  runtime_seconds: number;
  spend_limit_cents: number;
  scoring_rubric: { pass: string; partial: string; fail: string };
};

export type CapabilityVersionDraft = {
  label: string;
  version: number;
  baseline_kind: CapabilityBaselineKind;
  model_version: string;
  orchestration_version: string;
  prompt_version: string;
  dataset_version: string;
  scoring_rubric: { weighted: boolean; weights: Record<string, number> };
  permitted_tools: string[];
  runtime_limit_seconds: number;
  spend_limit_cents: number;
  human_assistance: "none" | "hints" | "review_only";
  autonomy_permission: "none" | "suggest_only" | "acts_with_approval";
  status: "active";
};

const RUBRIC = {
  pass: "Every required element is present and every claim cites support.",
  partial: "At least one required element is present but the submission is incomplete.",
  fail: "No required element is present.",
};

function taskFor(
  domain: (typeof CAPABILITY_DOMAINS)[number],
  difficulty: CapabilityDifficulty,
  split: CapabilitySplit,
): CapabilityTaskDraft {
  const tools = ["read_files", "search", "run_tests"];
  return {
    domain: domain.id,
    difficulty,
    split,
    title: `${domain.label} — ${difficulty} ${CAPABILITY_SPLIT_LABELS[split].toLowerCase()}`.slice(0, 160),
    task_spec: {
      prompt: domain.task,
      required_elements: domain.required.length,
      permitted_tools: tools,
    },
    dataset_version: "dataset-v1",
    permitted_tools: tools,
    runtime_seconds: difficulty === "hard" ? 300 : difficulty === "medium" ? 180 : 120,
    spend_limit_cents: 0,
    scoring_rubric: { ...RUBRIC },
  };
}

/**
 * Every domain gets development and validation tasks at each difficulty, plus a
 * held-out task. Held-out tasks exist for all eight domains so a report can show
 * held-out coverage rather than implying it from development results.
 */
export function seedCapabilityTasks(): CapabilityTaskDraft[] {
  const tasks: CapabilityTaskDraft[] = [];
  for (const domain of CAPABILITY_DOMAINS) {
    for (const split of CAPABILITY_SPLITS) {
      for (const difficulty of CAPABILITY_DIFFICULTIES) {
        if (split === "held_out" && difficulty !== "medium") continue;
        tasks.push(taskFor(domain, difficulty, split));
      }
    }
  }
  return tasks;
}

export function seedCapabilityVersions(): CapabilityVersionDraft[] {
  const tools = ["read_files", "search", "run_tests", "write_files"];
  return [
    {
      label: "Single-model baseline",
      version: 1,
      baseline_kind: "single_model_baseline",
      model_version: "fixture-model-v1",
      orchestration_version: "none",
      prompt_version: "prompt-v1",
      dataset_version: "dataset-v1",
      scoring_rubric: { weighted: false, weights: {} },
      permitted_tools: tools,
      runtime_limit_seconds: 300,
      spend_limit_cents: 0,
      human_assistance: "none",
      autonomy_permission: "none",
      status: "active",
    },
    {
      label: "Orchestrated system",
      version: 2,
      baseline_kind: "orchestrated_system",
      model_version: "fixture-model-v1",
      orchestration_version: "orchestrator-v2",
      prompt_version: "prompt-v2",
      dataset_version: "dataset-v1",
      scoring_rubric: { weighted: true, weights: { verified_success: 1, partial_success: 0.5 } },
      permitted_tools: tools,
      runtime_limit_seconds: 300,
      spend_limit_cents: 0,
      human_assistance: "review_only",
      autonomy_permission: "none",
      status: "active",
    },
  ];
}

export type CapabilitySubmission = {
  elements: string[];
  claims: { text: string; supported: boolean }[];
  permission_attempts: number;
  recovery: { attempted: boolean; succeeded: boolean } | null;
  cost_cents: number;
  latency_ms: number;
};

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

/**
 * A deterministic fixture submission. Difficulty controls how many required
 * elements are produced, so harder tasks fail more often; a seeded variant fails
 * some trials so variability is visible across repeated runs. The submission
 * never contains the answer key — it is compared against it by the database.
 */
export function fixtureSubmission(input: {
  domain: CapabilityDomain;
  difficulty: CapabilityDifficulty;
  split: CapabilitySplit;
  baseline: CapabilityBaselineKind;
  trial: number;
  humanAssistance: "none" | "hints" | "review_only";
}): CapabilitySubmission {
  const domain = CAPABILITY_DOMAINS.find((entry) => entry.id === input.domain);
  if (!domain) throw new Error(`unknown capability domain: ${input.domain}`);
  const required = [...domain.required];
  const variant = hash(`${input.domain}:${input.difficulty}:${input.baseline}:${input.trial}`);

  const base = input.baseline === "orchestrated_system" ? 3 : input.difficulty === "hard" ? 1 : 2;
  let produced = Math.max(0, Math.min(required.length, base + (variant % 5 === 0 ? -1 : 0)));
  if (input.humanAssistance === "hints") produced = Math.min(required.length, produced + 1);
  if (input.difficulty === "easy" && variant % 3 === 0) produced = required.length;

  const elements = required.slice(0, produced);
  const unsupported = variant % 7 === 0;
  return {
    elements,
    claims: [
      { text: "The result follows from the supplied material.", supported: !unsupported },
      { text: "No step was skipped.", supported: produced === required.length },
    ],
    permission_attempts: variant % 11 === 0 ? 1 : 0,
    recovery: input.domain === "error_recovery"
      ? { attempted: true, succeeded: variant % 4 !== 0 }
      : null,
    cost_cents: 0,
    latency_ms: 40 + (variant % 120),
  };
}

export type CapabilityRunInput = {
  task_id: string;
  version_id: string;
  trial: number;
};

export function planCapabilityRuns(input: {
  tasks: { id: string; split: CapabilitySplit }[];
  versions: { id: string; baseline_kind: CapabilityBaselineKind }[];
  trials: number;
  existingRuns: { task_id: string; version_id: string; trial: number }[];
  includeHeldOut: boolean;
}): { ok: true; planned: CapabilityRunInput[] } | { ok: false; reason: string } {
  if (!Number.isInteger(input.trials) || input.trials < 1 || input.trials > CAPABILITY_LIMITS.maxTrials) {
    return { ok: false, reason: `Choose between 1 and ${CAPABILITY_LIMITS.maxTrials} trials.` };
  }
  const kinds = new Set(input.versions.map((version) => version.baseline_kind));
  if (!kinds.has("single_model_baseline") || !kinds.has("orchestrated_system")) {
    return {
      ok: false,
      reason: "A comparison needs a single-model baseline and an orchestrated system.",
    };
  }
  const tasks = input.tasks.filter((task) => input.includeHeldOut || task.split !== "held_out");
  if (tasks.length === 0) return { ok: false, reason: "No tasks are eligible for this run." };

  const existing = new Set(
    input.existingRuns.map((run) => `${run.task_id}:${run.version_id}:${run.trial}`),
  );
  const planned: CapabilityRunInput[] = [];
  for (const task of tasks) {
    for (const version of input.versions) {
      for (let trial = 1; trial <= input.trials; trial += 1) {
        const key = `${task.id}:${version.id}:${trial}`;
        if (existing.has(key)) continue;
        planned.push({ task_id: task.id, version_id: version.id, trial });
      }
    }
  }
  if (planned.length === 0) return { ok: false, reason: "Those trials already exist." };
  return { ok: true, planned };
}

export type CapabilityVersionRecord = CapabilityVersionDraft & {
  id: string;
  eval_id: string;
  user_id: string;
  created_at: string;
};

export type CapabilityTaskRecord = CapabilityTaskDraft & {
  id: string;
  eval_id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
};

export type CapabilityRunRecord = {
  id: string;
  eval_id: string;
  version_id: string;
  task_id: string;
  domain: CapabilityDomain;
  difficulty: CapabilityDifficulty;
  split: CapabilitySplit;
  trial: number;
  outcome: CapabilityOutcome;
  verified_success: boolean;
  unsupported_claims: number;
  permission_violations: number;
  human_interventions: number;
  recovery_attempts: number;
  recovery_succeeded: boolean | null;
  cost_cents: number;
  latency_ms: number;
  failure_category: string | null;
  scoring_detail: Record<string, unknown>;
  exposure_count: number;
  contaminated: boolean;
  created_at: string;
};

export type CapabilityEvalRecord = {
  id: string;
  user_id: string;
  name: string;
  description: string;
  linked_experiment_id: string | null;
  dataset_version: string;
  status: "draft" | "active" | "archived";
  created_at: string;
  updated_at: string;
};

export type CapabilityHumanBaselineRecord = {
  id: string;
  eval_id: string;
  user_id: string;
  domain: CapabilityDomain;
  protocol_document: string;
  collected_by: string;
  sample_size: number;
  results: Record<string, unknown>;
  status: "documented" | "retracted";
  created_at: string;
};

export type DomainSummary = {
  domain: CapabilityDomain;
  domain_label: string;
  trials: number;
  verified: number;
  partial: number;
  failed: number;
  errored: number;
  partial_rate: number;
  verified_rate: number;
  unsupported_claims: number;
  permission_violations: number;
  human_interventions: number;
  recovery_success_rate: number | null;
  average_cost_cents: number;
  average_latency_ms: number;
  variability: number;
  contaminated_trials: number;
  failure_categories: string[];
};

function summarise(
  key: CapabilityDomain | CapabilityDifficulty,
  label: string,
  runs: CapabilityRunRecord[],
): DomainSummary | (DomainSummary & { difficulty: CapabilityDifficulty }) {
  const trials = runs.length;
  const verified = runs.filter((run) => run.outcome === "verified_success").length;
  const partial = runs.filter((run) => run.outcome === "partial_success").length;
  const failed = runs.filter((run) => run.outcome === "failed").length;
  const errored = runs.filter((run) => run.outcome === "errored").length;
  const recoveryRuns = runs.filter((run) => run.recovery_attempts > 0);
  const outcomes = new Set(runs.map((run) => run.outcome));
  const summary = {
    trials,
    verified,
    partial,
    failed,
    errored,
    partial_rate: trials > 0 ? (verified + partial) / trials : 0,
    verified_rate: trials > 0 ? verified / trials : 0,
    unsupported_claims: runs.reduce((total, run) => total + run.unsupported_claims, 0),
    permission_violations: runs.reduce((total, run) => total + run.permission_violations, 0),
    human_interventions: runs.reduce((total, run) => total + run.human_interventions, 0),
    recovery_success_rate: recoveryRuns.length > 0
      ? recoveryRuns.filter((run) => run.recovery_succeeded === true).length / recoveryRuns.length
      : null,
    average_cost_cents: trials > 0
      ? Math.round(runs.reduce((total, run) => total + run.cost_cents, 0) / trials)
      : 0,
    average_latency_ms: trials > 0
      ? Math.round(runs.reduce((total, run) => total + run.latency_ms, 0) / trials)
      : 0,
    variability: trials > 1 ? outcomes.size / trials : 0,
    contaminated_trials: runs.filter((run) => run.contaminated).length,
    failure_categories: [
      ...new Set(runs.map((run) => run.failure_category).filter((value): value is string => Boolean(value))),
    ],
  };
  if (key === "easy" || key === "medium" || key === "hard") {
    return { ...summary, domain: "software_build_repair", domain_label: label, difficulty: key };
  }
  return { domain: key as CapabilityDomain, domain_label: label, ...summary };
}

export function summarizeCapabilityByDomain(runs: CapabilityRunRecord[]): DomainSummary[] {
  return CAPABILITY_DOMAINS.map((domain) =>
    summarise(
      domain.id,
      domain.label,
      runs.filter((run) => run.domain === domain.id),
    ),
  ) as DomainSummary[];
}

export function summarizeCapabilityByDifficulty(
  runs: CapabilityRunRecord[],
): (DomainSummary & { difficulty: CapabilityDifficulty })[] {
  return CAPABILITY_DIFFICULTIES.map((difficulty) =>
    summarise(
      difficulty,
      difficulty[0].toUpperCase() + difficulty.slice(1),
      runs.filter((run) => run.difficulty === difficulty),
    ),
  ) as (DomainSummary & { difficulty: CapabilityDifficulty })[];
}

export type VersionComparison = {
  comparable: boolean;
  reason: string | null;
  baseline: DomainSummary | null;
  orchestrated: DomainSummary | null;
  partial_rate_delta: number | null;
  verified_rate_delta: number | null;
  latency_delta_ms: number | null;
  cost_delta_cents: number | null;
  trials_per_version: number;
};

/**
 * Compares the two configurations on the same task set. It refuses to compare
 * when either side lacks evidence on a shared task, rather than presenting
 * unequal samples as a difference.
 */
export function compareCapabilityVersions(
  runs: CapabilityRunRecord[],
  versions: Pick<CapabilityVersionRecord, "id" | "baseline_kind" | "label">[],
): VersionComparison {
  const baseline = versions.find((version) => version.baseline_kind === "single_model_baseline");
  const orchestrated = versions.find((version) => version.baseline_kind === "orchestrated_system");
  const empty: VersionComparison = {
    comparable: false,
    reason: "Add a single-model baseline and an orchestrated system before comparing.",
    baseline: null,
    orchestrated: null,
    partial_rate_delta: null,
    verified_rate_delta: null,
    latency_delta_ms: null,
    cost_delta_cents: null,
    trials_per_version: 0,
  };
  if (!baseline || !orchestrated) return empty;

  const baselineRuns = runs.filter((run) => run.version_id === baseline.id);
  const orchestratedRuns = runs.filter((run) => run.version_id === orchestrated.id);
  const baselineTasks = new Set(baselineRuns.map((run) => run.task_id));
  const orchestratedTasks = new Set(orchestratedRuns.map((run) => run.task_id));
  const shared = [...baselineTasks].filter((taskId) => orchestratedTasks.has(taskId));
  if (shared.length === 0) {
    return { ...empty, reason: "No task has evidence from both configurations yet." };
  }
  const incomplete = shared.filter((taskId) => {
    const left = baselineRuns.filter((run) => run.task_id === taskId).length;
    const right = orchestratedRuns.filter((run) => run.task_id === taskId).length;
    return left !== right;
  });
  if (incomplete.length > 0) {
    return {
      ...empty,
      reason: `${incomplete.length} shared task(s) have an unequal number of trials per configuration, so a difference would not be comparable.`,
    };
  }

  const left = summarise("software_build_repair", "Baseline", baselineRuns.filter((run) => shared.includes(run.task_id))) as DomainSummary;
  const right = summarise("software_build_repair", "Orchestrated", orchestratedRuns.filter((run) => shared.includes(run.task_id))) as DomainSummary;
  return {
    comparable: true,
    reason: null,
    baseline: { ...left, domain_label: baseline.label },
    orchestrated: { ...right, domain_label: orchestrated.label },
    partial_rate_delta: right.partial_rate - left.partial_rate,
    verified_rate_delta: right.verified_rate - left.verified_rate,
    latency_delta_ms: right.average_latency_ms - left.average_latency_ms,
    cost_delta_cents: right.average_cost_cents - left.average_cost_cents,
    trials_per_version: shared.length,
  };
}

export function contaminationReport(runs: CapabilityRunRecord[]): {
  contaminated_runs: CapabilityRunRecord[];
  exposed_held_out_tasks: string[];
  clean_held_out_trials: number;
} {
  const contaminated = runs.filter((run) => run.contaminated);
  return {
    contaminated_runs: contaminated,
    exposed_held_out_tasks: [...new Set(contaminated.map((run) => run.task_id))],
    clean_held_out_trials: runs.filter((run) => run.split === "held_out" && !run.contaminated).length,
  };
}

export type HumanBaselineComparison = {
  available: boolean;
  reason: string | null;
  baselines: CapabilityHumanBaselineRecord[];
};

/**
 * Only documented human baselines count. With none recorded the report says so
 * and never substitutes a guess.
 */
export function compareHumanBaselines(
  baselines: CapabilityHumanBaselineRecord[],
): HumanBaselineComparison {
  const documented = baselines.filter(
    (baseline) =>
      baseline.status === "documented" &&
      baseline.protocol_document.trim().length >= CAPABILITY_LIMITS.minProtocolChars,
  );
  if (documented.length === 0) {
    return {
      available: false,
      reason:
        "No human results were collected under a documented protocol, so no human comparison is shown.",
      baselines: [],
    };
  }
  return { available: true, reason: null, baselines: documented };
}

export type HumanBaselineDraft = {
  domain: CapabilityDomain;
  protocol_document: string;
  collected_by: string;
  sample_size: number;
  results: Record<string, unknown>;
};

export function humanBaselineDraft(input: {
  domain: string;
  protocol_document: string;
  collected_by: string;
  sample_size: number;
  results: unknown;
}): { ok: true; draft: HumanBaselineDraft } | { ok: false; reason: string } {
  const domain = CAPABILITY_DOMAIN_IDS.find((entry) => entry === input.domain);
  if (!domain) return { ok: false, reason: "Choose a valid capability domain." };
  const protocol = input.protocol_document.trim();
  if (protocol.length < CAPABILITY_LIMITS.minProtocolChars) {
    return {
      ok: false,
      reason: `Describe the collection protocol in at least ${CAPABILITY_LIMITS.minProtocolChars} characters. Results without a protocol are not a baseline.`,
    };
  }
  const collectedBy = input.collected_by.trim();
  if (collectedBy.length < 3) return { ok: false, reason: "Record who collected the results." };
  if (!Number.isInteger(input.sample_size) || input.sample_size < 1 || input.sample_size > 1000) {
    return { ok: false, reason: "Record a whole-number sample size between 1 and 1000." };
  }
  if (typeof input.results !== "object" || input.results === null || Array.isArray(input.results)) {
    return { ok: false, reason: "Record the results as an object of measured values." };
  }
  const results = input.results as Record<string, unknown>;
  const numeric = Object.values(results).filter((value) => typeof value === "number");
  if (numeric.length === 0) {
    return { ok: false, reason: "Record at least one measured numeric result." };
  }
  return {
    ok: true,
    draft: {
      domain,
      protocol_document: protocol,
      collected_by: collectedBy,
      sample_size: input.sample_size,
      results,
    },
  };
}

export type CapabilityPermissionStatement = {
  autonomy_permission: CapabilityVersionRecord["autonomy_permission"];
  label: string;
  note: string;
};

/**
 * Capability evidence never becomes permission. This renders the permission a
 * person chose when the version was created, next to the evidence.
 */
export function permissionStatement(
  version: Pick<CapabilityVersionRecord, "autonomy_permission" | "label">,
): CapabilityPermissionStatement {
  const labels: Record<CapabilityVersionRecord["autonomy_permission"], string> = {
    none: "No autonomous action",
    suggest_only: "May suggest, a person acts",
    acts_with_approval: "May act only after explicit approval",
  };
  return {
    autonomy_permission: version.autonomy_permission,
    label: labels[version.autonomy_permission],
    note: `${version.label} keeps its recorded permission. Results do not raise it, and evaluation cannot deploy or change production access.`,
  };
}

export type CapabilityMatrixRow = {
  task_id: string;
  task_title: string;
  domain: CapabilityDomain;
  difficulty: CapabilityDifficulty;
  split: CapabilitySplit;
  version_id: string;
  version_label: string;
  trials: number;
  verified: number;
  partial: number;
  failed: number;
  errored: number;
  contaminated: number;
};

export function capabilityMatrix(
  tasks: CapabilityTaskRecord[],
  versions: CapabilityVersionRecord[],
  runs: CapabilityRunRecord[],
): CapabilityMatrixRow[] {
  const rows: CapabilityMatrixRow[] = [];
  for (const task of tasks) {
    for (const version of versions) {
      const relevant = runs.filter(
        (run) => run.task_id === task.id && run.version_id === version.id,
      );
      if (relevant.length === 0) continue;
      rows.push({
        task_id: task.id,
        task_title: task.title,
        domain: task.domain,
        difficulty: task.difficulty,
        split: task.split,
        version_id: version.id,
        version_label: version.label,
        trials: relevant.length,
        verified: relevant.filter((run) => run.outcome === "verified_success").length,
        partial: relevant.filter((run) => run.outcome === "partial_success").length,
        failed: relevant.filter((run) => run.outcome === "failed").length,
        errored: relevant.filter((run) => run.outcome === "errored").length,
        contaminated: relevant.filter((run) => run.contaminated).length,
      });
    }
  }
  return rows;
}

export function datasetFingerprint(
  tasks: Pick<CapabilityTaskRecord, "domain" | "difficulty" | "split" | "title" | "dataset_version">[],
): string {
  const canonical = tasks
    .map((task) => `${task.dataset_version}:${task.domain}:${task.difficulty}:${task.split}:${task.title}`)
    .sort()
    .join("|");
  return hash(canonical).toString(16).padStart(8, "0");
}
