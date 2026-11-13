import { getSession } from "@/lib/auth";
import { listIncidentHistoryForExport } from "@/lib/data/incident-history";
import {
  HISTORY_EXPORT_MAX,
  NOTIFICATION_EXPORT_MAX,
  historyFilters,
} from "@/lib/incident-history";
import {
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

  const filters = historyFilters(Object.fromEntries(new URL(request.url).searchParams));
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

  const rows = incidentNotificationRowCount(result.incidents);
  if (rows > NOTIFICATION_EXPORT_MAX) {
    return new Response(
      `Those filters cover ${rows} notifications, more than the ${NOTIFICATION_EXPORT_MAX} rows one export supports. Narrow the filters and try again.`,
      { status: 413 },
    );
  }

  const exportedAt = new Date().toISOString();

  return new Response(incidentNotificationCsv(result.incidents), {
    status: 200,
    headers: {
      "Content-Type": "text/csv;charset=utf-8",
      "Content-Disposition": `attachment; filename="${incidentNotificationCsvFileName(exportedAt)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
