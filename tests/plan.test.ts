import { describe, expect, it } from "vitest";
import { limitMessage, remainingNote } from "@/lib/ai/limits";
import {
  computePlanSnapshot,
  isPlanSnapshotStale,
  parsePlanResponse,
  planAnswersSchema,
  planSaveSchema,
} from "@/lib/ai/plan";
import {
  ambiguousResponse,
  badMinutesResponse,
  clarifyResponse,
  duplicateTitlesResponse,
  emptyQuestionsResponse,
  fencedPlanResponse,
  missingFieldResponse,
  nonJsonResponse,
  planTaskFixture,
  proseWrappedPlanResponse,
  tooFewTasksResponse,
  tooManyTasksResponse,
  validPlanObject,
  validPlanResponse,
} from "./fixtures/plan-responses";

const GOAL_ID = "0b8f3c2e-6c1a-4f5b-9f7e-2d3c4b5a6e7f";

describe("parsePlanResponse", () => {
  it("accepts a bare JSON plan with every field intact", () => {
    const parsed = parsePlanResponse(validPlanResponse);
    expect(parsed.kind).toBe("plan");
    if (parsed.kind !== "plan") return;
    expect(parsed.tasks).toHaveLength(4);
    expect(parsed.tasks[0]).toEqual({
      title: "Outline the case study",
      instructions:
        "Open the draft and write the first two sentences without editing yourself.",
      first_action: "Open the draft.",
      expected_deliverable: "Two sentences saved in the draft.",
      estimated_minutes: 15,
    });
  });

  it("accepts a fenced JSON block", () => {
    expect(parsePlanResponse(fencedPlanResponse).kind).toBe("plan");
  });

  it("finds JSON wrapped in prose", () => {
    expect(parsePlanResponse(proseWrappedPlanResponse).kind).toBe("plan");
  });

  it("accepts clarification questions", () => {
    const parsed = parsePlanResponse(clarifyResponse);
    expect(parsed.kind).toBe("questions");
    if (parsed.kind !== "questions") return;
    expect(parsed.questions).toHaveLength(2);
  });

  it("rejects a plan with fewer than three tasks", () => {
    const parsed = parsePlanResponse(tooFewTasksResponse);
    expect(parsed).toEqual({ kind: "invalid", reason: "too-few-tasks" });
  });

  it("rejects a plan with more than seven tasks", () => {
    expect(parsePlanResponse(tooManyTasksResponse)).toEqual({
      kind: "invalid",
      reason: "too-many-tasks",
    });
  });

  it("rejects a task missing a required field", () => {
    expect(parsePlanResponse(missingFieldResponse)).toEqual({
      kind: "invalid",
      reason: "bad-task",
    });
  });

  it("rejects an estimate outside the allowed range", () => {
    expect(parsePlanResponse(badMinutesResponse)).toEqual({
      kind: "invalid",
      reason: "bad-task",
    });
  });

  it("rejects an empty question list", () => {
    expect(parsePlanResponse(emptyQuestionsResponse)).toEqual({
      kind: "invalid",
      reason: "bad-questions",
    });
  });

  it("rejects a reply that is both questions and tasks", () => {
    expect(parsePlanResponse(ambiguousResponse)).toEqual({
      kind: "invalid",
      reason: "ambiguous-shape",
    });
  });

  it("rejects a plan whose task titles repeat", () => {
    expect(parsePlanResponse(duplicateTitlesResponse)).toEqual({
      kind: "invalid",
      reason: "duplicate-tasks",
    });
  });

  it("rejects prose with no JSON at all", () => {
    expect(parsePlanResponse(nonJsonResponse)).toEqual({
      kind: "invalid",
      reason: "unreadable-json",
    });
  });

  it("rejects an empty reply", () => {
    expect(parsePlanResponse("   ")).toEqual({
      kind: "invalid",
      reason: "unreadable-json",
    });
  });
});

describe("planSaveSchema", () => {
  const draft = planTaskFixture("Outline the case study");

  it("accepts an edited plan", () => {
    const parsed = planSaveSchema.safeParse({
      goal_id: GOAL_ID,
      snapshot: "2026-11-01T10:00:00Z|2|2026-11-01T09:00:00Z",
      tasks: [draft, planTaskFixture("Draft the hero copy")],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts cleared optional guidance fields", () => {
    const parsed = planSaveSchema.safeParse({
      goal_id: GOAL_ID,
      snapshot: "snapshot",
      tasks: [
        {
          title: "Outline the case study",
          instructions: "",
          first_action: "",
          expected_deliverable: "",
          estimated_minutes: null,
        },
      ],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.tasks[0].instructions).toBe("");
    expect(parsed.data.tasks[0].estimated_minutes).toBeNull();
  });

  it("coerces a numeric string estimate", () => {
    const parsed = planSaveSchema.safeParse({
      goal_id: GOAL_ID,
      snapshot: "snapshot",
      tasks: [{ ...draft, estimated_minutes: "30" }],
    });
    expect(parsed.success && parsed.data.tasks[0].estimated_minutes).toBe(30);
  });

  it("rejects saving an empty preview", () => {
    expect(
      planSaveSchema.safeParse({ goal_id: GOAL_ID, snapshot: "s", tasks: [] })
        .success,
    ).toBe(false);
  });

  it("rejects more tasks than a plan allows", () => {
    const tasks = [...validPlanObject.tasks, ...validPlanObject.tasks.map((t) => ({ ...t, title: `${t.title} two` }))];
    const parsed = planSaveSchema.safeParse({
      goal_id: GOAL_ID,
      snapshot: "s",
      tasks,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a task with no name", () => {
    expect(
      planSaveSchema.safeParse({
        goal_id: GOAL_ID,
        snapshot: "s",
        tasks: [{ ...draft, title: "  " }],
      }).success,
    ).toBe(false);
  });

  it("rejects an estimate that is too small", () => {
    expect(
      planSaveSchema.safeParse({
        goal_id: GOAL_ID,
        snapshot: "s",
        tasks: [{ ...draft, estimated_minutes: 3 }],
      }).success,
    ).toBe(false);
  });

  it("requires the preview fingerprint", () => {
    expect(
      planSaveSchema.safeParse({ goal_id: GOAL_ID, snapshot: "", tasks: [draft] })
        .success,
    ).toBe(false);
  });
});

describe("planAnswersSchema", () => {
  it("accepts a couple of answers", () => {
    const parsed = planAnswersSchema.safeParse({
      answers: [
        { question: "Who is it for?", answer: "Hiring managers" },
        { question: "What must it do?", answer: "" },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("requires at least one answer slot", () => {
    expect(planAnswersSchema.safeParse({ answers: [] }).success).toBe(false);
  });
});

describe("plan snapshots", () => {
  const goal = { updated_at: "2026-11-01T10:00:00.000Z" };
  const tasks = [
    { updated_at: "2026-11-01T09:00:00.000Z" },
    { updated_at: "2026-11-01T09:30:00.000Z" },
  ];

  it("is stable when nothing changed", () => {
    const first = computePlanSnapshot(goal, tasks);
    const second = computePlanSnapshot(goal, [...tasks]);
    expect(isPlanSnapshotStale(first, second)).toBe(false);
  });

  it("is stale when a task is added after the preview", () => {
    const previewed = computePlanSnapshot(goal, tasks);
    const live = computePlanSnapshot(goal, [
      ...tasks,
      { updated_at: "2026-11-01T11:00:00.000Z" },
    ]);
    expect(isPlanSnapshotStale(previewed, live)).toBe(true);
  });

  it("is stale when a task is completed or edited", () => {
    const previewed = computePlanSnapshot(goal, tasks);
    const edited = computePlanSnapshot(goal, [
      tasks[0],
      { updated_at: "2026-11-01T11:30:00.000Z" },
    ]);
    expect(isPlanSnapshotStale(previewed, edited)).toBe(true);
  });

  it("is stale when the goal itself changes", () => {
    const previewed = computePlanSnapshot(goal, tasks);
    const live = computePlanSnapshot(
      { updated_at: "2026-11-01T12:00:00.000Z" },
      tasks,
    );
    expect(isPlanSnapshotStale(previewed, live)).toBe(true);
  });

  it("handles a goal with no tasks yet", () => {
    expect(computePlanSnapshot(goal, [])).toBe(`${goal.updated_at}|0|`);
  });
});

describe("AI request limit messages", () => {
  it("explains a request already in flight", () => {
    expect(limitMessage("in-flight")).toContain("already running");
  });

  it("describes the daily allowance as requests, not money", () => {
    const message = limitMessage("user-daily", 15);
    expect(message).toContain("15 AI requests");
    expect(message).not.toContain("$");
    expect(message.toLowerCase()).not.toContain("budget");
  });

  it("explains a paused global allowance", () => {
    expect(limitMessage("global-daily")).toContain("paused for everyone");
  });

  it("falls back to a safe message", () => {
    expect(limitMessage("something-new")).toBe(
      "We couldn't start that AI request. Try again in a moment.",
    );
  });

  it("shows the operation price, not a free allowance", () => {
    expect(remainingNote()).toContain("This request: 1 credit ($0.10)");
    expect(remainingNote()).toContain("failed request releases it");
    expect(remainingNote("app_repair")).toContain("2 credits ($0.20)");
  });
});
