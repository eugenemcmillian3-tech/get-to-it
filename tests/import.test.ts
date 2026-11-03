import { describe, expect, it } from "vitest";
import { buildExportBundle, exportBundleJson, type ExportSource } from "@/lib/export";
import {
  IMPORT_CONFIRMATION,
  MAX_IMPORT_BYTES,
  importPlanHash,
  importRows,
  importSummary,
  parseImportFile,
  type ExistingImportState,
  type ImportOptions,
} from "@/lib/import";

const source: ExportSource = {
  goals: [
    {
      id: "goal-1",
      title: "Launch the site",
      desired_outcome: "Ship a working landing page",
      deadline: "2026-12-01",
      time_available_minutes: 45,
      blocker: "",
      category: "launch",
      archived_at: null,
      created_at: "2026-11-01T09:00:00Z",
    },
    {
      id: "goal-2",
      title: "Learn SQL",
      desired_outcome: "Write joins from memory",
      deadline: null,
      time_available_minutes: 30,
      blocker: "",
      category: null,
      archived_at: null,
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
      instructions: "Under ten words.",
      first_action: null,
      expected_deliverable: null,
      estimated_minutes: 20,
      origin: "manual",
      created_at: "2026-11-01T09:05:00Z",
    },
  ],
  results: [{ task_id: "task-1", content: "Ship it.", updated_at: "2026-11-01T12:01:00Z" }],
  reflections: [
    {
      week_start: "2026-10-26",
      moved_forward: "Wrote the outline",
      got_in_the_way: "",
      next_step: "Draft the intro",
      updated_at: "2026-11-01T18:00:00Z",
    },
  ],
  preferences: {
    session_length_minutes: 25,
    work_days: [1, 2],
    work_start: "09:00",
    work_end: "12:00",
    task_size: "small",
    communication_style: "concise",
    help_topics: ["writing"],
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
  ],
};

const bundle = buildExportBundle(source, "2026-11-02T07:00:00Z");
const json = exportBundleJson(bundle);

const emptyExisting: ExistingImportState = {
  goalTitles: [],
  reflectionWeeks: [],
  hasPreferences: false,
};

const defaultOptions: ImportOptions = {
  skipExistingGoalTitles: true,
  replacePreferences: false,
};

function parse(
  text: string,
  existing: ExistingImportState = emptyExisting,
  options: ImportOptions = defaultOptions,
) {
  return parseImportFile(text, existing, options);
}

describe("import envelope", () => {
  it("round-trips a fresh export", () => {
    const parsed = parse(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.plan.counts).toEqual({
      goals: 2,
      tasks: 1,
      saved_results: 1,
      reflections: 1,
      preferences: 1,
      focus_sessions_ignored: 1,
    });
    expect(parsed.plan.goals[0].title).toBe("Launch the site");
    expect(parsed.plan.goals[0].tasks[0].result?.content).toBe("Ship it.");
    expect(parsed.exportedAt).toBe("2026-11-02T07:00:00Z");
  });

  it("refuses a different format, version, or unreadable file", () => {
    const otherFormat = JSON.parse(json);
    otherFormat.format = "some-other-app.export";
    const formatResult = parse(JSON.stringify(otherFormat));
    expect(formatResult.ok).toBe(false);
    if (!formatResult.ok) expect(formatResult.errors[0]).toMatch(/not a GET TO IT export/);

    const otherVersion = JSON.parse(json);
    otherVersion.version = 99;
    const versionResult = parse(JSON.stringify(otherVersion));
    expect(versionResult.ok).toBe(false);
    if (!versionResult.ok) expect(versionResult.errors[0]).toMatch(/version 99/);

    const broken = parse("{not json");
    expect(broken.ok).toBe(false);

    const empty = parse("   ");
    expect(empty.ok).toBe(false);
  });

  it("refuses a file over the size limit", () => {
    const huge = `{"format":"get-to-it.export","version":1,"padding":"${"x".repeat(MAX_IMPORT_BYTES)}"}`;
    const parsed = parse(huge);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors[0]).toMatch(/larger than/);
  });

  it("refuses more goals than the limit", () => {
    const many = JSON.parse(json);
    many.goals = Array.from({ length: 500 }, (_, index) => ({
      ...many.goals[0],
      title: `Goal ${index}`,
    }));
    const parsed = parse(JSON.stringify(many));
    expect(parsed.ok).toBe(false);
  });
});

describe("ownership and credentials", () => {
  it("rejects a goal carrying an ownership id", () => {
    const tampered = JSON.parse(json);
    tampered.goals[0].user_id = "11111111-1111-1111-1111-111111111111";

    const parsed = parse(JSON.stringify(tampered));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.plan.goals).toHaveLength(1);
    expect(parsed.plan.rejected[0].reason).toMatch(/user_id/);
    expect(parsed.plan.rejected[0].reason).toMatch(/never imported/);
  });

  it("rejects a task carrying a connector token", () => {
    const tampered = JSON.parse(json);
    tampered.goals[0].tasks[0].connector_token = "secret-value";

    const parsed = parse(JSON.stringify(tampered));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.plan.goals[0].tasks).toHaveLength(0);
    expect(parsed.plan.rejected[0].kind).toBe("task");
    expect(parsed.plan.rejected[0].reason).toMatch(/connector_token/);
  });

  it("rejects a bundle-level payment credential without importing anything", () => {
    const tampered = JSON.parse(json);
    tampered.preferences = { ...tampered.preferences, stripe_customer_id: "cus_123" };

    const parsed = parse(JSON.stringify(tampered));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.plan.preferences).toBeNull();
    expect(parsed.plan.rejected[0].kind).toBe("preferences");
  });
});

describe("per-record rejection", () => {
  it("imports the valid records and reports the invalid one", () => {
    const tampered = JSON.parse(json);
    tampered.goals[1].tasks.push({ ...tampered.goals[0].tasks[0], title: "x" });

    const parsed = parse(JSON.stringify(tampered));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.plan.goals).toHaveLength(2);
    expect(parsed.plan.counts.tasks).toBe(1);
    expect(parsed.plan.rejected).toHaveLength(1);
    expect(parsed.plan.rejected[0].kind).toBe("task");
    expect(parsed.plan.rejected[0].label).toContain("Learn SQL");
  });

  it("rejects a duplicate week inside the file", () => {
    const tampered = JSON.parse(json);
    tampered.reflections.push({ ...tampered.reflections[0] });

    const parsed = parse(JSON.stringify(tampered));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.plan.counts.reflections).toBe(1);
    expect(parsed.plan.rejected[0].reason).toMatch(/twice/);
  });

  it("rejects an invalid preference value but keeps the rest", () => {
    const tampered = JSON.parse(json);
    tampered.preferences.session_length_minutes = 5_000;

    const parsed = parse(JSON.stringify(tampered));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.plan.preferences).toBeNull();
    expect(parsed.plan.counts.goals).toBe(2);
  });
});

describe("no overwriting", () => {
  const existing: ExistingImportState = {
    goalTitles: ["Launch the site"],
    reflectionWeeks: ["2026-10-26"],
    hasPreferences: true,
  };

  it("skips an existing goal title when asked", () => {
    const parsed = parse(json, existing, defaultOptions);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.plan.goals.map((goal) => goal.title)).toEqual(["Learn SQL"]);
    expect(parsed.plan.skipped.some((row) => row.label === "Launch the site")).toBe(true);
  });

  it("adds a second goal with the same title when skipping is off", () => {
    const parsed = parse(json, existing, {
      skipExistingGoalTitles: false,
      replacePreferences: false,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.plan.goals).toHaveLength(2);
  });

  it("never overwrites an existing week's reflection", () => {
    const parsed = parse(json, existing, defaultOptions);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.plan.reflections).toHaveLength(0);
    expect(parsed.plan.skipped.some((row) => row.kind === "reflection")).toBe(true);
  });

  it("leaves preferences alone unless replacing was approved", () => {
    const skipped = parse(json, existing, defaultOptions);
    expect(skipped.ok).toBe(true);
    if (!skipped.ok) return;
    expect(skipped.plan.preferences).toBeNull();
    expect(skipped.plan.replacePreferences).toBe(false);
    expect(skipped.plan.skipped.some((row) => row.kind === "preferences")).toBe(true);

    const replaced = parse(json, existing, {
      skipExistingGoalTitles: true,
      replacePreferences: true,
    });
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    expect(replaced.plan.preferences?.session_length_minutes).toBe(25);
    expect(replaced.plan.replacePreferences).toBe(true);
    expect(replaced.plan.warnings.some((row) => row.kind === "preferences")).toBe(true);
  });
});

describe("focus sessions are export only", () => {
  it("warns and imports nothing from them", () => {
    const parsed = parse(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.plan.counts.focus_sessions_ignored).toBe(1);
    expect(parsed.plan.warnings.some((row) => row.label === "Focus sessions")).toBe(true);
    expect(JSON.stringify(parsed.plan.goals)).not.toContain("1500");
  });
});

describe("plan hash and rows", () => {
  it("is stable for the same plan and changes with the content", () => {
    const first = parse(json);
    const second = parse(json);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.plan.hash).toBe(second.plan.hash);

    const tampered = JSON.parse(json);
    tampered.goals[0].title = "Launch the site now";
    const changed = parse(JSON.stringify(tampered));
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;

    expect(changed.plan.hash).not.toBe(first.plan.hash);
    expect(importPlanHash(changed.plan)).toBe(changed.plan.hash);
  });

  it("maps goals, tasks and saved results in order without ids", () => {
    const parsed = parse(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const rows = importRows(parsed.plan);
    expect(rows.goals).toHaveLength(2);
    expect(rows.tasks).toHaveLength(1);
    expect(rows.tasks[0].goalIndex).toBe(0);
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]).toEqual({ goalIndex: 0, taskIndex: 0, content: "Ship it." });
    expect(rows.reflections).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain("goal-1");
    expect(JSON.stringify(rows)).not.toContain("user_id");
  });

  it("summarises what will happen and names the confirmation", () => {
    const parsed = parse(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(importSummary(parsed.plan)).toMatch(/2 goals/);
    expect(IMPORT_CONFIRMATION).toBe("IMPORT");
  });
});
