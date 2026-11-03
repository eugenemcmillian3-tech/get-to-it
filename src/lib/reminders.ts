/**
 * Reminder helpers.
 *
 * Pure functions only: time parsing, quiet-hour arithmetic, weekday summaries
 * and the delivery predicate. The authoritative scheduling and deduplication
 * happen in Postgres (`reminder_next_due`, `run_reminder_pass`), because that is
 * where the timestamps and the unique delivery key live.
 */

export const WEEKDAY_LABELS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

export const DEFAULT_WEEKDAYS = [1, 2, 3, 4, 5];

export const SNOOZE_OPTIONS = [
  { label: "In an hour", minutes: 60 },
  { label: "Tomorrow morning", minutes: 24 * 60 },
] as const;

/** A short list of common zones; the value is stored as-is (IANA name). */
export const REMINDER_TIMEZONES = [
  "UTC",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Amsterdam",
  "Europe/Lisbon",
  "Europe/Warsaw",
  "Europe/Stockholm",
  "Europe/Athens",
  "Europe/Istanbul",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Sao_Paulo",
  "Africa/Lagos",
  "Africa/Johannesburg",
  "Africa/Nairobi",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Perth",
  "Australia/Sydney",
  "Pacific/Auckland",
];

/** `9:5` is not a time; `09:05` is. Returns HH:MM or null. */
export function parseTimeOfDay(value: string): string | null {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function timeToMinutes(value: string): number | null {
  const parsed = parseTimeOfDay(value);
  if (!parsed) return null;
  const [hours, minutes] = parsed.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * True when the given local time falls inside quiet hours.
 * Quiet hours may wrap midnight: 21:00 → 08:00 covers the night.
 */
export function isQuietHours(now: string, from: string, to: string): boolean {
  const current = timeToMinutes(now);
  const start = timeToMinutes(from);
  const end = timeToMinutes(to);
  if (current === null || start === null || end === null) return false;
  if (start === end) return false;
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}

/** `09:00` → `9:00 am`. */
export function formatTime12(value: string): string {
  const minutes = timeToMinutes(value);
  if (minutes === null) return value;
  const hours24 = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const suffix = hours24 < 12 ? "am" : "pm";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(mins).padStart(2, "0")} ${suffix}`;
}

/** Sorted, unique weekdays; anything outside 0–6 is dropped. */
export function normalizeWeekdays(days: number[]): number[] {
  const clean = days.filter(
    (day) => Number.isInteger(day) && day >= 0 && day <= 6,
  );
  return [...new Set(clean)].sort((a, b) => a - b);
}

export function weekdaySummary(days: number[]): string {
  const clean = normalizeWeekdays(days);
  if (clean.length === 7) return "Every day";
  if (clean.length === 5 && clean.every((day, index) => day === index + 1)) {
    return "Weekdays";
  }
  if (clean.length === 2 && clean[0] === 0 && clean[1] === 6) return "Weekends";
  if (clean.length === 0) return "No days selected";
  return clean.map((day) => WEEKDAY_LABELS[day]).join(", ");
}

export function isValidTimeZone(zone: string): boolean {
  if (zone.trim() === "") return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Current local clock in a zone, as HH:MM. */
export function localClock(zone: string, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(at);
  } catch {
    return "00:00";
  }
}

/** Current local date in a zone, as YYYY-MM-DD. */
export function localDate(zone: string, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** `Fri 09:00`, or null when there is no next time. */
export function dueLabel(iso: string | null, zone: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace("T", " ");
  }
}

export type DeliveryDecision = {
  enabled: boolean;
  settingsEnabled: boolean;
  dueAt: string | null;
  quietNow: boolean;
  targetCompleted: boolean;
};

export type DeliveryOutcome = "deliver" | "skip-quiet" | "skip-completed" | "not-due";

/**
 * The same decision the database makes, expressed once so it can be tested
 * without waiting for a clock. Used by the reminder tests; the SQL pass is the
 * one that actually writes.
 */
export function deliveryOutcome(
  input: DeliveryDecision,
  now: Date = new Date(),
): DeliveryOutcome {
  if (!input.enabled || !input.settingsEnabled || !input.dueAt) return "not-due";
  const due = new Date(input.dueAt);
  if (Number.isNaN(due.getTime()) || due.getTime() > now.getTime()) {
    return "not-due";
  }
  if (input.targetCompleted) return "skip-completed";
  if (input.quietNow) return "skip-quiet";
  return "deliver";
}

/** One delivery per due slot; the database unique index is the real guard. */
export function deliveryKey(
  kind: "reminder" | "checkin",
  targetId: string,
  dueIso: string,
): string {
  if (kind === "checkin") return `checkin:${targetId}:${dueIso.slice(0, 10)}`;
  return `reminder:${targetId}:${dueIso.slice(0, 19)}`;
}
