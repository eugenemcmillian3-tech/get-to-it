/**
 * Phase 20 — outcomes and lessons, as pure rules.
 *
 * Ground rules encoded here:
 *   * A review captures the expectation at the moment it is created. The
 *     snapshot is immutable (a database trigger refuses to change it), and later
 *     observations are appended. Nothing rewrites an earlier scenario,
 *     recommendation or decision to look better in hindsight.
 *   * Four evaluation questions stay separate: was the action completed, did the
 *     desired result occur, was the expectation accurate, and did external
 *     conditions change. Before/after is never treated as proof of causation.
 *   * Numerical forecasts are optional. Their stated probabilities and outcomes
 *     are kept, the scoring method is explained, and no cross-question or
 *     cross-person "intelligence" score is produced.
 *   * Improvement proposals need explicit consent and a scoped test set. They
 *     version a record and can be rolled back, but the shipped prompts are code:
 *     this build never edits prompts, permissions or safety rules at runtime,
 *     never trains on private content, and never optimises for engagement.
 */

import { z } from "zod";
import type {
  AssessmentAnswer,
  AssumptionVerdict,
  ExpectationSnapshot,
  ExternalChange,
  ForecastResolution,
  ImprovementArea,
  ImprovementVersion,
  ImprovementVersionStatus,
  OutcomeForecast,
  OutcomeObservationKind,
  OutcomeSourceKind,
} from "@/lib/types";

export const REVIEW_QUESTIONS: {
  key: OutcomeObservationKind;
  question: string;
  hint: string;
}[] = [
  {
    key: "observation",
    question: "What happened?",
    hint: "Describe what you observed, without explaining why yet.",
  },
  {
    key: "assumption",
    question: "Which assumptions held?",
    hint: "Name each assumption and whether it held, partly held, or failed.",
  },
  {
    key: "surprise",
    question: "What surprised you?",
    hint: "The thing you did not expect, good or bad.",
  },
  {
    key: "evidence",
    question: "What evidence changed?",
    hint: "What you now know that you did not know when you started.",
  },
  {
    key: "lesson",
    question: "What would you do differently?",
    hint: "A change to your process, not a resolution to try harder.",
  },
  {
    key: "next_action",
    question: "What is the next useful action?",
    hint: "One small, concrete step. Optional — stopping is also an answer.",
  },
];

export const OBSERVATION_LABELS: Record<OutcomeObservationKind, string> = {
  observation: "What happened",
  assumption: "Assumption check",
  surprise: "What surprised you",
  evidence: "Evidence that changed",
  lesson: "What you would do differently",
  next_action: "Next useful action",
};

export const ASSUMPTION_VERDICTS: {
  slug: AssumptionVerdict;
  label: string;
  note: string;
}[] = [
  { slug: "held", label: "Held", note: "The assumption turned out to be usable." },
  { slug: "partly", label: "Partly held", note: "True in part, or only for a while." },
  { slug: "failed", label: "Failed", note: "It did not hold, and the plan leaned on it." },
  { slug: "unknown", label: "Still unknown", note: "Nothing yet settles it. That is a real answer." },
];

export const ASSESSMENT_ANSWERS: { slug: AssessmentAnswer; label: string }[] = [
  { slug: "yes", label: "Yes" },
  { slug: "partly", label: "Partly" },
  { slug: "no", label: "No" },
  { slug: "unknown", label: "Unknown" },
];

export const EXTERNAL_CHANGES: { slug: ExternalChange; label: string }[] = [
  { slug: "changed", label: "Conditions changed" },
  { slug: "unchanged", label: "Conditions were similar" },
  { slug: "unclear", label: "Unclear" },
];

export const EVALUATION_DIMENSIONS: {
  key: "action_completed" | "desired_result" | "expectation_accuracy" | "external_conditions";
  label: string;
  question: string;
  note: string;
}[] = [
  {
    key: "action_completed",
    label: "Action completed",
    question: "Did you actually do the thing you planned?",
    note: "This is about the action, not about whether it worked.",
  },
  {
    key: "desired_result",
    label: "Desired result",
    question: "Did the result you wanted occur?",
    note: "Separate from whether the action was completed.",
  },
  {
    key: "expectation_accuracy",
    label: "Expectation accuracy",
    question: "Was your original expectation accurate?",
    note: "A wrong expectation can still be a useful experiment.",
  },
  {
    key: "external_conditions",
    label: "External conditions",
    question: "Did conditions outside your control change?",
    note: "A change here can explain a result without your action causing it.",
  },
];

export const CAUSATION_NOTE =
  "A change before and after your action is not proof that the action caused it. Record what you observed; if you want to claim causation, say what else could explain the same change.";

export const HISTORICAL_INTEGRITY_NOTE =
  "The expectation was captured when this review was created and cannot be edited. Later observations are appended, never merged into the original.";

export const OPTIONAL_PARTICIPATION_NOTE =
  "Reviewing is optional. Nothing is created automatically, and a record can stay open for as long as you need.";

export const FORECAST_METHOD_NOTE =
  "Each forecast is scored with the Brier score: (your stated probability − outcome)², where the outcome is 1 if it occurred and 0 if it did not. Lower is better. Only these forecasts are averaged, and forecasts about different questions are not comparable.";

export const NO_AGGREGATE_SCORE_NOTE =
  "There is no combined intelligence, confidence or performance score. Incomparable outcomes are never folded into one number, and no score is compared between people.";

/** Consent is part of the proposal itself, not a later checkbox. */
export function improvementBlockers({
  consentConfirmed,
  testScope,
}: {
  consentConfirmed: boolean;
  testScope: string;
}): string[] {
  const blockers: string[] = [];
  if (!consentConfirmed) {
    blockers.push(
      "Tick the consent box. Without explicit consent nothing is recorded and nothing is used.",
    );
  }
  if (testScope.trim().length < 10) {
    blockers.push("Describe the consented test set in at least 10 characters.");
  }
  return blockers;
}

export const IMPROVEMENT_NOTE =
  "An improvement proposal is a record for a person to approve. It is evaluated only on the consented test set described below, and approval versions the record rather than changing shipped prompts at runtime.";

export const NO_AUTONOMY_NOTE =
  "This build never modifies production prompts, permissions or safety rules on its own, never trains on private content, never claims consciousness or AGI, and never optimises for engagement or time spent.";

export const NO_TRAINING_NOTE =
  "Private content is not used to train anything. An improvement proposal only refers to the scope you explicitly consent to.";

export const USER_BENEFIT_MEASURES = [
  "Useful work saved",
  "User-confirmed progress",
  "Fewer unwanted suggestions",
  "Better identification of uncertainty",
] as const;

export const SOURCE_LABELS: Record<OutcomeSourceKind, string> = {
  goal: "Goal",
  future_path: "Future path",
  review: "Review",
};

export const IMPROVEMENT_AREAS: {
  slug: ImprovementArea;
  label: string;
  description: string;
}[] = [
  {
    slug: "planning_prompt",
    label: "Planning prompts",
    description: "The wording that asks a model to produce a plan.",
  },
  {
    slug: "template_structure",
    label: "Template structure",
    description: "The order and fields of a reusable plan or goal template.",
  },
  {
    slug: "clarification_questions",
    label: "Clarification questions",
    description: "The questions asked before planning starts.",
  },
  {
    slug: "review_timing",
    label: "Review timing",
    description: "When a review is suggested, and how often.",
  },
];

export function isOutcomeSourceKind(value: string): value is OutcomeSourceKind {
  return value === "goal" || value === "future_path" || value === "review";
}

export function isObservationKind(value: string): value is OutcomeObservationKind {
  return REVIEW_QUESTIONS.some((question) => question.key === value);
}

export function isAssumptionVerdict(value: string): value is AssumptionVerdict {
  return ASSUMPTION_VERDICTS.some((verdict) => verdict.slug === value);
}

export function isImprovementArea(value: string): value is ImprovementArea {
  return IMPROVEMENT_AREAS.some((area) => area.slug === value);
}

export function observationLabel(value: string): string {
  return OBSERVATION_LABELS[value as OutcomeObservationKind] ?? value;
}

export function assumptionVerdictLabel(value: string | null): string {
  if (!value) return "No verdict";
  return ASSUMPTION_VERDICTS.find((verdict) => verdict.slug === value)?.label ?? value;
}

export function assessmentLabel(value: string | null): string {
  if (!value) return "Not answered";
  return ASSESSMENT_ANSWERS.find((answer) => answer.slug === value)?.label ?? value;
}

export function externalChangeLabel(value: string | null): string {
  if (!value) return "Not answered";
  return EXTERNAL_CHANGES.find((change) => change.slug === value)?.label ?? value;
}

export function improvementAreaLabel(value: string): string {
  return IMPROVEMENT_AREAS.find((area) => area.slug === value)?.label ?? value;
}

/** A review can be completed with any answers; the note is what matters. */
export function isReviewComplete(review: {
  action_completed: string | null;
  desired_result: string | null;
  expectation_accuracy: string | null;
  external_conditions: string | null;
}): boolean {
  return (
    review.action_completed !== null &&
    review.desired_result !== null &&
    review.expectation_accuracy !== null &&
    review.external_conditions !== null
  );
}

export type SnapshotInput =
  | {
      kind: "goal";
      goal: {
        title: string;
        desired_outcome: string;
        deadline: string | null;
        created_at: string;
      };
    }
  | {
      kind: "future_path";
      path: {
        decision: string;
        chosen_kind: string | null;
        rationale: string | null;
        review_at: string | null;
        created_at: string;
      };
      scenario: { title: string; assumptions: string[] } | null;
    }
  | {
      kind: "review";
      review: {
        question: string;
        chosen_option: string | null;
        decision: string | null;
        rejected_recommendation: boolean;
        created_at: string;
      };
    };

/**
 * Captures what was expected at the start. Pure, so the same record always
 * produces the same snapshot apart from the supplied capture time.
 */
export function buildExpectationSnapshot(
  input: SnapshotInput,
  capturedAt: string,
): ExpectationSnapshot {
  if (input.kind === "goal") {
    return {
      source: "goal",
      title: input.goal.title,
      summary: input.goal.desired_outcome,
      lines: [
        { label: "Desired outcome", text: input.goal.desired_outcome },
        { label: "Deadline", text: input.goal.deadline ?? "None set" },
        { label: "Goal created", text: input.goal.created_at.slice(0, 10) },
      ],
      captured_at: capturedAt,
    };
  }

  if (input.kind === "future_path") {
    const lines = [
      { label: "Decision", text: input.path.decision },
      {
        label: "Chosen scenario",
        text: input.path.chosen_kind
          ? (input.scenario?.title ?? input.path.chosen_kind)
          : "No scenario chosen",
      },
      {
        label: "Assumptions",
        text:
          input.scenario && input.scenario.assumptions.length > 0
            ? input.scenario.assumptions.join("\n")
            : "None recorded",
      },
      { label: "Rationale", text: input.path.rationale ?? "None recorded" },
      { label: "Review date", text: input.path.review_at ?? "None set" },
    ];

    return {
      source: "future_path",
      title: input.path.decision,
      summary: input.scenario?.title ?? input.path.decision,
      lines,
      captured_at: capturedAt,
    };
  }

  return {
    source: "review",
    title: input.review.question,
    summary: input.review.decision ?? "No decision recorded",
    lines: [
      { label: "Question", text: input.review.question },
      {
        label: "Option chosen",
        text: input.review.chosen_option ?? "No option recorded",
      },
      { label: "Decision", text: input.review.decision ?? "No decision recorded" },
      {
        label: "Recommendation rejected",
        text: input.review.rejected_recommendation ? "Yes" : "No",
      },
    ],
    captured_at: capturedAt,
  };
}

/** A deterministic, human-readable rendering of a stored snapshot. */
export function snapshotLines(snapshot: ExpectationSnapshot): { label: string; text: string }[] {
  return snapshot.lines.filter((line) => line.text.trim() !== "");
}

/**
 * Brier score for one stated probability. Returns null when the forecast has
 * not resolved, because an unresolved forecast has no score yet.
 */
export function brierScore(
  probabilityPercent: number,
  resolution: ForecastResolution,
): number | null {
  if (resolution === "pending") return null;
  const probability = Math.min(99, Math.max(1, probabilityPercent)) / 100;
  const occurred = resolution === "occurred" ? 1 : 0;
  return Number(((probability - occurred) ** 2).toFixed(4));
}

export type ForecastScore = {
  id: string;
  statement: string;
  probability: number;
  resolution: ForecastResolution;
  score: number | null;
};

export type ForecastSummary = {
  scores: ForecastScore[];
  resolvedCount: number;
  mean: number | null;
  explanation: string;
};

export function scoreForecasts(
  forecasts: Pick<OutcomeForecast, "id" | "statement" | "probability" | "resolution">[],
): ForecastSummary {
  const scores: ForecastScore[] = forecasts.map((forecast) => ({
    id: forecast.id,
    statement: forecast.statement,
    probability: forecast.probability,
    resolution: forecast.resolution,
    score: brierScore(forecast.probability, forecast.resolution),
  }));

  const resolved = scores.filter((score) => score.score !== null);
  const mean =
    resolved.length === 0
      ? null
      : Number(
          (resolved.reduce((total, score) => total + (score.score ?? 0), 0) / resolved.length).toFixed(4),
        );

  return {
    scores,
    resolvedCount: resolved.length,
    mean,
    explanation:
      resolved.length === 0
        ? "No forecast has resolved yet, so there is no score. An unresolved forecast is not a success or a failure."
        : `${FORECAST_METHOD_NOTE} This average covers ${resolved.length} resolved ${resolved.length === 1 ? "forecast" : "forecasts"} in this review only.`,
  };
}

export function nextVersionNumber(
  versions: Pick<ImprovementVersion, "area" | "version">[],
  area: ImprovementArea,
): number {
  const numbers = versions.filter((version) => version.area === area).map((version) => version.version);
  return numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
}

export function activeVersion(
  versions: Pick<ImprovementVersion, "id" | "area" | "version" | "status">[],
  area: ImprovementArea,
): Pick<ImprovementVersion, "id" | "area" | "version" | "status"> | null {
  return (
    versions
      .filter((version) => version.area === area && version.status === "active")
      .sort((a, b) => b.version - a.version)[0] ?? null
  );
}

export type RollbackPlan = {
  rollbackId: string;
  rollbackVersion: number;
  restoreId: string | null;
  restoreVersion: number | null;
};

/**
 * Rolling back retires the active version and restores the newest superseded
 * one. It never edits the content of any version.
 */
export function rollbackPlan(
  versions: Pick<ImprovementVersion, "id" | "area" | "version" | "status">[],
  area: ImprovementArea,
): RollbackPlan | null {
  const current = activeVersion(versions, area);
  if (!current) return null;

  const previous =
    versions
      .filter(
        (version) =>
          version.area === area &&
          version.status === "superseded" &&
          version.version < current.version,
      )
      .sort((a, b) => b.version - a.version)[0] ?? null;

  return {
    rollbackId: current.id,
    rollbackVersion: current.version,
    restoreId: previous?.id ?? null,
    restoreVersion: previous?.version ?? null,
  };
}

export function versionStatusLabel(status: ImprovementVersionStatus): string {
  switch (status) {
    case "active":
      return "Active record";
    case "superseded":
      return "Superseded";
    case "rolled_back":
      return "Rolled back";
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const uuidSchema = z.string().trim().regex(UUID_PATTERN, "That link doesn't look right.");

const optionalDate = z
  .string()
  .trim()
  .refine(
    (value) => value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value),
    "Use a date in the form YYYY-MM-DD.",
  );

export const outcomeReviewSchema = z.object({
  source_kind: z.string().trim().refine(isOutcomeSourceKind, "Choose what to review."),
  source_id: uuidSchema,
  review_at: optionalDate,
});

export const observationSchema = z
  .object({
    review_id: uuidSchema,
    kind: z.string().trim().refine(isObservationKind, "Choose one of the review questions."),
    text: z
      .string()
      .trim()
      .min(5, "Write at least 5 characters.")
      .max(2000, "Keep this under 2000 characters."),
    verdict: z.string().trim(),
    causation_note: z
      .string()
      .trim()
      .max(2000, "Keep this under 2000 characters."),
  })
  .refine((value) => value.kind !== "assumption" || value.verdict !== "", {
    message: "Choose whether the assumption held.",
    path: ["verdict"],
  });

export const assessmentSchema = z.object({
  review_id: uuidSchema,
  action_completed: z.enum(["yes", "partly", "no", "unknown"]),
  desired_result: z.enum(["yes", "partly", "no", "unknown"]),
  expectation_accuracy: z.enum(["yes", "partly", "no", "unknown"]),
  external_conditions: z.enum(["changed", "unchanged", "unclear"]),
  causation_note: z
    .string()
    .trim()
    .max(2000, "Keep the causation note under 2000 characters."),
});

export const forecastSchema = z.object({
  review_id: uuidSchema,
  statement: z
    .string()
    .trim()
    .min(5, "Write the forecast in at least 5 characters.")
    .max(300, "Keep the forecast under 300 characters."),
  probability: z
    .string()
    .trim()
    .refine(
      (value) => /^\d{1,2}$|^100$/.test(value) && Number(value) >= 1 && Number(value) <= 99,
      "Give a whole-number probability between 1 and 99.",
    ),
});

export const forecastResolutionSchema = z.object({
  review_id: uuidSchema,
  forecast_id: uuidSchema,
  resolution: z.enum(["occurred", "did_not_occur", "pending"]),
});

export const improvementSchema = z.object({
  area: z.string().trim().refine(isImprovementArea, "Choose what to improve."),
  title: z
    .string()
    .trim()
    .min(5, "Give the proposal a short title.")
    .max(160, "Keep the title under 160 characters."),
  rationale: z
    .string()
    .trim()
    .min(10, "Explain why this change might help.")
    .max(2000, "Keep the rationale under 2000 characters."),
  change_text: z
    .string()
    .trim()
    .min(10, "Describe the proposed change.")
    .max(3000, "Keep the change under 3000 characters."),
  consent_confirmed: z.boolean(),
  test_scope: z
    .string()
    .trim()
    .min(10, "Describe the consented test set, even briefly.")
    .max(500, "Keep the scope under 500 characters."),
});

export type OutcomeReviewInput = z.infer<typeof outcomeReviewSchema>;
export type ObservationInput = z.infer<typeof observationSchema>;
export type AssessmentInput = z.infer<typeof assessmentSchema>;
export type ForecastInput = z.infer<typeof forecastSchema>;
export type ImprovementInput = z.infer<typeof improvementSchema>;
