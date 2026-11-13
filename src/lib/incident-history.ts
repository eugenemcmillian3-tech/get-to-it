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
