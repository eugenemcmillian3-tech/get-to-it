import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import { listIncidentHistory } from "@/lib/data/incident-history";
import { getIdentity } from "@/lib/identity";
import {
  CLOSED_STATUSES,
  INCIDENT_SEVERITIES,
  formatIncidentMoment,
  historyFilters,
  historyHref,
  incidentDuration,
  notificationStageLabel,
  pageWindow,
  recoveryKindLabel,
} from "@/lib/incident-history";
import { cardClass, chipClass, inputClass, labelClass, primaryButton, quietButton } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Incident history — GET TO IT" };

function person(name: string | null, id: string): string {
  return name ?? `member ${id.slice(0, 8)}`;
}

export default async function IncidentHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId } = await params;
  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const filters = historyFilters(await searchParams);
  const session = await requireSession();
  const [identity, firstRead] = await Promise.all([
    getIdentity(session),
    listIncidentHistory(session, workspaceId, filters),
  ]);
  if (!firstRead) notFound();

  // A page past the end of the result set reads nothing, so it is re-read at the
  // last page that exists instead of showing "0 of 63".
  let history = firstRead;
  let window = pageWindow(history.total, filters.page);
  if (history.total > 0 && window.page !== filters.page) {
    history = (await listIncidentHistory(session, workspaceId, { ...filters, page: window.page })) ??
      history;
    window = pageWindow(history.total, window.page);
  }

  const notifications = history.incidents.reduce(
    (total, incident) => total + incident.notifications.length,
    0,
  );
  const escalations = history.incidents.reduce(
    (total, incident) =>
      total + incident.notifications.filter((row) => row.stage === "escalation").length,
    0,
  );
  const filtered = Boolean(
    filters.severity || filters.status || filters.query || filters.from || filters.to,
  );
  const invertedRange = Boolean(filters.from && filters.to && filters.from > filters.to);
  const clearHref = historyHref(workspaceId, {
    severity: null,
    status: null,
    query: null,
    from: null,
    to: null,
    page: 1,
  });

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-4xl px-5 pb-16 pt-6">
        <Link
          href={`/workspace/${workspaceId}/improvements/promotions`}
          className="text-sm text-muted underline"
        >
          Back to promotion audit
        </Link>

        <h1 className="mt-3 text-3xl font-black tracking-tight">Incident history</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Closed incidents that were opened against the deployment of a promoted change, each with
          the notifications the schedule delivered for it and whether they were marked read. This
          page only reads: every line comes from the incident and notification rows themselves, so
          an incident closed before it had been open for a day shows no notifications rather than
          an assumed one. Filter by severity, by how it closed, by a UTC closed-date range, or by
          text in the incident or the promoted change; newest closure first.
        </p>
        <p className="mt-2 text-xs text-muted">
          {history.total} closed {history.total === 1 ? "incident" : "incidents"}
          {filtered ? " matching the filters" : ""} · on this page:{" "}
          {history.incidents.length} {history.incidents.length === 1 ? "incident" : "incidents"},{" "}
          {notifications} {notifications === 1 ? "notification" : "notifications"} delivered
          {escalations > 0 ? ` · ${escalations} escalation${escalations === 1 ? "" : "s"}` : ""}
        </p>

        <form method="get" className={`${cardClass} mt-4 grid gap-3 sm:grid-cols-2`}>
          <label>
            <span className={labelClass}>Severity</span>
            <select
              name="severity"
              defaultValue={filters.severity ?? ""}
              className={`${inputClass} mt-1`}
            >
              <option value="">Any severity</option>
              {INCIDENT_SEVERITIES.map((severity) => (
                <option key={severity} value={severity}>
                  {severity}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={labelClass}>Closed as</span>
            <select name="status" defaultValue={filters.status ?? ""} className={`${inputClass} mt-1`}>
              <option value="">Resolved or dismissed</option>
              {CLOSED_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={labelClass}>Closed from</span>
            <input
              type="date"
              name="from"
              defaultValue={filters.from ?? ""}
              className={`${inputClass} mt-1`}
            />
          </label>
          <label>
            <span className={labelClass}>Closed to</span>
            <input
              type="date"
              name="to"
              defaultValue={filters.to ?? ""}
              className={`${inputClass} mt-1`}
            />
          </label>
          <p className="text-xs text-muted sm:col-span-2">
            Dates are UTC days and both ends are inclusive. Leave either blank for an open-ended
            range.
          </p>
          <label className="sm:col-span-2">
            <span className={labelClass}>Search</span>
            <input
              type="search"
              name="query"
              defaultValue={filters.query ?? ""}
              maxLength={100}
              placeholder="Incident or promoted change"
              className={`${inputClass} mt-1`}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <button type="submit" className={primaryButton}>
              Apply filters
            </button>
            {filtered ? (
              <Link href={clearHref} className={quietButton}>
                Clear
              </Link>
            ) : null}
          </div>
        </form>

        <section aria-labelledby="closed-heading" className="mt-8">
          <h2 id="closed-heading" className="text-xl font-bold">
            Closed incidents
          </h2>
          {invertedRange ? (
            <p className="mt-2 text-sm text-muted">
              The start date {filters.from} is after the end date {filters.to}, so nothing can
              match. Swap them to widen the range.
            </p>
          ) : null}
          {history.incidents.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              {filtered ? (
                <>
                  No closed incident matches these filters.{" "}
                  <Link href={clearHref} className="underline">
                    Clear them
                  </Link>
                  .
                </>
              ) : (
                "No incident on a promoted deployment has been resolved or dismissed in this workspace yet."
              )}
            </p>
          ) : (
            <ul className="mt-3 grid gap-4">
              {history.incidents.map((incident) => (
                <li key={incident.id} className={cardClass}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="text-base font-bold">{incident.title}</h3>
                      <p className="text-xs text-muted">
                        {incident.candidateTitle} · {incident.target} deployment · open{" "}
                        {incidentDuration(incident.openedAt, incident.closedAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={chipClass}>{incident.severity}</span>
                      <span className={chipClass}>{incident.status}</span>
                      <span className={chipClass}>
                        {incident.notifications.length}{" "}
                        {incident.notifications.length === 1 ? "notification" : "notifications"}
                      </span>
                    </div>
                  </div>

                  <dl className="mt-3 grid gap-3 text-sm">
                    <div>
                      <dt className="font-semibold">When</dt>
                      <dd className="text-muted">
                        Opened {formatIncidentMoment(incident.openedAt)}, closed{" "}
                        {formatIncidentMoment(incident.closedAt)}
                      </dd>
                    </div>

                    <div>
                      <dt className="font-semibold">What triggered it</dt>
                      <dd className="text-muted">{incident.trigger}</dd>
                    </div>

                    <div>
                      <dt className="font-semibold">Recovery</dt>
                      <dd className="text-muted">{recoveryKindLabel(incident.recoveryKind)}</dd>
                    </div>
                  </dl>

                  <div className="mt-3">
                    <h4 className="text-sm font-semibold">Notifications delivered</h4>
                    {incident.notifications.length === 0 ? (
                      <p className="mt-1 text-sm text-muted">
                        None. The incident closed before a notification was due.
                      </p>
                    ) : (
                      <ul className="mt-1 grid gap-2 text-sm text-muted">
                        {incident.notifications.map((row) => (
                          <li key={`${row.userId}-${row.sentAt}`}>
                            <span className="text-foreground">
                              {person(row.recipient, row.userId)}
                            </span>{" "}
                            · {notificationStageLabel(row.stage)} · sent{" "}
                            {formatIncidentMoment(row.sentAt)} ·{" "}
                            {row.readAt
                              ? `marked read ${formatIncidentMoment(row.readAt)}`
                              : "not marked read"}
                            <span className="mt-0.5 block text-xs">{row.summary}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {history.total > 0 ? (
          <nav
            aria-label="Incident history pages"
            className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm"
          >
            <p className="text-muted">
              Showing {window.first}–{window.last} of {history.total}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {window.hasPrevious ? (
                <Link href={historyHref(workspaceId, filters, window.page - 1)} className={quietButton}>
                  Previous
                </Link>
              ) : null}
              <span className="text-muted">
                Page {window.page} of {window.pageCount}
              </span>
              {window.hasNext ? (
                <Link href={historyHref(workspaceId, filters, window.page + 1)} className={quietButton}>
                  Next
                </Link>
              ) : null}
            </div>
          </nav>
        ) : null}
      </main>
    </div>
  );
}
