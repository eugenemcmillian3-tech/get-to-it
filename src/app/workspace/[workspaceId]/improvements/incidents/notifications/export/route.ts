import { getSession } from "@/lib/auth";
import { listIncidentHistoryForExport } from "@/lib/data/incident-history";
import {
  HISTORY_EXPORT_MAX,
  NOTIFICATION_EXPORT_MAX,
  historyFilters,
} from "@/lib/incident-history";
import {
  filterIncidentNotificationsByRecipient,
  incidentNotificationCsv,
  incidentNotificationCsvFileName,
  incidentNotificationRowCount,
} from "@/lib/incident-history-csv";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { isUuid } from "@/lib/validation";

/**
 * CSV of the notification trail for the filtered history: one row per delivery
 * rather than per incident, so a review can see each stage, recipient and read
 * time on its own line.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params;
  if (!isUuid(workspaceId)) {
    return new Response("Not found", { status: 404 });
  }
  if (!getSupabaseSettings()) {
    return new Response("This workspace is not connected yet.", { status: 503 });
  }

  const session = await getSession();
  if (!session) {
    return new Response("Sign in to export the notification trail.", { status: 401 });
  }

  const search = new URL(request.url).searchParams;
  const filters = historyFilters(Object.fromEntries(search));
  const recipient = search.get("recipient");
  if (recipient !== null && !isUuid(recipient)) {
    return new Response("That recipient is not a member of this workspace.", { status: 400 });
  }
  const result = await listIncidentHistoryForExport(session, workspaceId, filters);
  if (!result) {
    return new Response("Not found", { status: 404 });
  }
  if (result.tooLarge) {
    return new Response(
      `That history has ${result.total} matching incidents, more than the ${HISTORY_EXPORT_MAX} one export walks. Narrow the filters and try again.`,
      { status: 413 },
    );
  }

  // A recipient narrows the deliveries, not the incidents: the same filters decide
  // which incidents are in scope, then only that person's rows are written.
  const scoped = recipient
    ? filterIncidentNotificationsByRecipient(result.incidents, recipient)
    : result.incidents;

  const rows = incidentNotificationRowCount(scoped);
  if (rows > NOTIFICATION_EXPORT_MAX) {
    return new Response(
      `Those filters cover ${rows} notifications, more than the ${NOTIFICATION_EXPORT_MAX} rows one export supports. Narrow the filters and try again.`,
      { status: 413 },
    );
  }

  const exportedAt = new Date().toISOString();

  return new Response(incidentNotificationCsv(scoped), {
    status: 200,
    headers: {
      "Content-Type": "text/csv;charset=utf-8",
      "Content-Disposition": `attachment; filename="${incidentNotificationCsvFileName(exportedAt)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
