import crypto from "node:crypto";
import { SAFE_TOOLS } from "@/lib/improvement-eval";
import {
  PERFORMANCE_FAMILIES,
  TOOL_SELECTION_FAMILY,
  familyOptions,
  familySpec,
  type FamilyOption,
} from "@/lib/performance-families";

/**
 * Phase 41 — the controlled performance research program.
 *
 * Two narrowly defined families are installed, each a fixed authored
 * distribution with its own baseline, candidate policies and pinned digest:
 * tool selection (Phase 40's suite) and error recovery (what to do after a
 * connector call fails). A program registers one family and the claim it could
 * support, and the words here are shared by the page, the actions and the report
 * so the registered claim and the supported claim cannot drift apart.
 */

const PRIMARY_FAMILY = TOOL_SELECTION_FAMILY;

export const PERFORMANCE_FAMILY_KEY = PRIMARY_FAMILY.key;
export const PERFORMANCE_FAMILY_VERSION = PRIMARY_FAMILY.version;
/**
 * Recomputed from the authored cases. The migration seeds the same digest, and a
 * unit test compares the two so a suite edit cannot leave a stale family behind.
 */
export const PERFORMANCE_FAMILY_DIGEST = PRIMARY_FAMILY.digest;
export const ERROR_RECOVERY_FAMILY_KEY = "error_recovery";
export const ERROR_RECOVERY_FAMILY_VERSION = "2026-11-13.1";

export const PERFORMANCE_TASK_KEYS = PRIMARY_FAMILY.taskKeys;
export const PERFORMANCE_FAMILIES_LIST = PERFORMANCE_FAMILIES;
export const PERFORMANCE_FAMILY_OPTIONS: FamilyOption[] = familyOptions();

export const PERFORMANCE_LIMITS = {
  maxProgramsPerWorkspace: 20,
  minTrials: 1,
  maxTrials: 20,
  minTimeLimitSeconds: 10,
  maxTimeLimitSeconds: 3600,
  maxCostLimitCents: 100_000,
  maxDisagreements: 100,
  minClaimText: 20,
  maxClaimText: 500,
} as const;

export const PERFORMANCE_CLAIMS = [
  "benchmark",
  "faster",
  "lower_cost",
  "distribution",
] as const;

export type PerformanceClaim = (typeof PERFORMANCE_CLAIMS)[number];

export const CLAIM_LABELS: Record<PerformanceClaim, string> = {
  benchmark: "Better on this authored benchmark",
  faster: "Faster on this task family",
  lower_cost: "Lower cost on this task family",
  distribution: "Better on a defined real-world task distribution",
};

/** What the registered minimum effect is measured in, per claim. */
export const CLAIM_UNITS: Record<PerformanceClaim, string> = {
  benchmark: "score points (0–1)",
  faster: "percent lower median latency",
  lower_cost: "percent lower mean cost",
  distribution: "score points (0–1)",
};

export const CLAIM_NOTES: Record<PerformanceClaim, string> = {
  benchmark:
    "A benchmark claim holds on the family's authored cases, scored pass or fail. It says nothing about tasks that are not in the family.",
  faster:
    "Speed needs measured latency for both configurations. If a trial has no latency, the report refuses the claim rather than inferring one.",
  lower_cost:
    "Cost is measured money per trial. Zero recorded cost on both sides is not evidence of a saving, and the report says so.",
  distribution:
    "A real-world distribution claim needs a documented, consented human reference collected over a sample of that distribution. Without one, the result stays a benchmark result.",
};

export const REFUSED_CLAIM_NOTE =
  "One authored task family cannot support a broader general-capability claim, whatever the score on it. No result here is an AGI, superintelligence or singularity claim, and none is publishable as one.";

export const PERFORMANCE_STATUS_LABELS: Record<string, string> = {
  draft: "draft",
  registered: "registered",
  closed: "closed",
};

export const VERDICT_LABELS: Record<string, string> = {
  supported: "supported by the recorded evidence",
  not_supported: "not supported by the recorded evidence",
  awaiting_evidence: "awaiting the registered trials",
};

/** Candidates a program may test, keyed by family. A family fixes its baseline. */
export const PERFORMANCE_POLICIES: Record<string, { label: string; policy: typeof PRIMARY_FAMILY.baseline.policy }> =
  Object.fromEntries(
    PRIMARY_FAMILY.candidates.map((candidate) => [
      candidate.key,
      { label: candidate.label, policy: candidate.policy },
    ]),
  );

export const PERFORMANCE_BASELINE = PRIMARY_FAMILY.baseline;

export function familyLabel(key: string): string {
  return familySpec(key)?.label ?? key;
}

export function familyCandidate(key: string, policyKey: string) {
  return familySpec(key)?.candidates.find((candidate) => candidate.key === policyKey) ?? null;
}

export { familySpec };
export type { FamilyOption };

export const PERFORMANCE_PERMITTED_TOOLS = [...SAFE_TOOLS];

export type PerformanceDraft = {
  title: string;
  question: string;
  inclusionRules: string;
  exclusionRules: string;
  scoringMethod: string;
  candidatePolicy: string;
  trials: number;
  timeLimitSeconds: number;
  costLimitCents: number;
  humanAssistancePolicy: string;
  failureCriteria: string;
  supportedClaim: string;
  claimText: string;
  minimumEffect: number;
  noninferiorityMargin: number;
  maxDisagreements: number;
};

const BANNED_CLAIM = /(^|[^a-z])(agi|artificial general intelligence|superintelligence|singularity)([^a-z]|$)/;

/** The phrase guard the database also enforces. */
export function bannedClaimPhrase(text: string): boolean {
  return BANNED_CLAIM.test(text.toLowerCase());
}

function between(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

/**
 * Everything the registration has to say before a trial may exist. Mirrors the
 * table's checks so a person sees the problem instead of a constraint name.
 */
export function programProblems(draft: PerformanceDraft): string[] {
  const problems: string[] = [];
  const text = (value: string, min: number, max: number, name: string) => {
    const length = value.trim().length;
    if (length < min || length > max) problems.push(`${name} must be ${min}–${max} characters.`);
  };

  text(draft.title, 5, 160, "The title");
  text(draft.question, 20, 1000, "The question");
  text(draft.inclusionRules, 20, 2000, "The inclusion rules");
  text(draft.exclusionRules, 10, 2000, "The exclusion rules");
  text(draft.scoringMethod, 20, 2000, "The scoring method");
  text(draft.humanAssistancePolicy, 20, 1000, "The human assistance policy");
  text(draft.failureCriteria, 20, 2000, "The failure criteria");

  if (!PERFORMANCE_CLAIMS.includes(draft.supportedClaim as PerformanceClaim)) {
    problems.push("Choose which claim this comparison could support.");
  }
  text(draft.claimText, PERFORMANCE_LIMITS.minClaimText, PERFORMANCE_LIMITS.maxClaimText, "The claim");
  if (bannedClaimPhrase(draft.claimText)) {
    problems.push(
      "That claim cannot be registered: a task family supports a specific result, never an AGI, superintelligence or singularity claim.",
    );
  }

  if (!PERFORMANCE_POLICIES[draft.candidatePolicy]) {
    problems.push("Choose the candidate policy this program compares with the shipped policy.");
  }

  if (!between(draft.trials, PERFORMANCE_LIMITS.minTrials, PERFORMANCE_LIMITS.maxTrials)) {
    problems.push(`Trials per task must be ${PERFORMANCE_LIMITS.minTrials}–${PERFORMANCE_LIMITS.maxTrials}.`);
  }
  if (
    !between(
      draft.timeLimitSeconds,
      PERFORMANCE_LIMITS.minTimeLimitSeconds,
      PERFORMANCE_LIMITS.maxTimeLimitSeconds,
    )
  ) {
    problems.push(
      `The time limit must be ${PERFORMANCE_LIMITS.minTimeLimitSeconds}–${PERFORMANCE_LIMITS.maxTimeLimitSeconds} seconds.`,
    );
  }
  if (!between(draft.costLimitCents, 0, PERFORMANCE_LIMITS.maxCostLimitCents)) {
    problems.push("The cost limit must be between 0 and 100,000 cents.");
  }
  if (!between(draft.minimumEffect, 0, 100)) {
    problems.push("The minimum effect must be between 0 and 100.");
  }
  if (!between(draft.noninferiorityMargin, 0, 1)) {
    problems.push("The non-inferiority margin must be between 0 and 1.");
  }
  if (!between(draft.maxDisagreements, 0, PERFORMANCE_LIMITS.maxDisagreements)) {
    problems.push(`The disagreement allowance must be 0–${PERFORMANCE_LIMITS.maxDisagreements}.`);
  }

  return problems;
}

/** The distribution is built from the installed family, never typed in. */
export function familyDistribution(familyKey: string = PERFORMANCE_FAMILY_KEY): {
  suite: string;
  version: string;
  digest: string;
  task_keys: string[];
  tasks: number;
} {
  const family = familySpec(familyKey) ?? PRIMARY_FAMILY;
  return {
    suite: family.key,
    version: family.version,
    digest: family.digest,
    task_keys: family.taskKeys,
    tasks: family.taskKeys.length,
  };
}

/**
 * A stable hash of everything a reader would need to know what was registered.
 * The report repeats the protocol so this can be recomputed, and a trial cannot
 * be recorded against a program whose distribution differs from the family.
 */
export function protocolFingerprint(input: {
  familyKey?: string;
  title: string;
  question: string;
  inclusionRules: string;
  exclusionRules: string;
  scoringMethod: string;
  candidatePolicy: string;
  trials: number;
  timeLimitSeconds: number;
  costLimitCents: number;
  humanAssistancePolicy: string;
  failureCriteria: string;
  supportedClaim: string;
  claimText: string;
  minimumEffect: number;
  noninferiorityMargin: number;
  maxDisagreements: number;
}): string {
  const family = familySpec(input.familyKey ?? PERFORMANCE_FAMILY_KEY) ?? PRIMARY_FAMILY;
  const canonical = {
    family: family.key,
    familyVersion: family.version,
    digest: family.digest,
    tasks: family.taskKeys,
    baseline: family.baseline.key,
    candidate: input.candidatePolicy,
    title: input.title.trim(),
    question: input.question.trim(),
    inclusionRules: input.inclusionRules.trim(),
    exclusionRules: input.exclusionRules.trim(),
    scoringMethod: input.scoringMethod.trim(),
    trials: input.trials,
    timeLimitSeconds: input.timeLimitSeconds,
    costLimitCents: input.costLimitCents,
    humanAssistancePolicy: input.humanAssistancePolicy.trim(),
    failureCriteria: input.failureCriteria.trim(),
    supportedClaim: input.supportedClaim,
    claimText: input.claimText.trim(),
    minimumEffect: input.minimumEffect,
    noninferiorityMargin: input.noninferiorityMargin,
    maxDisagreements: input.maxDisagreements,
    permittedTools: PERFORMANCE_PERMITTED_TOOLS,
  };
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function formatScore(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "not recorded";
  return value.toFixed(4);
}

export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "not measured";
  return `${value.toFixed(2)}%`;
}

export function formatCents(value: number): string {
  return `${(value / 100).toFixed(2)} USD`;
}

export function formatLatency(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "not measured";
  return `${Math.round(value)} ms`;
}
