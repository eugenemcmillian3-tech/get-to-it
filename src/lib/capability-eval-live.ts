/**
 * Phase 38 live trials.
 *
 * A live configuration is graded on an answer the model never sees. The seeded
 * tasks cannot support that: they are scored by matching named elements, and
 * those names are the verbs of the prompt, so a model could repeat them and
 * score a pass without doing any work. The tasks below carry a problem, and the
 * expected answer is computed here and written only into the answer key.
 *
 * Every domain has a development task and a held-out task, so no domain is
 * graded by restating its own wording. Answers are either a computed number or
 * one short label chosen from several listed options.
 *
 * Pure functions only: no database, no provider, no secrets. The server action
 * and the unit tests share exactly this code.
 */

import type { ChatMessage } from "@/lib/ai/ollama";
import { isAiModel } from "@/lib/ai/models";
import { CAPABILITY_LIMITS, type CapabilityDomain } from "@/lib/capability-eval";
import { AI_OPERATION_CREDIT_COSTS, CREDIT_VALUE_CENTS } from "@/lib/credits/pricing";

/**
 * One live trial reserves the existing model-backed task operation: two credits,
 * twenty cents. No new price is invented here.
 */
export const LIVE_TRIAL_KIND = "team_task" as const;
export const LIVE_TRIAL_CREDIT_COST = AI_OPERATION_CREDIT_COSTS[LIVE_TRIAL_KIND];
export const LIVE_TRIAL_COST_CENTS = LIVE_TRIAL_CREDIT_COST * CREDIT_VALUE_CENTS;

/** The task spec marker the server action writes and reads back. */
export const AUTHORED_TASK_MODE = "authored_answer";

export type AnswerKind = "number" | "text";

export type AuthoredTask = {
  domain: CapabilityDomain;
  split: "development" | "held_out";
  difficulty: "easy" | "medium" | "hard";
  title: string;
  problem: string;
  /** Computed, never written into the prompt. */
  expected?: number;
  /** Chosen from `options`, and never stated as the answer. */
  expectedText?: string;
  options?: string[];
  tolerance: number;
};

export function answerKind(task: Pick<AuthoredTask, "expectedText">): AnswerKind {
  return task.expectedText === undefined ? "number" : "text";
}

/* ------------------------------------------------------------------ repair */

const WINDOW = { total: 240, setup: 18, checks: 6, reproduce: 9, patch: 14, verify: 25 };
const SECOND_WINDOW = { total: 300, setup: 24, checks: 4, reproduce: 11, patch: 19, verify: 30 };

function remainingMinutes(window: typeof WINDOW): number {
  return window.total - (window.setup + window.checks * (window.reproduce + window.patch) + window.verify);
}

function windowProblem(window: typeof WINDOW): string {
  return [
    `A repair job has a ${window.total}-minute budget.`,
    `Setup takes ${window.setup} minutes.`,
    `Each of the ${window.checks} failing checks is first reproduced (${window.reproduce} minutes each), then patched (${window.patch} minutes each).`,
    `Verification happens once at the end and takes ${window.verify} minutes, regardless of how many checks were patched.`,
    "How many minutes of the budget remain when the job is finished?",
  ].join(" ");
}

/* ---------------------------------------------------------------- planning */

function fitCount(window: number, required: number, others: number[]): number {
  let used = required;
  let count = 1;
  for (const task of [...others].sort((left, right) => left - right)) {
    if (used + task > window) break;
    used += task;
    count += 1;
  }
  return count;
}

/* ------------------------------------------------------------------ tables */

export const AUTHORED_TASKS: AuthoredTask[] = [
  {
    domain: "software_build_repair",
    split: "development",
    difficulty: "medium",
    title: "Repair budget remainder — development",
    problem: windowProblem(WINDOW),
    expected: remainingMinutes(WINDOW),
    tolerance: 0,
  },
  {
    domain: "software_build_repair",
    split: "held_out",
    difficulty: "medium",
    title: "Repair budget remainder — held out",
    problem: windowProblem(SECOND_WINDOW),
    expected: remainingMinutes(SECOND_WINDOW),
    tolerance: 0,
  },
  {
    domain: "research_synthesis",
    split: "development",
    difficulty: "medium",
    title: "Acceptable sources left uncited — development",
    problem:
      "A review pool holds five sources: three are peer-reviewed, one is a preprint and one is vendor documentation. The protocol accepts peer-reviewed sources only, and each source can be cited once. You must cite exactly two acceptable sources. How many acceptable sources remain uncited?",
    expected: 1,
    tolerance: 0,
  },
  {
    domain: "research_synthesis",
    split: "held_out",
    difficulty: "medium",
    title: "Acceptable sources left uncited — held out",
    problem:
      "A review pool holds seven sources: four are peer-reviewed, two are preprints and one is a vendor page. The protocol accepts peer-reviewed sources only, and each source can be cited once. You must cite exactly one acceptable source. How many acceptable sources remain uncited?",
    expected: 3,
    tolerance: 0,
  },
  {
    domain: "quantitative_reasoning",
    split: "development",
    difficulty: "medium",
    title: "Weighted throughput — development",
    problem:
      "A pipeline processes 120 jobs per hour. One in four jobs needs a second pass, which costs half a job's time again. How many job-slots does 6 hours of processing consume, counting the second passes?",
    expected: 120 * 6 + (120 * 6) / 4 / 2,
    tolerance: 0,
  },
  {
    domain: "quantitative_reasoning",
    split: "held_out",
    difficulty: "medium",
    title: "Weighted throughput — held out",
    problem:
      "A pipeline processes 80 jobs per hour. One in five jobs needs a second pass, which costs half a job's time again. How many job-slots does 10 hours of processing consume, counting the second passes?",
    expected: 80 * 10 + (80 * 10) / 5 / 2,
    tolerance: 0,
  },
  {
    domain: "document_analysis",
    split: "development",
    difficulty: "easy",
    title: "Total citations — development",
    problem:
      "A report has four sections. Section 1 cites nothing. Section 2 cites 3 sources, section 3 cites 5 and section 4 cites 1. How many sources does the report cite across all sections?",
    expected: 9,
    tolerance: 0,
  },
  {
    domain: "document_analysis",
    split: "held_out",
    difficulty: "easy",
    title: "Total citations — held out",
    problem:
      "A report has five sections. Section 1 cites nothing. Section 2 cites 4 sources, section 3 cites 2, section 4 cites 7 and section 5 cites nothing. How many sources does the report cite across all sections?",
    expected: 13,
    tolerance: 0,
  },
  {
    domain: "planning_under_constraints",
    split: "development",
    difficulty: "medium",
    title: "Tasks inside a fixed window — development",
    problem:
      "You have 180 minutes. Task A takes 45 minutes, B takes 30, C takes 50 and D takes 70. A must be included. What is the largest number of tasks you can complete?",
    expected: fitCount(180, 45, [30, 50, 70]),
    tolerance: 0,
  },
  {
    domain: "planning_under_constraints",
    split: "held_out",
    difficulty: "medium",
    title: "Tasks inside a fixed window — held out",
    problem:
      "You have 240 minutes. Task A takes 45 minutes, B takes 30, C takes 50, D takes 70 and E takes 60. A must be included. What is the largest number of tasks you can complete?",
    expected: fitCount(240, 45, [30, 50, 70, 60]),
    tolerance: 0,
  },
  {
    domain: "tool_selection_execution",
    split: "development",
    difficulty: "easy",
    title: "Choose one permitted tool — development",
    problem:
      "Only search, read_files and run_tests are permitted. You must find which file references a given symbol, without changing anything. Answer with the single permitted tool name.",
    expectedText: "search",
    options: ["search", "read_files", "run_tests"],
    tolerance: 0,
  },
  {
    domain: "tool_selection_execution",
    split: "held_out",
    difficulty: "easy",
    title: "Choose one permitted tool — held out",
    problem:
      "Only run_tests, read_files and search are permitted. You must confirm whether the existing suite still passes after a change, without modifying any file. Answer with the single permitted tool name.",
    expectedText: "run_tests",
    options: ["run_tests", "read_files", "search"],
    tolerance: 0,
  },
  {
    domain: "error_recovery",
    split: "development",
    difficulty: "medium",
    title: "Find the step that broke it — development",
    problem:
      "Step 2 updates a lockfile. Step 3 applies a patch to a shared config. Step 4's tests fail. Step 5 rolls the config back and the tests pass. Which step introduced the fault? Answer with the step number.",
    expected: 3,
    options: ["2", "3", "4", "5"],
    tolerance: 0,
  },
  {
    domain: "error_recovery",
    split: "held_out",
    difficulty: "medium",
    title: "Find the step that broke it — held out",
    problem:
      "Step 2 upgrades a dependency. Step 3's build fails. Step 4 pins the previous version and the build passes. Step 5 reruns the tests. Which step introduced the fault? Answer with the step number.",
    expected: 2,
    options: ["2", "3", "4", "5"],
    tolerance: 0,
  },
  {
    domain: "unfamiliar_formats",
    split: "development",
    difficulty: "easy",
    title: "Missing required key — development",
    problem:
      "The specification requires the keys id, name and total. The payload is {id, title, total}. Which required key is missing? Answer with the key name only.",
    expectedText: "name",
    options: ["id", "name", "total"],
    tolerance: 0,
  },
  {
    domain: "unfamiliar_formats",
    split: "held_out",
    difficulty: "easy",
    title: "Missing required key — held out",
    problem:
      "The specification requires the keys sku, price and currency. The payload is {sku, price, tax}. Which required key is missing? Answer with the key name only.",
    expectedText: "currency",
    options: ["sku", "price", "currency"],
    tolerance: 0,
  },
];

/**
 * The prompt states the problem and the reply shape. It never states the
 * expected number, and no text answer is offered as the only option.
 */
export function liveTrialMessages(
  task: { task_spec: { prompt?: unknown } },
  kind: AnswerKind,
): ChatMessage[] {
  const prompt = typeof task.task_spec?.prompt === "string" ? task.task_spec.prompt : "";
  const shape =
    kind === "number"
      ? '{"answer": <number>, "working": "<one sentence>"}'
      : '{"answer": "<one of the listed names>", "working": "<one sentence>"}';
  return [
    {
      role: "system",
      content: `You are answering a scored task. Work it out, then reply with JSON only, in the form ${shape}. Do not add anything outside the JSON.`,
    },
    { role: "user", content: prompt },
  ];
}

export type LiveAnswer =
  | { ok: true; answer: number | string }
  | { ok: false; reason: string };

/** Strict: a bare value is not accepted, because the reply shape is part of the contract. */
export function parseLiveAnswer(content: string, kind: AnswerKind): LiveAnswer {
  const text = content.trim();
  if (text.length === 0) return { ok: false, reason: "The model returned an empty reply." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "The model's reply was not valid JSON." };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: "The model's reply was not a JSON object." };
  }
  const answer = (parsed as { answer?: unknown }).answer;
  if (kind === "number") {
    if (typeof answer !== "number" || !Number.isFinite(answer)) {
      return { ok: false, reason: "The model's reply did not contain a numeric answer." };
    }
    return { ok: true, answer };
  }
  if (typeof answer !== "string" || answer.trim().length === 0) {
    return { ok: false, reason: "The model's reply did not contain a text answer." };
  }
  return { ok: true, answer: answer.trim() };
}

export type LiveReadiness =
  | {
      ok: true;
      chargeCents: number;
      remainingCents: number;
      runtimeLimitSeconds: number;
    }
  | { ok: false; reason: string };

/**
 * Everything that must hold before a paid call is made. The database enforces
 * the per-run ceiling again; this check exists so the owner is not charged for a
 * run that cannot be recorded.
 */
export function liveTrialReadiness(input: {
  hasModelKey: boolean;
  version: {
    model_version: string;
    spend_limit_cents: number;
    runtime_limit_seconds: number;
  };
  task: { spend_limit_cents: number; runtime_seconds: number };
  spentCents: number;
}): LiveReadiness {
  if (!input.hasModelKey) {
    return {
      ok: false,
      reason:
        "OLLAMA_API_KEY is not set, so a live trial cannot run. Everything already recorded still stands.",
    };
  }
  if (!isAiModel(input.version.model_version)) {
    return {
      ok: false,
      reason:
        "This configuration is not a live model configuration. Add a live configuration before running a paid trial.",
    };
  }

  const limit = Math.min(input.version.spend_limit_cents, input.task.spend_limit_cents);
  if (limit < LIVE_TRIAL_COST_CENTS) {
    return {
      ok: false,
      reason: `A live trial costs ${LIVE_TRIAL_COST_CENTS} cents, but this task and configuration allow at most ${limit}. Raise the recorded limit first; a limit of 0 means the run must be free.`,
    };
  }

  const remaining = limit - Math.max(0, input.spentCents);
  if (remaining < LIVE_TRIAL_COST_CENTS) {
    return {
      ok: false,
      reason: `This configuration has ${Math.max(0, remaining)} cents of its ${limit}-cent ceiling left, which is not enough for another ${LIVE_TRIAL_COST_CENTS}-cent trial.`,
    };
  }

  const runtimeLimit = Math.min(input.version.runtime_limit_seconds, input.task.runtime_seconds);
  if (!Number.isFinite(runtimeLimit) || runtimeLimit < 10) {
    return {
      ok: false,
      reason: `A live trial needs at least 10 seconds of recorded runtime; this task and configuration allow ${runtimeLimit}.`,
    };
  }

  return {
    ok: true,
    chargeCents: LIVE_TRIAL_COST_CENTS,
    remainingCents: remaining,
    runtimeLimitSeconds: runtimeLimit,
  };
}

/** Stops the request a few seconds inside the recorded ceiling. */
export function liveTrialTimeoutMs(runtimeLimitSeconds: number): number {
  return Math.max(10_000, runtimeLimitSeconds * 1_000 - 5_000);
}

/** Bounds for the prepared configuration, reused by the form and the action. */
export const LIVE_TRIAL_LIMITS = {
  minSpendCents: LIVE_TRIAL_COST_CENTS,
  maxSpendCents: CAPABILITY_LIMITS.maxSpendCents,
  minRuntimeSeconds: 10,
  maxRuntimeSeconds: CAPABILITY_LIMITS.maxRuntimeSeconds,
} as const;
