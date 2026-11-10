/**
 * Phase 36 — MAGI outcome orchestration, as pure rules.
 *
 * MAGI here means Manifested Artificial Generative Intelligence: turning an
 * approved intent into artifacts and evidenced outcomes. It is a product term.
 * It is not a claim of AGI, superintelligence, consciousness or a singularity,
 * and no output of this layer is treated as one.
 *
 * Ground rules encoded here:
 *   * Orchestration links existing records by id. It never copies a mission,
 *     experiment, learning goal or opportunity into a competing store.
 *   * A contract is versioned and immutable once approved. Approval is bound to
 *     one version and one fingerprint; a material change needs new approval.
 *   * A task graph is bounded by the approved contract: no task may add scope,
 *     a recipient, a data source, a tool, a target or spending on its own.
 *   * Deliverables are distinguished from outcomes that need observation and
 *     from external effects nobody can guarantee.
 *   * An agent's own report never marks work verified, and agent consensus is
 *     not independent verification.
 *   * A mission is never completed because an agent says it is finished. A
 *     human records the outcome decision.
 *   * Money is accounted in integer micro-credits (1 000 000 = 1 credit =
 *     $0.10). Nothing rounds every internal action up to a whole credit.
 *   * Retrieved documents, pages and tool output are data, never authority.
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import { CREDIT_VALUE_CENTS } from "@/lib/credits/pricing";
import type { WorkspaceRole } from "@/lib/types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const KEY_PATTERN = /^[a-z][a-z0-9_-]{1,39}$/;

export const NO_AGI_CLAIM =
  "MAGI is the product name for manifested, evidenced outcomes. This layer does not establish or claim AGI, superintelligence, consciousness or a technological singularity.";

export const ORCHESTRATION_LIMITS = {
  minTasks: 1,
  maxTasks: 12,
  maxRetryLimit: 3,
  minCredits: 1,
  maxCredits: 200,
  minTimeMinutes: 15,
  maxTimeMinutes: 10080,
  maxTextChars: 2000,
} as const;

// ---------------------------------------------------------------------------
// 1. Lifecycle
// ---------------------------------------------------------------------------

export const ORCHESTRATION_STATUSES = [
  "draft",
  "awaiting_approval",
  "ready",
  "running",
  "paused",
  "awaiting_input",
  "awaiting_action_approval",
  "verifying",
  "awaiting_review",
  "completed",
  "needs_revision",
  "stopped",
  "failed",
  "cancellation_requested",
] as const;
export type OrchestrationStatus = (typeof ORCHESTRATION_STATUSES)[number];

/** Every allowed move. Anything absent from this table is refused server-side. */
export const TRANSITIONS: Record<OrchestrationStatus, OrchestrationStatus[]> = {
  draft: ["awaiting_approval", "stopped"],
  awaiting_approval: ["draft", "ready", "stopped"],
  ready: ["running", "awaiting_approval", "stopped"],
  running: [
    "paused",
    "awaiting_input",
    "awaiting_action_approval",
    "verifying",
    "failed",
    "cancellation_requested",
  ],
  paused: ["running", "cancellation_requested", "stopped"],
  awaiting_input: ["running", "cancellation_requested", "stopped"],
  awaiting_action_approval: ["running", "cancellation_requested", "stopped"],
  cancellation_requested: ["stopped", "failed"],
  verifying: ["running", "awaiting_review", "failed", "stopped"],
  awaiting_review: ["completed", "needs_revision", "stopped"],
  needs_revision: ["awaiting_approval", "stopped"],
  completed: [],
  stopped: [],
  failed: ["needs_revision", "stopped"],
};

export const TERMINAL_ORCHESTRATION_STATUSES: OrchestrationStatus[] = [
  "completed",
  "stopped",
];

export const ORCHESTRATION_STATUS_LABELS: Record<OrchestrationStatus, string> = {
  draft: "Draft",
  awaiting_approval: "Awaiting approval",
  ready: "Ready",
  running: "Running",
  paused: "Paused",
  awaiting_input: "Awaiting input",
  awaiting_action_approval: "Awaiting action approval",
  verifying: "Verifying",
  awaiting_review: "Awaiting human review",
  completed: "Completed",
  needs_revision: "Needs revision",
  stopped: "Stopped",
  failed: "Failed",
  cancellation_requested: "Cancellation requested",
};

export const TASK_STATUSES = [
  "pending",
  "ready",
  "running",
  "awaiting_approval",
  "produced",
  "verified",
  "failed",
  "cancelled",
  "skipped",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: "Planned",
  ready: "Ready",
  running: "In progress",
  awaiting_approval: "Awaiting action approval",
  produced: "Produced, unverified",
  verified: "Verified",
  failed: "Failed",
  cancelled: "Cancelled",
  skipped: "Skipped",
};

/** A dependency is satisfied only by verified work, never by a claim. */
export const VERIFIED_DEPENDENCY_STATUSES: TaskStatus[] = ["verified"];

export function isOrchestrationStatus(
  value: string,
): value is OrchestrationStatus {
  return (ORCHESTRATION_STATUSES as readonly string[]).includes(value);
}

export function canTransition(
  from: OrchestrationStatus,
  to: OrchestrationStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

export type TransitionContext = {
  from: OrchestrationStatus;
  to: OrchestrationStatus;
  role: WorkspaceRole | null | undefined;
  contractApproved: boolean;
  approvedVersionMatches: boolean;
  tasksComplete: boolean;
  criteriaVerified: boolean;
  reviewAccepted: boolean;
  stopCondition: boolean;
  cancellationRequested: boolean;
};

export type RuleProblem = {
  ok: boolean;
  code?: string;
  message: string;
};

const OK: RuleProblem = { ok: true, message: "" };

/**
 * The single place that decides whether a lifecycle move is allowed. The
 * database repeats these checks in `orchestration_transition`, so a direct API
 * call cannot skip them.
 */
export function transitionProblem(ctx: TransitionContext): RuleProblem {
  if (!canTransition(ctx.from, ctx.to)) {
    return {
      ok: false,
      code: "invalid-transition",
      message: `${ORCHESTRATION_STATUS_LABELS[ctx.from]} cannot move directly to ${ORCHESTRATION_STATUS_LABELS[ctx.to]}. Nothing was changed.`,
    };
  }

  if (ctx.to === "ready") {
    if (ctx.role !== "owner" && ctx.role !== "admin") {
      return {
        ok: false,
        code: "forbidden",
        message:
          "Only an owner or admin can approve this contract. Nothing was changed.",
      };
    }
    if (!ctx.contractApproved) {
      return {
        ok: false,
        code: "contract-not-approved",
        message:
          "This contract version has no recorded approval. Approve the exact version before it can run.",
      };
    }
    if (!ctx.approvedVersionMatches) {
      return {
        ok: false,
        code: "contract-stale",
        message:
          "The approved version does not match the current contract. Approve the current version; an earlier approval does not cover a material change.",
      };
    }
  }

  if (ctx.to === "running" && ctx.stopCondition) {
    return {
      ok: false,
      code: "stop-condition",
      message:
        "A stop condition is recorded as reached. Resolve it and record the decision before running more work.",
    };
  }

  if (ctx.to === "awaiting_review") {
    if (!ctx.tasksComplete) {
      return {
        ok: false,
        code: "tasks-incomplete",
        message:
          "At least one task is unfinished, failed or cancelled. Resolve it, or stop the orchestration instead of presenting it as reviewable.",
      };
    }
    if (!ctx.criteriaVerified) {
      return {
        ok: false,
        code: "verification-incomplete",
        message:
          "Not every acceptance criterion has passing evidence. Unverified work stays unverified; it is not reviewable as a produced outcome.",
      };
    }
  }

  if (ctx.to === "completed") {
    if (!ctx.reviewAccepted) {
      return {
        ok: false,
        code: "review-missing",
        message:
          "A person has not recorded an outcome decision yet. An agent cannot complete this orchestration.",
      };
    }
  }

  if (
    ctx.to === "stopped" &&
    ctx.from === "cancellation_requested" &&
    !ctx.cancellationRequested
  ) {
    return {
      ok: false,
      code: "invalid-transition",
      message:
        "Cancellation was not requested. Record the request before stopping.",
    };
  }

  return OK;
}

// ---------------------------------------------------------------------------
// 2. Origins and capabilities (existing modules, referenced by id)
// ---------------------------------------------------------------------------

export const ORCHESTRATION_ORIGINS = [
  "mission",
  "experiment",
  "learning_goal",
  "radar_signal",
  "future_path",
  "outcome_review",
  "new_goal",
] as const;
export type OrchestrationOrigin = (typeof ORCHESTRATION_ORIGINS)[number];

export const ORIGIN_LABELS: Record<OrchestrationOrigin, string> = {
  mission: "Mission",
  experiment: "Experiment",
  learning_goal: "Learning goal",
  radar_signal: "Opportunity radar signal",
  future_path: "Scenario",
  outcome_review: "Previous outcome review",
  new_goal: "New goal",
};

export const ORIGIN_TABLE: Record<
  Exclude<OrchestrationOrigin, "new_goal">,
  { table: string; column: string }
> = {
  mission: { table: "missions", column: "mission_id" },
  experiment: { table: "experiments", column: "experiment_id" },
  learning_goal: { table: "goals", column: "learning_goal_id" },
  radar_signal: { table: "radar_signals", column: "radar_signal_id" },
  future_path: { table: "future_paths", column: "future_path_id" },
  outcome_review: { table: "outcome_reviews", column: "outcome_review_id" },
};

/** A new goal becomes an existing-style mission, never a parallel goal table. */
export function needsMissionPromotion(origin: OrchestrationOrigin): boolean {
  return origin === "new_goal";
}

export const CAPABILITIES = [
  "scenario_planning",
  "opportunity_radar",
  "learning_goal",
  "app_builder",
  "mission_workspace",
  "experiment_workspace",
  "outcome_review",
  "research",
  "verification",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const CAPABILITY_LABELS: Record<Capability, string> = {
  scenario_planning: "Scenario planning",
  opportunity_radar: "Opportunity radar",
  learning_goal: "Learning goal",
  app_builder: "App builder",
  mission_workspace: "Mission workspace",
  experiment_workspace: "Experiment workspace",
  outcome_review: "Outcome review",
  research: "Research",
  verification: "Verification",
};

export const ALLOWED_TOOLS = [
  "workspace_read",
  "workspace_write",
  "app_builder_generate",
  "sandbox_run_tests",
  "preview_capture",
  "research_search",
] as const;
export type AllowedTool = (typeof ALLOWED_TOOLS)[number];

export const EXECUTION_ENVIRONMENTS = ["sandbox", "preview"] as const;
export type ExecutionEnvironment = (typeof EXECUTION_ENVIRONMENTS)[number];

export const EXTERNAL_ACTION_KINDS = [
  "outreach",
  "publication",
  "paid_activity",
  "deployment",
] as const;
export type ExternalActionKind = (typeof EXTERNAL_ACTION_KINDS)[number];

export const EXTERNAL_ACTION_LABELS: Record<ExternalActionKind, string> = {
  outreach: "Contacting real people",
  publication: "Publishing outside the workspace",
  paid_activity: "Spending money",
  deployment: "Deploying to production",
};

// ---------------------------------------------------------------------------
// 3. The outcome contract
// ---------------------------------------------------------------------------

export const DELIVERABLE_KINDS = [
  "deliverable",
  "observation",
  "external_effect",
] as const;
export type DeliverableKind = (typeof DELIVERABLE_KINDS)[number];

export const DELIVERABLE_KIND_LABELS: Record<DeliverableKind, string> = {
  deliverable: "Deliverable the system can produce",
  observation: "Outcome that requires observation",
  external_effect: "External effect that cannot be guaranteed",
};

export const DELIVERABLE_KIND_NOTES: Record<DeliverableKind, string> = {
  deliverable:
    "Something this layer can actually produce and point at: a prototype, a document, a passing test run.",
  observation:
    "Needs evidence gathered from real people or real use. Without recorded evidence it stays unknown.",
  external_effect:
    "Depends on other people, other systems or the world. Approval can permit an attempt, never guarantee the effect.",
};

export const CONTRACT_KIND_NOTE =
  "Deploying an approved prototype is a deliverable. 'People find it useful' is an observation. 'Improve community wellbeing' is not established by shipping anything.";

export const VERIFICATION_METHODS = [
  "automated_test",
  "direct_observation",
  "human_review",
  "document_review",
] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

export const VERIFICATION_METHOD_LABELS: Record<VerificationMethod, string> = {
  automated_test: "Automated test",
  direct_observation: "Direct observation",
  human_review: "Human review",
  document_review: "Document review",
};

/** What counts as acceptable proof for each verification method. */
export const VERIFIER_FOR_METHOD: Record<VerificationMethod, EvidenceKind[]> = {
  automated_test: ["automated_test"],
  direct_observation: ["direct_observation"],
  human_review: ["human_judgment"],
  document_review: ["direct_observation", "human_judgment"],
};

export const EVIDENCE_KINDS = [
  "ai_proposal",
  "participant_opinion",
  "direct_observation",
  "automated_test",
  "human_judgment",
  "unverified_claim",
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const EVIDENCE_KIND_LABELS: Record<EvidenceKind, string> = {
  ai_proposal: "AI-generated proposal",
  participant_opinion: "Participant opinion",
  direct_observation: "Direct observation",
  automated_test: "Automated test result",
  human_judgment: "Human judgment",
  unverified_claim: "Unverified claim",
};

/** A kind that can never verify an acceptance criterion on its own. */
export const NON_VERIFYING_EVIDENCE: EvidenceKind[] = [
  "ai_proposal",
  "participant_opinion",
  "unverified_claim",
];

export const VERIFICATION_NOTE =
  "An agent's report of its own success is not verification. Agent agreement is not independent verification, and a proposal is not evidence that anything happened.";

export type AcceptanceCriterion = {
  key: string;
  criterion: string;
  verification: VerificationMethod;
};

export type ContractDeliverable = {
  key: string;
  statement: string;
  kind: DeliverableKind;
};

export type ContractContent = {
  goal: string;
  origin_kind: OrchestrationOrigin;
  origin_id: string | null;
  stakeholders: string;
  scope: string;
  exclusions: string[];
  evidence_available: string;
  assumptions: string;
  unresolved_questions: string;
  deliverables: ContractDeliverable[];
  acceptance_criteria: AcceptanceCriterion[];
  allowed_tools: AllowedTool[];
  execution_environments: ExecutionEnvironment[];
  required_human_decisions: string[];
  max_credits: number;
  time_limit_minutes: number;
  resource_limits: string;
  privacy_constraints: string;
  consent_constraints: string;
  stop_conditions: string;
  review_at: string;
};

const KEY_MESSAGE = "Use a short lowercase key (a–z, 0–9, - or _).";

export function slugKey(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  return KEY_PATTERN.test(slug) ? slug : `item-${slug.slice(0, 30)}`;
}

/** `Criterion text :: automated_test` — the method is required. */
export function parseCriterionLine(line: string): AcceptanceCriterion | null {
  const [criterion, method] = line.split("::").map((part) => part.trim());
  if (!criterion || criterion.length < 5) return null;
  if (!method || !(VERIFICATION_METHODS as readonly string[]).includes(method)) {
    return null;
  }
  return {
    key: slugKey(criterion),
    criterion: criterion.slice(0, 500),
    verification: method as VerificationMethod,
  };
}

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export const contractContentSchema = z.object({
  goal: z.string().trim().min(8, "Describe the goal in at least 8 characters.").max(1000),
  origin_kind: z.enum(ORCHESTRATION_ORIGINS),
  origin_id: z.union([z.string().trim().regex(UUID_PATTERN), z.null()]),
  stakeholders: z.string().trim().min(5, "Name who is affected.").max(2000),
  scope: z.string().trim().min(10, "Say what is in scope.").max(2000),
  exclusions: z.array(z.string().trim().min(3).max(300)).min(1).max(12),
  evidence_available: z.string().trim().max(4000),
  assumptions: z.string().trim().max(4000),
  unresolved_questions: z.string().trim().max(4000),
  deliverables: z
    .array(
      z.object({
        key: z.string().trim().regex(KEY_PATTERN, KEY_MESSAGE),
        statement: z.string().trim().min(5).max(500),
        kind: z.enum(DELIVERABLE_KINDS),
      }),
    )
    .min(1)
    .max(12),
  acceptance_criteria: z
    .array(
      z.object({
        key: z.string().trim().regex(KEY_PATTERN, KEY_MESSAGE),
        criterion: z.string().trim().min(5).max(500),
        verification: z.enum(VERIFICATION_METHODS),
      }),
    )
    .min(1)
    .max(12),
  allowed_tools: z.array(z.enum(ALLOWED_TOOLS)).min(1),
  execution_environments: z.array(z.enum(EXECUTION_ENVIRONMENTS)).min(1),
  required_human_decisions: z.array(z.string().trim().min(3).max(300)),
  max_credits: z
    .number()
    .int()
    .min(ORCHESTRATION_LIMITS.minCredits, "Authorize at least one credit.")
    .max(ORCHESTRATION_LIMITS.maxCredits, "Keep the authorized maximum at 200 credits or fewer."),
  time_limit_minutes: z
    .number()
    .int()
    .min(ORCHESTRATION_LIMITS.minTimeMinutes, "Allow at least 15 minutes.")
    .max(ORCHESTRATION_LIMITS.maxTimeMinutes, "Keep the time limit to seven days or less."),
  resource_limits: z.string().trim().max(1000),
  privacy_constraints: z.string().trim().min(5, "Record the privacy constraints.").max(2000),
  consent_constraints: z.string().trim().min(5, "Record the consent constraints.").max(2000),
  stop_conditions: z.string().trim().min(5, "Record the stop conditions.").max(2000),
  review_at: z.string().trim().regex(DATE_PATTERN, "Choose a review date."),
});

export type ContractContentInput = z.infer<typeof contractContentSchema>;

/** The form the person fills in. Lists are one entry per line. */
export const contractFormSchema = z.object({
  goal: z.string().trim().min(8, "Describe the goal in at least 8 characters.").max(1000),
  origin_kind: z.enum(ORCHESTRATION_ORIGINS),
  origin_id: z.union([z.string().trim().regex(UUID_PATTERN), z.literal("")]).default(""),
  stakeholders: z.string().trim().min(5, "Name who is affected.").max(2000),
  scope: z.string().trim().min(10, "Say what is in scope.").max(2000),
  exclusions: z.string().trim().min(3, "Name at least one exclusion.").max(4000),
  evidence_available: z.string().trim().max(4000).default(""),
  assumptions: z.string().trim().max(4000).default(""),
  unresolved_questions: z.string().trim().max(4000).default(""),
  deliverable_lines: z
    .string()
    .trim()
    .min(5, "Name at least one intended deliverable.")
    .max(4000),
  observation_lines: z.string().trim().max(4000).default(""),
  external_effect_lines: z.string().trim().max(4000).default(""),
  criteria_lines: z
    .string()
    .trim()
    .min(5, "Write at least one acceptance criterion with a verification method.")
    .max(4000),
  allowed_tools: z.array(z.string().trim()).min(1, "Choose at least one allowed tool."),
  execution_environments: z
    .array(z.string().trim())
    .min(1, "Choose at least one execution environment."),
  required_human_decisions: z.string().trim().max(2000).default(""),
  max_credits: z.coerce
    .number()
    .int("Use whole credits.")
    .min(ORCHESTRATION_LIMITS.minCredits, "Authorize at least one credit.")
    .max(ORCHESTRATION_LIMITS.maxCredits, "Keep the authorized maximum at 200 credits or fewer."),
  time_limit_minutes: z.coerce
    .number()
    .int("Use whole minutes.")
    .min(ORCHESTRATION_LIMITS.minTimeMinutes, "Allow at least 15 minutes.")
    .max(ORCHESTRATION_LIMITS.maxTimeMinutes, "Keep the time limit to seven days or less."),
  resource_limits: z.string().trim().max(1000).default(""),
  privacy_constraints: z.string().trim().min(5, "Record the privacy constraints.").max(2000),
  consent_constraints: z.string().trim().min(5, "Record the consent constraints.").max(2000),
  stop_conditions: z.string().trim().min(5, "Record the stop conditions.").max(2000),
  review_at: z.string().trim().regex(DATE_PATTERN, "Choose a review date."),
});

export type ContractFormInput = z.infer<typeof contractFormSchema>;

export type ContractParseResult =
  | { ok: true; content: ContractContent }
  | { ok: false; message: string };

/**
 * Turns the form into a canonical contract. Deliverables are split into the
 * three classes so a promise to "improve wellbeing" cannot be entered as though
 * it were a build artifact.
 */
export function parseContractForm(input: ContractFormInput): ContractParseResult {
  const tools = input.allowed_tools.filter((tool): tool is AllowedTool =>
    (ALLOWED_TOOLS as readonly string[]).includes(tool),
  );
  if (tools.length !== input.allowed_tools.length) {
    return {
      ok: false,
      message: "One of the selected tools is not available in this layer.",
    };
  }
  const environments = input.execution_environments.filter(
    (environment): environment is ExecutionEnvironment =>
      (EXECUTION_ENVIRONMENTS as readonly string[]).includes(environment),
  );
  if (environments.length !== input.execution_environments.length) {
    return {
      ok: false,
      message: "One of the selected execution environments is not available.",
    };
  }

  const criteria: AcceptanceCriterion[] = [];
  for (const line of lines(input.criteria_lines)) {
    const parsed = parseCriterionLine(line);
    if (!parsed) {
      return {
        ok: false,
        message: `Each acceptance criterion needs text and a method, like: A visitor can finish the form :: automated_test. Problem line: ${line.slice(0, 80)}`,
      };
    }
    if (criteria.some((entry) => entry.key === parsed.key)) {
      return {
        ok: false,
        message: `Two acceptance criteria share the key ${parsed.key}. Make them distinct.`,
      };
    }
    criteria.push(parsed);
  }

  const deliverableLines = lines(input.deliverable_lines);
  const observationLines = lines(input.observation_lines);
  const externalLines = lines(input.external_effect_lines);

  const deliverables: ContractDeliverable[] = [
    ...deliverableLines.map((line) => ({
      key: slugKey(line),
      statement: line.slice(0, 500),
      kind: "deliverable" as DeliverableKind,
    })),
    ...observationLines.map((line) => ({
      key: slugKey(line),
      statement: line.slice(0, 500),
      kind: "observation" as DeliverableKind,
    })),
    ...externalLines.map((line) => ({
      key: slugKey(line),
      statement: line.slice(0, 500),
      kind: "external_effect" as DeliverableKind,
    })),
  ];
  const keys = new Set<string>();
  for (const deliverable of deliverables) {
    if (keys.has(deliverable.key)) {
      return {
        ok: false,
        message: `Two deliverables share the key ${deliverable.key}. Make them distinct.`,
      };
    }
    keys.add(deliverable.key);
  }

  const candidate: ContractContent = {
    goal: input.goal,
    origin_kind: input.origin_kind,
    origin_id: input.origin_id === "" ? null : input.origin_id,
    stakeholders: input.stakeholders,
    scope: input.scope,
    exclusions: lines(input.exclusions).map((line) => line.slice(0, 300)),
    evidence_available: input.evidence_available,
    assumptions: input.assumptions,
    unresolved_questions: input.unresolved_questions,
    deliverables,
    acceptance_criteria: criteria,
    allowed_tools: tools,
    execution_environments: environments,
    required_human_decisions: lines(input.required_human_decisions).map((line) =>
      line.slice(0, 300),
    ),
    max_credits: input.max_credits,
    time_limit_minutes: input.time_limit_minutes,
    resource_limits: input.resource_limits,
    privacy_constraints: input.privacy_constraints,
    consent_constraints: input.consent_constraints,
    stop_conditions: input.stop_conditions,
    review_at: input.review_at,
  };

  const parsed = contractContentSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "That contract is incomplete.",
    };
  }

  if (needsMissionPromotion(candidate.origin_kind) && candidate.origin_id !== null) {
    return {
      ok: false,
      message:
        "A new goal becomes an existing-style mission. Do not attach a record id to a new goal.",
    };
  }
  if (!needsMissionPromotion(candidate.origin_kind) && candidate.origin_id === null) {
    return {
      ok: false,
      message: "Choose the existing record this orchestration starts from.",
    };
  }

  return { ok: true, content: parsed.data };
}

/** Stable JSON so the same contract always yields the same fingerprint. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function contractFingerprint(content: ContractContent): string {
  return createHash("sha256").update(canonicalJson(content)).digest("hex");
}

export const CONTRACT_APPROVAL_NOTE =
  "Approval is bound to this exact version and fingerprint. Any material change creates a new version that needs its own approval, and contract approval never replaces the separate approval each external action needs.";

export type MaterialChangeCode =
  | "spending_increase"
  | "scope_expanded"
  | "new_recipients"
  | "new_data_access"
  | "consent_changed"
  | "new_deployment_targets"
  | "external_effects_added"
  | "time_increase"
  | "criteria_changed"
  | "tools_changed";

export const MATERIAL_CHANGE_LABELS: Record<MaterialChangeCode, string> = {
  spending_increase: "The authorized maximum was increased.",
  scope_expanded: "The scope was expanded.",
  new_recipients: "New stakeholders or recipients were added.",
  new_data_access: "New data access or privacy terms were introduced.",
  consent_changed: "The consent requirements changed.",
  new_deployment_targets: "A new execution or deployment target was added.",
  external_effects_added: "A new external effect was added.",
  time_increase: "More time was authorized.",
  criteria_changed: "The acceptance criteria changed.",
  tools_changed: "The allowed tools changed.",
};

/**
 * Compares two contract versions. Everything that widens authority or changes
 * what counts as success is material; cosmetic re-wording of the goal is not.
 */
export function materialChanges(
  previous: ContractContent,
  next: ContractContent,
): MaterialChangeCode[] {
  const changes: MaterialChangeCode[] = [];
  if (next.max_credits > previous.max_credits) changes.push("spending_increase");
  if (next.scope.trim() !== previous.scope.trim()) changes.push("scope_expanded");
  if (next.stakeholders.trim() !== previous.stakeholders.trim()) changes.push("new_recipients");
  if (
    next.privacy_constraints.trim() !== previous.privacy_constraints.trim() ||
    next.evidence_available.trim() !== previous.evidence_available.trim()
  ) {
    changes.push("new_data_access");
  }
  if (next.consent_constraints.trim() !== previous.consent_constraints.trim()) {
    changes.push("consent_changed");
  }
  const previousTargets = new Set(previous.execution_environments);
  if (next.execution_environments.some((target) => !previousTargets.has(target))) {
    changes.push("new_deployment_targets");
  }
  const previousEffects = new Set(
    previous.deliverables
      .filter((entry) => entry.kind === "external_effect")
      .map((entry) => entry.key),
  );
  if (
    next.deliverables.some(
      (entry) => entry.kind === "external_effect" && !previousEffects.has(entry.key),
    )
  ) {
    changes.push("external_effects_added");
  }
  if (next.time_limit_minutes > previous.time_limit_minutes) changes.push("time_increase");
  if (
    canonicalJson(next.acceptance_criteria) !== canonicalJson(previous.acceptance_criteria)
  ) {
    changes.push("criteria_changed");
  }
  const previousTools = new Set(previous.allowed_tools);
  if (next.allowed_tools.some((tool) => !previousTools.has(tool))) changes.push("tools_changed");
  return changes;
}

export type ContractApproval = {
  version: number;
  fingerprint: string;
  status: "draft" | "approved" | "superseded" | "rejected";
  approved_by: string | null;
  approved_at: string | null;
};

export type ContractVersion = {
  id: string;
  version: number;
  fingerprint: string;
  status: "draft" | "approved" | "superseded" | "rejected";
  content: ContractContent;
};

/**
 * Approval covers exactly one version and one fingerprint. A stale approval is
 * refused rather than being treated as permission for the new text.
 */
export function approvalCoversContract({
  contract,
  approval,
}: {
  contract: ContractVersion;
  approval: ContractApproval | null;
}): RuleProblem {
  if (!approval) {
    return {
      ok: false,
      code: "contract-not-approved",
      message: "This contract version has not been approved.",
    };
  }
  if (approval.status !== "approved" || !approval.approved_by || !approval.approved_at) {
    return {
      ok: false,
      code: "contract-not-approved",
      message: "This contract version has no recorded human approval.",
    };
  }
  if (approval.version !== contract.version) {
    return {
      ok: false,
      code: "contract-stale",
      message: `Version ${approval.version} was approved, but the current contract is version ${contract.version}. Approve the current version.`,
    };
  }
  if (approval.fingerprint !== contract.fingerprint) {
    return {
      ok: false,
      code: "contract-stale",
      message:
        "The contract text changed after approval. Approve the exact version that will run.",
    };
  }
  return OK;
}

export function isContractApproved(
  versions: ContractVersion[],
  contractId: string,
): boolean {
  const target = versions.find((version) => version.id === contractId);
  if (!target) return false;
  return (
    target.status === "approved" &&
    versions.some(
      (version) =>
        version.status === "approved" &&
        version.version === target.version &&
        version.fingerprint === target.fingerprint,
    )
  );
}

/** A new contract version inherits nothing from the approval of an older one. */
export function nextVersion(versions: Pick<ContractVersion, "version">[]): number {
  return versions.length === 0
    ? 1
    : Math.max(...versions.map((version) => version.version)) + 1;
}

// ---------------------------------------------------------------------------
// 4. Budget (integer micro-credits, 1 credit = $0.10)
// ---------------------------------------------------------------------------

export const MICROS_PER_CREDIT = 1_000_000;

export function creditsToMicros(credits: number): number {
  return Math.round(credits * MICROS_PER_CREDIT);
}

export function microsToCredits(micros: number): number {
  return micros / MICROS_PER_CREDIT;
}

/** Retail cents for a micro-credit amount, truncated like the credits UI. */
export function microsToCents(micros: number): number {
  return Math.trunc((micros * CREDIT_VALUE_CENTS) / MICROS_PER_CREDIT);
}

export function formatMicrosUsd(micros: number): string {
  const cents = microsToCents(micros);
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatCredits(micros: number): string {
  const credits = microsToCredits(micros);
  return Number.isInteger(credits)
    ? `${credits} credit${credits === 1 ? "" : "s"}`
    : `${credits.toFixed(3)} credits`;
}

export type BudgetSnapshot = {
  authorized: number;
  reserved: number;
  consumed: number;
  remaining: number;
  available: number;
  overCommitted: boolean;
};

export function budgetSnapshot(input: {
  authorizedMicros: number;
  reservedMicros: number;
  consumedMicros: number;
}): BudgetSnapshot {
  const authorized = Math.max(0, Math.trunc(input.authorizedMicros));
  const reserved = Math.max(0, Math.trunc(input.reservedMicros));
  const consumed = Math.max(0, Math.trunc(input.consumedMicros));
  const remaining = authorized - consumed;
  return {
    authorized,
    reserved,
    consumed,
    remaining,
    available: remaining - reserved,
    overCommitted: consumed + reserved > authorized,
  };
}

export function reservationProblem({
  snapshot,
  amountMicros,
}: {
  snapshot: BudgetSnapshot;
  amountMicros: number;
}): RuleProblem {
  if (amountMicros <= 0) {
    return {
      ok: false,
      code: "invalid-amount",
      message: "A reservation needs a positive amount.",
    };
  }
  if (snapshot.overCommitted) {
    return {
      ok: false,
      code: "over-committed",
      message:
        "Reserved plus consumed work already exceeds the authorized maximum. Resolve it before reserving more.",
    };
  }
  if (amountMicros > snapshot.available) {
    return {
      ok: false,
      code: "budget-exhausted",
      message: `Only ${formatCredits(Math.max(snapshot.available, 0))} remain available of the authorized ${formatCredits(snapshot.authorized)}. Stop, or approve a new contract version with a higher maximum.`,
    };
  }
  return OK;
}

/**
 * Settles one task's reservation. Failure releases the unused part; success
 * consumes the actual cost. It never invents a charge for work that failed.
 */
export function settleReservation({
  reservedMicros,
  actualMicros,
  succeeded,
}: {
  reservedMicros: number;
  actualMicros: number;
  succeeded: boolean;
}): { consumedMicros: number; releasedMicros: number } {
  const reserved = Math.max(0, Math.trunc(reservedMicros));
  if (!succeeded) return { consumedMicros: 0, releasedMicros: reserved };
  const consumed = Math.min(reserved, Math.max(0, Math.trunc(actualMicros)));
  return { consumedMicros: consumed, releasedMicros: reserved - consumed };
}

export function planCost(tasks: Pick<OrchestrationTaskInput, "credits_micros">[]): number {
  return tasks.reduce((total, task) => total + Math.max(0, task.credits_micros), 0);
}

export const BUDGET_NOTE =
  "One credit is $0.10 retail. Reservations are atomic and locked per orchestration, so two tasks running at once cannot spend past the authorized maximum. Failure releases the unused reservation.";

// ---------------------------------------------------------------------------
// 5. Task graph
// ---------------------------------------------------------------------------

export type OrchestrationTaskInput = {
  task_key: string;
  title: string;
  purpose: string;
  capability: Capability;
  depends_on: string[];
  covers: string[];
  input_refs: string;
  expected_output: string;
  verification_method: VerificationMethod;
  credits_micros: number;
  permissions: string[];
  retry_limit: number;
  external_action_kind: ExternalActionKind | null;
};

export type PlanProblem = {
  ok: boolean;
  code?: string;
  message: string;
};

export type PlanCheck = {
  ok: boolean;
  problems: PlanProblem[];
  costMicros: number;
};

function hasCycle(tasks: OrchestrationTaskInput[]): boolean {
  const byKey = new Map(tasks.map((task) => [task.task_key, task]));
  const state = new Map<string, "visiting" | "done">();

  const visit = (key: string): boolean => {
    const current = state.get(key);
    if (current === "done") return false;
    if (current === "visiting") return true;
    state.set(key, "visiting");
    const task = byKey.get(key);
    for (const dependency of task?.depends_on ?? []) {
      if (byKey.has(dependency) && visit(dependency)) return true;
    }
    state.set(key, "done");
    return false;
  };

  return tasks.some((task) => visit(task.task_key));
}

/**
 * Validates a bounded plan against its approved contract. It refuses scope that
 * is not in the contract, tools that were not allowed, spending past the
 * maximum, missing verification, and dependency cycles.
 */
export function planProblems({
  contract,
  tasks,
  excludedTools = [],
}: {
  contract: ContractContent;
  tasks: OrchestrationTaskInput[];
  excludedTools?: string[];
}): PlanCheck {
  const problems: PlanProblem[] = [];
  const fail = (code: string, message: string) =>
    problems.push({ ok: false, code, message });

  if (tasks.length < ORCHESTRATION_LIMITS.minTasks) {
    fail("empty-plan", "Add at least one task.");
  }
  if (tasks.length > ORCHESTRATION_LIMITS.maxTasks) {
    fail(
      "plan-too-large",
      `A plan holds at most ${ORCHESTRATION_LIMITS.maxTasks} tasks. Split the work into separate contracts instead of one unbounded run.`,
    );
  }

  const keys = new Set<string>();
  const criterionKeys = new Set(contract.acceptance_criteria.map((entry) => entry.key));
  const covered = new Set<string>();

  for (const task of tasks) {
    if (!KEY_PATTERN.test(task.task_key)) {
      fail("invalid-key", `Task key "${task.task_key}" is not a valid key.`);
    }
    if (keys.has(task.task_key)) {
      fail("duplicate-key", `Two tasks share the key ${task.task_key}.`);
    }
    keys.add(task.task_key);

    if (task.title.trim().length < 3) {
      fail("missing-title", "Every task needs a short title.");
    }
    if (task.purpose.trim().length < 10) {
      fail(
        "missing-purpose",
        `Task ${task.task_key} needs a purpose that explains why it exists.`,
      );
    }
    if (!(CAPABILITIES as readonly string[]).includes(task.capability)) {
      fail(
        "unknown-capability",
        `Task ${task.task_key} uses a capability this product does not have.`,
      );
    }
    if (task.expected_output.trim().length < 5) {
      fail(
        "missing-output",
        `Task ${task.task_key} needs an expected output you could point at.`,
      );
    }
    if (!(VERIFICATION_METHODS as readonly string[]).includes(task.verification_method)) {
      fail(
        "missing-verification",
        `Task ${task.task_key} needs a verification method. Work with no way to check it is not planned, it is hoped for.`,
      );
    }
    if (task.credits_micros <= 0) {
      fail(
        "missing-cost",
        `Task ${task.task_key} needs a positive credit reservation.`,
      );
    }
    if (
      !Number.isInteger(task.retry_limit) ||
      task.retry_limit < 0 ||
      task.retry_limit > ORCHESTRATION_LIMITS.maxRetryLimit
    ) {
      fail(
        "retry-limit",
        `Task ${task.task_key} has an invalid retry limit. Use 0–${ORCHESTRATION_LIMITS.maxRetryLimit}.`,
      );
    }
    for (const tool of task.permissions) {
      if (!(contract.allowed_tools as readonly string[]).includes(tool)) {
        fail(
          "tool-not-allowed",
          `Task ${task.task_key} asks for the tool "${tool}", which the approved contract does not allow.`,
        );
      }
      if (excludedTools.includes(tool)) {
        fail(
          "tool-unavailable",
          `Task ${task.task_key} asks for "${tool}", which is unavailable in this workspace.`,
        );
      }
    }
    for (const criterion of task.covers) {
      if (!criterionKeys.has(criterion)) {
        fail(
          "unknown-criterion",
          `Task ${task.task_key} claims to cover "${criterion}", which is not an acceptance criterion in this contract.`,
        );
      }
      covered.add(criterion);
    }
    if (task.external_action_kind) {
      if (
        !(EXTERNAL_ACTION_KINDS as readonly string[]).includes(
          task.external_action_kind,
        )
      ) {
        fail(
          "unknown-action",
          `Task ${task.task_key} names an external action this product cannot perform.`,
        );
      }
      if (task.permissions.length === 0) {
        fail(
          "action-without-permission",
          `Task ${task.task_key} performs an external action without naming the permission it uses.`,
        );
      }
    }
    for (const dependency of task.depends_on) {
      if (dependency === task.task_key) {
        fail("self-dependency", `Task ${task.task_key} depends on itself.`);
      } else if (!tasks.some((other) => other.task_key === dependency)) {
        fail(
          "missing-dependency",
          `Task ${task.task_key} depends on "${dependency}", which is not in this plan.`,
        );
      }
    }
  }

  if (hasCycle(tasks)) {
    fail(
      "dependency-cycle",
      "The task graph contains a cycle. A bounded plan has an order that finishes.",
    );
  }

  for (const criterion of criterionKeys) {
    if (!covered.has(criterion)) {
      fail(
        "uncovered-criterion",
        `No task covers the acceptance criterion "${criterion}". Either plan it or remove it from the contract.`,
      );
    }
  }

  const cost = planCost(tasks);
  const authorized = creditsToMicros(contract.max_credits);
  if (cost > authorized) {
    fail(
      "budget-exhausted",
      `The plan reserves ${formatCredits(cost)} but the approved maximum is ${formatCredits(authorized)}. Reduce the plan or approve a new contract version.`,
    );
  }

  return { ok: problems.length === 0, problems, costMicros: cost };
}

export type TaskState = {
  task_key: string;
  depends_on: string[];
  status: TaskStatus;
  attempts: number;
  retry_limit: number;
};

/** Pending tasks whose dependencies are verified, in insertion order. */
export function readyTasks(tasks: TaskState[]): string[] {
  const verified = new Set(
    tasks.filter((task) => task.status === "verified").map((task) => task.task_key),
  );
  return tasks
    .filter(
      (task) =>
        (task.status === "pending" || task.status === "ready") &&
        task.depends_on.every((dependency) => verified.has(dependency)),
    )
    .map((task) => task.task_key);
}

export function taskCanStart({
  task,
  tasks,
}: {
  task: TaskState;
  tasks: TaskState[];
}): RuleProblem {
  const verified = new Set(
    tasks.filter((entry) => entry.status === "verified").map((entry) => entry.task_key),
  );
  const unmet = task.depends_on.filter((dependency) => !verified.has(dependency));
  if (unmet.length > 0) {
    return {
      ok: false,
      code: "dependency-unmet",
      message: `This task is waiting on unverified work: ${unmet.join(", ")}. A dependency is satisfied by a verified result, not by a report.`,
    };
  }
  if (task.status === "awaiting_approval") {
    return {
      ok: false,
      code: "awaiting-approval",
      message: "This task needs its external action approved before it can run.",
    };
  }
  if (task.status !== "pending" && task.status !== "ready") {
    return {
      ok: false,
      code: "not-pending",
      message: `This task is ${TASK_STATUS_LABELS[task.status].toLowerCase()}.`,
    };
  }
  return OK;
}

/** `attempts` counts completed runs, including the first. A retry_limit of 1
 * allows two runs in total, which matches the database check. */
export function canRetry(task: TaskState): boolean {
  return task.attempts <= task.retry_limit;
}

export function retryProblem(task: TaskState): RuleProblem {
  if (canRetry(task)) return OK;
  return {
    ok: false,
    code: "retry-limit",
    message: `This task used its ${task.retry_limit} allowed retr${task.retry_limit === 1 ? "y" : "ies"}. A person has to review it before more work is scheduled.`,
  };
}

export function taskIdempotencyKey(
  orchestrationId: string,
  taskKey: string,
  attempt: number,
): string {
  return createHash("sha256")
    .update(`${orchestrationId}:${taskKey}:${attempt}`)
    .digest("hex")
    .slice(0, 40);
}

// ---------------------------------------------------------------------------
// 6. Evidence and verification
// ---------------------------------------------------------------------------

export type EvidenceRecord = {
  id: string;
  criterion_key: string | null;
  kind: EvidenceKind;
  source_ref: string;
  artifact_version: string;
  method: string;
  result: "pass" | "fail" | "inconclusive";
  limitations: string;
  verifier: string;
  observed_at: string;
};

export const EVIDENCE_INPUT_NOTE =
  "Every piece of evidence records its source, when it was observed, which version it applies to, how it was checked, the result, its limitations, and who or what verified it.";

export function evidenceProblem(evidence: {
  kind: EvidenceKind;
  method: string;
  result: string;
  source_ref: string;
  verifier: string;
}): RuleProblem {
  if (!evidence.source_ref.trim()) {
    return {
      ok: false,
      code: "missing-source",
      message: "Evidence needs a source or artifact reference.",
    };
  }
  if (!evidence.method.trim()) {
    return {
      ok: false,
      code: "missing-method",
      message: "Evidence needs a verification method.",
    };
  }
  if (NON_VERIFYING_EVIDENCE.includes(evidence.kind)) {
    return {
      ok: false,
      code: "non-verifying",
      message: `${EVIDENCE_KIND_LABELS[evidence.kind]} cannot verify an acceptance criterion. Label it for what it is, or record the test, observation or human judgment instead.`,
    };
  }
  if (/consensus/i.test(evidence.verifier)) {
    return {
      ok: false,
      code: "consensus-is-not-verification",
      message:
        "Agent consensus is not independent verification. Record the test, observation or person who checked it.",
    };
  }
  if (!["pass", "fail", "inconclusive"].includes(evidence.result)) {
    return {
      ok: false,
      code: "missing-result",
      message: "Record whether the check passed, failed or was inconclusive.",
    };
  }
  return OK;
}

export type CriterionState = {
  key: string;
  state: "verified" | "failed" | "unverified";
  evidenceIds: string[];
};

export function criterionStates({
  criteria,
  evidence,
}: {
  criteria: AcceptanceCriterion[];
  evidence: EvidenceRecord[];
}): CriterionState[] {
  return criteria.map((criterion) => {
    const relevant = evidence.filter((entry) => entry.criterion_key === criterion.key);
    const passing = relevant.filter(
      (entry) =>
        entry.result === "pass" &&
        !NON_VERIFYING_EVIDENCE.includes(entry.kind) &&
        (VERIFIER_FOR_METHOD[criterion.verification] as string[]).includes(entry.kind),
    );
    if (passing.length > 0) {
      return {
        key: criterion.key,
        state: "verified",
        evidenceIds: passing.map((entry) => entry.id),
      };
    }
    if (relevant.some((entry) => entry.result === "fail")) {
      return {
        key: criterion.key,
        state: "failed",
        evidenceIds: relevant
          .filter((entry) => entry.result === "fail")
          .map((entry) => entry.id),
      };
    }
    return {
      key: criterion.key,
      state: "unverified",
      evidenceIds: relevant.map((entry) => entry.id),
    };
  });
}

export function allCriteriaVerified(states: CriterionState[]): boolean {
  return states.length > 0 && states.every((state) => state.state === "verified");
}

export const VERIFIED_LABEL_NOTE =
  "Verified means a matching check passed. Produced means an artifact exists. An artifact existing is not a verified outcome.";

export const NO_FABRICATION_NOTE =
  "Never invent participants, interviews, testimonials, test results, deployment results, usage, revenue or social benefit. If something could not be checked, it stays unverified with the reason recorded.";

// ---------------------------------------------------------------------------
// 7. Human decision checkpoints
// ---------------------------------------------------------------------------

export type CheckpointKind =
  | "missing_information"
  | "consent_missing"
  | "budget_shortfall"
  | "external_action_approval"
  | "stop_condition"
  | "contradicted_assumption"
  | "outside_scope"
  | "high_stakes";

export type Checkpoint = {
  kind: CheckpointKind;
  title: string;
  what_happened: string;
  evidence: string;
  decision: string;
  implication: string;
};

export const CHECKPOINT_LABELS: Record<CheckpointKind, string> = {
  missing_information: "Required information is missing",
  consent_missing: "Consent is missing or no longer applies",
  budget_shortfall: "The approved budget cannot cover the next step",
  external_action_approval: "An external action needs approval",
  stop_condition: "A stop condition was reached",
  contradicted_assumption: "Evidence contradicts a critical assumption",
  outside_scope: "The requested action falls outside the approved scope",
  high_stakes: "This needs a specialist process",
};

export function checkpointsFor({
  contract,
  nextTask,
  budget,
  consentValid,
  stopConditionReached,
  contradictedAssumption,
  requestedTools = [],
  highStakes = false,
}: {
  contract: ContractContent;
  nextTask: OrchestrationTaskInput | null;
  budget: BudgetSnapshot;
  consentValid: boolean;
  stopConditionReached: boolean;
  contradictedAssumption: string | null;
  requestedTools?: string[];
  highStakes?: boolean;
}): Checkpoint[] {
  const checkpoints: Checkpoint[] = [];

  const add = (checkpoint: Checkpoint) => checkpoints.push(checkpoint);

  if (!consentValid) {
    add({
      kind: "consent_missing",
      title: CHECKPOINT_LABELS.consent_missing,
      what_happened: "The consent this contract depends on is missing or no longer applies.",
      evidence: contract.consent_constraints,
      decision: "Record valid consent, or stop and remove the affected work.",
      implication: "Nothing that depends on that consent may run.",
    });
  }

  if (stopConditionReached) {
    add({
      kind: "stop_condition",
      title: CHECKPOINT_LABELS.stop_condition,
      what_happened: "A stop condition recorded in the contract has been reached.",
      evidence: contract.stop_conditions,
      decision: "Stop the orchestration, or record why the condition no longer applies.",
      implication: "No further task is scheduled automatically.",
    });
  }

  if (contradictedAssumption) {
    add({
      kind: "contradicted_assumption",
      title: CHECKPOINT_LABELS.contradicted_assumption,
      what_happened: `Evidence contradicts a recorded assumption: ${contradictedAssumption}`,
      evidence: contradictedAssumption,
      decision:
        "Decide whether the goal survives the contradiction. Do not quietly rewrite the assumption to fit the result.",
      implication: "The contract's conclusion may no longer follow from its premises.",
    });
  }

  if (highStakes) {
    add({
      kind: "high_stakes",
      title: CHECKPOINT_LABELS.high_stakes,
      what_happened:
        "The work looks like medical, legal, financial, safety, crisis or work-with-minors activity.",
      evidence: contract.scope,
      decision: "Move it to a specialist process outside this generic workflow.",
      implication: "This layer does not perform high-stakes activity.",
    });
  }

  if (!nextTask) {
    add({
      kind: "missing_information",
      title: "No runnable task",
      what_happened: "There is no pending task whose dependencies are verified.",
      evidence: "The task graph has no ready work.",
      decision: "Add a bounded task, resolve a failed one, or record the outcome.",
      implication: "Running would produce nothing, so it is not allowed.",
    });
    return checkpoints;
  }

  const outOfScopeTools = requestedTools.filter(
    (tool) => !(contract.allowed_tools as readonly string[]).includes(tool),
  );
  if (outOfScopeTools.length > 0) {
    add({
      kind: "outside_scope",
      title: CHECKPOINT_LABELS.outside_scope,
      what_happened: `The task asks for tools outside the contract: ${outOfScopeTools.join(", ")}.`,
      evidence: `Allowed tools: ${contract.allowed_tools.join(", ")}`,
      decision: "Approve a new contract version, or change the task.",
      implication: "An agent cannot widen its own authority.",
    });
  }

  if (nextTask.credits_micros > budget.available) {
    add({
      kind: "budget_shortfall",
      title: CHECKPOINT_LABELS.budget_shortfall,
      what_happened: `The next task reserves ${formatCredits(nextTask.credits_micros)}, but only ${formatCredits(Math.max(budget.available, 0))} is available.`,
      evidence: `Authorized ${formatCredits(budget.authorized)}, consumed ${formatCredits(budget.consumed)}, reserved ${formatCredits(budget.reserved)}.`,
      decision: "Approve a higher maximum in a new contract version, or stop.",
      implication: "The task cannot reserve credits, so it cannot run.",
    });
  }

  if (nextTask.external_action_kind) {
    add({
      kind: "external_action_approval",
      title: `${CHECKPOINT_LABELS.external_action_approval}: ${EXTERNAL_ACTION_LABELS[nextTask.external_action_kind]}`,
      what_happened: `Task ${nextTask.task_key} would ${nextTask.external_action_kind.replace("_", " ")}.`,
      evidence: nextTask.purpose,
      decision:
        "A different owner or admin approves or rejects this specific action. Approval records a decision; it does not perform the action.",
      implication: "Nothing external happens without that separate decision.",
    });
  }

  return checkpoints;
}

// ---------------------------------------------------------------------------
// 8. Cancellation, uncertain external effects, retries
// ---------------------------------------------------------------------------

export type CancellationPlan = {
  stop_scheduling: true;
  reversible: string[];
  irreversible: string[];
  note: string;
};

export function cancellationPlan(tasks: (TaskState & { external_action_kind?: ExternalActionKind | null })[]): CancellationPlan {
  const irreversible = tasks
    .filter(
      (task) =>
        task.external_action_kind &&
        (task.status === "produced" || task.status === "verified"),
    )
    .map(
      (task) =>
        `${task.task_key}: ${EXTERNAL_ACTION_LABELS[task.external_action_kind as ExternalActionKind]} was already performed`,
    );
  const reversible = tasks
    .filter((task) => task.status === "pending" || task.status === "ready" || task.status === "running")
    .map((task) => task.task_key);

  return {
    stop_scheduling: true,
    reversible,
    irreversible,
    note:
      irreversible.length === 0
        ? "No external action has been performed, so stopping schedules no further work and undoes nothing external."
        : "Cancellation stops new scheduling. It does not reverse an external action that already happened; those are listed above for a person to handle.",
  };
}

export const UNCERTAIN_ACTION_NOTE =
  "An uncertain external action is not retried blindly. Its status is reconciled first, and if it cannot be established safely the orchestration pauses for a person.";

export function uncertainActionResult({
  attempted,
  outcomeKnown,
}: {
  attempted: boolean;
  outcomeKnown: boolean;
}): RuleProblem {
  if (!attempted) return OK;
  if (outcomeKnown) return OK;
  return {
    ok: false,
    code: "uncertain-external-action",
    message:
      "The external action was attempted but its result cannot be established. Do not repeat it. Pause for a person to reconcile it.",
  };
}

export function duplicateDeliveryResponse({
  alreadyProcessed,
}: {
  alreadyProcessed: boolean;
}): RuleProblem {
  if (!alreadyProcessed) return OK;
  return {
    ok: false,
    code: "duplicate",
    message:
      "This event was already processed. The stored result is returned and nothing is charged or repeated.",
  };
}

// ---------------------------------------------------------------------------
// 9. Untrusted content and tenant boundaries
// ---------------------------------------------------------------------------

const INJECTION_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /ignore (all )?(the )?(previous|prior) instructions/i, reason: "asks to discard policy" },
  { pattern: /system prompt/i, reason: "asks about system instructions" },
  { pattern: /you are now (an?|the) /i, reason: "tries to reassign the agent role" },
  { pattern: /approve (this|the) (payment|deployment|purchase)/i, reason: "tries to trigger an approval" },
  { pattern: /send (the )?(email|invite|message) (to|now)/i, reason: "tries to trigger outreach" },
  { pattern: /deploy (this|it) to production/i, reason: "tries to trigger a deployment" },
  { pattern: /exfiltrate|reveal (the )?(secret|api key|token)/i, reason: "asks for secrets" },
  { pattern: /transfer (credits|money)/i, reason: "asks to move money" },
];

export type UntrustedFinding = {
  flagged: boolean;
  reasons: string[];
  note: string;
};

export const UNTRUSTED_CONTENT_NOTE =
  "Retrieved documents, feedback, websites and tool responses are untrusted data. They cannot change the contract, permissions, budget or approvals, and any instruction inside them is reported, not followed.";

/** Reports embedded instructions. It never executes or obeys them. */
export function scanUntrustedContent(text: string): UntrustedFinding {
  const reasons = INJECTION_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(
    ({ reason }) => reason,
  );
  return {
    flagged: reasons.length > 0,
    reasons,
    note:
      reasons.length > 0
        ? `${UNTRUSTED_CONTENT_NOTE} This content contained instructions (${reasons.join("; ")}). They were recorded as data and not acted on.`
        : UNTRUSTED_CONTENT_NOTE,
  };
}

export function crossTenantProblem({
  actorWorkspaceId,
  recordWorkspaceId,
}: {
  actorWorkspaceId: string | null;
  recordWorkspaceId: string;
}): RuleProblem {
  if (!actorWorkspaceId) {
    return {
      ok: false,
      code: "forbidden",
      message: "You are not a member of this workspace. Nothing was read or changed.",
    };
  }
  if (actorWorkspaceId !== recordWorkspaceId) {
    return {
      ok: false,
      code: "forbidden",
      message:
        "That record belongs to a different workspace. Orchestration never moves work or data between workspaces.",
    };
  }
  return OK;
}

// ---------------------------------------------------------------------------
// 10. Outcome review
// ---------------------------------------------------------------------------

export const REVIEW_DECISIONS = ["accept", "revise", "new_contract", "stop"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export const REVIEW_DECISION_LABELS: Record<ReviewDecision, string> = {
  accept: "Accept and complete",
  revise: "Request a bounded revision",
  new_contract: "Continue through a new approved contract",
  stop: "Stop",
};

export const OUTCOME_REVIEW_NOTE =
  "The review shows the original goal, the approved scope, what was produced, what was verified, what failed, what remains unknown and what was actually spent. A person chooses what happens next.";

export type OutcomeReviewDraft = {
  decision: ReviewDecision;
  built: string;
  verified: string;
  failed: string;
  unknown: string;
  deviations: string;
  next_steps: string;
  decided_by_kind: "human" | "agent";
};

export function outcomeReviewProblem({
  review,
  criteria,
  actorRole,
  requestedRevision = false,
}: {
  review: OutcomeReviewDraft;
  criteria: CriterionState[];
  actorRole: WorkspaceRole | null | undefined;
  requestedRevision?: boolean;
}): RuleProblem {
  if (review.decided_by_kind !== "human") {
    return {
      ok: false,
      code: "agent-decision",
      message:
        "An agent cannot record the outcome decision. A person accepts, revises, continues or stops this work.",
    };
  }
  if (actorRole !== "owner" && actorRole !== "admin" && actorRole !== "member") {
    return {
      ok: false,
      code: "forbidden",
      message: "You are not a member of this workspace. Nothing was recorded.",
    };
  }
  if (review.unknown.trim().length < 5) {
    return {
      ok: false,
      code: "missing-unknowns",
      message:
        "Say what remains unknown, even if that is 'nothing yet'. A review that hides uncertainty is not an honest review.",
    };
  }
  if (review.decision === "accept") {
    if (criteria.some((criterion) => criterion.state === "failed")) {
      return {
        ok: false,
        code: "failure-unresolved",
        message:
          "An acceptance criterion failed. Accept requires a passing check or an explicit revision; a failure is not erased by accepting.",
      };
    }
    if (criteria.some((criterion) => criterion.state === "unverified")) {
      return {
        ok: false,
        code: "unverified",
        message:
          "Not every acceptance criterion is verified. Record the missing evidence, or choose a bounded revision instead of accepting.",
      };
    }
  }
  if ((review.decision === "revise" || review.decision === "new_contract") && !requestedRevision) {
    return {
      ok: false,
      code: "revision-not-requested",
      message:
        "A follow-up needs a bounded request. Describe the single change and the evidence that justifies it.",
    };
  }
  if (review.decision === "accept" && review.verified.trim().length < 5) {
    return {
      ok: false,
      code: "missing-verified",
      message: "Say what was actually verified before accepting the outcome.",
    };
  }
  return OK;
}

export type OutcomeSummary = {
  original_goal: string;
  approved_scope: string;
  approved_version: number | null;
  produced: string[];
  verified: string[];
  failed: string[];
  unknown: string;
  spent_micros: number;
  spent_usd: string;
  deviations: string[];
  note: string;
};

export function outcomeSummary({
  contract,
  approvedVersion,
  tasks,
  criteria,
  budget,
}: {
  contract: ContractContent;
  approvedVersion: number | null;
  tasks: (TaskState & { external_action_kind?: ExternalActionKind | null })[];
  criteria: CriterionState[];
  budget: BudgetSnapshot;
}): OutcomeSummary {
  return {
    original_goal: contract.goal,
    approved_scope: contract.scope,
    approved_version: approvedVersion,
    produced: tasks
      .filter((task) => task.status === "produced" || task.status === "verified")
      .map((task) => task.task_key),
    verified: criteria.filter((entry) => entry.state === "verified").map((entry) => entry.key),
    failed: [
      ...criteria.filter((entry) => entry.state === "failed").map((entry) => entry.key),
      ...tasks.filter((task) => task.status === "failed").map((task) => task.task_key),
    ],
    unknown: criteria
      .filter((entry) => entry.state === "unverified")
      .map((entry) => entry.key)
      .join(", ") || "Nothing recorded as unknown.",
    spent_micros: budget.consumed,
    spent_usd: formatMicrosUsd(budget.consumed),
    deviations: tasks
      .filter((task) => task.external_action_kind)
      .map(
        (task) =>
          `${task.task_key}: ${EXTERNAL_ACTION_LABELS[task.external_action_kind as ExternalActionKind]}`,
      ),
    note:
      "Produced is not verified, and deployment is not proof of benefit. Follow-up experiments belong in the existing experiment workspace.",
  };
}

/** The original hypothesis and criteria of a linked experiment are never rewritten. */
export function experimentPreserved({
  originalHypothesis,
  originalSuccessCriteria,
  currentHypothesis,
  currentSuccessCriteria,
}: {
  originalHypothesis: string;
  originalSuccessCriteria: string;
  currentHypothesis: string;
  currentSuccessCriteria: string;
}): RuleProblem {
  if (
    originalHypothesis.trim() !== currentHypothesis.trim() ||
    originalSuccessCriteria.trim() !== currentSuccessCriteria.trim()
  ) {
    return {
      ok: false,
      code: "experiment-rewritten",
      message:
        "The linked experiment's hypothesis or success criteria changed. Orchestration may not rewrite them to match a result.",
    };
  }
  return OK;
}

// ---------------------------------------------------------------------------
// 11. UI helpers
// ---------------------------------------------------------------------------

export function canManageOrchestration(
  role: WorkspaceRole | null | undefined,
): boolean {
  return role === "owner" || role === "admin";
}

export function statusLabel(status: OrchestrationStatus): string {
  return ORCHESTRATION_STATUS_LABELS[status];
}

export function taskStatusLabel(status: TaskStatus): string {
  return TASK_STATUS_LABELS[status];
}

export function capabilityLabel(capability: Capability): string {
  return CAPABILITY_LABELS[capability] ?? capability;
}

/**
 * A deterministic first plan derived from the contract. Each deliverable becomes
 * one bounded task and one verification task covers every acceptance criterion.
 * It is a draft a person can inspect before any approval; no model is involved.
 */
export function defaultPlan(contract: ContractContent): OrchestrationTaskInput[] {
  const authorized = creditsToMicros(contract.max_credits);
  const builds = contract.deliverables.filter((entry) => entry.kind === "deliverable");
  const observations = contract.deliverables.filter(
    (entry) => entry.kind === "observation",
  );
  const effects = contract.deliverables.filter(
    (entry) => entry.kind === "external_effect",
  );

  const work: OrchestrationTaskInput[] = [];
  const addWork = (
    entry: ContractDeliverable,
    capability: Capability,
    method: VerificationMethod,
    prefix: string,
  ) => {
    work.push({
      task_key: `${prefix}-${entry.key}`.slice(0, 40),
      title: entry.statement.slice(0, 160),
      purpose: `Produce this within the approved scope: ${entry.statement}`.slice(0, 1000),
      capability,
      depends_on: [],
      covers: [],
      input_refs: `contract:${contract.origin_kind}${contract.origin_id ? `:${contract.origin_id}` : ""}`,
      expected_output: entry.statement.slice(0, 2000),
      verification_method: method,
      credits_micros: 0,
      permissions: [contract.allowed_tools[0]],
      retry_limit: 1,
      external_action_kind: null,
    });
  };

  for (const entry of builds) addWork(entry, "app_builder", "automated_test", "build");
  for (const entry of observations) {
    addWork(entry, "research", "direct_observation", "observe");
  }
  for (const entry of effects) {
    addWork(entry, "mission_workspace", "human_review", "effect");
  }

  const workUnits = Math.max(work.length, 1);
  const verifyBudget = Math.max(
    1,
    Math.min(Math.floor(authorized * 0.2), authorized - workUnits),
  );
  const workBudget = authorized - verifyBudget;
  const share = Math.max(1, Math.floor(workBudget / workUnits));
  work.forEach((task) => {
    task.credits_micros = share;
  });

  const workKeys = work.map((task) => task.task_key);
  const spend = work.reduce((total, task) => total + task.credits_micros, 0);
  const verifyTask: OrchestrationTaskInput = {
    task_key: "verify",
    title: "Verify every acceptance criterion",
    purpose:
      "Collect the recorded evidence for each acceptance criterion and check it against the agreed verification method.",
    capability: "verification",
    depends_on: workKeys,
    covers: contract.acceptance_criteria.map((criterion) => criterion.key),
    input_refs: "contract:acceptance_criteria",
    expected_output:
      "A passing or failing result for every acceptance criterion, with limitations recorded.",
    verification_method: "automated_test",
    credits_micros: Math.max(1, authorized - spend),
    permissions: [contract.allowed_tools[0]],
    retry_limit: 0,
    external_action_kind: null,
  };

  return [...work, verifyTask];
}

export function nextStepHint({
  status,
  hasContractApproval,
  ready,
  unverified,
}: {
  status: OrchestrationStatus;
  hasContractApproval: boolean;
  ready: string[];
  unverified: number;
}): string {
  switch (status) {
    case "draft":
      return hasContractApproval
        ? "Send this contract for approval, then start the bounded plan."
        : "Finish the contract fields, then ask a person to approve this exact version.";
    case "awaiting_approval":
      return "An owner or admin reviews the contract version. Nothing runs before that.";
    case "ready":
      return ready.length > 0
        ? `Run the next ready task: ${ready[0]}.`
        : "No task is ready. Check dependencies — a dependency is satisfied only by verified work.";
    case "running":
      return "Work is running inside the approved contract. Stop conditions and budget are checked before each task.";
    case "verifying":
      return unverified > 0
        ? `${unverified} acceptance criteri${unverified === 1 ? "on is" : "a are"} unverified. Record the missing evidence.`
        : "Every criterion has passing evidence. A person records the outcome decision next.";
    case "awaiting_review":
      return "A person reviews what was produced, verified, failed and remains unknown, then decides.";
    case "completed":
      return "Completed by a human decision. The evidence stays attached.";
    case "needs_revision":
      return "Revise one thing, then approve a new contract version. The old version stays visible.";
    case "stopped":
      return "Stopped. Recorded external effects are not reversed by stopping.";
    case "failed":
      return "A task failed or an external result is uncertain. Review it before scheduling more work.";
    case "paused":
      return "Paused. No new work is scheduled until it resumes.";
    case "awaiting_input":
      return "A required answer is missing. Nothing is guessed to fill it.";
    case "awaiting_action_approval":
      return "An external action is waiting for a separate human decision.";
    case "cancellation_requested":
      return "Cancellation is recorded. Already-performed external effects are listed and are not reversible here.";
  }
}
