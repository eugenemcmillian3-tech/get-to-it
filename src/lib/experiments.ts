/**
 * Phase 35 — experiment workspace, as pure rules.
 *
 * An experiment turns one future-facing question into a bounded test. This
 * module is the shared contract for the page, server actions and tests. The
 * database migration enforces the same hard rules under RLS and triggers.
 *
 * Ground rules encoded here:
 *   * The original question and hypothesis are never rewritten. The review is a
 *     separate record of what was built, observed, failed and remains unknown.
 *   * Participant feedback needs recorded consent. A participant opinion is
 *     never counted as a measured outcome, and no participant, quote or result
 *     is invented.
 *   * High-stakes human-subject research is refused by this generic workflow.
 *   * Outreach, publication, paid activity and deployment each need a separate
 *     human approval. A requester cannot approve their own request.
 *   * An approved prototype is a normal app-builder project. Approval here does
 *     not run code, deploy, publish or spend money.
 */

import { z } from "zod";
import type { AppIntakeInput } from "@/lib/app-builder";
import type { WorkspaceRole } from "@/lib/types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const uuidOrEmpty = z
  .union([z.string().trim().regex(UUID_PATTERN), z.literal("")])
  .default("");

export const EXPERIMENT_STATUSES = [
  "draft",
  "ready",
  "running",
  "awaiting_review",
  "completed",
  "stopped",
] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

export const EXPERIMENT_OBSERVATION_KINDS = [
  "measured",
  "participant_opinion",
  "observation",
  "failure",
  "unknown",
] as const;
export type ExperimentObservationKind =
  (typeof EXPERIMENT_OBSERVATION_KINDS)[number];

export const EXPERIMENT_FEEDBACK_KINDS = ["opinion", "measured"] as const;
export type ExperimentFeedbackKind = (typeof EXPERIMENT_FEEDBACK_KINDS)[number];

export const EXPERIMENT_APPROVAL_KINDS = [
  "outreach",
  "publication",
  "paid_activity",
  "deployment",
  "high_stakes",
] as const;
export type ExperimentApprovalKind =
  (typeof EXPERIMENT_APPROVAL_KINDS)[number];
export type ExperimentApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled";

export const EXPERIMENT_DECISIONS = [
  "undecided",
  "continue",
  "revise",
  "stop",
] as const;
export type ExperimentDecision = (typeof EXPERIMENT_DECISIONS)[number];

export const EXPERIMENT_LIMITS = {
  minTimeMinutes: 15,
  maxTimeMinutes: 10080,
  maxFeedbackChars: 2000,
  maxObservationChars: 4000,
} as const;

export const EXPERIMENT_STATUS_LABELS: Record<ExperimentStatus, string> = {
  draft: "Draft",
  ready: "Ready to run",
  running: "Running",
  awaiting_review: "Awaiting review",
  completed: "Complete",
  stopped: "Stopped",
};

export const OBSERVATION_KIND_LABELS: Record<ExperimentObservationKind, string> = {
  measured: "Measured outcome",
  participant_opinion: "Participant opinion",
  observation: "Observation",
  failure: "What failed",
  unknown: "Still unknown",
};

export const APPROVAL_KIND_LABELS: Record<ExperimentApprovalKind, string> = {
  outreach: "Real outreach",
  publication: "Publication",
  paid_activity: "Paid activity",
  deployment: "Deployment",
  high_stakes: "High-stakes research",
};

export const APPROVAL_KIND_NOTES: Record<ExperimentApprovalKind, string> = {
  outreach:
    "Contacting real people or recruiting participants. Approval records a decision; it does not send anything.",
  publication:
    "Publishing identifiable feedback or results. Approval records a decision; it does not publish anything.",
  paid_activity:
    "Spending money on ads, incentives, hosting or a provider. Approval records a decision; it does not charge anything.",
  deployment:
    "Making a prototype reachable outside the existing preview workspace. Existing deployment approvals still apply.",
  high_stakes:
    "Medical, legal, financial, safety, crisis or work-with-minors research is refused by this generic workflow.",
};

export const EXPERIMENT_NOTES = {
  voluntary:
    "Participation is voluntary. A person can decline or stop at any time, and declining has no consequence in this workspace.",
  aiDisclosure:
    "Show participants when they are interacting with AI. The assistant here works from recorded fields and fixed rules; it does not call a model or invent a participant.",
  noFabrication:
    "Never invent participants, testimonials, quotes or results. Empty evidence stays empty, and a prototype deployment is not proof of benefit.",
  consent:
    "Feedback is stored only with recorded consent. Identifiable feedback also needs explicit permission to quote it, and publication needs a separate approval.",
  highStakes:
    "This workflow is not for high-stakes human-subject research. Medical, legal, financial, safety, crisis and work-with-minors studies need a specialist research process.",
  buildGate:
    "An approved prototype becomes a normal app-builder project. Its sandbox, testing and deployment approvals are unchanged, and there is no separate execution path.",
  outcomeHonesty:
    "The review keeps the original hypothesis. Participant opinions are separate from measured outcomes, and deploying a prototype does not prove social benefit.",
} as const;

export const HIGH_STAKES_REFUSAL =
  "This workflow cannot run high-stakes human-subject research. Use a specialist research and ethics process instead. Nothing was created.";

export type Experiment = {
  id: string;
  workspace_id: string;
  mission_id: string | null;
  future_path_id: string | null;
  radar_signal_id: string | null;
  learning_goal_id: string | null;
  outcome_review_id: string | null;
  prototype_project_id: string | null;
  created_by: string;
  question: string;
  hypothesis: string;
  target_users: string;
  evidence_available: string;
  assumptions: string;
  proposed_prototype: string;
  success_criteria: string;
  failure_criteria: string;
  time_limit_minutes: number;
  resource_limit: string;
  privacy_requirements: string;
  consent_requirements: string;
  stop_conditions: string;
  ai_disclosure: string;
  high_stakes: boolean;
  status: ExperimentStatus;
  review_at: string;
  prototype_approved_by: string | null;
  prototype_approved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ExperimentObservation = {
  id: string;
  experiment_id: string;
  workspace_id: string;
  author_id: string;
  kind: ExperimentObservationKind;
  text: string;
  source: string;
  created_at: string;
};

export type ExperimentFeedback = {
  id: string;
  experiment_id: string;
  workspace_id: string;
  author_id: string;
  kind: ExperimentFeedbackKind;
  participant_reference: string;
  text: string;
  identifiable: boolean;
  consent_confirmed: boolean;
  consent_note: string;
  permission_to_quote: boolean;
  created_at: string;
};

export type ExperimentApproval = {
  id: string;
  experiment_id: string;
  workspace_id: string;
  kind: ExperimentApprovalKind;
  summary: string;
  scope: string;
  requested_by: string | null;
  requested_by_kind: "human" | "agent";
  status: ExperimentApprovalStatus;
  decided_by: string | null;
  decided_at: string | null;
  note: string;
  created_at: string;
};

export type ExperimentReview = {
  id: string;
  experiment_id: string;
  workspace_id: string;
  built: string;
  observed: string;
  failed: string;
  unknown: string;
  decision: ExperimentDecision;
  decision_note: string;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ExperimentEvent = {
  id: string;
  experiment_id: string;
  workspace_id: string;
  actor_id: string | null;
  kind: string;
  detail: string;
  created_at: string;
};

export const experimentInputSchema = z.object({
  workspace_id: z.string().trim().regex(UUID_PATTERN),
  mission_id: uuidOrEmpty,
  future_path_id: uuidOrEmpty,
  radar_signal_id: uuidOrEmpty,
  learning_goal_id: uuidOrEmpty,
  outcome_review_id: uuidOrEmpty,
  question: z
    .string()
    .trim()
    .min(8, "Ask a question of at least 8 characters.")
    .max(300, "Keep the question under 300 characters."),
  hypothesis: z
    .string()
    .trim()
    .min(8, "State a hypothesis of at least 8 characters.")
    .max(2000, "Keep the hypothesis under 2000 characters."),
  target_users: z
    .string()
    .trim()
    .min(5, "Say who would be affected or would take part.")
    .max(1000, "Keep this under 1000 characters."),
  evidence_available: z
    .string()
    .trim()
    .max(4000, "Keep existing evidence under 4000 characters.")
    .default(""),
  assumptions: z
    .string()
    .trim()
    .max(4000, "Keep assumptions under 4000 characters.")
    .default(""),
  proposed_prototype: z
    .string()
    .trim()
    .min(5, "Describe the proposed prototype.")
    .max(2000, "Keep the prototype description under 2000 characters."),
  success_criteria: z
    .string()
    .trim()
    .min(5, "Say what would count as success.")
    .max(2000, "Keep success criteria under 2000 characters."),
  failure_criteria: z
    .string()
    .trim()
    .min(5, "Say what would count as failure.")
    .max(2000, "Keep failure criteria under 2000 characters."),
  time_limit_minutes: z.coerce
    .number()
    .int("Use whole minutes.")
    .min(15, "Allow at least 15 minutes.")
    .max(10080, "Keep the time limit to seven days or less."),
  resource_limit: z
    .string()
    .trim()
    .max(1000, "Keep the resource limit under 1000 characters.")
    .default(""),
  privacy_requirements: z
    .string()
    .trim()
    .min(5, "Record the privacy requirements.")
    .max(2000, "Keep privacy requirements under 2000 characters."),
  consent_requirements: z
    .string()
    .trim()
    .min(5, "Record how consent will be asked for.")
    .max(2000, "Keep consent requirements under 2000 characters."),
  stop_conditions: z
    .string()
    .trim()
    .min(5, "Record when the experiment must stop.")
    .max(2000, "Keep stop conditions under 2000 characters."),
  ai_disclosure: z
    .string()
    .trim()
    .min(10, "Say how AI assistance will be disclosed.")
    .max(1000, "Keep the AI disclosure under 1000 characters."),
  review_at: z.string().trim().regex(DATE_PATTERN, "Choose a review date."),
  high_stakes: z.boolean().default(false),
});

export type ExperimentInput = z.infer<typeof experimentInputSchema>;

export const experimentObservationSchema = z.object({
  workspace_id: z.string().trim().regex(UUID_PATTERN),
  experiment_id: z.string().trim().regex(UUID_PATTERN),
  kind: z.enum(EXPERIMENT_OBSERVATION_KINDS),
  text: z
    .string()
    .trim()
    .min(5, "Describe what was observed.")
    .max(4000, "Keep an observation under 4000 characters."),
  source: z.string().trim().max(300, "Keep the source under 300 characters.").default(""),
});

export const experimentFeedbackSchema = z.object({
  workspace_id: z.string().trim().regex(UUID_PATTERN),
  experiment_id: z.string().trim().regex(UUID_PATTERN),
  kind: z.enum(EXPERIMENT_FEEDBACK_KINDS),
  participant_reference: z
    .string()
    .trim()
    .max(120, "Keep the reference under 120 characters.")
    .default(""),
  text: z
    .string()
    .trim()
    .min(5, "Record what the participant said or what was measured.")
    .max(2000, "Keep feedback under 2000 characters."),
  identifiable: z.boolean().default(false),
  consent_confirmed: z.boolean().default(false),
  consent_note: z
    .string()
    .trim()
    .max(1000, "Keep the consent note under 1000 characters.")
    .default(""),
  permission_to_quote: z.boolean().default(false),
});

export const experimentApprovalSchema = z.object({
  workspace_id: z.string().trim().regex(UUID_PATTERN),
  experiment_id: z.string().trim().regex(UUID_PATTERN),
  kind: z.enum(EXPERIMENT_APPROVAL_KINDS),
  summary: z
    .string()
    .trim()
    .min(5, "Summarise the request.")
    .max(500, "Keep the summary under 500 characters."),
  scope: z
    .string()
    .trim()
    .min(5, "Say exactly what would change.")
    .max(2000, "Keep the scope under 2000 characters."),
});

export const experimentApprovalDecisionSchema = z.object({
  workspace_id: z.string().trim().regex(UUID_PATTERN),
  experiment_id: z.string().trim().regex(UUID_PATTERN),
  approval_id: z.string().trim().regex(UUID_PATTERN),
  decision: z.enum(["approved", "rejected"]),
  note: z.string().trim().max(1000, "Keep the note under 1000 characters.").default(""),
});

export const experimentReviewSchema = z.object({
  workspace_id: z.string().trim().regex(UUID_PATTERN),
  experiment_id: z.string().trim().regex(UUID_PATTERN),
  built: z.string().trim().max(3000, "Keep this under 3000 characters.").default(""),
  observed: z.string().trim().max(3000, "Keep this under 3000 characters.").default(""),
  failed: z.string().trim().max(3000, "Keep this under 3000 characters.").default(""),
  unknown: z.string().trim().max(3000, "Keep this under 3000 characters.").default(""),
  decision: z.enum(EXPERIMENT_DECISIONS),
  decision_note: z.string().trim().max(3000, "Keep the note under 3000 characters.").default(""),
});

export function isExperimentApprovalKind(
  value: string,
): value is ExperimentApprovalKind {
  return (EXPERIMENT_APPROVAL_KINDS as readonly string[]).includes(value);
}

export function canManageExperiments(role: WorkspaceRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function highStakesProblem(highStakes: boolean): string | null {
  return highStakes ? HIGH_STAKES_REFUSAL : null;
}

export type ExperimentReadiness = {
  ready: boolean;
  missing: string[];
  notes: string[];
};

/**
 * What a person still needs to decide before starting. It never invents a
 * missing fact or treats an absent answer as a negative result.
 */
export function experimentReadiness(experiment: Pick<
  Experiment,
  | "question"
  | "hypothesis"
  | "target_users"
  | "evidence_available"
  | "assumptions"
  | "success_criteria"
  | "failure_criteria"
  | "privacy_requirements"
  | "consent_requirements"
  | "stop_conditions"
  | "review_at"
  | "time_limit_minutes"
  | "proposed_prototype"
>): ExperimentReadiness {
  const missing: string[] = [];
  if (experiment.evidence_available.trim().length < 10) {
    missing.push("Record the evidence you already have, or say plainly that there is none.");
  }
  if (experiment.assumptions.trim().length < 10) {
    missing.push("Name the assumptions the experiment depends on.");
  }
  if (experiment.target_users.trim().length < 5) {
    missing.push("Say who the affected group or participants are.");
  }
  if (experiment.success_criteria.trim().length < 5) {
    missing.push("Write a success criterion you could observe.");
  }
  if (experiment.failure_criteria.trim().length < 5) {
    missing.push("Write a failure criterion and what you would do if it happens.");
  }
  if (experiment.privacy_requirements.trim().length < 5) {
    missing.push("Record the privacy requirements.");
  }
  if (experiment.consent_requirements.trim().length < 5) {
    missing.push("Record how voluntary, informed consent will be asked for.");
  }
  if (experiment.stop_conditions.trim().length < 5) {
    missing.push("Record the stop conditions.");
  }
  if (!experiment.review_at) {
    missing.push("Choose a review date before starting.");
  }
  if (experiment.time_limit_minutes < 15) {
    missing.push("Allow at least 15 minutes.");
  }
  if (experiment.proposed_prototype.trim().length < 5) {
    missing.push("Describe the smallest prototype you would actually build.");
  }

  return {
    ready: missing.length === 0,
    missing,
    notes: [
      "A plan is not a result. Do not describe it as one.",
      "If the evidence is only a participant opinion, label it that way.",
      "A deployed prototype is not proof of social benefit.",
    ],
  };
}

export type ApproachOption = {
  title: string;
  whatYouWouldLearn: string;
  cost: string;
  risk: string;
};

/** Compares approaches from the recorded fields, without promising an answer. */
export function compareApproaches(
  experiment: Pick<Experiment, "question" | "proposed_prototype" | "target_users">,
): ApproachOption[] {
  return [
    {
      title: "Talk or observe before building",
      whatYouWouldLearn:
        "Whether the stated problem is the one people actually experience, and which words they use for it.",
      cost: "Low build cost; requires voluntary participation and consent.",
      risk:
        "A small number of views cannot establish how common something is. Record it as opinion, not proof of a measured rate.",
    },
    {
      title: "Smallest useful prototype",
      whatYouWouldLearn: `Whether one workflow for ${experiment.target_users} is understandable and useful enough to test further.`,
      cost: "One bounded build, using the normal app-builder sandbox and test gates.",
      risk:
        "A prototype can look finished while leaving accessibility, privacy and edge cases unresolved.",
    },
    {
      title: "Manual or concierge test",
      whatYouWouldLearn:
        "Whether the outcome can be delivered at all before automating it.",
      cost: "A person performs the workflow by hand for a short, bounded period.",
      risk:
        "Manual effort can hide a process that would not work at the scale you hope for.",
    },
    {
      title: "Do not run yet",
      whatYouWouldLearn:
        "Nothing about the hypothesis, but it avoids spending trust or effort on an unready question.",
      cost: "No build cost; the question stays open.",
      risk:
        "Waiting is also a choice. Record why you are waiting and what evidence would change it.",
    },
  ];
}

export type SmallestPrototype = {
  scope: string;
  pages: string[];
  entities: string[];
  exclusions: string[];
  checks: string[];
};

export function smallestPrototype(
  experiment: Pick<Experiment, "question" | "target_users" | "success_criteria">,
): SmallestPrototype {
  return {
    scope: `One workflow that lets ${experiment.target_users} answer: ${experiment.question}`,
    pages: [
      "/ | Start | Explain the experiment, consent and AI assistance",
      "/try | Try it | One workflow with a visible way to stop",
      "/result | What happened | Show the recorded outcome without claiming causation",
    ],
    entities: ["observation: kind, text", "feedback: kind, text, consent_confirmed"],
    exclusions: [
      "No accounts or personal profiles in the first prototype unless they are necessary.",
      "No real outreach, publication, payment or deployment.",
      "No claims that the prototype improves anyone's life.",
      "No participant quote without explicit consent and permission to quote.",
    ],
    checks: [
      experiment.success_criteria,
      "A participant can stop without completing the workflow.",
      "The AI-assistance disclosure is visible before any AI-assisted interaction.",
      "Every stored feedback entry has recorded consent.",
    ],
  };
}

/** A normal app-builder intake. It is validated by the existing intake schema. */
export function prototypeIntake(
  experiment: Pick<
    Experiment,
    | "question"
    | "hypothesis"
    | "target_users"
    | "proposed_prototype"
    | "success_criteria"
    | "failure_criteria"
    | "privacy_requirements"
  >,
): AppIntakeInput {
  const name = experiment.question.replace(/\s+/g, " ").trim().slice(0, 72);
  const purpose = `${experiment.hypothesis} The prototype tests one bounded question and does not claim a social benefit.`;
  return {
    name: name.length >= 3 ? name : "Experiment prototype",
    purpose: purpose.slice(0, 1500),
    target_users: experiment.target_users.slice(0, 600),
    workflows: experiment.proposed_prototype.slice(0, 1500),
    required_pages:
      "/ | Start | Explain the experiment, consent and AI assistance\n/try | Try it | One bounded workflow\n/result | What happened | Record an observation without claiming causation",
    entities: "observation: kind, text\nfeedback: kind, text, consent_confirmed",
    auth_requirements: "none",
    integrations: "",
    design_preferences:
      "Calm and clear. Show AI assistance. Make stopping easy. Never invent a participant or result.",
    definition_of_done: experiment.success_criteria.slice(0, 1000),
  };
}

export function interviewQuestions(
  experiment: Pick<Experiment, "question" | "target_users" | "hypothesis">,
): string[] {
  return [
    `May I ask you a few questions about ${experiment.question.replace(/[?.]+$/, "")}? You can skip any question or stop at any time.`,
    "What do you do now when this situation comes up?",
    "What is the hardest part of that, and what makes it hard?",
    "What have you already tried, and what happened?",
    "What would a useful result look like to you?",
    `What would make you distrust or stop using something built for ${experiment.target_users}?`,
    "Is there anything I should have asked but did not?",
  ];
}

export type FeedbackSummary = {
  consentedCount: number;
  excludedCount: number;
  identifiableCount: number;
  opinions: string[];
  measured: string[];
  summary: string;
};

/**
 * Summarises only consented feedback. It never fills an empty list with an
 * example, a testimonial or an assumed result.
 */
export function summarizeFeedback(feedback: Pick<
  ExperimentFeedback,
  "kind" | "text" | "identifiable" | "consent_confirmed"
>[]): FeedbackSummary {
  const consented = feedback.filter((entry) => entry.consent_confirmed);
  const opinions = consented
    .filter((entry) => entry.kind === "opinion")
    .map((entry) => entry.text.trim())
    .filter(Boolean);
  const measured = consented
    .filter((entry) => entry.kind === "measured")
    .map((entry) => entry.text.trim())
    .filter(Boolean);
  const identifiableCount = consented.filter((entry) => entry.identifiable).length;

  return {
    consentedCount: consented.length,
    excludedCount: feedback.length - consented.length,
    identifiableCount,
    opinions,
    measured,
    summary:
      consented.length === 0
        ? "No consented feedback has been recorded. Do not describe a participant reaction until one is recorded with consent."
        : `${consented.length} consented ${consented.length === 1 ? "entry" : "entries"}: ${opinions.length} opinion and ${measured.length} measured. ${identifiableCount > 0 ? `${identifiableCount} identifiable ${identifiableCount === 1 ? "entry needs" : "entries need"} explicit permission before any quotation or publication.` : "No identifiable entries were recorded."}`,
  };
}

export function nextExperimentSuggestion({
  experiment,
  review,
}: {
  experiment: Pick<Experiment, "question" | "hypothesis">;
  review: Pick<ExperimentReview, "decision" | "decision_note"> | null;
}): string {
  if (!review || review.decision === "undecided") {
    return "Record what was built, observed, failed and still unknown before starting another experiment. Until then, the question stays open.";
  }
  if (review.decision === "stop") {
    return `Stop here. Do not start another experiment unless the question changes. Keep the original hypothesis and the review together: ${experiment.hypothesis}`;
  }
  if (review.decision === "revise") {
    return "Change one thing only: the target group, the prototype workflow, or the success measure. Record why the change is justified by an observation, not by enthusiasm.";
  }
  return "Continue only with a new bounded question and a new review date. Do not treat the first prototype's deployment as evidence that the outcome occurred.";
}

export type ApprovalProblem = {
  ok: boolean;
  code?:
    | "forbidden"
    | "self-approval"
    | "agent-approval"
    | "not-pending"
    | "already-approved"
    | "high-stakes";
  message: string;
};

export function approvalProblem({
  approval,
  actorId,
  actorRole,
}: {
  approval: Pick<ExperimentApproval, "status" | "requested_by" | "requested_by_kind">;
  actorId: string;
  actorRole: WorkspaceRole | null | undefined;
}): ApprovalProblem {
  if (!canManageExperiments(actorRole)) {
    return {
      ok: false,
      code: "forbidden",
      message: "Only an owner or admin can decide an approval. Nothing was changed.",
    };
  }
  if (approval.status !== "pending") {
    return {
      ok: false,
      code: "not-pending",
      message: "That approval was already decided.",
    };
  }
  if (approval.requested_by === actorId) {
    return {
      ok: false,
      code: "self-approval",
      message: "A separate person must decide this request. You cannot approve your own request.",
    };
  }
  if (approval.requested_by_kind === "agent") {
    return {
      ok: false,
      code: "agent-approval",
      message: "An agent request needs a human decision; an agent cannot approve it.",
    };
  }
  return { ok: true, message: "A separate owner or admin can decide this request." };
}

export function prototypeApprovalProblem({
  experiment,
  role,
  hasProject,
}: {
  experiment: Pick<Experiment, "high_stakes" | "prototype_project_id">;
  role: WorkspaceRole | null | undefined;
  hasProject: boolean;
}): ApprovalProblem {
  if (experiment.high_stakes) {
    return {
      ok: false,
      code: "high-stakes",
      message: HIGH_STAKES_REFUSAL,
    };
  }
  if (!canManageExperiments(role)) {
    return {
      ok: false,
      code: "forbidden",
      message: "Only an owner or admin can approve a prototype. Nothing was created.",
    };
  }
  if (experiment.prototype_project_id) {
    return {
      ok: false,
      code: "already-approved",
      message: "This experiment already has an approved prototype project.",
    };
  }
  if (!hasProject) {
    return {
      ok: false,
      code: "forbidden",
      message: "The prototype project could not be created. Nothing was linked.",
    };
  }
  return { ok: true, message: "Approval creates a normal app-builder project." };
}

export function decisionLabel(decision: ExperimentDecision): string {
  switch (decision) {
    case "continue":
      return "Continue";
    case "revise":
      return "Revise";
    case "stop":
      return "Stop";
    case "undecided":
      return "Undecided";
  }
}

export function approvalKindLabel(kind: ExperimentApprovalKind): string {
  return APPROVAL_KIND_LABELS[kind];
}

export function approvalKindNote(kind: ExperimentApprovalKind): string {
  return APPROVAL_KIND_NOTES[kind];
}
