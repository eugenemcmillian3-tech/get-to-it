import { describe, expect, it } from "vitest";
import {
  MODEL_HEALTH_DEGRADED_RATE,
  MODEL_HEALTH_MIN_TASKS,
  MODEL_HEALTH_WATCH_RATE,
  summariseModelHealth,
  type TeamModelSample,
} from "@/lib/agent-team";

const SECURITY = "mimo-v2.6-flash";
const BACKEND = "mimo-v2.6-pro";

function sample(overrides: Partial<TeamModelSample> = {}): TeamModelSample {
  return {
    role: "security",
    model: SECURITY,
    status: "completed",
    retries: 0,
    retry_reason: null,
    ...overrides,
  };
}

function repeat(count: number, overrides: Partial<TeamModelSample> = {}): TeamModelSample[] {
  return Array.from({ length: count }, () => sample(overrides));
}

describe("model health summary", () => {
  it("ignores fixture tasks, unfinished tasks and pre-model history", () => {
    const health = summariseModelHealth([
      sample({ model: null }),
      sample({ model: null, status: "completed" }),
      sample({ status: "queued", retries: 1, retry_reason: "not counted yet" }),
      sample({ status: "running" }),
    ]);
    expect(health).toEqual([]);
  });

  it("counts retries and failures per role and model", () => {
    const health = summariseModelHealth([
      ...repeat(MODEL_HEALTH_MIN_TASKS),
      sample({ retries: 1, retry_reason: "Security reviewer cannot write files." }),
      sample({ status: "failed", retries: 1, retry_reason: "The model did not return valid JSON." }),
    ]);

    expect(health).toHaveLength(1);
    const [row] = health;
    expect(row.role).toBe("security");
    expect(row.model).toBe(SECURITY);
    expect(row.tasks).toBe(MODEL_HEALTH_MIN_TASKS + 2);
    expect(row.retried).toBe(2);
    expect(row.failed).toBe(1);
    expect(row.retryRate).toBeCloseTo(2 / (MODEL_HEALTH_MIN_TASKS + 2), 3);
    expect(row.status).toBe("degraded");
  });

  it("will not call a rate below the sample floor", () => {
    const health = summariseModelHealth([
      sample({ retries: 1, retry_reason: "bad shape" }),
      sample(),
    ]);
    expect(health[0].tasks).toBe(2);
    expect(health[0].retryRate).toBe(0.5);
    expect(health[0].status).toBe("insufficient");
  });

  it("treats a failure as a regression even with one sample", () => {
    const health = summariseModelHealth([sample({ status: "failed" })]);
    expect(health[0].tasks).toBe(1);
    expect(health[0].status).toBe("degraded");
  });

  it("reports a clean role as stable and a rising rate as watch or regression", () => {
    const stable = summariseModelHealth(repeat(20));
    expect(stable[0].status).toBe("stable");
    expect(stable[0].retryRate).toBe(0);

    const watchCount = Math.ceil(MODEL_HEALTH_WATCH_RATE * 20);
    const watch = summariseModelHealth([
      ...repeat(20 - watchCount),
      ...repeat(watchCount, { retries: 1 }),
    ]);
    expect(watch[0].status).toBe("watch");

    const degradedCount = Math.ceil(MODEL_HEALTH_DEGRADED_RATE * 20);
    const degraded = summariseModelHealth([
      ...repeat(20 - degradedCount),
      ...repeat(degradedCount, { retries: 1 }),
    ]);
    expect(degraded[0].status).toBe("degraded");
  });

  it("keeps each model's history separate after a switch", () => {
    const health = summariseModelHealth([
      ...repeat(6, { role: "backend", model: BACKEND }),
      ...repeat(4, {
        role: "backend",
        model: "minimax-m3.1-flash",
        retries: 1,
        retry_reason: "old model",
      }),
    ]);

    expect(health).toHaveLength(2);
    expect(health.map((row) => row.model)).toEqual([BACKEND, "minimax-m3.1-flash"]);
    expect(health[0]).toMatchObject({ tasks: 6, retried: 0, status: "stable" });
    expect(health[1]).toMatchObject({ tasks: 4, retried: 4, status: "degraded" });
  });

  it("keeps the newest retry reason and orders roles like the plan", () => {
    const health = summariseModelHealth([
      sample({ role: "security", retries: 1, retry_reason: "newest rejection" }),
      sample({ role: "security", retries: 1, retry_reason: "older rejection" }),
      sample({ role: "coordinator", model: "glm-5.3-flash" }),
    ]);

    expect(health.map((row) => row.role)).toEqual(["coordinator", "security"]);
    expect(health[1].lastRetryReason).toBe("newest rejection");
  });
});
