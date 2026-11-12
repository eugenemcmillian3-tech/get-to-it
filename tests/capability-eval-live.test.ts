import { describe, expect, it } from "vitest";
import { CAPABILITY_DOMAIN_IDS } from "@/lib/capability-eval";
import {
  AUTHORED_TASKS,
  LIVE_TRIAL_COST_CENTS,
  LIVE_TRIAL_CREDIT_COST,
  LIVE_TRIAL_LIMITS,
  answerKind,
  liveTrialMessages,
  liveTrialReadiness,
  liveTrialTimeoutMs,
  parseLiveAnswer,
} from "@/lib/capability-eval-live";

const liveVersion = {
  model_version: "deepseek-v4-pro",
  spend_limit_cents: 20,
  runtime_limit_seconds: 120,
};
const liveTask = { spend_limit_cents: 20, runtime_seconds: 120 };
const ready = {
  hasModelKey: true,
  version: liveVersion,
  task: liveTask,
  spentCents: 0,
};

describe("authored machine-checkable tasks", () => {
  it("covers every capability domain with a development and a held-out task", () => {
    for (const domain of CAPABILITY_DOMAIN_IDS) {
      const rows = AUTHORED_TASKS.filter((task) => task.domain === domain);
      expect(rows.map((task) => task.split).sort()).toEqual(["development", "held_out"]);
    }
    expect(AUTHORED_TASKS).toHaveLength(CAPABILITY_DOMAIN_IDS.length * 2);
  });

  it("never states a numeric answer except as one of several listed steps", () => {
    for (const task of AUTHORED_TASKS) {
      if (task.expected === undefined) continue;
      const standalone = new RegExp(`(^|\\D)${task.expected}(\\D|$)`);
      if (task.options) {
        // A choice among referenced steps: the answer must not be the only one.
        expect(task.options.length).toBeGreaterThanOrEqual(3);
        expect(task.options).toContain(String(task.expected));
        continue;
      }
      expect(task.problem).not.toMatch(standalone);
    }
  });

  it("never offers a text answer as the only option", () => {
    for (const task of AUTHORED_TASKS) {
      if (task.expectedText === undefined) continue;
      expect(task.options?.length ?? 0).toBeGreaterThanOrEqual(3);
      expect(task.options).toContain(task.expectedText);
      const others = (task.options ?? []).filter((option) => option !== task.expectedText);
      expect(others.length).toBeGreaterThan(0);
      for (const option of task.options ?? []) {
        expect(task.problem.toLowerCase()).toContain(option.toLowerCase());
      }
    }
  });

  it("computes the answers its own problems describe", () => {
    const byTitle = (needle: string) => {
      const task = AUTHORED_TASKS.find((entry) => entry.title.includes(needle));
      if (!task) throw new Error(`missing task: ${needle}`);
      return task;
    };

    // 240 - (18 + 6 * (9 + 14) + 25) and 300 - (24 + 4 * (11 + 19) + 30)
    expect(byTitle("Repair budget remainder — development").expected).toBe(59);
    expect(byTitle("Repair budget remainder — held out").expected).toBe(126);

    expect(byTitle("Acceptable sources left uncited — development").expected).toBe(1);
    expect(byTitle("Acceptable sources left uncited — held out").expected).toBe(3);

    // 120 * 6 * (1 + 1/4 * 1/2) and 80 * 10 * (1 + 1/5 * 1/2)
    expect(byTitle("Weighted throughput — development").expected).toBe(810);
    expect(byTitle("Weighted throughput — held out").expected).toBe(880);

    expect(byTitle("Total citations — development").expected).toBe(9);
    expect(byTitle("Total citations — held out").expected).toBe(13);

    // 45 + 30 + 50 fits 180; adding 70 does not. 45 + 30 + 50 + 60 fits 240.
    expect(byTitle("Tasks inside a fixed window — development").expected).toBe(3);
    expect(byTitle("Tasks inside a fixed window — held out").expected).toBe(4);

    expect(byTitle("Find the step that broke it — development").expected).toBe(3);
    expect(byTitle("Find the step that broke it — held out").expected).toBe(2);

    expect(byTitle("Choose one permitted tool — development").expectedText).toBe("search");
    expect(byTitle("Choose one permitted tool — held out").expectedText).toBe("run_tests");

    expect(byTitle("Missing required key — development").expectedText).toBe("name");
    expect(byTitle("Missing required key — held out").expectedText).toBe("currency");
  });

  it("asks for the reply shape that matches the answer kind", () => {
    const numeric = AUTHORED_TASKS.find((task) => task.expected !== undefined);
    const textual = AUTHORED_TASKS.find((task) => task.expectedText !== undefined);
    if (!numeric || !textual) throw new Error("expected both kinds");

    const numberPrompt = liveTrialMessages(
      { task_spec: { prompt: numeric.problem } },
      answerKind(numeric),
    )
      .map((message) => message.content)
      .join("\n");
    expect(numberPrompt).toContain('"answer": <number>');

    const textPrompt = liveTrialMessages(
      { task_spec: { prompt: textual.problem } },
      answerKind(textual),
    )
      .map((message) => message.content)
      .join("\n");
    expect(textPrompt).toContain('"answer": "<one of the listed names>"');
  });

  it("tolerates an empty task spec without throwing", () => {
    expect(liveTrialMessages({ task_spec: {} }, "number")).toHaveLength(2);
  });
});

describe("parseLiveAnswer", () => {
  it("accepts a JSON object with a numeric answer", () => {
    expect(parseLiveAnswer('{"answer": 59, "working": "240 - 181"}', "number")).toEqual({
      ok: true,
      answer: 59,
    });
  });

  it("accepts a JSON object with a text answer", () => {
    expect(parseLiveAnswer('{"answer": " search "}', "text")).toEqual({
      ok: true,
      answer: "search",
    });
  });

  it("rejects the wrong kind of answer", () => {
    expect(parseLiveAnswer('{"answer": "59"}', "number").ok).toBe(false);
    expect(parseLiveAnswer('{"answer": 59}', "text").ok).toBe(false);
  });

  it("rejects a bare value, prose and empty replies", () => {
    expect(parseLiveAnswer("59", "number").ok).toBe(false);
    expect(parseLiveAnswer('The answer is 59', "number").ok).toBe(false);
    expect(parseLiveAnswer('{"working": "59"}', "number").ok).toBe(false);
    expect(parseLiveAnswer("", "number").ok).toBe(false);
    expect(parseLiveAnswer("[59]", "number").ok).toBe(false);
  });
});

describe("liveTrialReadiness", () => {
  it("allows a paid trial when the ceilings cover it", () => {
    expect(liveTrialReadiness(ready)).toEqual({
      ok: true,
      chargeCents: LIVE_TRIAL_COST_CENTS,
      remainingCents: 20,
      runtimeLimitSeconds: 120,
    });
  });

  it("refuses without a model key", () => {
    const outcome = liveTrialReadiness({ ...ready, hasModelKey: false });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/OLLAMA_API_KEY/);
  });

  it("refuses a fixture configuration", () => {
    const outcome = liveTrialReadiness({
      ...ready,
      version: { ...liveVersion, model_version: "fixture-model-v1" },
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/not a live model configuration/);
  });

  it("refuses a free ceiling, which is what every fixture run records", () => {
    const outcome = liveTrialReadiness({
      ...ready,
      version: { ...liveVersion, spend_limit_cents: 0 },
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/allow at most 0/);
  });

  it("uses the stricter of the task and configuration ceilings", () => {
    const outcome = liveTrialReadiness({
      ...ready,
      task: { ...liveTask, spend_limit_cents: 5 },
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/at most 5/);
  });

  it("refuses once the ceiling is spent", () => {
    const outcome = liveTrialReadiness({ ...ready, spentCents: 20 });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/not enough for another/);
  });

  it("refuses a runtime limit too short to call a model", () => {
    const outcome = liveTrialReadiness({
      ...ready,
      task: { ...liveTask, runtime_seconds: 5 },
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatch(/at least 10 seconds/);
  });

  it("keeps the request inside the recorded runtime ceiling", () => {
    expect(liveTrialTimeoutMs(120)).toBe(115_000);
    expect(liveTrialTimeoutMs(10)).toBe(10_000);
  });

  it("prices a trial from the approved operation price, not a new number", () => {
    expect(LIVE_TRIAL_CREDIT_COST).toBe(2);
    expect(LIVE_TRIAL_COST_CENTS).toBe(20);
    expect(LIVE_TRIAL_LIMITS.minSpendCents).toBe(LIVE_TRIAL_COST_CENTS);
  });
});
