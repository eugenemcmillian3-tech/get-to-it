import crypto from "node:crypto";

/**
 * Phase 40 — improvement proposals.
 *
 * A candidate is a written case for changing the system that builds and runs
 * the product: a prompt revision, a routing rule, a tool policy, a procedure, a
 * workflow, an application patch or a new evaluation case. Everything here is
 * about the proposal record and the rules around it. Evaluation lives in
 * `improvement-eval.ts`, and the state machine lives in Postgres.
 *
 * The boundaries in `PROTECTED_AUTHORITIES` are the ones the engine may never
 * cross. They are refused at drafting time and again by a database trigger, so a
 * candidate cannot ask for them by name and a later edit cannot smuggle them in.
 */

export const CANDIDATE_KINDS = [
  "prompt_revision",
  "model_routing",
  "tool_policy",
  "procedure",
  "workflow_change",
  "code_patch",
  "evaluation_case",
] as const;
export type CandidateKind = (typeof CANDIDATE_KINDS)[number];

export const CANDIDATE_KIND_LABELS: Record<CandidateKind, string> = {
  prompt_revision: "Prompt revision",
  model_routing: "Model-routing adjustment",
  tool_policy: "Tool-selection policy",
  procedure: "Reusable procedure",
  workflow_change: "Workflow change",
  code_patch: "Application-code patch",
  evaluation_case: "New evaluation case",
};

export const CANDIDATE_STATUSES = [
  "draft",
  "evaluating",
  "evaluated",
  "approved",
  "rejected",
  "promoted",
  "cancelled",
  "blocked",
] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export const CANDIDATE_STATUS_LABELS: Record<CandidateStatus, string> = {
  draft: "Draft",
  evaluating: "Evaluating",
  evaluated: "Evaluated",
  approved: "Approved for promotion",
  rejected: "Rejected",
  promoted: "Promoted",
  cancelled: "Cancelled",
  blocked: "Blocked",
};

export const VERDICTS = ["better", "equal", "worse", "inconclusive"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const VERDICT_LABELS: Record<Verdict, string> = {
  better: "Better than the baseline",
  equal: "No measurable change",
  worse: "Worse than the baseline",
  inconclusive: "Inconclusive",
};

/** The installed candidate policies a proposal may name. */
export const POLICY_OPTIONS = [
  { value: "channel-lookup", label: "Resolve a channel name before posting" },
  { value: "widened-toolset", label: "Let delete and merge requests through" },
  { value: "shipped", label: "The shipped baseline (control)" },
] as const;

export const CANDIDATE_LIMITS = {
  maxPerWorkspace: 40,
  maxNeedsAssessment: 1,
  maxSuiteHashAgeDays: 30,
  maxCostIncreaseRatio: 0.25,
  maxCases: 40,
  maxComponents: 8,
} as const;

/**
 * The things the improvement engine may never do for itself. A candidate that
 * asks for any of them is refused, whether it asks at drafting time or tries to
 * add them later.
 */
export const PROTECTED_AUTHORITIES = [
  "grant_permissions",
  "remove_approval_gate",
  "increase_spend_limit",
  "change_billing_price",
  "disable_audit_log",
  "alter_held_out_answers",
  "rewrite_success_criteria",
  "deploy_own_change",
  "write_production_data",
] as const;
export type ProtectedAuthority = (typeof PROTECTED_AUTHORITIES)[number];

export const PROTECTED_AUTHORITY_LABELS: Record<ProtectedAuthority, string> = {
  grant_permissions: "Grant itself or anyone else permissions",
  remove_approval_gate: "Remove or skip an approval gate",
  increase_spend_limit: "Increase spending authority",
  change_billing_price: "Change a billing price",
  disable_audit_log: "Disable or trim audit logging",
  alter_held_out_answers: "Alter held-out answers",
  rewrite_success_criteria: "Rewrite success criteria after seeing results",
  deploy_own_change: "Deploy its own change",
  write_production_data: "Modify production data without approval",
};

export const PROTECTED_AUTHORITY_NOTE =
  "These boundaries are fixed: the improvement engine cannot grant permissions, remove an approval gate, raise spending authority, change a billing price, disable audit logging, alter held-out answers, rewrite success criteria after seeing results, deploy its own change or modify production data without approval.";

export const CANDIDATE_NOTES = {
  isolation:
    "A candidate runs in its own branch or sandbox with authorized test data. Production credentials are never handed to it.",
  evaluation:
    "The candidate is measured against the current baseline with functional, security, cost and regression checks. Changing the tests needs its own review, so a candidate cannot look better by weakening them.",
  promotion:
    "Promotion is a separate human decision about the exact change, the results, the remaining risks, the cost and the rollback. Deployment stays in the existing deployment approvals.",
  boundaries: PROTECTED_AUTHORITY_NOTE,
} as const;

export function isCandidateKind(value: string): value is CandidateKind {
  return (CANDIDATE_KINDS as readonly string[]).includes(value);
}

export function isCandidateStatus(value: string): value is CandidateStatus {
  return (CANDIDATE_STATUSES as readonly string[]).includes(value);
}

export function isProtectedAuthority(value: string): value is ProtectedAuthority {
  return (PROTECTED_AUTHORITIES as readonly string[]).includes(value);
}

export type CandidateDraft = {
  kind: CandidateKind;
  title: string;
  problem: string;
  evidence: string;
  proposedChange: string;
  expectedBenefit: string;
  possibleRegressions: string;
  affectedComponents: string[];
  evaluationPlan: string;
  costImpact: string;
  securityImplications: string;
  rollbackPlan: string;
  requestedAuthorities: string[];
  sandboxKind: "branch" | "sandbox";
  baseRef: string;
  candidateRef: string;
};

const FIELD_RULES: { key: keyof CandidateDraft; label: string; min: number; max: number }[] = [
  { key: "title", label: "Title", min: 5, max: 160 },
  { key: "problem", label: "Problem", min: 20, max: 2000 },
  { key: "evidence", label: "Evidence", min: 20, max: 4000 },
  { key: "proposedChange", label: "Proposed change", min: 20, max: 3000 },
  { key: "expectedBenefit", label: "Expected benefit", min: 10, max: 1000 },
  { key: "possibleRegressions", label: "Possible regressions", min: 10, max: 2000 },
  { key: "evaluationPlan", label: "Evaluation plan", min: 20, max: 3000 },
  { key: "costImpact", label: "Cost impact", min: 5, max: 1000 },
  { key: "securityImplications", label: "Security implications", min: 5, max: 2000 },
  { key: "rollbackPlan", label: "Rollback plan", min: 20, max: 2000 },
];

/** Every field the record must carry, checked before anything is stored. */
export function candidateProblems(draft: CandidateDraft): string[] {
  const problems: string[] = [];

  for (const rule of FIELD_RULES) {
    const value = String(draft[rule.key] ?? "").trim();
    if (value.length < rule.min) {
      problems.push(`${rule.label} needs at least ${rule.min} characters.`);
    } else if (value.length > rule.max) {
      problems.push(`${rule.label} must stay under ${rule.max} characters.`);
    }
  }

  const components = draft.affectedComponents.map((value) => value.trim()).filter(Boolean);
  if (components.length === 0) {
    problems.push("Name at least one affected component.");
  } else if (components.length > CANDIDATE_LIMITS.maxComponents) {
    problems.push(`Name at most ${CANDIDATE_LIMITS.maxComponents} affected components.`);
  }
  for (const component of components) {
    if (component.length > 80) problems.push("An affected component name must stay under 80 characters.");
    if (/[<>]/.test(component)) problems.push("An affected component name cannot contain angle brackets.");
  }

  for (const authority of draft.requestedAuthorities) {
    const problem = authorityProblem(authority);
    if (problem) problems.push(problem);
  }

  if (!draft.baseRef.trim()) problems.push("Name the baseline the candidate is compared with.");
  if (!draft.candidateRef.trim()) problems.push("Name the branch or sandbox the candidate runs in.");
  if (draft.baseRef.trim() && draft.baseRef.trim() === draft.candidateRef.trim()) {
    problems.push("A candidate needs its own branch or sandbox, not the baseline's.");
  }

  return problems;
}

/** Refuses a requested authority by name, with the reason a person needs. */
export function authorityProblem(authority: string): string | null {
  if (!isProtectedAuthority(authority)) return null;
  return `Refused: ${PROTECTED_AUTHORITY_LABELS[authority].toLowerCase()} is outside the improvement engine.`;
}

export function requestedAuthorityProblems(authorities: string[]): string[] {
  return authorities.map((authority) => authorityProblem(authority)).filter((value): value is string => Boolean(value));
}

/** The success criteria a candidate is judged by, hashed so they cannot drift. */
export function criteriaHash(input: {
  evaluationPlan: string;
  expectedBenefit: string;
  suiteName: string;
  suiteVersion: string;
}): string {
  return crypto
    .createHash("sha256")
    .update(
      [
        input.suiteName.trim(),
        input.suiteVersion.trim(),
        input.evaluationPlan.trim(),
        input.expectedBenefit.trim(),
      ].join("\u0000"),
    )
    .digest("hex");
}

export type EvaluationNumbers = {
  totalCases: number;
  baselinePassed: number;
  candidatePassed: number;
  securityFindings: number;
  regressions: number;
  baselineCostUnits: number;
  candidateCostUnits: number;
};

export type EvaluationComparison = {
  verdict: Verdict;
  reasons: string[];
  costDeltaRatio: number;
  functionalDelta: number;
};

/**
 * The comparison is arithmetic, not opinion. A candidate is only better when it
 * passes strictly more cases, introduces no security finding, changes no guarded
 * behaviour and stays inside the cost allowance.
 */
export function compareEvaluation(
  numbers: EvaluationNumbers,
  maxCostIncreaseRatio: number = CANDIDATE_LIMITS.maxCostIncreaseRatio,
): EvaluationComparison {
  const reasons: string[] = [];
  const functionalDelta = numbers.candidatePassed - numbers.baselinePassed;
  const baselineCost = Math.max(1, numbers.baselineCostUnits);
  const costDeltaRatio = (numbers.candidateCostUnits - baselineCost) / baselineCost;

  if (numbers.totalCases <= 0 || numbers.baselinePassed > numbers.totalCases) {
    return { verdict: "inconclusive", reasons: ["The run has no usable case count."], costDeltaRatio, functionalDelta };
  }

  if (numbers.candidatePassed < numbers.baselinePassed) {
    reasons.push(`The candidate passes ${numbers.candidatePassed} of ${numbers.totalCases} cases, fewer than the baseline's ${numbers.baselinePassed}.`);
  }
  if (numbers.securityFindings > 0) {
    reasons.push(`The candidate introduces ${numbers.securityFindings} security finding(s).`);
  }
  if (numbers.regressions > 0) {
    reasons.push(`The candidate changes ${numbers.regressions} guarded behaviour(s).`);
  }
  if (costDeltaRatio > maxCostIncreaseRatio) {
    reasons.push(
      `The candidate costs ${(costDeltaRatio * 100).toFixed(0)}% more, above the ${(maxCostIncreaseRatio * 100).toFixed(0)}% allowance.`,
    );
  }

  if (reasons.length > 0) return { verdict: "worse", reasons, costDeltaRatio, functionalDelta };

  if (functionalDelta > 0) {
    reasons.push(`The candidate passes ${functionalDelta} more case(s) than the baseline with no security or regression finding.`);
    return { verdict: "better", reasons, costDeltaRatio, functionalDelta };
  }

  reasons.push("The candidate matches the baseline exactly.");
  return { verdict: "equal", reasons, costDeltaRatio, functionalDelta };
}

export type PromotionReview = {
  status: CandidateStatus;
  verdict: Verdict | null;
  integrity: "verified" | "mismatch" | null;
  securityFindings: number;
  regressions: number;
  costDeltaRatio: number;
  reviewNote: string;
  reviewedBy: string | null;
  authorId: string;
  sandboxRef: string;
  /** The deployment that would ship the change. */
  deploymentApproved: boolean;
  deploymentProjectMatches: boolean;
};

/** What a person still has to supply before a candidate may be promoted. */
export function promotionProblems(review: PromotionReview): string[] {
  const problems: string[] = [];

  if (review.status !== "approved") problems.push("Only an approved candidate can be promoted.");
  if (review.verdict !== "better" && review.verdict !== "equal") {
    problems.push("The evaluation is not better than or equal to the baseline.");
  }
  if (review.integrity !== "verified") problems.push("The evaluation suite did not match the frozen suite.");
  if (review.securityFindings > 0) problems.push("Security findings must be resolved before promotion.");
  if (review.regressions > 0) problems.push("Guarded behaviour changed; that needs its own review.");
  if (review.costDeltaRatio > CANDIDATE_LIMITS.maxCostIncreaseRatio) {
    problems.push("The cost increase is above the allowance.");
  }
  if (review.reviewNote.trim().length < 20) {
    problems.push("Record the review decision: the exact change, the results, the risks and the rollback.");
  }
  if (!review.reviewedBy) problems.push("A named person has to approve the promotion.");
  if (review.reviewedBy && review.reviewedBy === review.authorId) {
    problems.push("The author cannot approve their own candidate.");
  }
  if (!review.sandboxRef.trim()) problems.push("The promotion needs the sandbox or branch it came from.");
  if (!review.deploymentApproved) {
    problems.push("Name a deployment that has already been approved; promotion rides on its approval.");
  }
  if (!review.deploymentProjectMatches) {
    problems.push("The deployment has to belong to the same project as the candidate.");
  }
  return problems;
}

/** The review card a person reads before deciding. */
export function reviewSummary(input: {
  kind: CandidateKind;
  title: string;
  verdict: Verdict | null;
  comparison: EvaluationComparison | null;
  securityFindings: number;
  regressions: number;
  costDeltaRatio: number;
  sandboxRef: string;
  rollbackPlan: string;
}): string[] {
  const lines = [
    `${CANDIDATE_KIND_LABELS[input.kind]}: ${input.title}`,
    `Result: ${input.verdict ? VERDICT_LABELS[input.verdict] : "not evaluated yet"}.`,
    `Security findings: ${input.securityFindings}. Guarded behaviours changed: ${input.regressions}.`,
    `Cost change: ${(input.costDeltaRatio * 100).toFixed(0)}%.`,
    `Ran in: ${input.sandboxRef}.`,
    "Promotion ships through the deployment approval for the same project.",
    `Rollback: ${input.rollbackPlan}`,
  ];
  if (input.comparison) lines.push(...input.comparison.reasons);
  return lines;
}
