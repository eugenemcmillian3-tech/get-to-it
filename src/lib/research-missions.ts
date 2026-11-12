import type { TeamRole } from "@/lib/agent-team";
import { ORCHESTRATION_LIMITS } from "@/lib/orchestration";

/**
 * Phase 39 research missions.
 *
 * This module is deliberately data and rules only: it never runs an agent, a
 * search, outreach or a publication. A mission executes on the Phase 36
 * orchestration layer and proposes an ordinary Phase 35 experiment, so there is
 * no second, unrestricted runtime behind it.
 */

export const RESEARCH_SPECIALIST_FUNCTIONS = [
  "investigator",
  "alternative_hypothesis_reviewer",
  "methodology_reviewer",
  "prototype_builder",
  "evidence_verifier",
  "synthesis_writer",
] as const;

export type ResearchSpecialistFunction =
  (typeof RESEARCH_SPECIALIST_FUNCTIONS)[number];

export const RESEARCH_FUNCTION_LABELS: Record<
  ResearchSpecialistFunction,
  string
> = {
  investigator: "Investigator",
  alternative_hypothesis_reviewer: "Alternative-hypothesis reviewer",
  methodology_reviewer: "Methodology reviewer",
  prototype_builder: "Prototype builder",
  evidence_verifier: "Evidence verifier",
  synthesis_writer: "Synthesis writer",
};

/**
 * Each specialist function is performed by one of the existing team roles. The
 * roles are not new agents: they already exist with their own tool allowlists.
 */
export const RESEARCH_FUNCTION_ROLES: Record<
  ResearchSpecialistFunction,
  TeamRole
> = {
  investigator: "data",
  alternative_hypothesis_reviewer: "qa",
  methodology_reviewer: "security",
  prototype_builder: "frontend",
  evidence_verifier: "qa",
  synthesis_writer: "coordinator",
};

export const RESEARCH_FUNCTION_DUTIES: Record<
  ResearchSpecialistFunction,
  string
> = {
  investigator: "Searches for support and contradiction, and records sources with provenance.",
  alternative_hypothesis_reviewer: "Argues the competing explanation and looks for evidence that distinguishes it.",
  methodology_reviewer: "Checks whether the method could produce the claimed result by accident.",
  prototype_builder: "Builds the smallest artefact the next experiment needs, inside an app project.",
  evidence_verifier: "Re-reads the cited sources and confirms the quote or observation says what it is claimed to say.",
  synthesis_writer: "Writes the brief from verified material and lists what remains unresolved.",
};

/**
 * Functions that audit somebody else's work. The same role performing both
 * sides is not independent verification, whatever the labels say.
 */
export const RESEARCH_INDEPENDENCE_RULES: {
  reviewer: ResearchSpecialistFunction;
  of: ResearchSpecialistFunction;
}[] = [
  { reviewer: "evidence_verifier", of: "investigator" },
  { reviewer: "evidence_verifier", of: "synthesis_writer" },
  { reviewer: "methodology_reviewer", of: "investigator" },
  { reviewer: "alternative_hypothesis_reviewer", of: "investigator" },
];

export const RESEARCH_LIMITS = {
  maxTasks: ORCHESTRATION_LIMITS.maxTasks,
  maxAgents: 6,
  maxRetries: ORCHESTRATION_LIMITS.maxRetryLimit,
  minSpendCents: 10,
  maxSpendCents: ORCHESTRATION_LIMITS.maxCredits * 10,
  minMinutes: ORCHESTRATION_LIMITS.minTimeMinutes,
  maxMinutes: ORCHESTRATION_LIMITS.maxTimeMinutes,
  minQuestionChars: 8,
  maxQuestionChars: 300,
  maxScopeChars: 2000,
  maxExistingEvidenceChars: 4000,
  minHypotheses: 2,
  maxHypotheses: 6,
  maxDeliverables: 6,
  maxCheckpoints: 6,
  maxStopConditions: 6,
} as const;

export const RESEARCH_TOOLS = [
  "read_workspace_records",
  "read_project_files",
  "read_web_page",
  "run_read_only_query",
  "build_sandbox_prototype",
  "draft_document",
] as const;

export type ResearchTool = (typeof RESEARCH_TOOLS)[number];

/** Tools a research mission may never request. */
export const RESEARCH_FORBIDDEN_TOOLS = [
  "send_email",
  "publish",
  "outreach",
  "post_message",
  "contact_participant",
] as const;

export const RESEARCH_DEFAULT_STOP_CONDITIONS = [
  "Stop when the spend ceiling is reached.",
  "Stop when a required source cannot be reached.",
  "Stop when two verified sources contradict and no further evidence resolves it.",
] as const;

export const RESEARCH_DEFAULT_CHECKPOINTS = [
  "A person reviews the source list before synthesis.",
  "A person approves any proposed experiment before it becomes a record.",
] as const;

export const RESEARCH_STATUSES = [
  "draft",
  "ready",
  "running",
  "paused",
  "complete",
  "cancelled",
] as const;

export type ResearchStatus = (typeof RESEARCH_STATUSES)[number];

export const RESEARCH_STATUS_LABELS: Record<ResearchStatus, string> = {
  draft: "Draft",
  ready: "Ready",
  running: "Running",
  paused: "Paused",
  complete: "Complete",
  cancelled: "Cancelled",
};

export const SOURCE_TIERS = [
  "primary",
  "reputable_secondary",
  "unverified",
] as const;

export type SourceTier = (typeof SOURCE_TIERS)[number];

export const SOURCE_TIER_LABELS: Record<SourceTier, string> = {
  primary: "Primary source",
  reputable_secondary: "Reputable secondary",
  unverified: "Unverified",
};

export const REQUIRED_SOURCE_TIERS = [
  "primary",
  "reputable_secondary",
  "any",
] as const;

export type RequiredSourceTier = (typeof REQUIRED_SOURCE_TIERS)[number];

export const REQUIRED_SOURCE_TIER_LABELS: Record<RequiredSourceTier, string> = {
  primary: "At least one primary source",
  reputable_secondary: "Reputable secondary sources are acceptable",
  any: "Any recorded source is acceptable",
};

export const SOURCE_STANCES = ["supports", "contradicts"] as const;
export type SourceStance = (typeof SOURCE_STANCES)[number];

export const SOURCE_STANCE_LABELS: Record<SourceStance, string> = {
  supports: "Supports",
  contradicts: "Contradicts",
};

/**
 * Quotations and observations are evidence; inferences and proposals are not.
 * Only the first two can carry a discovery.
 */
export const STATEMENT_KINDS = [
  "quotation",
  "observation",
  "inference",
  "proposal",
] as const;

export type StatementKind = (typeof STATEMENT_KINDS)[number];

export const STATEMENT_KIND_LABELS: Record<StatementKind, string> = {
  quotation: "Quotation",
  observation: "Observation",
  inference: "Inference",
  proposal: "Proposal",
};

export const EVIDENCE_STATEMENT_KINDS: StatementKind[] = [
  "quotation",
  "observation",
];

export const RESEARCH_SOURCE_KINDS = [
  "document",
  "dataset",
  "interview",
  "observation",
  "code",
  "literature",
  "internal_record",
  "web_page",
] as const;

export type ResearchSourceKind = (typeof RESEARCH_SOURCE_KINDS)[number];

export const RESEARCH_SOURCE_KIND_LABELS: Record<ResearchSourceKind, string> = {
  document: "Document",
  dataset: "Dataset",
  interview: "Interview transcript",
  observation: "Observation made here",
  code: "Code or repository",
  literature: "Published literature",
  internal_record: "Workspace record",
  web_page: "Web page",
};

export const FINDING_LABELS = [
  "observation",
  "inference",
  "proposal",
  "discovery",
] as const;

export type FindingLabel = (typeof FINDING_LABELS)[number];

export const FINDING_LABEL_LABELS: Record<FindingLabel, string> = {
  observation: "Observation",
  inference: "Inference",
  proposal: "Proposal",
  discovery: "Discovery",
};

export const FINDING_LABEL_NOTES: Record<FindingLabel, string> = {
  observation: "Something the sources show directly.",
  inference: "What this build thinks follows from the sources.",
  proposal: "A suggestion for something to test. Not a finding about the world.",
  discovery: "A verified finding with no verified source against it.",
};

export const FINDING_STATUSES = [
  "pending",
  "supported",
  "conflicted",
  "unsupported",
] as const;

export type FindingStatus = (typeof FINDING_STATUSES)[number];

export const FINDING_STATUS_LABELS: Record<FindingStatus, string> = {
  pending: "Pending",
  supported: "Supported",
  conflicted: "Conflicted",
  unsupported: "Unsupported",
};

export const RESEARCH_NOTES = {
  noAutomaticPublication:
    "A brief stays inside this workspace. Nothing is published, sent or shared automatically.",
  noProposalAsDiscovery:
    "A proposal is a thing to test, not a discovery. This build refuses to label one as a discovery.",
  provenance:
    "Every source records where it came from, what kind of statement it is, and whether it supports or contradicts.",
  limits:
    "Task count, agent count, retries, spending and time are all bounded by the contract, and cancellation stops the orchestration behind the mission.",
} as const;

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

export type ResearchContractInput = {
  question: string;
  scope: string;
  existing_evidence: string;
  required_source_tier: RequiredSourceTier;
  allowed_tools: string[];
  deliverables: string[];
  task_budget: number;
  agent_budget: number;
  retry_budget: number;
  spend_ceiling_cents: number;
  time_ceiling_minutes: number;
  stop_conditions: string[];
  checkpoints: string[];
  hypotheses: string[];
};

export type ResearchContractProblem = { field: string; message: string };

export function validateResearchContract(
  input: ResearchContractInput,
): ResearchContractProblem[] {
  const problems: ResearchContractProblem[] = [];
  const add = (field: string, message: string) =>
    problems.push({ field, message });

  const question = input.question.trim();
  if (question.length < RESEARCH_LIMITS.minQuestionChars) {
    add("question", "Write the research question in at least a few words.");
  }
  if (question.length > RESEARCH_LIMITS.maxQuestionChars) {
    add("question", `Keep the question under ${RESEARCH_LIMITS.maxQuestionChars} characters.`);
  }

  if (input.scope.trim().length < 5) {
    add("scope", "Say what is in scope and what is out of scope.");
  }
  if (input.scope.length > RESEARCH_LIMITS.maxScopeChars) {
    add("scope", `Keep the scope under ${RESEARCH_LIMITS.maxScopeChars} characters.`);
  }
  if (input.existing_evidence.length > RESEARCH_LIMITS.maxExistingEvidenceChars) {
    add("existing_evidence", "Summarise the existing evidence in fewer words.");
  }

  const hypotheses = input.hypotheses
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  if (hypotheses.length < RESEARCH_LIMITS.minHypotheses) {
    add(
      "hypotheses",
      `Record at least ${RESEARCH_LIMITS.minHypotheses} hypotheses, including a competing explanation.`,
    );
  }
  if (hypotheses.length > RESEARCH_LIMITS.maxHypotheses) {
    add("hypotheses", `Record at most ${RESEARCH_LIMITS.maxHypotheses} hypotheses.`);
  }
  if (new Set(hypotheses.map((statement) => statement.toLowerCase())).size !== hypotheses.length) {
    add("hypotheses", "Two hypotheses are identical; keep the distinct explanations.");
  }

  if (input.allowed_tools.length === 0) {
    add("allowed_tools", "Allow at least one read-only tool.");
  }
  const forbidden = input.allowed_tools.filter((tool) =>
    (RESEARCH_FORBIDDEN_TOOLS as readonly string[]).includes(tool),
  );
  if (forbidden.length > 0) {
    add("allowed_tools", `Research missions cannot use ${forbidden.join(", ")}.`);
  }
  const unknown = input.allowed_tools.filter(
    (tool) => !(RESEARCH_TOOLS as readonly string[]).includes(tool),
  );
  if (unknown.length > 0) {
    add("allowed_tools", `${unknown.join(", ")} is not a research tool in this build.`);
  }

  if (input.deliverables.length === 0) {
    add("deliverables", "Name at least one deliverable.");
  }
  if (input.deliverables.length > RESEARCH_LIMITS.maxDeliverables) {
    add("deliverables", `Keep the deliverable list to ${RESEARCH_LIMITS.maxDeliverables}.`);
  }

  if (
    !Number.isInteger(input.task_budget) ||
    input.task_budget < ORCHESTRATION_LIMITS.minTasks ||
    input.task_budget > RESEARCH_LIMITS.maxTasks
  ) {
    add("task_budget", `The task budget must be between 1 and ${RESEARCH_LIMITS.maxTasks}.`);
  }
  if (
    !Number.isInteger(input.agent_budget) ||
    input.agent_budget < 1 ||
    input.agent_budget > RESEARCH_LIMITS.maxAgents
  ) {
    add("agent_budget", `The agent budget must be between 1 and ${RESEARCH_LIMITS.maxAgents}.`);
  }
  if (
    !Number.isInteger(input.retry_budget) ||
    input.retry_budget < 0 ||
    input.retry_budget > RESEARCH_LIMITS.maxRetries
  ) {
    add("retry_budget", `Retries are limited to ${RESEARCH_LIMITS.maxRetries}.`);
  }
  if (
    !Number.isInteger(input.spend_ceiling_cents) ||
    input.spend_ceiling_cents < RESEARCH_LIMITS.minSpendCents ||
    input.spend_ceiling_cents > RESEARCH_LIMITS.maxSpendCents
  ) {
    add(
      "spend_ceiling_cents",
      `The spending ceiling must be between ${RESEARCH_LIMITS.minSpendCents} and ${RESEARCH_LIMITS.maxSpendCents} cents.`,
    );
  }
  if (
    !Number.isInteger(input.time_ceiling_minutes) ||
    input.time_ceiling_minutes < RESEARCH_LIMITS.minMinutes ||
    input.time_ceiling_minutes > RESEARCH_LIMITS.maxMinutes
  ) {
    add(
      "time_ceiling_minutes",
      `The time ceiling must be between ${RESEARCH_LIMITS.minMinutes} and ${RESEARCH_LIMITS.maxMinutes} minutes.`,
    );
  }

  if (input.stop_conditions.filter((entry) => entry.trim() !== "").length === 0) {
    add("stop_conditions", "A mission needs at least one stop condition.");
  }
  if (input.checkpoints.filter((entry) => entry.trim() !== "").length === 0) {
    add(
      "checkpoints",
      "A mission needs at least one human review checkpoint, where it waits for a person.",
    );
  }

  return problems;
}

/**
 * The same role performing two functions is fine for some pairs and not for
 * others. Independence is about who checked whose work, not about labels.
 */
export function independenceProblems(
  assignments: Partial<Record<ResearchSpecialistFunction, TeamRole>>,
): string[] {
  const problems: string[] = [];
  for (const rule of RESEARCH_INDEPENDENCE_RULES) {
    const reviewerRole = assignments[rule.reviewer];
    const subjectRole = assignments[rule.of];
    if (!reviewerRole || !subjectRole) continue;
    if (reviewerRole !== subjectRole) continue;
    problems.push(
      `${RESEARCH_FUNCTION_LABELS[rule.reviewer]} cannot be the same agent as ${RESEARCH_FUNCTION_LABELS[rule.of]}: a shared label is not independent verification.`,
    );
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export type ResearchMission = {
  id: string;
  workspace_id: string;
  created_by: string;
  orchestration_id: string | null;
  question: string;
  scope: string;
  existing_evidence: string;
  required_source_tier: RequiredSourceTier;
  allowed_tools: string[];
  deliverables: string[];
  task_budget: number;
  agent_budget: number;
  retry_budget: number;
  spend_ceiling_cents: number;
  time_ceiling_minutes: number;
  stop_conditions: string[];
  checkpoints: string[];
  status: ResearchStatus;
  proposed_experiment_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ResearchHypothesis = {
  id: string;
  mission_id: string;
  statement: string;
  role: "leading" | "competing";
  status: "open" | "supported" | "rejected" | "unresolved";
  created_at: string;
};

export type ResearchSource = {
  id: string;
  mission_id: string;
  hypothesis_id: string | null;
  stance: SourceStance;
  statement_kind: StatementKind;
  source_tier: SourceTier;
  source_kind: ResearchSourceKind;
  title: string;
  locator: string;
  excerpt: string;
  verified: boolean;
  created_at: string;
};

export type ResearchFinding = {
  id: string;
  mission_id: string;
  hypothesis_id: string | null;
  claim: string;
  label: FindingLabel;
  author_role: ResearchSpecialistFunction;
  verifier_role: ResearchSpecialistFunction | null;
  status: FindingStatus;
  verified_at: string | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// The brief
// ---------------------------------------------------------------------------

export type BriefFinding = {
  id: string;
  claim: string;
  label: FindingLabel;
  /** The label the brief actually shows, after re-checking the evidence. */
  status: FindingStatus;
  supportedBy: number;
  contradictedBy: number;
  verified: boolean;
  downgraded: string | null;
};

export type BriefHypothesis = {
  id: string;
  statement: string;
  role: "leading" | "competing";
  supporting: number;
  contradicting: number;
  state: "supported" | "contradicted" | "unresolved" | "no-evidence";
};

export type ResearchBrief = {
  question: string;
  scope: string;
  findings: BriefFinding[];
  proposals: BriefFinding[];
  evidence: ResearchSource[];
  alternatives: BriefHypothesis[];
  limitations: string[];
  unresolvedQuestions: string[];
  proposedExperiment: ResearchExperimentProposal | null;
  counts: {
    sources: number;
    supporting: number;
    contradicting: number;
    verifiedSources: number;
    findings: number;
    discoveries: number;
  };
};

export type ResearchExperimentProposal = {
  question: string;
  hypothesis: string;
  success_criteria: string;
  failure_criteria: string;
  target_users: string;
  proposed_prototype: string;
  time_limit_minutes: number;
  stop_conditions: string;
};

function tierSatisfies(required: RequiredSourceTier, tier: SourceTier): boolean {
  if (required === "any") return true;
  if (required === "primary") return tier === "primary";
  return tier === "primary" || tier === "reputable_secondary";
}

/**
 * Recomputes what the evidence actually supports. A stored label is not taken
 * on trust: if the supporting sources are gone, unverified, of the wrong kind,
 * or contradicted, the brief downgrades the finding instead of repeating it.
 */
export function buildResearchBrief(input: {
  mission: ResearchMission;
  hypotheses: ResearchHypothesis[];
  sources: ResearchSource[];
  findings: ResearchFinding[];
}): ResearchBrief {
  const { mission, hypotheses, sources, findings } = input;

  const supportFor = (finding: ResearchFinding) => {
    const usable = sources.filter(
      (source) =>
        source.stance === "supports" &&
        source.statement_kind !== "inference" &&
        source.statement_kind !== "proposal",
    );
    const verified = usable.filter(
      (source) =>
        source.verified &&
        tierSatisfies(mission.required_source_tier, source.source_tier),
    );
    const contradicted = sources.filter(
      (source) => source.stance === "contradicts" && source.verified,
    );
    return {
      supportedBy: verified.filter(
        (source) =>
          finding.hypothesis_id === null ||
          source.hypothesis_id === null ||
          source.hypothesis_id === finding.hypothesis_id,
      ).length,
      contradictedBy: contradicted.filter(
        (source) =>
          finding.hypothesis_id === null ||
          source.hypothesis_id === null ||
          source.hypothesis_id === finding.hypothesis_id,
      ).length,
      totalSupport: verified.length,
    };
  };

  const evaluated = findings.map((finding): BriefFinding => {
    const support = supportFor(finding);
    const independentVerifier =
      finding.verifier_role !== null && finding.verifier_role !== finding.author_role;

    let status = finding.status;
    let downgraded: string | null = null;

    if (finding.label === "discovery") {
      const missing: string[] = [];
      if (!independentVerifier) {
        missing.push("no independent verifier");
      }
      if (support.supportedBy === 0) {
        missing.push("no verified supporting source at the required quality");
      }
      if (support.contradictedBy > 0) {
        missing.push("a verified source contradicts it");
      }
      if (missing.length > 0) {
        status = "unsupported";
        downgraded = `Shown as unsupported: ${missing.join("; ")}.`;
      }
    } else if (finding.label === "proposal" && status === "supported") {
      status = "pending";
      downgraded = "A proposal is not evidence; it stays pending until an experiment tests it.";
    }

    return {
      id: finding.id,
      claim: finding.claim,
      label: finding.label,
      status,
      supportedBy: support.supportedBy,
      contradictedBy: support.contradictedBy,
      verified: independentVerifier,
      downgraded,
    };
  });

  const alternatives = hypotheses.map((hypothesis): BriefHypothesis => {
    const supporting = sources.filter(
      (source) => source.hypothesis_id === hypothesis.id && source.stance === "supports",
    ).length;
    const contradicting = sources.filter(
      (source) => source.hypothesis_id === hypothesis.id && source.stance === "contradicts",
    ).length;
    const state =
      supporting === 0 && contradicting === 0
        ? "no-evidence"
        : supporting > 0 && contradicting > 0
          ? "contradicted"
          : contradicting > 0
            ? "contradicted"
            : "supported";
    return {
      id: hypothesis.id,
      statement: hypothesis.statement,
      role: hypothesis.role,
      supporting,
      contradicting,
      state,
    };
  });

  const limitations: string[] = [];
  const unverified = sources.filter((source) => !source.verified);
  if (unverified.length > 0) {
    limitations.push(
      `${unverified.length} of ${sources.length} sources have not been re-checked against the original.`,
    );
  }
  const weak = sources.filter(
    (source) => !tierSatisfies(mission.required_source_tier, source.source_tier),
  );
  if (weak.length > 0) {
    limitations.push(
      `${weak.length} source(s) fall below the required quality for this mission.`,
    );
  }
  if (mission.required_source_tier === "any") {
    limitations.push("This mission accepts any recorded source, so quality was not the bar.");
  }
  if (sources.some((source) => source.source_kind === "internal_record")) {
    limitations.push(
      "Some evidence is internal to this workspace and was not compared with an outside source.",
    );
  }
  if (limitations.length === 0) {
    limitations.push("No source-quality limitation was recorded.");
  }

  const unresolvedQuestions: string[] = [];
  for (const hypothesis of alternatives) {
    if (hypothesis.state === "no-evidence") {
      unresolvedQuestions.push(`No evidence has been recorded either way for: ${hypothesis.statement}`);
    }
    if (hypothesis.state === "contradicted") {
      unresolvedQuestions.push(`Evidence conflicts on: ${hypothesis.statement}`);
    }
  }
  for (const finding of evaluated) {
    if (finding.status === "pending" && finding.label !== "proposal") {
      unresolvedQuestions.push(`Still unverified: ${finding.claim}`);
    }
    if (finding.status === "conflicted") {
      unresolvedQuestions.push(`Conflicting evidence on: ${finding.claim}`);
    }
  }
  const verifiedSupport = sources.filter(
    (source) =>
      source.verified &&
      source.stance === "supports" &&
      tierSatisfies(mission.required_source_tier, source.source_tier),
  ).length;
  if (verifiedSupport === 0) {
    unresolvedQuestions.push(
      "No source has been verified at the required quality yet, so nothing in this brief is established.",
    );
  }

  const discoveries = evaluated.filter(
    (finding) => finding.label === "discovery" && finding.status === "supported",
  ).length;

  return {
    question: mission.question,
    scope: mission.scope,
    findings: evaluated.filter((finding) => finding.label !== "proposal"),
    proposals: evaluated.filter((finding) => finding.label === "proposal"),
    evidence: sources,
    alternatives,
    limitations,
    unresolvedQuestions,
    proposedExperiment: proposeExperiment({
      mission,
      briefFindings: evaluated,
      alternatives,
      sources,
    }),
    counts: {
      sources: sources.length,
      supporting: sources.filter((source) => source.stance === "supports").length,
      contradicting: sources.filter((source) => source.stance === "contradicts").length,
      verifiedSources: sources.filter((source) => source.verified).length,
      findings: findings.length,
      discoveries,
    },
  };
}

/**
 * The smallest useful next experiment: one question, one hypothesis, one
 * success criterion, inside the mission's own time ceiling. It is a proposal
 * until a person turns it into a Phase 35 record.
 */
export function proposeExperiment(input: {
  mission: ResearchMission;
  briefFindings: BriefFinding[];
  alternatives: BriefHypothesis[];
  sources: ResearchSource[];
}): ResearchExperimentProposal | null {
  const { mission, briefFindings, alternatives } = input;
  if (briefFindings.length === 0 && alternatives.length === 0) return null;

  const contested =
    alternatives.find((entry) => entry.state === "contradicted") ??
    alternatives.find((entry) => entry.state === "no-evidence") ??
    alternatives[0];
  if (!contested) return null;

  const weakest = briefFindings.find(
    (finding) => finding.status !== "supported" && finding.label !== "proposal",
  );
  const focus = weakest?.claim ?? briefFindings[0]?.claim ?? contested.statement;

  const minutes = Math.min(Math.max(60, 15), mission.time_ceiling_minutes);

  return {
    question: mission.question,
    hypothesis: contested.statement,
    success_criteria: `The test distinguishes between the hypotheses: ${focus}`,
    failure_criteria:
      "Neither hypothesis is favoured, or the result depends on a source this mission could not verify.",
    target_users: "Consenting participants from the workspace's own audience",
    proposed_prototype:
      "The smallest artefact that tests this question: one screen or one recorded task, reviewed by a person before any participant sees it.",
    time_limit_minutes: minutes,
    stop_conditions: mission.stop_conditions.join(" "),
  };
}

// ---------------------------------------------------------------------------
// Synthetic mission used by the acceptance check
// ---------------------------------------------------------------------------

export type SyntheticResearchMission = {
  contract: ResearchContractInput;
  hypothesisStatements: string[];
  sources: {
    hypothesisIndex: number | null;
    stance: SourceStance;
    statement_kind: StatementKind;
    source_tier: SourceTier;
    source_kind: ResearchSourceKind;
    title: string;
    locator: string;
    excerpt: string;
    verified: boolean;
  }[];
  findings: {
    hypothesisIndex: number | null;
    claim: string;
    label: FindingLabel;
    author_role: ResearchSpecialistFunction;
    verifier_role: ResearchSpecialistFunction | null;
    status: FindingStatus;
    verified: boolean;
  }[];
  /** A conclusion the database must refuse. */
  unsupportedAttempt: {
    claim: string;
    label: FindingLabel;
    author_role: ResearchSpecialistFunction;
    verifier_role: ResearchSpecialistFunction | null;
    status: FindingStatus;
  };
};

/**
 * A synthetic mission with real structure: one supported finding, one verified
 * source against it, and one conclusion that is deliberately unsupported so the
 * guard can be shown refusing it.
 */
export function syntheticResearchMission(): SyntheticResearchMission {
  const contract: ResearchContractInput = {
    question:
      "Does a 320 px minimum viewport change whether people finish the weekly review?",
    scope:
      "Synthetic data only. One workspace review flow, one narrow viewport, no participants and no outreach.",
    existing_evidence:
      "Internal notes claim narrow screens cause abandonment, but no measurement exists in this workspace.",
    required_source_tier: "reputable_secondary",
    allowed_tools: ["read_workspace_records", "read_web_page", "draft_document"],
    deliverables: ["Sourced research brief", "Proposed bounded experiment"],
    task_budget: 4,
    agent_budget: 3,
    retry_budget: 1,
    spend_ceiling_cents: 200,
    time_ceiling_minutes: 120,
    stop_conditions: [...RESEARCH_DEFAULT_STOP_CONDITIONS],
    checkpoints: [...RESEARCH_DEFAULT_CHECKPOINTS],
    hypotheses: [
      "Narrow viewports cause people to abandon the weekly review.",
      "Abandonment is caused by the number of required fields, not the viewport.",
    ],
  };

  return {
    contract,
    hypothesisStatements: contract.hypotheses,
    sources: [
      {
        hypothesisIndex: 0,
        stance: "supports",
        statement_kind: "quotation",
        source_tier: "primary",
        source_kind: "literature",
        title: "Usability study on minimum supported width",
        locator: "Synthetic dataset, study 14, section 3",
        excerpt:
          "Participants on a 320 px viewport completed 41 percent fewer review steps than the wider group.",
        verified: true,
      },
      {
        hypothesisIndex: 0,
        stance: "contradicts",
        statement_kind: "observation",
        source_tier: "reputable_secondary",
        source_kind: "dataset",
        title: "Internal review completion by viewport",
        locator: "Synthetic analytics export, rows 1-240",
        excerpt:
          "Completion at 320 px matched the desktop rate once the required-field count was capped at three.",
        verified: true,
      },
      {
        hypothesisIndex: 1,
        stance: "supports",
        statement_kind: "observation",
        source_tier: "reputable_secondary",
        source_kind: "dataset",
        title: "Field count versus completion",
        locator: "Synthetic analytics export, rows 1-240",
        excerpt:
          "Completion fell as required fields rose, at every viewport width in the export.",
        verified: true,
      },
      {
        hypothesisIndex: 1,
        stance: "supports",
        statement_kind: "inference",
        source_tier: "unverified",
        source_kind: "internal_record",
        title: "Our reading of the same export",
        locator: "Workspace note, written here",
        excerpt: "We think the field count is the real driver.",
        verified: false,
      },
    ],
    findings: [
      {
        hypothesisIndex: 1,
        claim:
          "In the synthetic export, completion tracked the number of required fields at every width.",
        label: "observation",
        author_role: "investigator",
        verifier_role: "evidence_verifier",
        status: "supported",
        verified: true,
      },
      {
        hypothesisIndex: 0,
        claim: "The viewport explanation is not supported once field count is controlled.",
        label: "inference",
        author_role: "synthesis_writer",
        verifier_role: null,
        status: "pending",
        verified: false,
      },
      {
        hypothesisIndex: 1,
        claim: "Cap the review at three required fields and measure completion again.",
        label: "proposal",
        author_role: "prototype_builder",
        verifier_role: null,
        status: "pending",
        verified: false,
      },
    ],
    unsupportedAttempt: {
      claim: "Discovery: the 320 px viewport is the single cause of review abandonment.",
      label: "discovery",
      author_role: "investigator",
      verifier_role: "investigator",
      status: "supported",
    },
  };
}
