/**
 * Preferences and personalisation helpers.
 *
 * Everything here is pure so the rules can be tested without a browser or a
 * database:
 *
 *   * A preference only exists because the person typed it. There is no
 *     inference, no scoring and no stored conversation.
 *   * Personalisation off means no preference line reaches a prompt, and no
 *     suggestion is explained with a preference.
 *   * Suggestions are selections, never edits: nothing here changes a task,
 *     deadline, plan or reminder.
 */

import { z } from "zod";
import { WEEKDAY_LABELS, formatTime12, parseTimeOfDay } from "@/lib/reminders";
import { firstErrorMessage } from "@/lib/validation";
import type {
  CommunicationStyle,
  DailyPlanCandidate,
  TaskSize,
  UserPreferences,
} from "@/lib/types";

export const SESSION_LENGTH_OPTIONS = [10, 15, 20, 25, 30, 45, 60, 90] as const;

export const TASK_SIZE_OPTIONS: readonly {
  value: TaskSize;
  label: string;
  hint: string;
}[] = [
  { value: "small", label: "Small steps", hint: "Short pieces, ten minutes or so." },
  { value: "medium", label: "Medium steps", hint: "Pieces of roughly half an hour." },
  { value: "large", label: "Larger blocks", hint: "Longer stretches when you have them." },
];

export const COMMUNICATION_STYLE_OPTIONS: readonly {
  value: CommunicationStyle;
  label: string;
  hint: string;
}[] = [
  { value: "concise", label: "Concise", hint: "Short answers, no preamble." },
  { value: "encouraging", label: "Encouraging", hint: "Warm, steady, no pressure." },
  { value: "detailed", label: "Detailed", hint: "The reasoning and the steps." },
];

export const MAX_HELP_TOPICS = 8;
export const MAX_TOPIC_LENGTH = 80;

const TASK_SIZE_VALUES = TASK_SIZE_OPTIONS.map((option) => option.value) as [
  TaskSize,
  ...TaskSize[],
];
const STYLE_VALUES = COMMUNICATION_STYLE_OPTIONS.map(
  (option) => option.value,
) as [CommunicationStyle, ...CommunicationStyle[]];

/** Every field empty. Used when nothing has been saved, or after a reset. */
export function emptyPreferences(
  userId: string,
  enabled = true,
): UserPreferences {
  return {
    user_id: userId,
    session_length_minutes: null,
    work_days: null,
    work_start: null,
    work_end: null,
    task_size: null,
    communication_style: null,
    help_topics: null,
    personalization_enabled: enabled,
    updated_at: null,
  };
}

/**
 * Turns a database row (or no row at all) into preferences the UI can render.
 * A missing row is not an error and does not write anything.
 */
export function preferencesFromRow(
  row: Partial<UserPreferences> | null | undefined,
  userId: string,
): UserPreferences {
  if (!row) return emptyPreferences(userId);

  return {
    user_id: userId,
    session_length_minutes:
      typeof row.session_length_minutes === "number"
        ? row.session_length_minutes
        : null,
    work_days: Array.isArray(row.work_days) ? row.work_days : null,
    work_start: row.work_start ?? null,
    work_end: row.work_end ?? null,
    task_size: row.task_size ?? null,
    communication_style: row.communication_style ?? null,
    help_topics: Array.isArray(row.help_topics) ? row.help_topics : null,
    personalization_enabled: row.personalization_enabled !== false,
    updated_at: row.updated_at ?? null,
  };
}

/** True when at least one preference is set. Personalisation alone does not count. */
export function hasSavedPreferences(preferences: UserPreferences): boolean {
  return (
    preferences.session_length_minutes !== null ||
    (preferences.work_days?.length ?? 0) > 0 ||
    preferences.work_start !== null ||
    preferences.work_end !== null ||
    preferences.task_size !== null ||
    preferences.communication_style !== null ||
    (preferences.help_topics?.length ?? 0) > 0
  );
}

/** Topics are typed as a short list, separated by lines or commas. */
export function parseHelpTopics(raw: string): string[] {
  const parts = raw
    .split(/[\n,]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const topics: string[] = [];

  for (const part of parts) {
    const topic = part.slice(0, MAX_TOPIC_LENGTH).trim();
    if (topic === "") continue;
    const key = topic.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    topics.push(topic);
    if (topics.length === MAX_HELP_TOPICS) break;
  }

  return topics;
}

export function topicsToText(topics: string[] | null): string {
  return (topics ?? []).join("\n");
}

/** `09:00` → `9:00 am`; a null time stays null. */
export function formatClock(value: string | null): string | null {
  if (!value) return null;
  return formatTime12(value.slice(0, 5));
}

export function workDaySummary(days: number[] | null): string | null {
  if (!days || days.length === 0) return null;
  const clean = [...new Set(days)].sort((a, b) => a - b);
  if (clean.length === 7) return "Every day";
  if (clean.length === 5 && clean.every((day, index) => day === index + 1)) {
    return "Weekdays";
  }
  if (clean.length === 2 && clean[0] === 0 && clean[1] === 6) return "Weekends";
  return clean.map((day) => WEEKDAY_LABELS[day]).join(", ");
}

export function workHoursSummary(preferences: UserPreferences): string | null {
  const start = formatClock(preferences.work_start);
  const end = formatClock(preferences.work_end);
  if (!start || !end) return null;
  return `${start}–${end}`;
}

export type PreferenceSummaryRow = { label: string; value: string };

/** What the panel shows as "saved right now". Empty when nothing is saved. */
export function preferenceSummary(
  preferences: UserPreferences,
): PreferenceSummaryRow[] {
  const rows: PreferenceSummaryRow[] = [];

  if (preferences.session_length_minutes) {
    rows.push({
      label: "Work session",
      value: `${preferences.session_length_minutes} minutes`,
    });
  }

  const days = workDaySummary(preferences.work_days);
  if (days) rows.push({ label: "Usual days", value: days });

  const hours = workHoursSummary(preferences);
  if (hours) rows.push({ label: "Usual hours", value: hours });

  if (preferences.task_size) {
    const size = TASK_SIZE_OPTIONS.find(
      (option) => option.value === preferences.task_size,
    );
    if (size) rows.push({ label: "Task size", value: size.label });
  }

  if (preferences.communication_style) {
    const style = COMMUNICATION_STYLE_OPTIONS.find(
      (option) => option.value === preferences.communication_style,
    );
    if (style) rows.push({ label: "Reply style", value: style.label });
  }

  if (preferences.help_topics?.length) {
    rows.push({ label: "Topics", value: preferences.help_topics.join(", ") });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Prompt context
// ---------------------------------------------------------------------------

const STYLE_PROMPT: Record<CommunicationStyle, string> = {
  concise:
    "They chose concise answers: keep it under 80 words, no preamble and no recap.",
  encouraging:
    "They chose an encouraging tone: warm and steady. Never imply they should have done more, and never use guilt.",
  detailed:
    "They chose detailed answers: give the reasoning and the steps, still under 250 words.",
};

const TASK_SIZE_PROMPT: Record<TaskSize, string> = {
  small: "prefers small steps they can finish quickly",
  medium: "prefers steps of roughly half an hour",
  large: "prefers longer working blocks when the time is there",
};

/**
 * The only preference text that may reach a prompt.
 *
 * Returns an empty list whenever personalisation is off, so switching it off is
 * a real switch rather than a hidden one. Only saved fields appear; nothing is
 * derived, and no sensitive trait is ever described.
 */
export function preferenceContextLines(
  preferences: UserPreferences | null | undefined,
): string[] {
  if (!preferences || !preferences.personalization_enabled) return [];

  const lines: string[] = [];
  const habits: string[] = [];

  if (preferences.session_length_minutes) {
    habits.push(
      `about ${preferences.session_length_minutes} minutes per work session`,
    );
  }
  if (preferences.task_size) {
    habits.push(TASK_SIZE_PROMPT[preferences.task_size]);
  }

  const days = workDaySummary(preferences.work_days);
  const hours = workHoursSummary(preferences);
  if (days && hours) {
    habits.push(`usually works ${days.toLowerCase()} between ${hours}`);
  } else if (days) {
    habits.push(`usually works on ${days.toLowerCase()}`);
  } else if (hours) {
    habits.push(`usually works between ${hours}`);
  }

  if (habits.length > 0) {
    lines.push(`Preferences they saved: they ${habits.join("; ")}.`);
  }

  if (preferences.help_topics?.length) {
    lines.push(
      `They asked for help with: ${preferences.help_topics.join("; ")}.`,
    );
  }

  if (preferences.communication_style) {
    lines.push(STYLE_PROMPT[preferences.communication_style]);
  }

  if (lines.length > 0) {
    lines.push(
      "Use these only to shape the suggestion. Do not infer anything else about them, and never mention health, diagnoses or private traits.",
    );
  }

  return lines;
}

/** The extra style instruction for task help, or null when none was chosen. */
export function styleInstruction(
  preferences: UserPreferences | null | undefined,
): string | null {
  if (!preferences || !preferences.personalization_enabled) return null;
  if (!preferences.communication_style) return null;
  return STYLE_PROMPT[preferences.communication_style];
}

// ---------------------------------------------------------------------------
// Explanations
// ---------------------------------------------------------------------------

export function sessionExplanation(
  preferences: UserPreferences | null | undefined,
  minutes?: number | null,
): string | null {
  if (!preferences || !preferences.personalization_enabled) return null;
  const length = minutes ?? preferences.session_length_minutes;
  if (!length) return null;
  return `Suggested because you selected ${length}-minute sessions.`;
}

export function taskSizeExplanation(
  preferences: UserPreferences | null | undefined,
): string | null {
  if (!preferences || !preferences.personalization_enabled) return null;

  switch (preferences.task_size) {
    case "small":
      return "Suggested because you prefer small steps.";
    case "medium":
      return "Suggested because you prefer medium-sized steps.";
    case "large":
      return "Suggested because you prefer larger working blocks.";
    default:
      return null;
  }
}

export function workPatternExplanation(
  preferences: UserPreferences | null | undefined,
): string | null {
  if (!preferences || !preferences.personalization_enabled) return null;

  const days = workDaySummary(preferences.work_days);
  const hours = workHoursSummary(preferences);
  if (days && hours) {
    return `Suggested because you usually work ${days.toLowerCase()}, ${hours}.`;
  }
  if (days) return `Suggested because you usually work on ${days.toLowerCase()}.`;
  if (hours) return `Suggested because you usually work between ${hours}.`;
  return null;
}

export function styleExplanation(
  preferences: UserPreferences | null | undefined,
): string | null {
  if (!preferences || !preferences.personalization_enabled) return null;
  if (!preferences.communication_style) return null;
  const style = COMMUNICATION_STYLE_OPTIONS.find(
    (option) => option.value === preferences.communication_style,
  );
  return style ? `Written ${style.label.toLowerCase()} because you chose that style.` : null;
}

/** Short reasons shown under a suggestion. Never empty when a preference was used. */
export function suggestionReasons(
  preferences: UserPreferences | null | undefined,
): string[] {
  return [
    sessionExplanation(preferences),
    taskSizeExplanation(preferences),
    workPatternExplanation(preferences),
    styleExplanation(preferences),
  ].filter((reason): reason is string => reason !== null);
}

// ---------------------------------------------------------------------------
// Daily selection
// ---------------------------------------------------------------------------

export type DailySelection = {
  selected: DailyPlanCandidate[];
  skipped: DailyPlanCandidate[];
  /** Sum of the known estimates only. Missing estimates stay unknown. */
  totalMinutes: number;
  unknownEstimates: number;
  overLimit: boolean;
  reasons: string[];
};

/**
 * Chooses a manageable set of open tasks that fit the time the person has.
 *
 * In-progress work comes first so momentum is not lost; the rest keeps the
 * order it was given. A task with no estimate is included only while the known
 * total still has room, and is counted separately rather than guessed at.
 * Tasks that do not fit are returned as `skipped` — never marked abandoned.
 */
export function selectDailyTasks(
  tasks: DailyPlanCandidate[],
  minutes: number,
  preferences?: UserPreferences | null,
): DailySelection {
  const open = tasks.filter((task) => task.status !== "completed");
  const ordered = [
    ...open.filter((task) => task.status === "in_progress"),
    ...open.filter((task) => task.status !== "in_progress"),
  ];

  const selected: DailyPlanCandidate[] = [];
  const skipped: DailyPlanCandidate[] = [];
  let totalMinutes = 0;
  let unknownEstimates = 0;

  for (const task of ordered) {
    if (
      task.estimated_minutes !== null &&
      totalMinutes + task.estimated_minutes > minutes
    ) {
      skipped.push(task);
      continue;
    }

    selected.push(task);
    if (task.estimated_minutes === null) {
      unknownEstimates += 1;
    } else {
      totalMinutes += task.estimated_minutes;
    }
  }

  const reasons: string[] = [];
  if (preferences?.personalization_enabled && preferences.session_length_minutes) {
    reasons.push(
      sessionExplanation(preferences, preferences.session_length_minutes) ??
        "",
    );
  }
  const sizeReason = taskSizeExplanation(preferences);
  if (sizeReason) reasons.push(sizeReason);

  if (selected.length === 0) {
    reasons.unshift(
      `Nothing here is estimated to fit in ${minutes} minutes. Pick a smaller step, or give yourself more time.`,
    );
  } else if (skipped.length > 0) {
    reasons.push(
      `${skipped.length} ${skipped.length === 1 ? "task is" : "tasks are"} left for another day. Nothing about them changed.`,
    );
  }

  return {
    selected,
    skipped,
    totalMinutes,
    unknownEstimates,
    overLimit: totalMinutes > minutes,
    reasons: reasons.filter(Boolean),
  };
}

export type SelectionCheck =
  | { ok: true; tasks: DailyPlanCandidate[] }
  | { ok: false; reason: "empty" | "too-many" | "duplicate" | "unknown-task" };

/**
 * Checks a browser-supplied selection against the person's own open tasks.
 * Ownership is enforced again in Postgres; this catches the ordinary mistakes
 * before a round trip.
 */
export function validateDailySelection(
  ids: string[],
  tasks: DailyPlanCandidate[],
): SelectionCheck {
  if (ids.length === 0) return { ok: false, reason: "empty" };
  if (ids.length > 20) return { ok: false, reason: "too-many" };
  if (new Set(ids).size !== ids.length) {
    return { ok: false, reason: "duplicate" };
  }

  const byId = new Map(tasks.map((task) => [task.id, task]));
  const selected: DailyPlanCandidate[] = [];

  for (const id of ids) {
    const task = byId.get(id);
    if (!task || task.status === "completed") {
      return { ok: false, reason: "unknown-task" };
    }
    selected.push(task);
  }

  return { ok: true, tasks: selected };
}

export function selectionTotal(tasks: DailyPlanCandidate[]): {
  totalMinutes: number;
  unknownEstimates: number;
} {
  return tasks.reduce(
    (totals, task) =>
      task.estimated_minutes === null
        ? { ...totals, unknownEstimates: totals.unknownEstimates + 1 }
        : { ...totals, totalMinutes: totals.totalMinutes + task.estimated_minutes },
    { totalMinutes: 0, unknownEstimates: 0 },
  );
}

// ---------------------------------------------------------------------------
// Form parsing
// ---------------------------------------------------------------------------

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const preferenceValuesSchema = z
  .object({
    session_length_minutes: z
      .number()
      .int()
      .min(5, "Sessions start at 5 minutes.")
      .max(240, "Keep sessions at 240 minutes or less.")
      .nullable(),
    work_days: z.array(z.number().int().min(0).max(6)).max(7),
    work_start: z.string().regex(HHMM).nullable(),
    work_end: z.string().regex(HHMM).nullable(),
    task_size: z.enum(TASK_SIZE_VALUES).nullable(),
    communication_style: z.enum(STYLE_VALUES).nullable(),
    help_topics: z.array(z.string().min(1).max(MAX_TOPIC_LENGTH)).max(MAX_HELP_TOPICS),
    personalization_enabled: z.boolean(),
  })
  .superRefine((values, ctx) => {
    if ((values.work_start === null) !== (values.work_end === null)) {
      ctx.addIssue({
        code: "custom",
        message: "Add both a start and an end time, or neither.",
        path: ["work_start"],
      });
      return;
    }
    if (values.work_start && values.work_end && values.work_start >= values.work_end) {
      ctx.addIssue({
        code: "custom",
        message: "Your end time needs to be after your start time.",
        path: ["work_end"],
      });
    }
  });

export type PreferenceValues = z.infer<typeof preferenceValuesSchema>;

export type PreferenceParseResult =
  | { ok: true; values: PreferenceValues }
  | { ok: false; message: string };

/**
 * Normalises raw form strings into validated values. Blank means "no
 * preference" for every optional field.
 */
export function parsePreferenceValues(raw: {
  sessionLength: string;
  workDays: string[];
  workStart: string;
  workEnd: string;
  taskSize: string;
  communicationStyle: string;
  helpTopics: string;
  personalizationEnabled: boolean;
}): PreferenceParseResult {
  const sessionLength = raw.sessionLength.trim();
  const parsedLength = sessionLength === "" ? null : Number(sessionLength);

  if (parsedLength !== null && !Number.isFinite(parsedLength)) {
    return { ok: false, message: "Choose a session length from the list." };
  }

  const start = raw.workStart.trim() === "" ? null : parseTimeOfDay(raw.workStart);
  const end = raw.workEnd.trim() === "" ? null : parseTimeOfDay(raw.workEnd);

  if (raw.workStart.trim() !== "" && !start) {
    return { ok: false, message: "Use a start time like 09:00." };
  }
  if (raw.workEnd.trim() !== "" && !end) {
    return { ok: false, message: "Use an end time like 17:30." };
  }

  const parsed = preferenceValuesSchema.safeParse({
    session_length_minutes: parsedLength,
    work_days: [...new Set(raw.workDays.map(Number))]
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
      .sort((a, b) => a - b),
    work_start: start,
    work_end: end,
    task_size: raw.taskSize === "" ? null : raw.taskSize,
    communication_style:
      raw.communicationStyle === "" ? null : raw.communicationStyle,
    help_topics: parseHelpTopics(raw.helpTopics),
    personalization_enabled: raw.personalizationEnabled,
  });

  if (!parsed.success) {
    return { ok: false, message: firstErrorMessage(parsed.error) };
  }

  return { ok: true, values: parsed.data };
}

/** The stored shape, ready for an upsert. Nulls clear a field. */
export function preferencesUpsertRow(
  userId: string,
  values: PreferenceValues,
): Omit<UserPreferences, "updated_at"> {
  return {
    user_id: userId,
    session_length_minutes: values.session_length_minutes,
    work_days: values.work_days.length > 0 ? values.work_days : null,
    work_start: values.work_start,
    work_end: values.work_end,
    task_size: values.task_size,
    communication_style: values.communication_style,
    help_topics: values.help_topics.length > 0 ? values.help_topics : null,
    personalization_enabled: values.personalization_enabled,
  };
}
