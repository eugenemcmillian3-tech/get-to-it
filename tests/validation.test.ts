import { describe, expect, it } from "vitest";
import {
  firstErrorMessage,
  goalInputSchema,
  isUuid,
  safeNextPath,
  signInSchema,
  signUpSchema,
  taskEditSchema,
  taskInputSchema,
  taskResultSchema,
} from "@/lib/validation";

const GOAL_ID = "0b8f3c2e-6c1a-4f5b-9f7e-2d3c4b5a6e7f";
const TASK_ID = "1c9f4d3a-7d2b-4a6c-8a8f-3e4d5c6b7a8b";

const validGoal = {
  title: "Finish my portfolio site",
  desired_outcome: "A live site with three case studies",
  deadline: "",
  time_available_minutes: "30",
  blocker: "",
};

describe("goalInputSchema", () => {
  it("accepts a complete goal and keeps optional fields empty", () => {
    const parsed = goalInputSchema.safeParse(validGoal);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.title).toBe("Finish my portfolio site");
    expect(parsed.data.time_available_minutes).toBe(30);
    expect(parsed.data.deadline).toBe("");
    expect(parsed.data.blocker).toBe("");
  });

  it("trims surrounding whitespace", () => {
    const parsed = goalInputSchema.safeParse({
      ...validGoal,
      title: "   Ship the draft   ",
      blocker: "  I keep rewriting the intro  ",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.title).toBe("Ship the draft");
    expect(parsed.data.blocker).toBe("I keep rewriting the intro");
  });

  it("rejects a title that is too short", () => {
    const parsed = goalInputSchema.safeParse({ ...validGoal, title: "Go" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(firstErrorMessage(parsed.error)).toBe(
      "Give your goal a short, specific title.",
    );
  });

  it("rejects a missing desired outcome", () => {
    expect(
      goalInputSchema.safeParse({ ...validGoal, desired_outcome: "   " }).success,
    ).toBe(false);
  });

  it("rejects an impossible date", () => {
    const parsed = goalInputSchema.safeParse({
      ...validGoal,
      deadline: "2026-02-30",
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(firstErrorMessage(parsed.error)).toBe(
      "That date doesn't exist. Pick another one.",
    );
  });

  it("accepts a real deadline", () => {
    const parsed = goalInputSchema.safeParse({
      ...validGoal,
      deadline: "2026-03-14",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects time outside 5 to 480 minutes", () => {
    expect(
      goalInputSchema.safeParse({ ...validGoal, time_available_minutes: "0" })
        .success,
    ).toBe(false);
    expect(
      goalInputSchema.safeParse({ ...validGoal, time_available_minutes: "999" })
        .success,
    ).toBe(false);
  });

  it("rejects a non-numeric time selection", () => {
    expect(
      goalInputSchema.safeParse({ ...validGoal, time_available_minutes: "" })
        .success,
    ).toBe(false);
  });
});

describe("task schemas", () => {
  it("accepts a task with a valid goal id", () => {
    expect(
      taskInputSchema.safeParse({ goal_id: GOAL_ID, title: "Draft the intro" })
        .success,
    ).toBe(true);
  });

  it("rejects a one character task name", () => {
    expect(
      taskInputSchema.safeParse({ goal_id: GOAL_ID, title: "a" }).success,
    ).toBe(false);
  });

  it("rejects a malformed goal id", () => {
    expect(
      taskInputSchema.safeParse({ goal_id: "not-a-uuid", title: "Draft" }).success,
    ).toBe(false);
  });

  it("validates status when editing", () => {
    const ok = taskEditSchema.safeParse({
      goal_id: GOAL_ID,
      task_id: TASK_ID,
      title: "Draft the intro",
      status: "in_progress",
    });
    expect(ok.success).toBe(true);

    const bad = taskEditSchema.safeParse({
      goal_id: GOAL_ID,
      task_id: TASK_ID,
      title: "Draft the intro",
      status: "done",
    });
    expect(bad.success).toBe(false);
  });
});

describe("taskResultSchema", () => {
  it("defaults the intent to saving without completing", () => {
    const parsed = taskResultSchema.safeParse({
      task_id: TASK_ID,
      goal_id: GOAL_ID,
      content: "Notes so far",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.intent).toBe("save");
    expect(parsed.data.content).toBe("Notes so far");
  });

  it("accepts an explicit complete intent", () => {
    const parsed = taskResultSchema.safeParse({
      task_id: TASK_ID,
      goal_id: GOAL_ID,
      content: "Done",
      intent: "complete",
    });
    expect(parsed.success && parsed.data.intent).toBe("complete");
  });

  it("rejects content beyond the stored limit", () => {
    const parsed = taskResultSchema.safeParse({
      task_id: TASK_ID,
      goal_id: GOAL_ID,
      content: "x".repeat(20001),
    });
    expect(parsed.success).toBe(false);
  });
});

describe("auth schemas", () => {
  it("requires an 8 character password to sign up", () => {
    const parsed = signUpSchema.safeParse({
      display_name: "",
      email: "person@example.com",
      password: "short",
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(firstErrorMessage(parsed.error)).toBe("Use at least 8 characters.");
  });

  it("accepts a valid sign up", () => {
    expect(
      signUpSchema.safeParse({
        display_name: "Sam",
        email: "sam@example.com",
        password: "a-good-password",
      }).success,
    ).toBe(true);
  });

  it("rejects a malformed email", () => {
    expect(
      signInSchema.safeParse({ email: "sam", password: "a-good-password" }).success,
    ).toBe(false);
  });
});

describe("helpers", () => {
  it("recognises uuids", () => {
    expect(isUuid(GOAL_ID)).toBe(true);
    expect(isUuid("123")).toBe(false);
  });

  it("only allows in-app redirects", () => {
    expect(safeNextPath("/goals/abc")).toBe("/goals/abc");
    expect(safeNextPath("//evil.example")).toBe("/dashboard");
    expect(safeNextPath("https://evil.example")).toBe("/dashboard");
    expect(safeNextPath(undefined)).toBe("/dashboard");
  });
});
