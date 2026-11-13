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

/**
 * The delivery trail, one row per notification. The incident's own facts are
 * repeated on each row so a single line stands on its own when filtered or sorted.
 */
export const INCIDENT_NOTIFICATION_CSV_HEADERS = [
  "incident_status",
  "severity",
  "incident",
  "promoted_change",
  "deployment_target",
  "opened_at",
  "closed_at",
  "stage",
  "reminder_day",
  "recipient",
  "sent_at",
  "read_at",
  "summary",
];

export function incidentNotificationCsv(incidents: ClosedIncident[]): string {
  return csvRows(
    INCIDENT_NOTIFICATION_CSV_HEADERS,
    incidents.flatMap((incident) => {
      // Oldest delivery first within an incident; incidents keep their closed-date
      // order, so the file reads the same way as the page.
      const delivered = [...incident.notifications].sort((a, b) =>
        a.sentAt < b.sentAt ? -1 : a.sentAt > b.sentAt ? 1 : 0,
      );
      return delivered.map((row) => [
        incident.status,
        incident.severity,
        incident.title,
        incident.candidateTitle,
        incident.target,
        incident.openedAt,
        incident.closedAt,
        row.stage ?? "",
        row.day ?? "",
        row.recipient ?? `member ${row.userId.slice(0, 8)}`,
        row.sentAt,
        row.readAt ?? "",
        row.summary,
      ]);
    }),
  );
}

/**
 * Narrows the trail to one recipient's deliveries. Incidents with nothing left for
 * that person are dropped rather than exported as empty rows, so a filtered file
 * contains only deliveries that person actually received.
 */
export function filterIncidentNotificationsByRecipient(
  incidents: ClosedIncident[],
  recipientId: string,
): ClosedIncident[] {
  return incidents
    .map((incident) => ({
      ...incident,
      notifications: incident.notifications.filter((row) => row.userId === recipientId),
    }))
    .filter((incident) => incident.notifications.length > 0);
}

export function incidentNotificationRowCount(incidents: ClosedIncident[]): number {
  return incidents.reduce((total, incident) => total + incident.notifications.length, 0);
}

export function incidentNotificationCsvFileName(exportedAt: string): string {
  return `incident-notifications-${exportedAt.slice(0, 10)}.csv`;
}
