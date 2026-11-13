/**
 * Data export: one documented JSON format plus CSV per dataset.
 *
 * Rules encoded here:
 *   * Only the person's own rows are exported, and only the fields listed below.
 *     There is no column for a password, session, API key or payment credential
 *     in the format, and no owner id is written: goals and tasks are given local
 *     references (`g1`, `g1-t1`) so an export can be re-imported without trusting
 *     any identifier from another account.
 *   * Focus sessions are exported as recorded time, but never imported: their
 *     durations are derived from server timestamps, so importing them would
 *     invent time that was never spent.
 *   * CSV cells that begin with a formula character are prefixed with an
 *     apostrophe, so opening an export in a spreadsheet cannot execute content.
 */

import type {
  FocusSessionStatus,
  GoalCategory,
  TaskOrigin,
  TaskStatus,
} from "@/lib/types";

export const EXPORT_FORMAT = "get-to-it.export" as const;
export const EXPORT_VERSION = 1 as const;
export const EXPORT_APP_NAME = "GET TO IT";

/** Hard ceiling for the JSON body handed to the browser. */
export const MAX_EXPORT_BYTES = 8_000_000;

export type ExportTaskResult = {
  content: string;
  updated_at: string;
};

export type ExportTask = {
  ref: string;
  title: string;
  status: TaskStatus;
  completed_at: string | null;
  instructions: string | null;
  first_action: string | null;
  expected_deliverable: string | null;
  estimated_minutes: number | null;
  origin: TaskOrigin;
  created_at: string;
  result: ExportTaskResult | null;
};

export type ExportGoal = {
  ref: string;
  title: string;
  desired_outcome: string;
  deadline: string | null;
  time_available_minutes: number;
  blocker: string;
  category: GoalCategory | null;
  archived_at: string | null;
  created_at: string;
  tasks: ExportTask[];
};

export type ExportReflection = {
  week_start: string;
  moved_forward: string;
  got_in_the_way: string;
  next_step: string;
  updated_at: string;
};

export type ExportPreferences = {
  session_length_minutes: number | null;
  work_days: number[] | null;
  work_start: string | null;
  work_end: string | null;
  task_size: "small" | "medium" | "large" | null;
  communication_style: "concise" | "encouraging" | "detailed" | null;
  help_topics: string[] | null;
  personalization_enabled: boolean;
  updated_at: string;
};

export type ExportFocusSession = {
  goal_ref: string;
  task_ref: string;
  goal_title: string;
  task_title: string;
  status: FocusSessionStatus;
  started_at: string;
  finished_at: string | null;
  seconds: number;
};

export type ExportBundle = {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  app: typeof EXPORT_APP_NAME;
  exported_at: string;
  counts: {
    goals: number;
    tasks: number;
    saved_results: number;
    reflections: number;
    focus_sessions: number;
    preferences: number;
  };
  goals: ExportGoal[];
  reflections: ExportReflection[];
  preferences: ExportPreferences | null;
  focus_sessions: ExportFocusSession[];
  importable: string[];
  export_only: string[];
  excluded: string[];
};

export const EXPORT_DATASETS = [
  {
    id: "goals",
    label: "Goals",
    file: "goals.csv",
    description: "One row per goal, with its task count and category.",
  },
  {
    id: "tasks",
    label: "Tasks",
    file: "tasks.csv",
    description: "One row per task, including plan detail and completion state.",
  },
  {
    id: "saved-results",
    label: "Saved results",
    file: "saved-results.csv",
    description: "One row per saved task result, with the full saved text.",
  },
  {
    id: "reflections",
    label: "Reflections",
    file: "reflections.csv",
    description: "Weekly check-ins, one row per week.",
  },
  {
    id: "preferences",
    label: "Preferences",
    file: "preferences.csv",
    description: "Saved work preferences as field/value pairs.",
  },
  {
    id: "focus-sessions",
    label: "Focus sessions",
    file: "focus-sessions.csv",
    description: "Recorded focus time. Export only; never imported.",
  },
] as const;

export type ExportDatasetId = (typeof EXPORT_DATASETS)[number]["id"];

export const IMPORTABLE_DATASETS = [
  "goals",
  "tasks",
  "saved_results",
  "reflections",
  "preferences",
] as const;

export const EXPORT_ONLY_DATASETS = ["focus_sessions"] as const;

/** What the format deliberately leaves out, and why. */
export const EXCLUDED_FIELDS = [
  "Email address, password, session cookies and any authentication record",
  "Account identifiers and internal owner ids",
  "Connector tokens, AI provider keys and payment credentials",
  "Reminders, partner sharing, workspaces and AI conversations",
  "Other people's rows: every query is owner-scoped before it runs",
];

export type ExportSource = {
  goals: {
    id: string;
    title: string;
    desired_outcome: string;
    deadline: string | null;
    time_available_minutes: number;
    blocker: string;
    category: GoalCategory | null;
    archived_at: string | null;
    created_at: string;
  }[];
  tasks: {
    id: string;
    goal_id: string;
    title: string;
    status: TaskStatus;
    completed_at: string | null;
    instructions: string | null;
    first_action: string | null;
    expected_deliverable: string | null;
    estimated_minutes: number | null;
    origin: TaskOrigin;
    created_at: string;
  }[];
  results: { task_id: string; content: string; updated_at: string }[];
  reflections: ExportReflection[];
  preferences: ExportPreferences | null;
  focusSessions: {
    goal_id: string;
    task_id: string;
    status: FocusSessionStatus;
    started_at: string;
    finished_at: string | null;
    seconds: number;
  }[];
};

/**
 * Builds the export with local references. A goal or task that is not in the
 * person's own rows simply does not appear, so a stray foreign key cannot leak
 * another account's title.
 */
export function buildExportBundle(
  source: ExportSource,
  exportedAt: string = new Date().toISOString(),
): ExportBundle {
  const resultsByTask = new Map(source.results.map((row) => [row.task_id, row]));
  const tasksByGoal = new Map<string, ExportSource["tasks"]>();

  for (const task of source.tasks) {
    const existing = tasksByGoal.get(task.goal_id) ?? [];
    existing.push(task);
    tasksByGoal.set(task.goal_id, existing);
  }

  const goalRefs = new Map<string, string>();
  const taskRefs = new Map<string, string>();

  const goals: ExportGoal[] = source.goals.map((goal, goalIndex) => {
    const ref = `g${goalIndex + 1}`;
    goalRefs.set(goal.id, ref);

    const tasks: ExportTask[] = (tasksByGoal.get(goal.id) ?? []).map((task, taskIndex) => {
      const taskRef = `${ref}-t${taskIndex + 1}`;
      taskRefs.set(task.id, taskRef);
      const result = resultsByTask.get(task.id);

      return {
        ref: taskRef,
        title: task.title,
        status: task.status,
        completed_at: task.completed_at,
        instructions: task.instructions,
        first_action: task.first_action,
        expected_deliverable: task.expected_deliverable,
        estimated_minutes: task.estimated_minutes,
        origin: task.origin,
        created_at: task.created_at,
        result: result
          ? { content: result.content, updated_at: result.updated_at }
          : null,
      };
    });

    return {
      ref,
      title: goal.title,
      desired_outcome: goal.desired_outcome,
      deadline: goal.deadline,
      time_available_minutes: goal.time_available_minutes,
      blocker: goal.blocker,
      category: goal.category,
      archived_at: goal.archived_at,
      created_at: goal.created_at,
      tasks,
    };
  });

  const focusSessions: ExportFocusSession[] = source.focusSessions
    .filter((session) => goalRefs.has(session.goal_id) && taskRefs.has(session.task_id))
    .map((session) => {
      const goal = source.goals.find((row) => row.id === session.goal_id);
      const task = source.tasks.find((row) => row.id === session.task_id);
      return {
        goal_ref: goalRefs.get(session.goal_id) ?? "",
        task_ref: taskRefs.get(session.task_id) ?? "",
        goal_title: goal?.title ?? "",
        task_title: task?.title ?? "",
        status: session.status,
        started_at: session.started_at,
        finished_at: session.finished_at,
        seconds: session.seconds,
      };
    });

  const taskCount = goals.reduce((total, goal) => total + goal.tasks.length, 0);
  const savedResults = goals.reduce(
    (total, goal) => total + goal.tasks.filter((task) => task.result !== null).length,
    0,
  );

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    app: EXPORT_APP_NAME,
    exported_at: exportedAt,
    counts: {
      goals: goals.length,
      tasks: taskCount,
      saved_results: savedResults,
      reflections: source.reflections.length,
      focus_sessions: focusSessions.length,
      preferences: source.preferences ? 1 : 0,
    },
    goals,
    reflections: source.reflections,
    preferences: source.preferences,
    focus_sessions: focusSessions,
    importable: [...IMPORTABLE_DATASETS],
    export_only: [...EXPORT_ONLY_DATASETS],
    excluded: EXCLUDED_FIELDS,
  };
}

export function exportBundleJson(bundle: ExportBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

export function exportFileName(
  kind: "json" | ExportDatasetId,
  exportedAt: string,
): string {
  const day = exportedAt.slice(0, 10);
  return kind === "json"
    ? `get-to-it-export-${day}.json`
    : `get-to-it-${kind}-${day}.csv`;
}

export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  // Spreadsheet formula injection guard.
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function csvRows(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

/** Builds one CSV dataset. Columns are stable for a given export version. */
export function exportCsv(dataset: ExportDatasetId, bundle: ExportBundle): string {
  switch (dataset) {
    case "goals":
      return csvRows(
        [
          "goal_ref",
          "title",
          "desired_outcome",
          "deadline",
          "time_available_minutes",
          "blocker",
          "category",
          "archived_at",
          "created_at",
          "task_count",
        ],
        bundle.goals.map((goal) => [
          goal.ref,
          goal.title,
          goal.desired_outcome,
          goal.deadline,
          goal.time_available_minutes,
          goal.blocker,
          goal.category,
          goal.archived_at,
          goal.created_at,
          goal.tasks.length,
        ]),
      );

    case "tasks":
      return csvRows(
        [
          "goal_ref",
          "task_ref",
          "title",
          "status",
          "completed_at",
          "estimated_minutes",
          "origin",
          "instructions",
          "first_action",
          "expected_deliverable",
          "has_saved_result",
        ],
        bundle.goals.flatMap((goal) =>
          goal.tasks.map((task) => [
            goal.ref,
            task.ref,
            task.title,
            task.status,
            task.completed_at,
            task.estimated_minutes,
            task.origin,
            task.instructions,
            task.first_action,
            task.expected_deliverable,
            task.result ? "yes" : "no",
          ]),
        ),
      );

    case "saved-results":
      return csvRows(
        ["goal_ref", "task_ref", "task_title", "content", "updated_at"],
        bundle.goals.flatMap((goal) =>
          goal.tasks
            .filter((task) => task.result !== null)
            .map((task) => [
              goal.ref,
              task.ref,
              task.title,
              task.result?.content ?? "",
              task.result?.updated_at ?? "",
            ]),
        ),
      );

    case "reflections":
      return csvRows(
        [
          "week_start",
          "moved_forward",
          "got_in_the_way",
          "next_step",
          "updated_at",
        ],
        bundle.reflections.map((reflection) => [
          reflection.week_start,
          reflection.moved_forward,
          reflection.got_in_the_way,
          reflection.next_step,
          reflection.updated_at,
        ]),
      );

    case "preferences": {
      const preferences = bundle.preferences;
      if (!preferences) return csvRows(["field", "value"], []);
      return csvRows(
        ["field", "value"],
        [
          ["session_length_minutes", preferences.session_length_minutes],
          ["work_days", preferences.work_days?.join(" ") ?? ""],
          ["work_start", preferences.work_start],
          ["work_end", preferences.work_end],
          ["task_size", preferences.task_size],
          ["communication_style", preferences.communication_style],
          ["help_topics", preferences.help_topics?.join("; ") ?? ""],
          ["personalization_enabled", preferences.personalization_enabled],
          ["updated_at", preferences.updated_at],
        ],
      );
    }

    case "focus-sessions":
      return csvRows(
        [
          "goal_ref",
          "task_ref",
          "goal_title",
          "task_title",
          "status",
          "started_at",
          "finished_at",
          "seconds",
        ],
        bundle.focus_sessions.map((session) => [
          session.goal_ref,
          session.task_ref,
          session.goal_title,
          session.task_title,
          session.status,
          session.started_at,
          session.finished_at,
          session.seconds,
        ]),
      );

    default:
      return "";
  }
}

export function exportCsvFileName(
  dataset: ExportDatasetId,
  exportedAt: string,
): string {
  const entry = EXPORT_DATASETS.find((row) => row.id === dataset);
  const day = exportedAt.slice(0, 10);
  return `get-to-it-${entry?.id ?? dataset}-${day}.csv`;
}
