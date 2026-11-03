import { describe, expect, it } from "vitest";
import { buildPlanMessages, type PlanContext } from "@/lib/ai/plan";
import { buildTaskHelpMessages } from "@/lib/ai/task-help";
import {
  MAX_HELP_TOPICS,
  MAX_TOPIC_LENGTH,
  emptyPreferences,
  hasSavedPreferences,
  parseHelpTopics,
  parsePreferenceValues,
  preferenceContextLines,
  preferenceSummary,
  preferencesFromRow,
  selectDailyTasks,
  sessionExplanation,
  styleInstruction,
  taskSizeExplanation,
  validateDailySelection,
  workPatternExplanation,
  workDaySummary,
} from "@/lib/preferences";
import {
  DISABLED_PREFERENCES,
  EMPTY_PREFERENCES,
  FULL_PREFERENCES,
  GOAL,
  OTHER_USER_PREFERENCES,
  PLAN_CANDIDATES,
  TASK,
  candidate,
} from "./fixtures/preferences";

const PLAN_CONTEXT: PlanContext = {
  title: GOAL.title,
  desiredOutcome: GOAL.desired_outcome,
  deadline: GOAL.deadline,
  timeAvailableMinutes: GOAL.time_available_minutes,
  blocker: GOAL.blocker,
  openTasks: ["Draft the hero copy"],
  completedTasks: [],
};

function promptText(messages: { content: string }[]): string {
  return messages.map((message) => message.content).join("\n");
}

describe("preferencesFromRow", () => {
  it("returns every field empty when nothing was saved", () => {
    const preferences = preferencesFromRow(null, EMPTY_PREFERENCES.user_id);
    expect(preferences).toEqual(EMPTY_PREFERENCES);
    expect(hasSavedPreferences(preferences)).toBe(false);
    expect(preferenceSummary(preferences)).toEqual([]);
  });

  it("keeps arrays and defaults personalisation on when the column is absent", () => {
    const preferences = preferencesFromRow(
      {
        session_length_minutes: 25,
        work_days: [2, 4],
        task_size: "medium",
        help_topics: ["writing"],
      },
      EMPTY_PREFERENCES.user_id,
    );

    expect(preferences.session_length_minutes).toBe(25);
    expect(preferences.work_days).toEqual([2, 4]);
    expect(preferences.task_size).toBe("medium");
    expect(preferences.help_topics).toEqual(["writing"]);
    expect(preferences.personalization_enabled).toBe(true);
    expect(hasSavedPreferences(preferences)).toBe(true);
  });

  it("does not treat personalisation alone as a saved preference", () => {
    const preferences = emptyPreferences(EMPTY_PREFERENCES.user_id, true);
    expect(hasSavedPreferences(preferences)).toBe(false);
  });

  it("falls back to the given user id, never one from a row", () => {
    const preferences = preferencesFromRow(OTHER_USER_PREFERENCES, "caller-id");
    expect(preferences.user_id).toBe("caller-id");
  });
});

describe("preference deletion", () => {
  it("looks exactly like never having saved anything", () => {
    // Deleting the row means the next read gets no row at all.
    const afterDelete = preferencesFromRow(null, FULL_PREFERENCES.user_id);
    expect(afterDelete).toEqual(emptyPreferences(FULL_PREFERENCES.user_id));
    expect(preferenceSummary(afterDelete)).toEqual([]);
    expect(preferenceContextLines(afterDelete)).toEqual([]);
    expect(sessionExplanation(afterDelete)).toBeNull();
  });
});

describe("parseHelpTopics", () => {
  it("splits lines and commas, trimming blanks", () => {
    expect(parseHelpTopics(" portfolio , job applications\n\nwriting ")).toEqual([
      "portfolio",
      "job applications",
      "writing",
    ]);
  });

  it("drops case-insensitive duplicates", () => {
    expect(parseHelpTopics("Writing\nwriting\nWRITING")).toEqual(["Writing"]);
  });

  it(`caps the list at ${MAX_HELP_TOPICS} topics`, () => {
    const many = Array.from({ length: 12 }, (_, index) => `topic ${index}`);
    expect(parseHelpTopics(many.join("\n"))).toHaveLength(MAX_HELP_TOPICS);
  });

  it(`trims a topic to ${MAX_TOPIC_LENGTH} characters`, () => {
    const [topic] = parseHelpTopics("x".repeat(200));
    expect(topic).toHaveLength(MAX_TOPIC_LENGTH);
  });

  it("returns an empty list for blank input", () => {
    expect(parseHelpTopics("   \n , ")).toEqual([]);
  });
});

describe("parsePreferenceValues", () => {
  const blank = {
    sessionLength: "",
    workDays: [] as string[],
    workStart: "",
    workEnd: "",
    taskSize: "",
    communicationStyle: "",
    helpTopics: "",
    personalizationEnabled: true,
  };

  it("accepts an entirely blank form as no preferences", () => {
    const parsed = parsePreferenceValues(blank);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.values.session_length_minutes).toBeNull();
    expect(parsed.values.work_days).toEqual([]);
    expect(parsed.values.task_size).toBeNull();
    expect(parsed.values.help_topics).toEqual([]);
  });

  it("normalises days, times and topics", () => {
    const parsed = parsePreferenceValues({
      ...blank,
      sessionLength: "25",
      workDays: ["4", "1", "1", "9"],
      workStart: "9:00",
      workEnd: "17:30",
      taskSize: "medium",
      communicationStyle: "detailed",
      helpTopics: "writing, job applications",
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.values).toMatchObject({
      session_length_minutes: 25,
      work_days: [1, 4],
      work_start: "09:00",
      work_end: "17:30",
      task_size: "medium",
      communication_style: "detailed",
      help_topics: ["writing", "job applications"],
    });
  });

  it("rejects a session length outside the allowed range", () => {
    expect(parsePreferenceValues({ ...blank, sessionLength: "2" }).ok).toBe(false);
    expect(parsePreferenceValues({ ...blank, sessionLength: "500" }).ok).toBe(false);
    expect(parsePreferenceValues({ ...blank, sessionLength: "abc" }).ok).toBe(false);
  });

  it("requires both working hours, and an end after the start", () => {
    const startOnly = parsePreferenceValues({ ...blank, workStart: "09:00" });
    expect(startOnly).toEqual({
      ok: false,
      message: "Add both a start and an end time, or neither.",
    });

    const backwards = parsePreferenceValues({
      ...blank,
      workStart: "17:00",
      workEnd: "09:00",
    });
    expect(backwards.ok).toBe(false);
  });

  it("rejects a malformed time rather than guessing", () => {
    const parsed = parsePreferenceValues({
      ...blank,
      workStart: "9:5",
      workEnd: "17:00",
    });
    expect(parsed).toEqual({ ok: false, message: "Use a start time like 09:00." });
  });

  it("rejects an unknown task size or style", () => {
    expect(parsePreferenceValues({ ...blank, taskSize: "huge" }).ok).toBe(false);
    expect(
      parsePreferenceValues({ ...blank, communicationStyle: "poetic" }).ok,
    ).toBe(false);
  });
});

describe("preferenceContextLines", () => {
  it("returns nothing when personalisation is off", () => {
    expect(preferenceContextLines(DISABLED_PREFERENCES)).toEqual([]);
    expect(preferenceContextLines(null)).toEqual([]);
    expect(preferenceContextLines(EMPTY_PREFERENCES)).toEqual([]);
  });

  it("includes only the fields that were actually saved", () => {
    const lines = preferenceContextLines({
      ...EMPTY_PREFERENCES,
      session_length_minutes: 20,
    });

    expect(lines[0]).toContain("20 minutes per work session");
    expect(lines.join(" ")).not.toContain("weekdays");
    expect(lines.join(" ")).not.toContain("concise");
  });

  it("adds usual days, hours, topics and the chosen style", () => {
    const text = preferenceContextLines(FULL_PREFERENCES).join("\n");

    expect(text).toContain("15 minutes per work session");
    expect(text).toContain("small steps");
    expect(text).toContain("weekdays");
    expect(text).toContain("9:00 am–5:00 pm");
    expect(text).toContain("portfolio site; job applications");
    expect(text).toContain("under 80 words");
    expect(text).toContain("Do not infer anything else about them");
  });

  it("uses the caller's own preferences, not another account's", () => {
    expect(preferenceContextLines(OTHER_USER_PREFERENCES).join(" ")).toContain(
      "90 minutes",
    );
    expect(preferenceContextLines(FULL_PREFERENCES).join(" ")).not.toContain(
      "90 minutes",
    );
  });

  it("exposes no style instruction when personalisation is off", () => {
    expect(styleInstruction(DISABLED_PREFERENCES)).toBeNull();
    expect(styleInstruction(FULL_PREFERENCES)).toContain("80 words");
    expect(styleInstruction(EMPTY_PREFERENCES)).toBeNull();
  });
});

describe("explanations", () => {
  it("names the saved session length in the exact wording", () => {
    expect(sessionExplanation(FULL_PREFERENCES)).toBe(
      "Suggested because you selected 15-minute sessions.",
    );
    expect(sessionExplanation(FULL_PREFERENCES, 25)).toBe(
      "Suggested because you selected 25-minute sessions.",
    );
  });

  it("never explains a preference when personalisation is off", () => {
    expect(sessionExplanation(DISABLED_PREFERENCES)).toBeNull();
    expect(taskSizeExplanation(DISABLED_PREFERENCES)).toBeNull();
    expect(workPatternExplanation(DISABLED_PREFERENCES)).toBeNull();
  });

  it("explains task size and working pattern", () => {
    expect(taskSizeExplanation(FULL_PREFERENCES)).toBe(
      "Suggested because you prefer small steps.",
    );
    expect(workPatternExplanation(FULL_PREFERENCES)).toBe(
      "Suggested because you usually work weekdays, 9:00 am–5:00 pm.",
    );
  });

  it("summarises days without inventing any", () => {
    expect(workDaySummary([1, 2, 3, 4, 5])).toBe("Weekdays");
    expect(workDaySummary([0, 6])).toBe("Weekends");
    expect(workDaySummary([])).toBeNull();
    expect(workDaySummary(null)).toBeNull();
  });
});

describe("prompt context selection", () => {
  const taskContext = {
    goal: GOAL,
    task: TASK,
    savedWork: "First headline: Make the work the hero.",
  };

  it("adds saved preferences to the planning prompt", () => {
    const text = promptText(buildPlanMessages(PLAN_CONTEXT, undefined, FULL_PREFERENCES));
    expect(text).toContain("15 minutes per work session");
    expect(text).toContain("under 80 words");
  });

  it("omits them when personalisation is disabled", () => {
    const text = promptText(
      buildPlanMessages(PLAN_CONTEXT, undefined, DISABLED_PREFERENCES),
    );
    expect(text).not.toContain("15 minutes per work session");
    expect(text).not.toContain("under 80 words");
  });

  it("omits them when no preferences were passed at all", () => {
    const text = promptText(buildPlanMessages(PLAN_CONTEXT));
    expect(text).not.toContain("Preferences they saved");
  });

  it("adds saved preferences and the style line to task help", () => {
    const messages = buildTaskHelpMessages(taskContext, "start", FULL_PREFERENCES);
    const system = messages[0].content;
    const user = messages[1].content;

    expect(system).toContain("under 80 words");
    expect(user).toContain("15 minutes per work session");
  });

  it("sizes the smaller-step request from the saved session length", () => {
    const tailored = promptText(
      buildTaskHelpMessages(taskContext, "stuck-smaller", FULL_PREFERENCES),
    );
    expect(tailored).toContain("about 15 minutes");

    const plain = promptText(
      buildTaskHelpMessages(taskContext, "stuck-smaller", DISABLED_PREFERENCES),
    );
    expect(plain).toContain("about ten minutes");
    expect(plain).not.toContain("about 15 minutes");
  });
});

describe("selectDailyTasks", () => {
  it("selects only what fits the stated time", () => {
    const selection = selectDailyTasks(PLAN_CANDIDATES, 40, FULL_PREFERENCES);

    expect(selection.selected.map((task) => task.id)).toEqual([
      PLAN_CANDIDATES[0].id,
      PLAN_CANDIDATES[2].id,
    ]);
    expect(selection.totalMinutes).toBe(20);
    expect(selection.unknownEstimates).toBe(1);
    expect(selection.overLimit).toBe(false);
    expect(selection.skipped.map((task) => task.title)).toEqual([
      "Draft the hero copy",
      "Publish the page",
    ]);
  });

  it("puts in-progress work first without reordering the input", () => {
    const tasks = [
      candidate("c0000000-0000-4000-8000-000000000001", "Later", 10),
      candidate(
        "c0000000-0000-4000-8000-000000000002",
        "Started already",
        10,
        "in_progress",
      ),
    ];

    const selection = selectDailyTasks(tasks, 30);
    expect(selection.selected[0].title).toBe("Started already");
    expect(tasks[0].title).toBe("Later");
  });

  it("leaves the tasks untouched and keeps their statuses", () => {
    const before = JSON.stringify(PLAN_CANDIDATES);
    const selection = selectDailyTasks(PLAN_CANDIDATES, 30, FULL_PREFERENCES);

    expect(JSON.stringify(PLAN_CANDIDATES)).toBe(before);
    for (const task of selection.selected) {
      expect(task.status).toBe("todo");
    }
  });

  it("does not call unselected tasks abandoned", () => {
    const selection = selectDailyTasks(PLAN_CANDIDATES, 20);
    const notes = selection.reasons.join(" ");
    expect(notes).toContain("left for another day");
    expect(notes).toContain("Nothing about them changed");
    expect(notes.toLowerCase()).not.toContain("abandon");
    expect(notes.toLowerCase()).not.toContain("overdue");
  });

  it("explains a suggestion with the saved session length", () => {
    const selection = selectDailyTasks(PLAN_CANDIDATES, 60, FULL_PREFERENCES);
    expect(selection.reasons).toContain(
      "Suggested because you selected 15-minute sessions.",
    );
  });

  it("has no preference explanation when personalisation is off", () => {
    const selection = selectDailyTasks(PLAN_CANDIDATES, 60, DISABLED_PREFERENCES);
    expect(selection.reasons.join(" ")).not.toContain("Suggested because");
  });

  it("selects nothing and says so when no estimate fits", () => {
    const selection = selectDailyTasks(
      [candidate("d0000000-0000-4000-8000-000000000001", "Big rewrite", 240)],
      15,
    );

    expect(selection.selected).toEqual([]);
    expect(selection.reasons[0]).toContain("Nothing here is estimated to fit");
  });

  it("excludes completed tasks", () => {
    const selection = selectDailyTasks(
      [
        candidate("e0000000-0000-4000-8000-000000000001", "Done", 5, "completed"),
        candidate("e0000000-0000-4000-8000-000000000002", "Open", 5),
      ],
      30,
    );
    expect(selection.selected.map((task) => task.title)).toEqual(["Open"]);
  });
});

describe("validateDailySelection", () => {
  it("accepts a selection made of this person's open tasks", () => {
    const check = validateDailySelection(
      [PLAN_CANDIDATES[0].id, PLAN_CANDIDATES[1].id],
      PLAN_CANDIDATES,
    );
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.tasks).toHaveLength(2);
  });

  it("rejects an empty selection", () => {
    expect(validateDailySelection([], PLAN_CANDIDATES)).toEqual({
      ok: false,
      reason: "empty",
    });
  });

  it("rejects a repeated id", () => {
    expect(
      validateDailySelection(
        [PLAN_CANDIDATES[0].id, PLAN_CANDIDATES[0].id],
        PLAN_CANDIDATES,
      ),
    ).toEqual({ ok: false, reason: "duplicate" });
  });

  it("rejects a task from another account or a deleted one", () => {
    expect(
      validateDailySelection(
        ["ffffffff-ffff-4fff-8fff-ffffffffffff"],
        PLAN_CANDIDATES,
      ),
    ).toEqual({ ok: false, reason: "unknown-task" });
  });

  it("rejects a completed task", () => {
    const done = candidate(
      "a0000000-0000-4000-8000-000000000009",
      "Already done",
      5,
      "completed",
    );
    expect(validateDailySelection([done.id], [done])).toEqual({
      ok: false,
      reason: "unknown-task",
    });
  });
});
