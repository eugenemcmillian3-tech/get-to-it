import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Cron authentication.
 *
 * Scheduled routes are called by the host with `Authorization: Bearer
 * $CRON_SECRET`. The values are compared by digest, so the comparison time does
 * not depend on where two strings first differ or on how long they are — the
 * same approach the Stripe and Resend webhook verifiers use. A missing secret
 * never authorises anything: the routes must fail closed.
 */

export const CRON_AUTHORIZATION_PREFIX = "Bearer ";

/** Compares two secrets without leaking their contents or length through timing. */
export function secretsMatch(provided: string, expected: string): boolean {
  const providedDigest = createHash("sha256").update(provided, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

/**
 * True only for `Authorization: Bearer <CRON_SECRET>` with a configured secret.
 * A missing secret is a refusal, not an open door.
 */
export function cronRequestAuthorized(
  request: Pick<Request, "headers">,
  secret: string | undefined = process.env.CRON_SECRET,
): boolean {
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith(CRON_AUTHORIZATION_PREFIX)) return false;
  return secretsMatch(header.slice(CRON_AUTHORIZATION_PREFIX.length), secret);
}
