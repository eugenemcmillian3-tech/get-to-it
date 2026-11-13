/**
 * How a closed incident and the notifications it produced are described. Kept
 * away from the page so the wording can be checked without rendering anything.
 */

export function notificationStageLabel(stage: string | null): string {
  switch (stage) {
    case "first":
      return "first notification";
    case "reminder":
      return "reminder";
    case "escalation":
      return "escalation";
    default:
      return "notification sent before the schedule";
  }
}

export function formatIncidentMoment(value: string | null): string {
  if (!value) return "not recorded";
  return `${new Date(value).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** How long the incident was open between the two moments. */
export function incidentDuration(openedAt: string, closedAt: string): string {
  const hours = Math.floor(
    (new Date(closedAt).getTime() - new Date(openedAt).getTime()) / (60 * 60 * 1000),
  );
  if (!Number.isFinite(hours) || hours < 1) return "under an hour";
  if (hours < 48) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.floor(hours / 24);
  return `${days} days`;
}

export function recoveryKindLabel(kind: string | null): string {
  switch (kind) {
    case "code_rollback":
      return "code rollback";
    case "config_rollback":
      return "config rollback";
    case "database_recovery":
      return "database recovery";
    case "patch":
      return "patch";
    default:
      return "not recorded";
  }
}

export const HISTORY_PAGE_SIZE = 20;
export const INCIDENT_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const CLOSED_STATUSES = ["resolved", "dismissed"] as const;

export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];
export type ClosedStatus = (typeof CLOSED_STATUSES)[number];

export type IncidentHistoryFilters = {
  severity: IncidentSeverity | null;
  status: ClosedStatus | null;
  query: string | null;
  /** Inclusive first UTC day whose closures are shown. */
  from: string | null;
  /** Inclusive last UTC day whose closures are shown. */
  to: string | null;
  page: number;
};

/** A real calendar day in `YYYY-MM-DD`, or null. `2026-02-31` is rejected. */
function isoDay(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === value ? value : null;
}

function firstValue(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * What the URL asked for, kept only where it means something. An unknown severity
 * or status is dropped rather than passed on, so a hand-edited link cannot ask the
 * read for a filter it does not support.
 */
export function historyFilters(params: {
  severity?: string | string[];
  status?: string | string[];
  query?: string | string[];
  from?: string | string[];
  to?: string | string[];
  page?: string | string[];
}): IncidentHistoryFilters {
  const severity = firstValue(params.severity);
  const status = firstValue(params.status);
  const query = firstValue(params.query);
  const page = Number.parseInt(firstValue(params.page) ?? "", 10);

  return {
    severity: INCIDENT_SEVERITIES.includes(severity as IncidentSeverity)
      ? (severity as IncidentSeverity)
      : null,
    status: CLOSED_STATUSES.includes(status as ClosedStatus) ? (status as ClosedStatus) : null,
    query: query ? query.slice(0, 100) : null,
    from: isoDay(firstValue(params.from)),
    to: isoDay(firstValue(params.to)),
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

export function historyHref(
  workspaceId: string,
  filters: IncidentHistoryFilters,
  page: number = filters.page,
): string {
  const search = new URLSearchParams();
  if (filters.severity) search.set("severity", filters.severity);
  if (filters.status) search.set("status", filters.status);
  if (filters.from) search.set("from", filters.from);
  if (filters.to) search.set("to", filters.to);
  if (filters.query) search.set("query", filters.query);
  if (page > 1) search.set("page", String(page));
  const qs = search.toString();
  return `/workspace/${workspaceId}/improvements/incidents${qs ? `?${qs}` : ""}`;
}

/** Where the current page sits in the result set, for "showing 21-40 of 63". */
export function pageWindow(
  total: number,
  page: number,
  size: number = HISTORY_PAGE_SIZE,
): {
  page: number;
  pageCount: number;
  first: number;
  last: number;
  hasPrevious: boolean;
  hasNext: boolean;
} {
  const pageCount = Math.max(1, Math.ceil(Math.max(total, 0) / size));
  const current = Math.min(Math.max(page, 1), pageCount);
  return {
    page: current,
    pageCount,
    first: total === 0 ? 0 : (current - 1) * size + 1,
    last: Math.min(current * size, total),
    hasPrevious: current > 1,
    hasNext: current < pageCount,
  };
}
