import { getSession } from "@/lib/auth";
import { listIncidentHistoryForExport } from "@/lib/data/incident-history";
import { historyFilters, HISTORY_EXPORT_MAX } from "@/lib/incident-history";
import { incidentHistoryCsv, incidentHistoryCsvFileName } from "@/lib/incident-history-csv";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { isUuid } from "@/lib/validation";

/**
 * CSV of the closed incident history, filtered the same way the page is.
 *
 * It exports every matching incident rather than the current page, reads through
 * the same membership-checked RPC as the page, and refuses a result too large for
 * one file instead of cutting it short. Nothing here writes.
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
    return new Response("Sign in to export the incident history.", { status: 401 });
  }

  const filters = historyFilters(Object.fromEntries(new URL(request.url).searchParams));
  const result = await listIncidentHistoryForExport(session, workspaceId, filters);
  if (!result) {
    return new Response("Not found", { status: 404 });
  }
  if (result.tooLarge) {
    return new Response(
      `That history has ${result.total} matching incidents, more than the ${HISTORY_EXPORT_MAX} one export supports. Narrow the filters and try again.`,
      { status: 413 },
    );
  }

  const exportedAt = new Date().toISOString();

  return new Response(incidentHistoryCsv(result.incidents), {
    status: 200,
    headers: {
      "Content-Type": "text/csv;charset=utf-8",
      "Content-Disposition": `attachment; filename="${incidentHistoryCsvFileName(exportedAt)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
