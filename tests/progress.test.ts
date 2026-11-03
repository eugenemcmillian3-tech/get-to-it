import { describe, expect, it } from "vitest";
import { formatProgress, summarizeTaskStatuses } from "@/lib/progress";
import { formatDeadline, formatMinutes } from "@/lib/format";

describe("summarizeTaskStatuses", () => {
  it("returns zeroed progress with no tasks", () => {
    const counts = summarizeTaskStatuses([]);
    expect(counts).toEqual({
      total: 0,
      todo: 0,
      inProgress: 0,
      completed: 0,
      percentComplete: 0,
    });
    expect(formatProgress(counts)).toBe("No tasks yet");
  });

  it("counts each status and rounds the percentage", () => {
    const counts = summarizeTaskStatuses([
      { status: "completed" },
      { status: "in_progress" },
      { status: "todo" },
    ]);
    expect(counts.total).toBe(3);
    expect(counts.completed).toBe(1);
    expect(counts.inProgress).toBe(1);
    expect(counts.todo).toBe(1);
    expect(counts.percentComplete).toBe(33);
    expect(formatProgress(counts)).toBe("1 of 3 tasks complete");
  });

  it("uses a singular noun for a single task", () => {
    expect(
      formatProgress(summarizeTaskStatuses([{ status: "completed" }])),
    ).toBe("1 of 1 task complete");
  });

  it("reaches 100 percent when every task is complete", () => {
    expect(
      summarizeTaskStatuses([
        { status: "completed" },
        { status: "completed" },
      ]).percentComplete,
    ).toBe(100);
  });
});

describe("formatDeadline", () => {
  it("formats a stored date", () => {
    expect(formatDeadline("2026-03-14")).toBe("Mar 14, 2026");
  });

  it("returns null instead of inventing a date", () => {
    expect(formatDeadline(null)).toBeNull();
    expect(formatDeadline("")).toBeNull();
    expect(formatDeadline("not-a-date")).toBeNull();
  });
});

describe("formatMinutes", () => {
  it("shows minutes and hours", () => {
    expect(formatMinutes(10)).toBe("10 min");
    expect(formatMinutes(60)).toBe("1 hr");
    expect(formatMinutes(90)).toBe("1.5 hr");
    expect(formatMinutes(180)).toBe("3 hr");
  });
});
