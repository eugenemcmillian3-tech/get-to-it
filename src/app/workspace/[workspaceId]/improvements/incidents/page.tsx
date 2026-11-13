import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import { listIncidentHistory } from "@/lib/data/incident-history";
import { getIdentity } from "@/lib/identity";
import {
  formatIncidentMoment,
  incidentDuration,
  notificationStageLabel,
  recoveryKindLabel,
} from "@/lib/incident-history";
import { cardClass, chipClass } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Incident history — GET TO IT" };

function person(name: string | null, id: string): string {
  return name ?? `member ${id.slice(0, 8)}`;
}

export default async function IncidentHistoryPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const session = await requireSession();
  const [identity, history] = await Promise.all([
    getIdentity(session),
    listIncidentHistory(session, workspaceId),
  ]);
  if (!history) notFound();

  const notifications = history.incidents.reduce(
    (total, incident) => total + incident.notifications.length,
    0,
  );
  const escalations = history.incidents.reduce(
    (total, incident) =>
      total + incident.notifications.filter((row) => row.stage === "escalation").length,
    0,
  );

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
          an assumed one.
        </p>
        <p className="mt-2 text-xs text-muted">
          {history.incidents.length} closed {history.incidents.length === 1 ? "incident" : "incidents"} ·{" "}
          {notifications} {notifications === 1 ? "notification" : "notifications"} delivered
          {escalations > 0 ? ` · ${escalations} escalation${escalations === 1 ? "" : "s"}` : ""}
        </p>

        <section aria-labelledby="closed-heading" className="mt-8">
          <h2 id="closed-heading" className="text-xl font-bold">
            Closed incidents
          </h2>
          {history.incidents.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              No incident on a promoted deployment has been resolved or dismissed in this workspace
              yet.
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
      </main>
    </div>
  );
}
