/**
 * Focus timer helpers.
 *
 * The authoritative elapsed time always comes from the database: it is derived
 * from stored timestamps by `public.focus_elapsed_seconds`. Everything here
 * either formats that number or projects it forward for the on-screen clock.
 * Nothing here decides how much time was recorded.
 */

import type { FocusSessionStatus } from "@/lib/types";

/** One session can never count for more than eight hours. */
export const FOCUS_CAP_SECONDS = 8 * 60 * 60;

/** A session left open this long is closed at its recorded time. */
export const FOCUS_STALE_HOURS = 12;

export type FocusIntent = "start" | "pause" | "resume" | "finish";

/** `0:07`, `12:34`, `1:02:03`. */
export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  const ss = String(seconds).padStart(2, "0");
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);

  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** `0 min`, `45 min`, `1 hr`, `2 hr 5 min`. */
export function formatFocusTotal(totalSeconds: number): string {
  const minutes = Math.floor(Math.max(0, totalSeconds) / 60);
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/**
 * Projects a stored elapsed value forward for display.
 *
 * The screen clock is allowed to tick; the recorded total is not. This only
 * moves the display along, using wall-clock time rather than counting ticks, so
 * a throttled background tab does not drift.
 */
export function projectElapsed(
  baseSeconds: number,
  status: FocusSessionStatus,
  baseAtMs: number,
  nowMs: number,
): number {
  const base = Math.min(Math.max(0, Math.floor(baseSeconds)), FOCUS_CAP_SECONDS);
  if (status !== "running") return base;

  const delta = Math.max(0, Math.floor((nowMs - baseAtMs) / 1000));
  return Math.min(base + delta, FOCUS_CAP_SECONDS);
}

/** Which buttons make sense for the current state. */
export function availableActions(
  status: FocusSessionStatus | null,
): FocusIntent[] {
  if (status === null) return ["start"];
  if (status === "running") return ["pause", "finish"];
  if (status === "paused") return ["resume", "finish"];
  return [];
}

const UNAVAILABLE = "We couldn't update the timer. Reload the page to see where it stands.";

/** Turns a database code into something a person can read. */
export function focusErrorMessage(code?: string): string {
  switch (code) {
    case "unauthenticated":
      return "Your session expired. Sign in again to keep going.";
    case "no-task":
      return "That task isn't available. Go back to your goal and open it again.";
    case "no-session":
      return "That focus session is no longer open. Reload the page to see where it stands.";
    default:
      return UNAVAILABLE;
  }
}

/**
 * Monday of the current week in UTC, as `YYYY-MM-DD`.
 * The server decides this; the browser never sends a week.
 */
export function currentWeekStart(now: Date = new Date()): string {
  const utc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const daysSinceMonday = (utc.getUTCDay() + 6) % 7;
  utc.setUTCDate(utc.getUTCDate() - daysSinceMonday);
  return utc.toISOString().slice(0, 10);
}

/** Plain description of what happens when the browser closes mid-session. */
export const FOCUS_PERSISTENCE_NOTE =
  "The session lives on the server, not in the tab. If you close the browser, lose connection or refresh, the clock keeps running from the timestamps already stored — come back and pause or finish it. A session left open for more than " +
  `${FOCUS_STALE_HOURS} hours is closed automatically at the time it had reached, and no single session counts more than ${FOCUS_CAP_SECONDS / 3600} hours.`;
