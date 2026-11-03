/**
 * Operational logging, kept deliberately poor at its job.
 *
 * Logs may only carry an event name, an outcome code and small numbers. Anything
 * that looks like text — goal titles, saved work, reflections, prompts, emails,
 * tokens — is dropped rather than truncated, so a person's content cannot leak
 * into host logs by accident.
 */

export type LogValue = string | number | boolean;

const SAFE_KEY = /^[a-z][a-z0-9_]{0,39}$/;
const SAFE_STRING = /^[a-zA-Z0-9_.:-]{0,60}$/;

/** True only for a short, structured value; free text never qualifies. */
function isSafeValue(value: LogValue): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  return SAFE_STRING.test(value);
}

export function safeLogFields(fields: Record<string, LogValue>): Record<string, LogValue> {
  const safe: Record<string, LogValue> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (!SAFE_KEY.test(key)) continue;
    if (!isSafeValue(value)) continue;
    safe[key] = value;
  }

  return safe;
}

export function logOperational(event: string, fields: Record<string, LogValue> = {}): void {
  const line = JSON.stringify({
    at: new Date().toISOString(),
    event: SAFE_STRING.test(event) ? event : "invalid_event",
    ...safeLogFields(fields),
  });

  console.log(line);
}

/** A content-free error line: the message is reduced to a short code. */
export function logOperationalError(event: string, code: string): void {
  logOperational(event, { outcome: "error", code: code.slice(0, 40) });
}
