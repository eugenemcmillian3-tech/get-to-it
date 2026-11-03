import { describe, expect, it } from "vitest";
import {
  availableActions,
  currentWeekStart,
  FOCUS_CAP_SECONDS,
  focusErrorMessage,
  formatClock,
  formatFocusTotal,
  projectElapsed,
} from "@/lib/focus";
import {
  pickNextStep,
  smallerStepFor,
  summarizeProgress,
  type ProgressGoal,
  type ProgressTask,
} from "@/lib/progress";
import type { FocusTotals } from "@/lib/types";
import { checkinSchema } from "@/lib/validation";

const NO_FOCUS: FocusTotals = {
  today_seconds: 0,
  week_seconds: 0,
  total_seconds: 0,
  session_count: 0,
};

const goal = (id: string, title = `Goal ${id}`): ProgressGoal => ({ id, title });

const task = (overrides: Partial<ProgressTask> = {}): ProgressTask => ({
  id: "task-1",
  goal_id: "goal-1",
  title: "Write the intro",
  status: "todo",
  sort_order: 0,
  created_at: "2026-11-01T09:00:00.000Z",
  updated_at: "2026-11-01T09:00:00.000Z",
  first_action: null,
  estimated_minutes: null,
  ...overrides,
});

describe("formatClock", () => {
  it("shows minutes and seconds until an hour is reached", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(7)).toBe("0:07");
    expect(formatClock(59)).toBe("0:59");
    expect(formatClock(60)).toBe("1:00");
    expect(formatClock(754)).toBe("12:34");
  });

  it("adds hours when they matter", () => {
    expect(formatClock(3600)).toBe("1:00:00");
    expect(formatClock(3661)).toBe("1:01:01");
  });

  it("never shows a negative clock", () => {
    expect(formatClock(-5)).toBe("0:00");
  });
});

describe("formatFocusTotal", () => {
  it("counts in whole minutes, then hours", () => {
    expect(formatFocusTotal(0)).toBe("0 min");
    expect(formatFocusTotal(59)).toBe("0 min");
    expect(formatFocusTotal(60)).toBe("1 min");
    expect(formatFocusTotal(3599)).toBe("59 min");
    expect(formatFocusTotal(3600)).toBe("1 hr");
    expect(formatFocusTotal(5400)).toBe("1 hr 30 min");
  });
});

describe("projectElapsed", () => {
  it("moves a running clock forward by wall-clock time", () => {
    expect(projectElapsed(10, "running", 1_000, 5_000)).toBe(14);
  });

  it("does not move a paused or finished clock", () => {
    expect(projectElapsed(10, "paused", 1_000, 999_999)).toBe(10);
    expect(projectElapsed(10, "finished", 1_000, 999_999)).toBe(10);
  });

  it("caps a runaway session", () => {
    expect(projectElapsed(FOCUS_CAP_SECONDS, "running", 0, 5_000)).toBe(
      FOCUS_CAP_SECONDS,
    );
  });

  it("ignores a clock that appears to go backwards", () => {
    expect(projectElapsed(10, "running", 5_000, 1_000)).toBe(10);
  });
});

describe("availableActions", () => {
  it("offers start when nothing is open", () => {
    expect(availableActions(null)).toEqual(["start"]);
  });

  it("offers pause and finish while running", () => {
    expect(availableActions("running")).toEqual(["pause", "finish"]);
  });

  it("offers resume and finish while paused", () => {
    expect(availableActions("paused")).toEqual(["resume", "finish"]);
  });

  it("offers nothing on a finished session", () => {
    expect(availableActions("finished")).toEqual([]);
  });
});

describe("focusErrorMessage", () => {
  it("explains a session that is no longer open", () => {
    expect(focusErrorMessage("no-session")).toContain("no longer open");
  });

  it("explains a task that isn't available", () => {
    expect(focusErrorMessage("no-task")).toContain("isn't available");
  });

  it("falls back to a safe message", () => {
    expect(focusErrorMessage("something-else")).toContain("Reload the page");
  });
});

describe("currentWeekStart", () => {
  it("uses the Monday of the current UTC week", () => {
    expect(currentWeekStart(new Date("2026-11-01T23:30:00Z"))).toBe(
      "2026-10-26",
    );
    expect(currentWeekStart(new Date("2026-11-02T00:30:00Z"))).toBe(
      "2026-11-02",
    );
    expect(currentWeekStart(new Date("2026-11-04T12:00:00Z"))).toBe(
      "2026-11-02",
    );
  });

  it("always returns a Monday", () => {
    for (const day of ["2026-11-01", "2026-11-03", "2026-11-08"]) {
      const start = currentWeekStart(new Date(`${day}T12:00:00Z`));
      expect(new Date(`${start}T00:00:00Z`).getUTCDay()).toBe(1);
    }
  });
});

describe("summarizeProgress", () => {
  const goals = [goal("goal-1"), goal("goal-2"), goal("goal-3")];
  const tasks = [
    task({ id: "t1", goal_id: "goal-1", status: "completed" }),
    task({ id: "t2", goal_id: "goal-1", status: "completed" }),
    task({ id: "t3", goal_id: "goal-2", status: "todo" }),
  ];

  it("reports completed tasks, saved work, completed goals and focus time separately", () => {
    const progress = summarizeProgress(goals, tasks, ["t1", "t2", "t2"], {
      today_seconds: 600,
      week_seconds: 1200,
      total_seconds: 5400,
      session_count: 3,
    });

    expect(progress).toEqual({
      totalGoals: 3,
      completedGoals: 1,
      completedTasks: 2,
      openTasks: 1,
      savedWork: 2,
      focusSeconds: 5400,
      focusSessions: 3,
    });
  });

  it("does not call an empty goal complete", () => {
    const progress = summarizeProgress(
      [goal("goal-3")],
      [],
      [],
      NO_FOCUS,
    );
    expect(progress.completedGoals).toBe(0);
  });

  it("never produces a score", () => {
    const progress = summarizeProgress(goals, tasks, [], NO_FOCUS);
    expect(Object.keys(progress).sort()).toEqual([
      "completedGoals",
      "completedTasks",
      "focusSeconds",
      "focusSessions",
      "openTasks",
      "savedWork",
      "totalGoals",
    ]);
  });
});

describe("pickNextStep", () => {
  it("prefers a task already in progress", () => {
    const next = pickNextStep(
      [goal("goal-1", "Portfolio")],
      [
        task({ id: "t1", status: "todo", sort_order: 0 }),
        task({
          id: "t2",
          status: "in_progress",
          updated_at: "2026-11-01T10:00:00.000Z",
        }),
      ],
    );

    expect(next?.taskId).toBe("t2");
    expect(next?.goalTitle).toBe("Portfolio");
  });

  it("picks the longest-running in-progress task first", () => {
    const next = pickNextStep(
      [goal("goal-1")],
      [
        task({ id: "newer", status: "in_progress", updated_at: "2026-11-01T12:00:00.000Z" }),
        task({ id: "older", status: "in_progress", updated_at: "2026-11-01T08:00:00.000Z" }),
      ],
    );
    expect(next?.taskId).toBe("older");
  });

  it("falls back to the first to-do task in order", () => {
    const next = pickNextStep(
      [goal("goal-1")],
      [
        task({ id: "second", sort_order: 2 }),
        task({ id: "first", sort_order: 1 }),
      ],
    );
    expect(next?.taskId).toBe("first");
  });

  it("ignores completed tasks", () => {
    const next = pickNextStep(
      [goal("goal-1")],
      [
        task({ id: "done", status: "completed" }),
        task({ id: "open", sort_order: 5 }),
      ],
    );
    expect(next?.taskId).toBe("open");
  });

  it("returns null when everything is finished", () => {
    expect(
      pickNextStep([goal("goal-1")], [task({ status: "completed" })]),
    ).toBeNull();
  });

  it("returns null when the goal is missing", () => {
    expect(pickNextStep([], [task()])).toBeNull();
  });
});

describe("smallerStepFor", () => {
  it("uses the recorded first action when there is one", () => {
    expect(
      smallerStepFor(task({ first_action: "Open the draft." })),
    ).toBe("Just the first action: Open the draft.");
  });

  it("offers ten minutes for a long estimate", () => {
    expect(
      smallerStepFor(task({ estimated_minutes: 45 })),
    ).toContain("ten minutes");
  });

  it("always offers something to do", () => {
    expect(smallerStepFor(task({ estimated_minutes: 15 }))).toContain(
      "write one sentence",
    );
  });
});

describe("checkinSchema", () => {
  it("accepts a single answered prompt", () => {
    const parsed = checkinSchema.safeParse({ moved_forward: "Finished the draft." });
    expect(parsed.success).toBe(true);
  });

  it("accepts a next step on its own", () => {
    expect(checkinSchema.safeParse({ next_step: "Email the editor." }).success).toBe(
      true,
    );
  });

  it("rejects a completely blank check-in", () => {
    const parsed = checkinSchema.safeParse({});
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0].message).toBe("Write one line before saving.");
  });

  it("rejects a reflection that is too long", () => {
    expect(
      checkinSchema.safeParse({ moved_forward: "x".repeat(2001) }).success,
    ).toBe(false);
  });

  it("limits the next step to 500 characters", () => {
    expect(checkinSchema.safeParse({ next_step: "x".repeat(500) }).success).toBe(
      true,
    );
    expect(checkinSchema.safeParse({ next_step: "x".repeat(501) }).success).toBe(
      false,
    );
  });
});
