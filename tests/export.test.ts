import { describe, expect, it } from "vitest";
import {
  EXCLUDED_FIELDS,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  buildExportBundle,
  exportBundleJson,
  exportCsv,
  exportCsvFileName,
  exportFileName,
  type ExportSource,
} from "@/lib/export";

const source: ExportSource = {
  goals: [
    {
      id: "goal-1",
      title: "Launch the site",
      desired_outcome: "Ship a working landing page",
      deadline: "2026-12-01",
      time_available_minutes: 45,
      blocker: "Not sure where to start",
      category: "launch",
      archived_at: null,
      created_at: "2026-11-01T09:00:00Z",
    },
    {
      id: "goal-2",
      title: "Learn SQL",
      desired_outcome: "Write joins without looking them up",
      deadline: null,
      time_available_minutes: 30,
      blocker: "",
      category: null,
      archived_at: "2026-10-30T10:00:00Z",
      created_at: "2026-10-28T09:00:00Z",
    },
  ],
  tasks: [
    {
      id: "task-1",
      goal_id: "goal-1",
      title: "Write the headline",
      status: "completed",
      completed_at: "2026-11-01T12:00:00Z",
      instructions: "Keep it under ten words.",
      first_action: "Open a blank page.",
      expected_deliverable: "One headline",
      estimated_minutes: 20,
      origin: "ai_plan",
      created_at: "2026-11-01T09:05:00Z",
    },
    {
      id: "task-2",
      goal_id: "goal-1",
      title: "Pick a font",
      status: "todo",
      completed_at: null,
      instructions: null,
      first_action: null,
      expected_deliverable: null,
      estimated_minutes: 10,
      origin: "manual",
      created_at: "2026-11-01T09:06:00Z",
    },
    {
      id: "task-foreign",
      goal_id: "goal-other",
      title: "Someone else's task",
      status: "todo",
      completed_at: null,
      instructions: null,
      first_action: null,
      expected_deliverable: null,
      estimated_minutes: null,
      origin: "manual",
      created_at: "2026-11-01T09:07:00Z",
    },
  ],
  results: [
    { task_id: "task-1", content: "=SUM(A1:A2)", updated_at: "2026-11-01T12:01:00Z" },
    { task_id: "task-foreign", content: "foreign saved work", updated_at: "2026-11-01T12:02:00Z" },
  ],
  reflections: [
    {
      week_start: "2026-10-26",
      moved_forward: "Wrote the outline",
      got_in_the_way: "A cold",
      next_step: "Draft the intro",
      updated_at: "2026-11-01T18:00:00Z",
    },
  ],
  preferences: {
    session_length_minutes: 25,
    work_days: [1, 2, 3],
    work_start: "09:00",
    work_end: "12:00",
    task_size: "small",
    communication_style: "concise",
    help_topics: ["writing", "launch"],
    personalization_enabled: true,
    updated_at: "2026-11-01T08:00:00Z",
  },
  focusSessions: [
    {
      goal_id: "goal-1",
      task_id: "task-1",
      status: "finished",
      started_at: "2026-11-01T10:00:00Z",
      finished_at: "2026-11-01T10:25:00Z",
      seconds: 1_500,
    },
    {
      goal_id: "goal-other",
      task_id: "task-foreign",
      status: "finished",
      started_at: "2026-10-01T10:00:00Z",
      finished_at: "2026-10-01T10:25:00Z",
      seconds: 1_500,
    },
  ],
};

const bundle = buildExportBundle(source, "2026-11-02T07:00:00Z");

describe("export bundle", () => {
  it("uses the documented envelope and version", () => {
    expect(bundle.format).toBe(EXPORT_FORMAT);
    expect(bundle.version).toBe(EXPORT_VERSION);
    expect(bundle.app).toBe("GET TO IT");
    expect(bundle.exported_at).toBe("2026-11-02T07:00:00Z");
    expect(bundle.importable).toContain("goals");
    expect(bundle.export_only).toEqual(["focus_sessions"]);
  });

  it("counts only the person's own rows", () => {
    expect(bundle.counts).toEqual({
      goals: 2,
      tasks: 2,
      saved_results: 1,
      reflections: 1,
      focus_sessions: 1,
      preferences: 1,
    });
    expect(bundle.goals[0].tasks.map((task) => task.title)).toEqual([
      "Write the headline",
      "Pick a font",
    ]);
  });

  it("references rows locally instead of writing account ids", () => {
    expect(bundle.goals.map((goal) => goal.ref)).toEqual(["g1", "g2"]);
    expect(bundle.goals[0].tasks.map((task) => task.ref)).toEqual(["g1-t1", "g1-t2"]);
    expect(bundle.focus_sessions[0].task_ref).toBe("g1-t1");
    expect(bundle.focus_sessions[0].goal_title).toBe("Launch the site");
  });

  it("never contains an owner id, task id or email field", () => {
    const json = exportBundleJson(bundle);
    expect(json).not.toContain("goal-1");
    expect(json).not.toContain("task-1");
    expect(json).not.toContain("user_id");
    expect(json).not.toContain("@");
  });

  it("documents what is deliberately left out", () => {
    expect(EXCLUDED_FIELDS.length).toBeGreaterThan(2);
    expect(EXCLUDED_FIELDS.join(" ")).toMatch(/password/i);
    expect(EXCLUDED_FIELDS.join(" ")).toMatch(/connector tokens/i);
  });

  it("has no preferences section when nothing was saved", () => {
    const empty = buildExportBundle({ ...source, preferences: null }, "2026-11-02T07:00:00Z");
    expect(empty.preferences).toBeNull();
    expect(empty.counts.preferences).toBe(0);
  });
});

describe("CSV exports", () => {
  it("keeps stable headers and one row per record", () => {
    const goals = exportCsv("goals", bundle).trim().split("\n");
    expect(goals[0]).toBe(
      "goal_ref,title,desired_outcome,deadline,time_available_minutes,blocker,category,archived_at,created_at,task_count",
    );
    expect(goals).toHaveLength(3);

    const tasks = exportCsv("tasks", bundle).trim().split("\n");
    expect(tasks[0]).toContain("has_saved_result");
    expect(tasks).toHaveLength(3);

    const results = exportCsv("saved-results", bundle);
    expect(results).toContain("g1-t1");
    expect(results).not.toContain("foreign saved work");
  });

  it("quotes commas, quotes and newlines", () => {
    const csv = exportCsv("saved-results", bundle);
    // No comma, quote or newline here, so the cell stays unquoted.
    expect(csv).toContain("'=SUM(A1:A2)");

    const tricky = buildExportBundle(
      {
        ...source,
        results: [
          { task_id: "task-1", content: 'He said "hi", then\nleft', updated_at: "2026-11-01T12:01:00Z" },
        ],
      },
      "2026-11-02T07:00:00Z",
    );
    const escaped = exportCsv("saved-results", tricky);
    expect(escaped).toContain('"He said ""hi"", then\nleft"');
  });

  it("guards spreadsheet formula injection", () => {
    const content = exportCsv("saved-results", bundle);
    // A cell starting with "=" is written with a leading apostrophe.
    expect(content).toContain("'=SUM(A1:A2)");
    expect(content).not.toContain(",=SUM");
  });

  it("writes preferences as field/value pairs", () => {
    const preferences = exportCsv("preferences", bundle).trim().split("\n");
    expect(preferences[0]).toBe("field,value");
    expect(preferences).toContain("session_length_minutes,25");
    expect(preferences).toContain("work_days,1 2 3");
  });

  it("exports focus sessions with recorded seconds", () => {
    const csv = exportCsv("focus-sessions", bundle);
    expect(csv.split("\n")[0]).toContain("seconds");
    expect(csv).toContain("1500");
  });

  it("names files predictably", () => {
    expect(exportFileName("json", bundle.exported_at)).toBe("get-to-it-export-2026-11-02.json");
    expect(exportCsvFileName("saved-results", bundle.exported_at)).toBe(
      "get-to-it-saved-results-2026-11-02.csv",
    );
  });
});
