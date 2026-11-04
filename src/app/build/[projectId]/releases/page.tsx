import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import {
  AddReleaseCheckForm,
  ApproveRecoveryForm,
  AutomationForm,
  CaptureReleaseForm,
  DisableAutomationForm,
  IncidentDiagnosisForm,
  PrepareRecoveryForm,
  RecordSmokeForm,
  RunReleaseChecksForm,
} from "@/components/release-forms";
import { requireSession } from "@/lib/auth";
import {
  getReleaseDashboard,
  type AppRelease,
  type IncidentEvent,
  type ReleaseCheckRun,
  type ReleaseIncident,
} from "@/lib/data/releases";
import { getIdentity } from "@/lib/identity";
import { RECOVERY_LABELS, type ReleaseCheckConfig } from "@/lib/releases";
import { cardClass, chipClass, focusRing, secondaryButton } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { isUuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Releases — GET TO IT" };

function when(value: string | null): string {
  return value ? value.slice(0, 16).replace("T", " ") : "—";
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h4 className="text-sm font-bold">{title}</h4>
      {items.length === 0 ? (
        <p className="text-sm text-muted">None recorded.</p>
      ) : (
        <ul className="mt-1 space-y-1 text-sm text-muted">
          {items.map((item) => <li key={item} className="break-words">{item}</li>)}
        </ul>
      )}
    </div>
  );
}

function RunList({ runs }: { runs: ReleaseCheckRun[] }) {
  if (runs.length === 0) return <p className="mt-2 text-sm text-muted">No checks have run for this release.</p>;
  return (
    <ul className="mt-2 space-y-1 text-sm">
      {runs.map((run) => (
        <li key={run.id} className="border-b border-line py-1.5 last:border-0">
          <span className="font-semibold">{run.name}</span>{" "}
          <span className={
            run.status === "passed"
              ? "text-mint"
              : run.status === "failed"
                ? "text-danger"
                : "text-muted"
          }>
            {run.status}
          </span>
          {run.destructive ? <span className="ml-1 text-xs text-danger">destructive</span> : null}
          <span className="ml-1 text-xs text-muted">
            {run.synthetic ? "synthetic" : "manual"} · {when(run.created_at)}
          </span>
          <p className="break-words text-xs text-muted">{run.detail}</p>
        </li>
      ))}
    </ul>
  );
}

function IncidentCard({
  projectId,
  incident,
  events,
  hasMigrations,
}: {
  projectId: string;
  incident: ReleaseIncident;
  events: IncidentEvent[];
  hasMigrations: boolean;
}) {
  const steps = Array.isArray(incident.recovery_plan?.steps) ? incident.recovery_plan.steps : [];
  const limitations = Array.isArray(incident.recovery_plan?.limitations) ? incident.recovery_plan.limitations : [];
  return (
    <div className="rounded-xl border border-danger/30 bg-danger/5 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-danger">{incident.severity} incident</p>
          <h4 className="text-sm font-bold">{incident.title}</h4>
          <p className="text-xs text-muted">{incident.trigger} · {when(incident.created_at)}</p>
        </div>
        <span className={chipClass}>{incident.status.replace(/_/g, " ")}</span>
      </div>

      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-medium">Redacted evidence ({incident.evidence.length})</summary>
        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-card p-2 font-mono text-[11px]">
          {JSON.stringify(incident.evidence, null, 2)}
        </pre>
      </details>

      <div className="mt-2 rounded-lg border border-line bg-card p-2 text-sm">
        <p className="font-semibold">
          {incident.root_cause_confirmed ? "Confirmed root cause" : "Diagnosis — root cause not confirmed"}
        </p>
        {incident.diagnosis_hypothesis ? (
          <>
            <p className="mt-1 text-muted">Hypothesis: {incident.diagnosis_hypothesis}</p>
            <p className="text-muted">Support: {incident.diagnosis_support}</p>
          </>
        ) : (
          <p className="mt-1 text-muted">No hypothesis recorded. The failure evidence exists, but the cause is unknown.</p>
        )}
      </div>

      {incident.status === "evidence_collected" ? (
        <IncidentDiagnosisForm projectId={projectId} incidentId={incident.id} />
      ) : null}

      {incident.status === "diagnosed" ? (
        <PrepareRecoveryForm
          projectId={projectId}
          incidentId={incident.id}
          databaseRecoverySuggested={hasMigrations}
        />
      ) : null}

      {incident.status === "awaiting_approval" ? (
        <div className="mt-3 rounded-lg border border-line bg-card p-3">
          <p className="text-sm font-bold">
            Prepared: {incident.recovery_kind ? RECOVERY_LABELS[incident.recovery_kind] : "recovery"}
          </p>
          <List title="Steps" items={steps} />
          <List title="Limitations" items={limitations} />
          <p className="mt-2 text-xs text-muted">
            Nothing has been executed. Application code rollback, configuration rollback and database recovery remain separate actions.
          </p>
          <ApproveRecoveryForm projectId={projectId} incidentId={incident.id} />
        </div>
      ) : null}

      {incident.status === "approved" ? (
        <p className="mt-3 rounded-lg border border-mint/40 bg-mint/5 p-2 text-sm text-mint">
          A human approved the prepared recovery on {when(incident.approved_at)}. This dashboard did not execute it.
        </p>
      ) : null}

      {events.length > 0 ? (
        <ul className="mt-3 space-y-1 text-xs text-muted">
          {events.map((event) => (
            <li key={event.id}>
              <span className="font-semibold text-ink">{event.kind}</span> · {when(event.created_at)} — {event.detail}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ReleaseCard({
  projectId,
  release,
  configs,
  runs,
  incidents,
  incidentEvents,
  open,
}: {
  projectId: string;
  release: AppRelease;
  configs: ReleaseCheckConfig[];
  runs: ReleaseCheckRun[];
  incidents: ReleaseIncident[];
  incidentEvents: IncidentEvent[];
  open: boolean;
}) {
  const review = release.review;
  const smokeConfigs = configs.filter((config) => config.kind === "smoke" && config.enabled);
  return (
    <details open={open} className={cardClass}>
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold">Release v{release.version}</h2>
            <p className="text-xs text-muted">
              Captured {when(release.created_at)} · source revision {release.source_revision || "unknown"}
            </p>
          </div>
          <span className={chipClass}>{release.status.replace(/_/g, " ")}</span>
        </div>
      </summary>

      <p className="mt-3 break-all font-mono text-xs text-muted">Source digest {release.source_digest}</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <List title="Source revision" items={[release.source_revision || "unknown"]} />
        <List title="Changed features" items={release.changed_features} />
        <div>
          <h4 className="text-sm font-bold">Test results</h4>
          {release.test_results.length === 0 ? (
            <p className="text-sm text-muted">No test or post-deployment check results are recorded.</p>
          ) : (
            <ul className="mt-1 space-y-1 text-sm">
              {release.test_results.map((result) => (
                <li key={result.name} className="text-muted">
                  <span className="font-semibold text-ink">{result.name}</span>: {result.status}. {result.detail}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-xs text-muted">Passing tests do not establish that no defects exist.</p>
        </div>
        <List
          title="Dependency changes"
          items={release.dependency_changes.map(
            (change) => `${change.name}: ${change.from ?? "added"} → ${change.to ?? "removed"}`,
          )}
        />
        <List
          title="Migration requirements"
          items={release.migration_requirements.map(
            (migration) =>
              `${migration.path} — ${migration.state}. ${migration.destructive.length > 0 ? `Destructive: ${migration.destructive.join("; ")}.` : "No destructive pattern detected."} ${migration.note}`,
          )}
        />
        <List title="Configuration changes" items={release.config_changes} />
        <List title="Known issues" items={release.known_issues} />
        <List title="Rollback limitations" items={release.rollback_limitations} />
      </div>

      <div className="mt-5 rounded-xl border border-line bg-paper p-3">
        <h3 className="text-base font-bold">Release review</h3>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <List title="What changed" items={review.what_changed ?? []} />
          <List title="What was checked" items={review.what_checked ?? []} />
          <List title="What remains unverified" items={review.what_unverified ?? []} />
          <List title="Potentially affected workflows" items={review.affected_workflows ?? []} />
          <List title="Recommended manual checks" items={review.recommended_manual_checks ?? []} />
          <List title="Review limitations" items={review.limitations ?? []} />
        </div>
      </div>

      <div className="mt-5">
        <h3 className="text-base font-bold">Post-deployment checks for v{release.version}</h3>
        <RunReleaseChecksForm projectId={projectId} releaseId={release.id} disabled={configs.length === 0} />
        <RunList runs={runs} />
        {smokeConfigs.map((config) => (
          <RecordSmokeForm
            key={config.id}
            projectId={projectId}
            releaseId={release.id}
            configId={config.id}
            name={config.name}
          />
        ))}
      </div>

      {incidents.length > 0 ? (
        <div className="mt-5 space-y-3">
          <h3 className="text-base font-bold">Incidents</h3>
          {incidents.map((incident) => (
            <IncidentCard
              key={incident.id}
              projectId={projectId}
              incident={incident}
              events={incidentEvents.filter((event) => event.incident_id === incident.id)}
              hasMigrations={release.migration_requirements.length > 0}
            />
          ))}
        </div>
      ) : null}
    </details>
  );
}

export default async function ReleasesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) notFound();

  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <p className="text-sm text-muted">Sign-in is not configured in this build.</p>
      </main>
    );
  }

  const session = await requireSession();
  const [identity, dashboard] = await Promise.all([
    getIdentity(session),
    getReleaseDashboard(session, projectId),
  ]);
  if (!dashboard) notFound();

  const { project, releases, configs, runs, incidents, incidentEvents, automation, automationEvents } = dashboard;
  const latest = releases[0] ?? null;

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />
      <main className="mx-auto w-full max-w-6xl px-5 pb-16 pt-6">
        <Link
          href={`/build/${project.id}`}
          className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          ← Back to {project.name}
        </Link>

        <header className="mt-4">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Release evidence and recovery</p>
          <h1 className="mt-1 text-3xl font-black leading-tight tracking-tight sm:text-4xl">Releases</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
            Each record cites one pinned source version and the evidence available around it. The review names what is
            checked and what remains unverified. It does not produce a readiness score, and a passing test is not proof
            that no defects exist.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className={chipClass}>Version {project.current_version || "none"}</span>
            <span className={chipClass}>{releases.length} evidence record(s)</span>
            <span className={chipClass}>{incidents.length} incident(s)</span>
            <span className={chipClass}>Automatic rollback {automation?.auto_rollback_enabled ? "enabled" : "disabled"}</span>
          </div>
        </header>

        <section className={`${cardClass} mt-6`}>
          <h2 className="text-lg font-bold">Capture the current release</h2>
          <p className="mt-1 text-sm text-muted">
            Reuses the current project version, a matching deployment, merged maintenance changes and redacted error
            events. Capturing evidence creates no deployment and changes no source file.
          </p>
          <div className="mt-3"><CaptureReleaseForm projectId={project.id} /></div>
        </section>

        <section aria-labelledby="records-heading" className="mt-8 space-y-4">
          <h2 id="records-heading" className="text-xl font-bold">Reviewable evidence records</h2>
          {releases.length === 0 ? (
            <p className={`${cardClass} text-sm text-muted`}>
              No release evidence exists yet. Capture the current version to create the first record.
            </p>
          ) : releases.map((release, index) => (
            <ReleaseCard
              key={release.id}
              projectId={project.id}
              release={release}
              configs={configs}
              runs={runs.filter((run) => run.release_id === release.id)}
              incidents={incidents.filter((incident) => incident.release_id === release.id)}
              incidentEvents={incidentEvents}
              open={index === 0}
            />
          ))}
        </section>

        <section aria-labelledby="checks-heading" className="mt-8">
          <h2 id="checks-heading" className="text-xl font-bold">Configured post-deployment checks</h2>
          <p className="mt-1 text-sm text-muted">
            Health, selected routes, error-rate observations and functional smoke tests. HTTP checks use an
            unauthenticated synthetic request and never write data. Destructive checks are skipped against production.
          </p>
          <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_1fr]">
            <div className={cardClass}>
              <h3 className="text-base font-bold">Add a check</h3>
              <div className="mt-3"><AddReleaseCheckForm projectId={project.id} /></div>
            </div>
            <div className={cardClass}>
              <h3 className="text-base font-bold">Configured checks</h3>
              {configs.length === 0 ? (
                <p className="mt-2 text-sm text-muted">No checks configured.</p>
              ) : (
                <ul className="mt-2 space-y-2 text-sm">
                  {configs.map((config) => (
                    <li key={config.id} className="rounded-lg border border-line p-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold">{config.name}</span>
                        <span className={chipClass}>{config.kind.replace(/_/g, " ")}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        {config.kind === "health" || config.kind === "route"
                          ? `${config.target} · expected ${config.expected_status} · synthetic`
                          : config.kind === "error_rate"
                            ? `Last 24 hours · threshold ${config.max_errors}`
                            : config.instructions || "Manual functional smoke test."}
                      </p>
                      {config.destructive ? (
                        <p className="mt-1 text-xs text-danger">Destructive. Skipped against production by default.</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>

        <section aria-labelledby="automation-heading" className="mt-8">
          <h2 id="automation-heading" className="text-xl font-bold">Controlled automation</h2>
          <p className="mt-1 text-sm text-muted">
            Recommendations and prepared changes are the default. Automatic rollback is separately enabled and never
            executes from this dashboard. Conditions, known limitations, audit history and a disable control are shown
            together.
          </p>
          <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_1fr]">
            <div className={cardClass}>
              <h3 className="text-base font-bold">
                Automatic rollback: {automation?.auto_rollback_enabled ? "enabled" : "disabled"}
              </h3>
              <p className="mt-1 text-xs text-muted">
                {automation
                  ? `Last changed ${when(automation.updated_at)}.`
                  : "No setting exists, so automatic rollback is off."}
              </p>
              <AutomationForm
                projectId={project.id}
                enabled={automation?.auto_rollback_enabled ?? false}
                conditions={automation?.conditions ?? []}
                limitations={automation?.limitations ?? ""}
              />
              {automation?.auto_rollback_enabled ? <DisableAutomationForm projectId={project.id} /> : null}
              <p className="mt-2 text-xs text-muted">
                Limitation: automatic rollback cannot reverse a destructive migration, restore deleted data or guarantee
                that the detected condition was the only cause.
              </p>
            </div>
            <div className={cardClass}>
              <h3 className="text-base font-bold">Automation audit</h3>
              {automationEvents.length === 0 ? (
                <p className="mt-2 text-sm text-muted">No automation changes recorded.</p>
              ) : (
                <ul className="mt-2 space-y-1 text-sm">
                  {automationEvents.map((event) => (
                    <li key={event.id} className="border-b border-line py-1.5 last:border-0">
                      <span className="font-semibold">{event.kind}</span>{" "}
                      <span className="text-xs text-muted">{when(event.created_at)}</span>
                      <p className="break-words text-xs text-muted">{event.detail}</p>
                    </li>
                  ))}
                </ul>
              )}
              {latest ? (
                <p className="mt-3 text-xs text-muted">
                  Latest evidence record: v{latest.version}. It does not authorize a rollback.
                </p>
              ) : null}
            </div>
          </div>
        </section>

        <div className="mt-8 flex flex-wrap gap-3">
          {latest ? <Link href={`/build/${project.id}/deploy`} className={secondaryButton}>Deployment history</Link> : null}
          <Link href={`/build/${project.id}`} className={secondaryButton}>Back to project</Link>
        </div>
      </main>
    </div>
  );
}
