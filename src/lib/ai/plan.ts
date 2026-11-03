/**
 * Planning contract between GET TO IT and the model.
 *
 * Everything here is pure: schemas, the defensive parser, the prompt, and the
 * preview snapshot. That keeps the risky part — trusting model output — under
 * unit tests with fixtures, and keeps the server action thin.
 */

import { z } from "zod";
import type { ChatMessage } from "@/lib/ai/ollama";
import { formatDeadline, formatMinutes } from "@/lib/format";
import { preferenceContextLines } from "@/lib/preferences";
import type { UserPreferences } from "@/lib/types";

export const MIN_PLAN_TASKS = 3;
export const MAX_PLAN_TASKS = 7;

/** A task exactly as the model must return it. Nothing is optional. */
export const planTaskSchema = z.object({
  title: z.string().trim().min(2).max(200),
  instructions: z.string().trim().min(5).max(2000),
  first_action: z.string().trim().min(3).max(300),
  expected_deliverable: z.string().trim().min(2).max(300),
  estimated_minutes: z.coerce.number().int().min(5).max(240),
});

export type PlanTask = z.infer<typeof planTaskSchema>;

export const planQuestionsSchema = z.object({
  questions: z.array(z.string().trim().min(5).max(300)).min(1).max(3),
});

export const planTasksSchema = z.object({
  tasks: z.array(planTaskSchema).min(MIN_PLAN_TASKS).max(MAX_PLAN_TASKS),
});

export type PlanParseResult =
  | { kind: "questions"; questions: string[] }
  | { kind: "plan"; tasks: PlanTask[] }
  | { kind: "invalid"; reason: string };

/**
 * Pulls a JSON object out of whatever the model actually sent: bare JSON, a
 * fenced block, or JSON buried in a sentence. Returns null when there is no
 * object to be found.
 */
export function extractJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  const unfenced = trimmed
    .replace(/^```[a-zA-Z]*\s*/, "")
    .replace(/```\s*$/, "")
    .trim();

  const candidates = [unfenced];
  const firstBrace = unfenced.indexOf("{");
  const lastBrace = unfenced.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(unfenced.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

/**
 * Validates a raw model reply as either clarification questions or a plan.
 * Anything else is rejected outright — GET TO IT never shows unvalidated text
 * as a plan.
 */
export function parsePlanResponse(raw: string): PlanParseResult {
  const object = extractJsonObject(raw);
  if (!object) return { kind: "invalid", reason: "unreadable-json" };

  const hasQuestions = "questions" in object;
  const hasTasks = "tasks" in object;

  if (hasQuestions && hasTasks) {
    return { kind: "invalid", reason: "ambiguous-shape" };
  }

  if (hasQuestions) {
    const parsed = planQuestionsSchema.safeParse(object);
    if (!parsed.success) return { kind: "invalid", reason: "bad-questions" };
    return { kind: "questions", questions: parsed.data.questions };
  }

  if (!hasTasks) return { kind: "invalid", reason: "missing-tasks" };

  const rawTasks = object.tasks;
  if (!Array.isArray(rawTasks)) return { kind: "invalid", reason: "tasks-not-list" };
  if (rawTasks.length < MIN_PLAN_TASKS) return { kind: "invalid", reason: "too-few-tasks" };
  if (rawTasks.length > MAX_PLAN_TASKS) return { kind: "invalid", reason: "too-many-tasks" };

  const parsed = planTasksSchema.safeParse(object);
  if (!parsed.success) return { kind: "invalid", reason: "bad-task" };

  const titles = parsed.data.tasks.map((task) => task.title.toLowerCase());
  if (new Set(titles).size !== titles.length) {
    return { kind: "invalid", reason: "duplicate-tasks" };
  }

  return { kind: "plan", tasks: parsed.data.tasks };
}

/** Clarification answers coming back from the browser. */
export const planAnswersSchema = z.object({
  answers: z
    .array(
      z.object({
        question: z.string().trim().max(300),
        answer: z.string().trim().max(500),
      }),
    )
    .min(1)
    .max(3),
});

export type PlanAnswer = z.infer<typeof planAnswersSchema>["answers"][number];

/**
 * A task on its way back from the editable preview. The person may clear the
 * optional guidance fields, so only the title and the estimate are required.
 */
export const planSaveTaskSchema = z.object({
  title: z
    .string()
    .trim()
    .min(2, "Give every task a name.")
    .max(200, "Keep task names under 200 characters."),
  instructions: z
    .string()
    .trim()
    .max(2000, "Keep instructions under 2000 characters.")
    .default(""),
  first_action: z
    .string()
    .trim()
    .max(300, "Keep the first action under 300 characters.")
    .default(""),
  expected_deliverable: z
    .string()
    .trim()
    .max(300, "Keep the deliverable under 300 characters.")
    .default(""),
  estimated_minutes: z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? null : value),
    z.coerce
      .number()
      .int("Estimated minutes must be a whole number.")
      .min(5, "Estimates start at 5 minutes.")
      .max(240, "Keep estimates at 240 minutes or less.")
      .nullable(),
  ),
});

export type PlanSaveTask = z.infer<typeof planSaveTaskSchema>;

export const planSaveSchema = z.object({
  goal_id: z.string().trim().max(64),
  snapshot: z.string().trim().min(1).max(200),
  tasks: z
    .array(planSaveTaskSchema)
    .min(1, "Keep at least one task before saving.")
    .max(MAX_PLAN_TASKS, `A plan can hold at most ${MAX_PLAN_TASKS} tasks.`),
});

/**
 * A fingerprint of the goal and its tasks at preview time.
 *
 * Saving compares this against the live state: if anything changed in between
 * (a task completed in another tab, a manual task added), the save is rejected
 * instead of layered on top of work the person hasn't seen.
 */
export function computePlanSnapshot(
  goal: { updated_at: string },
  tasks: { updated_at: string }[],
): string {
  let newest = "";
  for (const task of tasks) {
    if (task.updated_at > newest) newest = task.updated_at;
  }
  return `${goal.updated_at}|${tasks.length}|${newest}`;
}

export function isPlanSnapshotStale(expected: string, current: string): boolean {
  return expected !== current;
}

export type PlanContext = {
  title: string;
  desiredOutcome: string;
  deadline: string | null;
  timeAvailableMinutes: number;
  blocker: string | null;
  openTasks: string[];
  completedTasks: string[];
};

const SYSTEM_PROMPT = [
  "You turn one personal goal into a short, realistic plan of 3 to 7 tasks.",
  "Each task must be something the person could start today and either finish or clearly advance.",
  "Use only the context you are given. Never invent deadlines, people, tools, budgets or resources.",
  "Reply with JSON only: no prose, no markdown, no code fences.",
  "Reply in exactly one of these two shapes.",
  'Shape A, when a missing detail would change the plan: {"questions": ["..."]} with one to three questions.',
  'Shape B, when you can plan without guessing: {"tasks": [{"title": "...", "instructions": "...", "first_action": "...", "expected_deliverable": "...", "estimated_minutes": 15}]} with three to seven tasks.',
  "Task rules: title under 120 characters; instructions one to three sentences on how to do it;",
  "first_action one concrete thing they can do in two minutes; expected_deliverable what exists when it is done;",
  "estimated_minutes a whole number from 5 to 120.",
  "Make the total estimate fit the time they said they have today when that is realistic.",
  "Give every task a distinct title. Prefer unblocking the thing they said is in the way.",
  "Ask questions only when the goal is too vague to plan honestly. Otherwise return tasks.",
  "Never diagnose, treat or give medical, legal or financial advice.",
].join(" ");

function describeContext(context: PlanContext): string {
  const deadline = context.deadline ? formatDeadline(context.deadline) : null;

  return [
    `Goal: ${context.title}`,
    `What done looks like: ${context.desiredOutcome}`,
    deadline ? `Deadline: ${deadline}` : "No deadline.",
    `Time available today: ${formatMinutes(context.timeAvailableMinutes)}`,
    context.blocker ? `What has been in the way: ${context.blocker}` : "Nothing named as in the way.",
    context.openTasks.length > 0
      ? `Tasks they already have: ${context.openTasks.join("; ")}`
      : "They have no tasks yet.",
    context.completedTasks.length > 0
      ? `Already finished: ${context.completedTasks.join("; ")}`
      : "",
    "Do not repeat a task they already have or already finished.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * `answers` is present only on the second call, after the person answered the
 * clarification questions. That call must produce a plan, not more questions.
 */
export function buildPlanMessages(
  context: PlanContext,
  answers?: PlanAnswer[],
  preferences?: UserPreferences | null,
): ChatMessage[] {
  const answered = (answers ?? []).filter((answer) => answer.answer.trim() !== "");

  const parts = [describeContext(context)];
  const preferenceLines = preferenceContextLines(preferences);
  if (preferenceLines.length > 0) parts.push(preferenceLines.join("\n"));

  if (answered.length > 0) {
    parts.push(
      `They answered your questions:\n${answered
        .map((answer) => `Q: ${answer.question}\nA: ${answer.answer}`)
        .join("\n")}`,
    );
    parts.push("You now have enough detail. Return Shape B with the tasks.");
  }

  parts.push("Return the JSON now.");

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: parts.join("\n\n") },
  ];
}
