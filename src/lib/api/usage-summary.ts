/**
 * Display-only summaries for the project API page.
 *
 * Kept out of the component so request-time clock reads do not happen during
 * render. This reads no secrets and makes no authorization decision.
 */

export type UsageSummaryRow = {
  key_id: string;
  status: number;
  created_at: string;
};

export type UsageSummary = { calls: number; limited: number; last: string | null };

export function summarizeRecentUsage(
  rows: UsageSummaryRow[],
  windowMs = 24 * 60 * 60 * 1000,
  now = Date.now(),
): Map<string, UsageSummary> {
  const since = now - windowMs;
  const stats = new Map<string, UsageSummary>();

  for (const row of rows) {
    const created = Date.parse(row.created_at);
    if (!Number.isFinite(created) || created < since) continue;
    const current = stats.get(row.key_id) ?? { calls: 0, limited: 0, last: null };
    current.calls += 1;
    if (row.status === 429) current.limited += 1;
    if (!current.last || row.created_at > current.last) current.last = row.created_at;
    stats.set(row.key_id, current);
  }

  return stats;
}

export function keyIsExpired(expiresAt: string, now = Date.now()): boolean {
  const parsed = Date.parse(expiresAt);
  return !Number.isFinite(parsed) || parsed <= now;
}
