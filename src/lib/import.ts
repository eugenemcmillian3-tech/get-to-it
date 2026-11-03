/**
 * Import: versioned, additive, and deliberately suspicious of its input.
 *
 * What this module guarantees:
 *   * Only the documented `get-to-it.export` version 1 envelope is accepted.
 *     There is no migration path from "some other app's JSON".
 *   * Size, schema and record counts are checked before anything is written.
 *   * Ownership ids are never trusted or used: every imported record is created
 *     under the signed-in person's own account, and references are local.
 *   * Nothing is overwritten. Goals and tasks are always new rows, an existing
 *     week's reflection is skipped, and saved preferences are replaced only when
 *     the person explicitly approves that.
 *   * Records that fail validation are reported by kind, label and reason, and
 *     the rest still import.
 *   * Connector tokens and payment credentials are not in the format; any record
 *     carrying one is rejected rather than imported.
 */

import { z } from "zod";
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  MAX_EXPORT_BYTES,
  type ExportPreferences,
  type ExportReflection,
} from "@/lib/export";

export const MAX_IMPORT_BYTES = Math.min(MAX_EXPORT_BYTES, 2_000_000);
export const MAX_IMPORT_GOALS = 200;
export const MAX_IMPORT_TASKS = 1_000;
export const MAX_IMPORT_REFLECTIONS = 300;
export const IMPORT_CONFIRMATION = "IMPORT";

const GOAL_CATEGORIES = [
  "launch",
  "job",
  "content",
  "learn",
  "personal",
  "business",
] as const;
const TASK_STATUSES = ["todo", "in_progress", "completed"] as const;
const TASK_ORIGINS = ["manual", "ai_plan"] as const;

const timestampSchema = z.string().trim().min(1).max(40);
const dateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-03-14.");

const resultSchema = z.strictObject({
  content: z.string().max(20_000),
  updated_at: timestampSchema,
});

const taskSchema = z.strictObject({
  ref: z.string().trim().min(1).max(80),
  title: z.string().trim().min(2, "Task titles need at least two characters.").max(200),
  status: z.enum(TASK_STATUSES),
  completed_at: timestampSchema.nullable(),
  instructions: z.string().max(4_000).nullable(),
  first_action: z.string().max(1_000).nullable(),
  expected_deliverable: z.string().max(1_000).nullable(),
  estimated_minutes: z.number().int().min(1).max(1_440).nullable(),
  origin: z.enum(TASK_ORIGINS),
  created_at: timestampSchema,
  result: resultSchema.nullable(),
});

const goalSchema = z.strictObject({
  ref: z.string().trim().min(1).max(80),
  title: z.string().trim().min(2, "Goal titles need at least two characters.").max(160),
  desired_outcome: z.string().trim().min(1).max(2_000),
  deadline: dateSchema.nullable(),
  time_available_minutes: z.number().int().min(5).max(480),
  blocker: z.string().max(2_000),
  category: z.enum(GOAL_CATEGORIES).nullable(),
  archived_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  tasks: z.array(z.unknown()).max(MAX_IMPORT_TASKS),
});

const reflectionSchema = z.strictObject({
  week_start: dateSchema,
  moved_forward: z.string().max(2_000),
  got_in_the_way: z.string().max(2_000),
  next_step: z.string().max(500),
  updated_at: timestampSchema,
});

const timeSchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Use a time like 09:30.");

const preferencesSchema = z.strictObject({
  session_length_minutes: z.number().int().min(5).max(240).nullable(),
  work_days: z
    .array(z.number().int().min(0).max(6))
    .min(1)
    .max(7)
    .nullable(),
  work_start: timeSchema.nullable(),
  work_end: timeSchema.nullable(),
  task_size: z.enum(["small", "medium", "large"]).nullable(),
  communication_style: z.enum(["concise", "encouraging", "detailed"]).nullable(),
  help_topics: z.array(z.string().trim().min(1).max(80)).max(8).nullable(),
  personalization_enabled: z.boolean(),
  updated_at: timestampSchema,
});

const envelopeSchema = z.object({
  format: z.unknown(),
  version: z.unknown(),
  exported_at: z.unknown().optional(),
  goals: z.array(z.unknown()).optional(),
  reflections: z.array(z.unknown()).optional(),
  preferences: z.unknown().optional(),
  focus_sessions: z.array(z.unknown()).optional(),
});

/** Keys that must never arrive from a file, whatever the format says. */
const FORBIDDEN_KEY =
  /(^|_)(user|owner|account)_id$|token|secret|password|connector|payment|stripe|credential|api_key|service_role/i;

export type ImportKind = "bundle" | "goal" | "task" | "reflection" | "preferences";

export type ImportRejection = {
  kind: ImportKind;
  label: string;
  reason: string;
};

export type ImportWarning = {
  kind: ImportKind;
  label: string;
  reason: string;
};

export type ImportGoal = {
  title: string;
  desired_outcome: string;
  deadline: string | null;
  time_available_minutes: number;
  blocker: string;
  category: (typeof GOAL_CATEGORIES)[number] | null;
  archived_at: string | null;
  created_at: string;
  tasks: {
    ref: string;
    title: string;
    status: (typeof TASK_STATUSES)[number];
    completed_at: string | null;
    instructions: string | null;
    first_action: string | null;
    expected_deliverable: string | null;
    estimated_minutes: number | null;
    origin: (typeof TASK_ORIGINS)[number];
    created_at: string;
    result: { content: string; updated_at: string } | null;
  }[];
};

export type ExistingImportState = {
  goalTitles: string[];
  reflectionWeeks: string[];
  hasPreferences: boolean;
};

export type ImportOptions = {
  /** Additive by default; skipping avoids duplicate titles. */
  skipExistingGoalTitles: boolean;
  /** Explicit approval to replace saved preferences. */
  replacePreferences: boolean;
};

export type ImportPlan = {
  hash: string;
  goals: ImportGoal[];
  reflections: ExportReflection[];
  preferences: ExportPreferences | null;
  skipped: ImportRejection[];
  rejected: ImportRejection[];
  warnings: ImportWarning[];
  counts: {
    goals: number;
    tasks: number;
    saved_results: number;
    reflections: number;
    preferences: number;
    focus_sessions_ignored: number;
  };
  replacePreferences: boolean;
};

export type ImportPreviewGoal = {
  title: string;
  taskCount: number;
  savedResults: number;
  alreadyExists: boolean;
};

export type ImportPreview = {
  planHash: string;
  goals: ImportPreviewGoal[];
  counts: ImportPlan["counts"];
  skipped: ImportRejection[];
  rejected: ImportRejection[];
  warnings: ImportWarning[];
  replacePreferences: boolean;
  exportedAt: string | null;
};

export type ImportParse =
  | { ok: true; plan: ImportPlan; exportedAt: string | null }
  | { ok: false; errors: string[]; rejected: ImportRejection[] };

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "That record isn't in the documented shape.";
}

/** Finds a forbidden ownership or credential field anywhere in a value. */
function findForbiddenKey(value: unknown, depth = 0): string | null {
  if (depth > 6 || value === null || typeof value !== "object") return null;

  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findForbiddenKey(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY.test(key)) return key;
    const found = findForbiddenKey(entry, depth + 1);
    if (found) return found;
  }

  return null;
}

/**
 * A goal's own fields, without its tasks: a bad task must be reported as a task,
 * not as the whole goal.
 */
function findForbiddenGoalKey(raw: unknown): string | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return findForbiddenKey(raw);
  }

  const own: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key === "tasks") continue;
    own[key] = value;
  }

  return findForbiddenKey(own);
}

/** Stable 64-bit-ish hash used to tie a confirmation to one exact plan. */
export function importPlanHash(plan: Omit<ImportPlan, "hash">): string {
  const shape = JSON.stringify({
    goals: plan.goals.map((goal) => ({
      title: goal.title,
      outcome: goal.desired_outcome,
      tasks: goal.tasks.map((task) => ({
        title: task.title,
        result: task.result?.content ?? null,
      })),
    })),
    reflections: plan.reflections.map((row) => row.week_start),
    preferences: plan.preferences
      ? [plan.preferences.session_length_minutes, plan.preferences.updated_at]
      : null,
    replace: plan.replacePreferences,
  });

  let hash = 0x811c9dc5;
  for (let index = 0; index < shape.length; index += 1) {
    hash ^= shape.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, "0")}${(hash ^ 0x9e3779b9).toString(16).padStart(8, "0")}`;
}

/**
 * Parses and validates an uploaded export. Returns either blocking errors (no
 * preview) or a plan with per-record rejections.
 */
export function parseImportFile(
  text: string,
  existing: ExistingImportState,
  options: ImportOptions,
): ImportParse {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes === 0) {
    return { ok: false, errors: ["That file is empty."], rejected: [] };
  }
  if (bytes > MAX_IMPORT_BYTES) {
    return {
      ok: false,
      errors: [
        `That file is larger than the ${Math.round(MAX_IMPORT_BYTES / 1_000_000)} MB import limit.`,
      ],
      rejected: [],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      errors: ["That file isn't valid JSON. Export a fresh copy and try again."],
      rejected: [],
    };
  }

  const envelope = envelopeSchema.safeParse(parsed);
  if (!envelope.success) {
    return {
      ok: false,
      errors: [
        "That JSON doesn't look like a GET TO IT export: goals, reflections and preferences are missing or the wrong shape.",
      ],
      rejected: [],
    };
  }

  const data = envelope.data;

  if (data.format !== EXPORT_FORMAT) {
    return {
      ok: false,
      errors: [`That file is not a GET TO IT export (expected format "${EXPORT_FORMAT}").`],
      rejected: [],
    };
  }

  if (data.version !== EXPORT_VERSION) {
    return {
      ok: false,
      errors: [
        typeof data.version === "number"
          ? `This export uses format version ${data.version}, but this build imports version ${EXPORT_VERSION}. Nothing was imported.`
          : "That export has no usable format version, so it was not imported.",
      ],
      rejected: [],
    };
  }

  const rawGoals = data.goals ?? [];
  const rawReflections = data.reflections ?? [];
  const rawPreferences = data.preferences ?? null;
  const focusSessions = data.focus_sessions ?? [];

  if (rawGoals.length > MAX_IMPORT_GOALS * 2) {
    return {
      ok: false,
      errors: [
        `That file contains ${rawGoals.length} goals, more than the ${MAX_IMPORT_GOALS} this build will accept.`,
      ],
      rejected: [],
    };
  }
  if (rawReflections.length > MAX_IMPORT_REFLECTIONS * 2) {
    return {
      ok: false,
      errors: [
        `That file contains ${rawReflections.length} reflections, more than the ${MAX_IMPORT_REFLECTIONS} this build will accept.`,
      ],
      rejected: [],
    };
  }

  const rejected: ImportRejection[] = [];
  const warnings: ImportWarning[] = [];
  const goals: ImportGoal[] = [];
  let taskTotal = 0;

  rawGoals.slice(0, MAX_IMPORT_GOALS * 2).forEach((raw, index) => {
    const label = `Goal ${index + 1}`;

    const forbidden = findForbiddenGoalKey(raw);
    if (forbidden) {
      rejected.push({
        kind: "goal",
        label,
        reason: `Contains the field "${forbidden}", which is never imported.`,
      });
      return;
    }

    const goal = goalSchema.safeParse(raw);
    if (!goal.success) {
      rejected.push({ kind: "goal", label, reason: firstIssue(goal.error) });
      return;
    }

    if (goals.length >= MAX_IMPORT_GOALS) {
      rejected.push({
        kind: "goal",
        label: goal.data.title,
        reason: `Only ${MAX_IMPORT_GOALS} goals are imported at once.`,
      });
      return;
    }

    const tasks: ImportGoal["tasks"] = [];

    goal.data.tasks.forEach((rawTask, taskIndex) => {
      const taskLabel = `${goal.data.title} — task ${taskIndex + 1}`;

      const taskForbidden = findForbiddenKey(rawTask);
      if (taskForbidden) {
        rejected.push({
          kind: "task",
          label: taskLabel,
          reason: `Contains the field "${taskForbidden}", which is never imported.`,
        });
        return;
      }

      const task = taskSchema.safeParse(rawTask);
      if (!task.success) {
        rejected.push({ kind: "task", label: taskLabel, reason: firstIssue(task.error) });
        return;
      }

      if (taskTotal >= MAX_IMPORT_TASKS) {
        rejected.push({
          kind: "task",
          label: task.data.title,
          reason: `Only ${MAX_IMPORT_TASKS} tasks are imported at once.`,
        });
        return;
      }

      taskTotal += 1;
      tasks.push({
        ref: task.data.ref,
        title: task.data.title,
        status: task.data.status,
        completed_at: task.data.completed_at,
        instructions: task.data.instructions,
        first_action: task.data.first_action,
        expected_deliverable: task.data.expected_deliverable,
        estimated_minutes: task.data.estimated_minutes,
        origin: task.data.origin,
        created_at: task.data.created_at,
        result: task.data.result,
      });
    });

    goals.push({
      title: goal.data.title,
      desired_outcome: goal.data.desired_outcome,
      deadline: goal.data.deadline,
      time_available_minutes: goal.data.time_available_minutes,
      blocker: goal.data.blocker,
      category: goal.data.category,
      archived_at: goal.data.archived_at,
      created_at: goal.data.created_at,
      tasks,
    });
  });

  const reflections: ExportReflection[] = [];
  const seenWeeks = new Set<string>();

  rawReflections.slice(0, MAX_IMPORT_REFLECTIONS).forEach((raw, index) => {
    const label = `Reflection ${index + 1}`;

    const forbidden = findForbiddenKey(raw);
    if (forbidden) {
      rejected.push({
        kind: "reflection",
        label,
        reason: `Contains the field "${forbidden}", which is never imported.`,
      });
      return;
    }

    const reflection = reflectionSchema.safeParse(raw);
    if (!reflection.success) {
      rejected.push({ kind: "reflection", label, reason: firstIssue(reflection.error) });
      return;
    }

    if (seenWeeks.has(reflection.data.week_start)) {
      rejected.push({
        kind: "reflection",
        label: reflection.data.week_start,
        reason: "The same week appears twice in the file.",
      });
      return;
    }
    seenWeeks.add(reflection.data.week_start);

    reflections.push({
      week_start: reflection.data.week_start,
      moved_forward: reflection.data.moved_forward,
      got_in_the_way: reflection.data.got_in_the_way,
      next_step: reflection.data.next_step,
      updated_at: reflection.data.updated_at,
    });
  });

  let preferences: ExportPreferences | null = null;

  if (rawPreferences !== null) {
    const forbidden = findForbiddenKey(rawPreferences);
    if (forbidden) {
      rejected.push({
        kind: "preferences",
        label: "Preferences",
        reason: `Contains the field "${forbidden}", which is never imported.`,
      });
    } else {
      const parsedPreferences = preferencesSchema.safeParse(rawPreferences);
      if (!parsedPreferences.success) {
        rejected.push({
          kind: "preferences",
          label: "Preferences",
          reason: firstIssue(parsedPreferences.error),
        });
      } else {
        preferences = parsedPreferences.data;
      }
    }
  }

  const skipped: ImportRejection[] = [];
  const existingTitles = new Set(existing.goalTitles);
  const existingWeeks = new Set(existing.reflectionWeeks);

  const goalsToImport = goals.filter((goal) => {
    if (options.skipExistingGoalTitles && existingTitles.has(goal.title)) {
      skipped.push({
        kind: "goal",
        label: goal.title,
        reason: "A goal with this title already exists, so it was skipped rather than duplicated.",
      });
      return false;
    }
    return true;
  });

  const reflectionsToImport = reflections.filter((reflection) => {
    if (existingWeeks.has(reflection.week_start)) {
      skipped.push({
        kind: "reflection",
        label: reflection.week_start,
        reason: "That week already has a reflection. Existing work is never overwritten.",
      });
      return false;
    }
    return true;
  });

  let preferencesToImport = preferences;
  let replacePreferences = false;

  if (preferences) {
    if (existing.hasPreferences && !options.replacePreferences) {
      skipped.push({
        kind: "preferences",
        label: "Preferences",
        reason:
          "Preferences are already saved. Tick the replace box to import these over them.",
      });
      preferencesToImport = null;
    } else if (existing.hasPreferences) {
      replacePreferences = true;
      warnings.push({
        kind: "preferences",
        label: "Preferences",
        reason: "The saved preferences will be replaced by the file's values.",
      });
    }
  }

  if (focusSessions.length > 0) {
    warnings.push({
      kind: "bundle",
      label: "Focus sessions",
      reason:
        "Focus time is export-only: its duration comes from server timestamps, so importing it would invent time. Nothing was imported from those rows.",
    });
  }

  const taskCount = goalsToImport.reduce((total, goal) => total + goal.tasks.length, 0);

  const base = {
    goals: goalsToImport,
    reflections: reflectionsToImport,
    preferences: preferencesToImport,
    skipped,
    rejected,
    warnings,
    replacePreferences,
    counts: {
      goals: goalsToImport.length,
      tasks: taskCount,
      saved_results: goalsToImport.reduce(
        (total, goal) => total + goal.tasks.filter((task) => task.result !== null).length,
        0,
      ),
      reflections: reflectionsToImport.length,
      preferences: preferencesToImport ? 1 : 0,
      focus_sessions_ignored: focusSessions.length,
    },
  };

  return {
    ok: true,
    plan: { ...base, hash: importPlanHash(base) },
    exportedAt: typeof data.exported_at === "string" ? data.exported_at : null,
  };
}

export function importPreview(plan: ImportPlan, existing: ExistingImportState): ImportPreview {
  const existingTitles = new Set(existing.goalTitles);
  return {
    planHash: plan.hash,
    exportedAt: null,
    goals: plan.goals.map((goal) => ({
      title: goal.title,
      taskCount: goal.tasks.length,
      savedResults: goal.tasks.filter((task) => task.result !== null).length,
      alreadyExists: existingTitles.has(goal.title),
    })),
    counts: plan.counts,
    skipped: plan.skipped,
    rejected: plan.rejected,
    warnings: plan.warnings,
    replacePreferences: plan.replacePreferences,
  };
}

/**
 * Rows to insert, in dependency order. No identifier from the file is used; the
 * action inserts these under the signed-in account and maps goal indexes.
 */
export function importRows(plan: ImportPlan): {
  goals: { index: number; values: Record<string, unknown> }[];
  tasks: { goalIndex: number; values: Record<string, unknown> }[];
  results: { goalIndex: number; taskIndex: number; content: string }[];
  reflections: ExportReflection[];
  preferences: ExportPreferences | null;
} {
  return {
    goals: plan.goals.map((goal, index) => ({
      index,
      values: {
        title: goal.title,
        desired_outcome: goal.desired_outcome,
        deadline: goal.deadline,
        time_available_minutes: goal.time_available_minutes,
        blocker: goal.blocker,
        category: goal.category,
        archived_at: goal.archived_at,
      },
    })),
    tasks: plan.goals.flatMap((goal, goalIndex) =>
      goal.tasks.map((task) => ({
        goalIndex,
        values: {
          title: task.title,
          status: task.status,
          completed_at: task.completed_at,
          instructions: task.instructions,
          first_action: task.first_action,
          expected_deliverable: task.expected_deliverable,
          estimated_minutes: task.estimated_minutes,
          origin: task.origin,
        },
      })),
    ),
    results: plan.goals.flatMap((goal, goalIndex) =>
      goal.tasks.flatMap((task, taskIndex) =>
        task.result
          ? [{ goalIndex, taskIndex, content: task.result.content }]
          : [],
      ),
    ),
    reflections: plan.reflections,
    preferences: plan.preferences,
  };
}

export function importSummary(plan: ImportPlan): string {
  if (
    plan.counts.goals === 0 &&
    plan.counts.reflections === 0 &&
    plan.counts.preferences === 0
  ) {
    return "Nothing would be imported from that file.";
  }

  const parts = [
    `${plan.counts.goals} ${plan.counts.goals === 1 ? "goal" : "goals"}`,
    `${plan.counts.tasks} ${plan.counts.tasks === 1 ? "task" : "tasks"}`,
    `${plan.counts.saved_results} saved ${plan.counts.saved_results === 1 ? "result" : "results"}`,
    `${plan.counts.reflections} ${plan.counts.reflections === 1 ? "reflection" : "reflections"}`,
  ];

  if (plan.counts.preferences > 0) parts.push("preferences");

  return `Ready to import ${parts.join(", ")}.`;
}

export const IMPORT_EXCLUDES_NOTE =
  "Connector tokens, AI provider keys and payment credentials are never part of the format, and a record carrying one is rejected rather than imported. Imported focus sessions are ignored: recorded time is exported only, because its duration comes from server timestamps.";

export const IMPORT_SCOPE_NOTE =
  "Import is additive. Goals and tasks are created as new rows, an existing week's reflection is skipped, and saved preferences are replaced only if you tick the box. Nothing in your account is deleted.";
