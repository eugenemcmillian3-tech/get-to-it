/**
 * Phase 38 live trials.
 *
 * A live configuration is graded on an answer the model never sees. The seeded
 * tasks cannot support that: they are scored by matching named elements, and
 * those names are the verbs of the prompt, so a model could repeat them and
 * score a pass without doing any work. The tasks below carry a problem, and the
 * expected total is computed here and written only into the answer key.
 *
 * Pure functions only: no database, no provider, no secrets. The server action
 * and the unit tests share exactly this code.
 */

import type { ChatMessage } from "@/lib/ai/ollama";
import { isAiModel } from "@/lib/ai/models";
import { CAPABILITY_LIMITS } from "@/lib/capability-eval";
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

export type AuthoredTask = {
  split: "development" | "held_out";
  difficulty: "easy" | "medium" | "hard";
  title: string;
  problem: string;
  /** Computed, never written into the prompt. */
  expected: number;
  tolerance: number;
};

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

export const AUTHORED_TASKS: AuthoredTask[] = [
  {
    split: "development",
    difficulty: "medium",
    title: "Repair budget remainder — development",
    problem: windowProblem(WINDOW),
    expected: remainingMinutes(WINDOW),
    tolerance: 0,
  },
  {
    split: "held_out",
    difficulty: "medium",
    title: "Repair budget remainder — held out",
    problem: windowProblem(SECOND_WINDOW),
    expected: remainingMinutes(SECOND_WINDOW),
    tolerance: 0,
  },
];

/**
 * The prompt states the problem and the reply shape. It never states the
 * expected value, and the arithmetic above is the only place it exists.
 */
export function liveTrialMessages(task: { task_spec: { prompt?: unknown } }): ChatMessage[] {
  const prompt = typeof task.task_spec?.prompt === "string" ? task.task_spec.prompt : "";
  return [
    {
      role: "system",
      content:
        'You are answering a scored task. Work it out, then reply with JSON only, in the form {"answer": <number>, "working": "<one sentence>"}. The answer must be a number of minutes. Do not add anything outside the JSON.',
    },
    { role: "user", content: prompt },
  ];
}

export type LiveAnswer = { ok: true; answer: number } | { ok: false; reason: string };

/** Strict: a bare number is not accepted, because the reply shape is part of the contract. */
export function parseLiveAnswer(content: string): LiveAnswer {
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
  if (typeof answer !== "number" || !Number.isFinite(answer)) {
    return { ok: false, reason: "The model's reply did not contain a numeric answer." };
  }
  return { ok: true, answer };
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
