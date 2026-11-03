/**
 * Learning mode: the contract between GET TO IT and the model, plus the rules
 * the interface has to keep.
 *
 * Everything here is pure so it can be tested with fixtures. The rules encoded
 * below are the point of the feature:
 *
 *   * Generated material is labelled and never presented as a source of truth.
 *   * No citation, link or statistic may be invented; and because learning mode
 *     does no retrieval, there are no sources to show, which the UI says plainly.
 *   * No mastery-by-a-date promise and no qualification. AI feedback is an
 *     opinion about one answer, kept separate from confidence and completion.
 *   * A hint comes before a full answer; the hint request forbids the answer.
 */

import { z } from "zod";
import type { ChatMessage } from "@/lib/ai/ollama";
import { extractJsonObject } from "@/lib/ai/plan";
import { parseTaskHelpReply } from "@/lib/ai/task-help";
import { formatMinutes } from "@/lib/format";
import { preferenceContextLines } from "@/lib/preferences";
import type {
  LearningExperience,
  LearningRecord,
  LearningStep,
  LearningStepKind,
  UserPreferences,
} from "@/lib/types";

export const LEARNING_EXPERIENCE_OPTIONS: readonly {
  value: LearningExperience;
  label: string;
  hint: string;
}[] = [
  { value: "new", label: "Just starting", hint: "Little or no experience with this." },
  { value: "some", label: "Some experience", hint: "I know the basics and want to get better." },
  { value: "confident", label: "Fairly confident", hint: "I want structure and harder practice." },
];

export const LEARNING_KIND_LABELS: Record<LearningStepKind, string> = {
  explanation: "Explanation",
  practice: "Practice",
  project: "Small project",
  checkpoint: "Checkpoint",
};

/** Shown beside every generated step. */
export const GENERATED_CONTENT_NOTE =
  "AI-generated learning material. It can be incomplete or wrong — check anything that matters against a source you trust.";

/** Learning mode does no retrieval, so it has no sources to show. */
export const SOURCES_NOTE =
  "Learning mode does not search the web, so no sources are retrieved or cited here. There are no references to follow up.";

/** AI feedback is never a qualification. */
export const NOT_QUALIFICATION_NOTE =
  "This is AI feedback on your answer: an opinion, not a grade, certificate or qualification.";

export const LEARNING_PATH_MIN_STEPS = 3;
export const LEARNING_PATH_MAX_STEPS = 8;
export const MAX_LEARNING_ANSWER = 4000;
export const MAX_LEARNING_FEEDBACK = 6000;

export const learningPlanInputSchema = z.object({
  what_to_learn: z
    .string()
    .trim()
    .min(3, "Say what you want to learn.")
    .max(200, "Keep this under 200 characters."),
  experience: z.enum(["new", "some", "confident"]),
  outcome: z
    .string()
    .trim()
    .min(5, "Describe one concrete thing you want to be able to do.")
    .max(500, "Keep the outcome under 500 characters."),
  minutes_per_week: z.coerce
    .number()
    .int("Use whole minutes.")
    .min(15, "Choose at least 15 minutes a week.")
    .max(2400, "Keep it under 40 hours a week."),
});

export type LearningPlanInput = z.infer<typeof learningPlanInputSchema>;

export const learningPathStepSchema = z.object({
  kind: z.enum(["explanation", "practice", "project", "checkpoint"]),
  title: z.string().trim().min(2).max(200),
  body: z.string().trim().min(10).max(4000),
  estimated_minutes: z.coerce.number().int().min(5).max(120),
});

export type LearningPathStep = z.infer<typeof learningPathStepSchema>;

const learningPathSchema = z.object({
  steps: z
    .array(learningPathStepSchema)
    .min(LEARNING_PATH_MIN_STEPS)
    .max(LEARNING_PATH_MAX_STEPS),
});

export type LearningPathParseResult =
  | { kind: "path"; steps: LearningPathStep[] }
  | { kind: "invalid"; reason: string };

/**
 * Validates a raw model reply as a learning path.
 *
 * The extra rules — distinct titles, at least one practice, at least one
 * checkpoint — are product rules, not model preferences: a path that is all
 * reading, or has nothing to practise, is not saved.
 */
export function parseLearningPath(raw: string): LearningPathParseResult {
  const object = extractJsonObject(raw);
  if (!object) return { kind: "invalid", reason: "unreadable-json" };

  const rawSteps = object.steps;
  if (!Array.isArray(rawSteps)) return { kind: "invalid", reason: "missing-steps" };
  if (rawSteps.length < LEARNING_PATH_MIN_STEPS) {
    return { kind: "invalid", reason: "too-few-steps" };
  }
  if (rawSteps.length > LEARNING_PATH_MAX_STEPS) {
    return { kind: "invalid", reason: "too-many-steps" };
  }

  const parsed = learningPathSchema.safeParse(object);
  if (!parsed.success) return { kind: "invalid", reason: "bad-step" };

  const titles = parsed.data.steps.map((step) => step.title.toLowerCase());
  if (new Set(titles).size !== titles.length) {
    return { kind: "invalid", reason: "duplicate-titles" };
  }

  if (!parsed.data.steps.some((step) => step.kind === "practice")) {
    return { kind: "invalid", reason: "no-practice" };
  }
  if (!parsed.data.steps.some((step) => step.kind === "checkpoint")) {
    return { kind: "invalid", reason: "no-checkpoint" };
  }

  return { kind: "path", steps: parsed.data.steps };
}

const PATH_SYSTEM_PROMPT = [
  "You design a short, practical learning path for one person working on a goal they already chose.",
  "They can edit or skip every step, so make each step a suggestion, not a requirement.",
  "Use only the details you are given. Never invent sources, citations, links, books, courses, statistics, people or prices.",
  "If something is uncertain or depends on their context, say so inside the step instead of guessing.",
  "Never promise mastery, fluency, a qualification or a finished skill by a particular date.",
  "Include at least one practice step and at least one checkpoint.",
  "Bodies are short: two to four sentences, or a short numbered list, under 900 characters.",
  "Reply with JSON only: no prose, no markdown, no code fences.",
  'Shape: {"steps": [{"kind": "explanation", "title": "...", "body": "...", "estimated_minutes": 15}]}',
  "kind is one of explanation, practice, project, checkpoint. estimated_minutes is a whole number from 5 to 120.",
  "Give every step a distinct title, in the order they should be worked through, and keep the total close to the time they have each week.",
  "Never diagnose, treat or give medical, legal or financial advice.",
].join(" ");

/** The generation prompt. Preference lines appear only when personalisation is on. */
export function buildLearningPathMessages(
  input: LearningPlanInput,
  preferences?: UserPreferences | null,
): ChatMessage[] {
  const experience =
    LEARNING_EXPERIENCE_OPTIONS.find((option) => option.value === input.experience)
      ?.label ?? input.experience;

  const lines = [
    `What they want to learn: ${input.what_to_learn}`,
    `Current experience: ${experience}`,
    `Concrete outcome they want: ${input.outcome}`,
    `Time available: ${formatMinutes(input.minutes_per_week)} per week`,
    ...preferenceContextLines(preferences),
    "Return the JSON now.",
  ];

  return [
    { role: "system", content: PATH_SYSTEM_PROMPT },
    { role: "user", content: lines.join("\n") },
  ];
}

// ---------------------------------------------------------------------------
// Step-level help
// ---------------------------------------------------------------------------

export const LEARNING_HELP_INTENTS = [
  "explain-concept",
  "worked-example",
  "practice-exercise",
  "hint",
  "review-answer",
] as const;

export type LearningHelpIntent = (typeof LEARNING_HELP_INTENTS)[number];

export const LEARNING_HELP_LABELS: Record<LearningHelpIntent, string> = {
  "explain-concept": "Explain this concept",
  "worked-example": "Show a worked example",
  "practice-exercise": "Give me a practice exercise",
  hint: "Give me a hint",
  "review-answer": "Review my answer",
};

export function isLearningHelpIntent(value: string): value is LearningHelpIntent {
  return (LEARNING_HELP_INTENTS as readonly string[]).includes(value);
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const learningHelpRequestSchema = z
  .object({
    step_id: z.string().trim().regex(UUID_PATTERN, "That step link doesn't look right."),
    intent: z.enum(LEARNING_HELP_INTENTS),
    answer: z.string().max(MAX_LEARNING_ANSWER).default(""),
    model: z.string().trim().max(100).default(""),
  })
  .superRefine((value, ctx) => {
    if (value.intent === "review-answer" && value.answer.trim().length < 2) {
      ctx.addIssue({
        code: "custom",
        message: "Write an answer before asking for a review.",
        path: ["answer"],
      });
    }
  });

export type LearningHelpRequest = z.infer<typeof learningHelpRequestSchema>;

const HELP_SYSTEM_PROMPT = [
  "You help one person work through a learning step they are practising right now.",
  "They are doing the learning: explain and hint, never pretend to have completed anything for them.",
  "Use only the step, their saved answer and the details you are given.",
  "Never invent citations, links, books, courses, statistics, names or sources. If a claim would need a source, say that you cannot verify it.",
  "When you are unsure, say so plainly inside the answer.",
  "Never promise mastery or a qualification, never issue a grade, mark or certificate, and never call your own opinion an assessment.",
  "Never diagnose, treat or give medical, legal or financial advice.",
  "Reply in plain text: no headings, no markdown, no code fences, no HTML.",
  "Keep it under 200 words unless the request explicitly asks for more detail.",
].join(" ");

const INTENT_PROMPTS: Record<LearningHelpIntent, string> = {
  "explain-concept":
    "Explain this concept again in simpler words, with one everyday analogy. Do not add unrelated topics, and say if the analogy only partly fits.",
  "worked-example":
    "Show one worked example, step by step. Make clear it is an example rather than their answer, and do not claim it is the only correct approach.",
  "practice-exercise":
    "Give me one short practice exercise for this step. Do not include the answer: describe what a good attempt would contain and one way to check it.",
  hint:
    "Give me one hint only, in at most two sentences. Do not reveal the full answer, do not give the working, and do not list the steps to it.",
  "review-answer":
    "Review the answer below against this step. Say what is working, what is missing or unclear, and one next change. Do not give a mark or grade, do not call it correct or incorrect overall, and do not claim this proves mastery.",
};

export type LearningHelpContext = {
  plan: {
    what_to_learn: string;
    outcome: string;
    experience: LearningExperience;
    minutes_per_week: number;
  };
  step: Pick<LearningStep, "kind" | "title" | "body">;
  answer: string;
};

/** The step-help prompt. A hint is explicitly forbidden from containing the answer. */
export function buildLearningHelpMessages(
  context: LearningHelpContext,
  intent: LearningHelpIntent,
  preferences?: UserPreferences | null,
): ChatMessage[] {
  const experience =
    LEARNING_EXPERIENCE_OPTIONS.find(
      (option) => option.value === context.plan.experience,
    )?.label ?? context.plan.experience;

  const lines = [
    `Learning goal: ${context.plan.what_to_learn}`,
    `Outcome they want: ${context.plan.outcome}`,
    `Experience: ${experience}. Time: ${formatMinutes(context.plan.minutes_per_week)} per week.`,
    `This step (${LEARNING_KIND_LABELS[context.step.kind]}): ${context.step.title}`,
    `Step material: ${context.step.body}`,
    context.answer.trim() === ""
      ? "Their answer: nothing written yet."
      : `Their answer:\n${context.answer}`,
    ...preferenceContextLines(preferences),
    INTENT_PROMPTS[intent],
  ];

  return [
    { role: "system", content: HELP_SYSTEM_PROMPT },
    { role: "user", content: lines.join("\n") },
  ];
}

export type LearningReplyParseResult =
  | { kind: "ok"; text: string }
  | { kind: "invalid"; reason: "empty" | "no-words" };

/** Same normalisation as task help: plain text, markup stripped. */
export function parseLearningReply(raw: string): LearningReplyParseResult {
  return parseTaskHelpReply(raw);
}

// ---------------------------------------------------------------------------
// Evidence and progress
// ---------------------------------------------------------------------------

export const CONFIDENCE_OPTIONS = [
  { value: 1, label: "Not yet" },
  { value: 2, label: "Shaky" },
  { value: 3, label: "Getting there" },
  { value: 4, label: "Fairly confident" },
  { value: 5, label: "Confident" },
] as const;

export function confidenceLabel(value: number | null): string {
  if (value === null) return "Not recorded";
  return CONFIDENCE_OPTIONS.find((option) => option.value === value)?.label ?? "Not recorded";
}

export type LearningEvidence = {
  /** The model's opinion, or null. Never a grade. */
  aiFeedback: string | null;
  /** What the person said about their own confidence. */
  confidence: number | null;
  confidenceLabel: string;
  /** The person's own "I finished this" mark. */
  completed: boolean;
  revisit: boolean;
};

/**
 * Keeps the three kinds of evidence separate. Completing an exercise never
 * creates feedback, feedback never changes confidence, and a checkpoint's
 * approval is a fourth, separate fact stored on the step itself.
 */
export function learningEvidence(record: LearningRecord | null): LearningEvidence {
  return {
    aiFeedback: record?.feedback ?? null,
    confidence: record?.confidence ?? null,
    confidenceLabel: confidenceLabel(record?.confidence ?? null),
    completed: Boolean(record?.completed_at),
    revisit: Boolean(record?.revisit),
  };
}

export type LearningProgress = {
  total: number;
  skipped: number;
  checkpoints: number;
  approvedCheckpoints: number;
};

export function learningProgress(steps: LearningStep[]): LearningProgress {
  return {
    total: steps.length,
    skipped: steps.filter((step) => step.status === "skipped").length,
    checkpoints: steps.filter((step) => step.kind === "checkpoint").length,
    approvedCheckpoints: steps.filter(
      (step) => step.kind === "checkpoint" && step.approved_at !== null,
    ).length,
  };
}

/**
 * Where to return to: the first active step they have not marked finished.
 * Skipped steps are never offered, and unfinished work comes before a step
 * they already completed.
 */
export function resumeStep(
  steps: LearningStep[],
  records: LearningRecord[],
): LearningStep | null {
  const active = steps.filter((step) => step.status === "active");
  const completed = new Set(
    records.filter((record) => record.completed_at !== null).map((record) => record.step_id),
  );
  return active.find((step) => !completed.has(step.id)) ?? active[0] ?? null;
}

/** Label for one learning record, used where records are listed. */
export function recordSummary(record: LearningRecord): string {
  const parts = [
    record.answer.trim() === "" ? "No answer yet" : "Answer saved",
    record.feedback ? "AI feedback saved" : "No AI feedback",
    `Confidence: ${confidenceLabel(record.confidence)}`,
    record.completed_at ? "Marked finished" : "Not marked finished",
  ];
  return parts.join(" · ");
}
