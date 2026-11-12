import { describe, expect, it } from "vitest";
import {
  AUTHORED_TASKS,
  LIVE_TRIAL_COST_CENTS,
  LIVE_TRIAL_CREDIT_COST,
  LIVE_TRIAL_LIMITS,
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
  it("never states the expected answer in the problem", () => {
    for (const task of AUTHORED_TASKS) {
      expect(task.problem).not.toContain(String(task.expected));
      expect(task.expected).toBeGreaterThan(0);
    }
  });

  it("covers a development and a held-out split with different problems", () => {
    const splits = AUTHORED_TASKS.map((task) => task.split).sort();
    expect(splits).toEqual(["development", "held_out"]);
    expect(new Set(AUTHORED_TASKS.map((task) => task.problem)).size).toBe(AUTHORED_TASKS.length);
  });

  it("computes the remainder from the numbers it describes", () => {
    // 240 - (18 + 6 * (9 + 14) + 25)
    expect(AUTHORED_TASKS[0].expected).toBe(59);
    // 300 - (24 + 4 * (11 + 19) + 30)
    expect(AUTHORED_TASKS[1].expected).toBe(126);
  });

  it("sends the problem and the reply shape, never the answer", () => {
    const messages = liveTrialMessages({ task_spec: { prompt: AUTHORED_TASKS[0].problem } });
    const text = messages.map((message) => message.content).join("\n");
    expect(text).toContain('"answer"');
    expect(text).toContain(AUTHORED_TASKS[0].problem);
    expect(text).not.toContain("59");
  });

  it("tolerates an empty task spec without throwing", () => {
    const messages = liveTrialMessages({ task_spec: {} });
    expect(messages).toHaveLength(2);
  });
});

describe("parseLiveAnswer", () => {
  it("accepts a JSON object with a numeric answer", () => {
    expect(parseLiveAnswer('{"answer": 59, "working": "240 - 181"}')).toEqual({
      ok: true,
      answer: 59,
    });
  });

  it("rejects a bare number, prose and non-numeric answers", () => {
    expect(parseLiveAnswer("59").ok).toBe(false);
    expect(parseLiveAnswer('The answer is 59').ok).toBe(false);
    expect(parseLiveAnswer('{"answer": "59"}').ok).toBe(false);
    expect(parseLiveAnswer('{"working": "59"}').ok).toBe(false);
    expect(parseLiveAnswer("").ok).toBe(false);
    expect(parseLiveAnswer("[59]").ok).toBe(false);
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
