import type { ClosedIncident } from "@/lib/data/incident-history";
import { csvRows } from "@/lib/export";

/**
 * One row per closed incident, with what the schedule delivered for it. Times are
 * ISO 8601 UTC so a spreadsheet can sort them; the human wording stays on the page.
 */
export const INCIDENT_HISTORY_CSV_HEADERS = [
  "incident_status",
  "severity",
  "incident",
  "promoted_change",
  "deployment_target",
  "opened_at",
  "closed_at",
  "open_hours",
  "recovery",
  "notifications_sent",
  "escalations",
  "unread_notifications",
  "recipients",
  "first_notification_at",
  "last_notification_at",
  "trigger",
];

function hoursOpen(openedAt: string, closedAt: string): number {
  const hours = (new Date(closedAt).getTime() - new Date(openedAt).getTime()) / 3_600_000;
  return Number.isFinite(hours) && hours > 0 ? Math.round(hours * 100) / 100 : 0;
}

function uniqueRecipients(incident: ClosedIncident): string {
  const names = new Set<string>();
  for (const row of incident.notifications) {
    names.add(row.recipient ?? `member ${row.userId.slice(0, 8)}`);
  }
  return [...names].sort().join("; ");
}

export function incidentHistoryCsv(incidents: ClosedIncident[]): string {
  return csvRows(
    INCIDENT_HISTORY_CSV_HEADERS,
    incidents.map((incident) => {
      const sent = incident.notifications.map((row) => row.sentAt).sort();
      return [
        incident.status,
        incident.severity,
        incident.title,
        incident.candidateTitle,
        incident.target,
        incident.openedAt,
        incident.closedAt,
        hoursOpen(incident.openedAt, incident.closedAt),
        incident.recoveryKind ?? "",
        incident.notifications.length,
        incident.notifications.filter((row) => row.stage === "escalation").length,
        incident.notifications.filter((row) => !row.readAt).length,
        uniqueRecipients(incident),
        sent[0] ?? "",
        sent[sent.length - 1] ?? "",
        incident.trigger,
      ];
    }),
  );
}

export function incidentHistoryCsvFileName(exportedAt: string): string {
  return `incident-history-${exportedAt.slice(0, 10)}.csv`;
}
