import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ApproveModernizationForm,
  ImportBaselineForm,
  ImportMapEditor,
  ModernizationForm,
} from "@/components/import-forms";
import { SiteHeader } from "@/components/site-header";
import { IMPORT_STACK } from "@/lib/app-import-constants";
import type { AppMap } from "@/lib/app-import";
import { requireSession } from "@/lib/auth";
import { getAppImportDetail } from "@/lib/data/app-import";
import { getAppProjectDetail } from "@/lib/data/app-projects";
import { getIdentity } from "@/lib/identity";
import { cardClass, chipClass, focusRing, secondaryButton } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { isUuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Imported app map — GET TO IT" };

const BASIS_LABELS = { inspected: "Inspected", inferred: "Inferred" } as const;

function BasisChip({ basis }: { basis: "inspected" | "inferred" }) {
  return (
    <span className={chipClass}>
      <span aria-hidden="true">{basis === "inspected" ? "●" : "○"}</span>
      {BASIS_LABELS[basis]}
    </span>
  );
}

function FileLink({ projectId, path }: { projectId: string; path: string }) {
  return (
    <Link
      href={`/build/${projectId}?file=${encodeURIComponent(path)}`}
      className={`break-all rounded text-xs font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
    >
      {path}
    </Link>
  );
}

function MapSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-line pt-4">
      <h3 className="text-sm font-bold">{title}</h3>
      <div className="mt-2 space-y-2 text-sm text-muted">{children}</div>
    </section>
  );
}

function MapView({ projectId, map }: { projectId: string; map: AppMap }) {
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-muted">{map.summary}</p>

      <MapSection title="Framework and dependencies">
        <p className="flex flex-wrap items-center gap-2">
          <code className="rounded bg-paper px-1.5 py-0.5 text-xs">{map.framework.name} {map.framework.version}</code>
          <span className={chipClass}>{map.framework.router} router</span>
          <BasisChip basis={map.framework.basis} />
        </p>
        <ul className="grid gap-1 sm:grid-cols-2">
          {map.dependencies.map((dependency) => (
            <li key={dependency.name} className="flex flex-wrap items-center gap-2">
              <code className="text-xs">{dependency.name} {dependency.version}</code>
              <BasisChip basis={dependency.basis} />
            </li>
          ))}
        </ul>
      </MapSection>

      <MapSection title="Routes and major components">
        {map.routes.length === 0 ? <p>No page routes were found.</p> : (
          <ul className="space-y-2">
            {map.routes.map((route) => (
              <li key={route.file} className="flex flex-wrap items-center gap-2">
                <code className="rounded bg-paper px-1.5 py-0.5 text-xs">{route.path}</code>
                <FileLink projectId={projectId} path={route.file} />
                <BasisChip basis={route.basis} />
              </li>
            ))}
          </ul>
        )}
        {map.components.length > 0 ? (
          <ul className="grid gap-1 sm:grid-cols-2">
            {map.components.map((component) => (
              <li key={component.file} className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-ink">{component.name}</span>
                <FileLink projectId={projectId} path={component.file} />
              </li>
            ))}
          </ul>
        ) : <p>No shared components were found under components/.</p>}
      </MapSection>

      <MapSection title="Backend operations">
        {map.backend_operations.length === 0 ? <p>None found.</p> : (
          <ul className="space-y-2">
            {map.backend_operations.map((operation, index) => (
              <li key={`${operation.file}-${operation.method}-${index}`} className="flex flex-wrap items-center gap-2">
                <code className="rounded bg-paper px-1.5 py-0.5 text-xs">{operation.method} {operation.path}</code>
                <FileLink projectId={projectId} path={operation.file} />
                <BasisChip basis={operation.basis} />
              </li>
            ))}
          </ul>
        )}
      </MapSection>

      <MapSection title="Database and migrations">
        {map.database.length === 0 ? <p>None found.</p> : (
          <ul className="space-y-2">
            {map.database.map((finding, index) => (
              <li key={`${finding.file}-${index}`} className="flex flex-wrap items-center gap-2">
                <span>{finding.label}</span>
                <FileLink projectId={projectId} path={finding.file} />
                <BasisChip basis={finding.basis} />
              </li>
            ))}
          </ul>
        )}
      </MapSection>

      <MapSection title="Authentication and authorization">
        <ul className="space-y-2">
          {map.auth.map((finding, index) => (
            <li key={`${finding.label}-${index}`} className="flex flex-wrap items-center gap-2">
              <span>{finding.label}</span>
              <FileLink projectId={projectId} path={finding.file} />
              <BasisChip basis={finding.basis} />
            </li>
          ))}
        </ul>
      </MapSection>

      <MapSection title="External integrations">
        {map.integrations.length === 0 ? <p>None detected.</p> : (
          <ul className="space-y-2">
            {map.integrations.map((finding, index) => (
              <li key={`${finding.label}-${index}`} className="flex flex-wrap items-center gap-2">
                <span>{finding.label}</span>
                <FileLink projectId={projectId} path={finding.file} />
                <BasisChip basis={finding.basis} />
              </li>
            ))}
          </ul>
        )}
      </MapSection>

      <MapSection title="Environment-variable names (no values)">
        {map.env_names.length === 0 ? <p>None found.</p> : (
          <ul className="grid gap-1 sm:grid-cols-2">
            {map.env_names.map((env) => (
              <li key={env.name} className="flex flex-wrap items-center gap-2">
                <code className="text-xs">{env.name}</code>
                {env.files.slice(0, 2).map((file) => <FileLink key={file} projectId={projectId} path={file} />)}
                <BasisChip basis={env.basis} />
              </li>
            ))}
          </ul>
        )}
      </MapSection>

      <MapSection title="Test and build commands">
        <dl className="grid gap-2 sm:grid-cols-2">
          {Object.entries(map.commands).map(([name, command]) => (
            <div key={name}>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink">{name}</dt>
              <dd className="break-words font-mono text-xs">{command}</dd>
            </div>
          ))}
        </dl>
      </MapSection>

      <MapSection title="Known uncertainties">
        <ul className="list-disc space-y-1 pl-5">
          {map.uncertainties.map((uncertainty) => <li key={uncertainty}>{uncertainty}</li>)}
        </ul>
      </MapSection>

      {map.notes.length > 0 ? (
        <MapSection title="Your notes">
          <ul className="list-disc space-y-1 pl-5">
            {map.notes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        </MapSection>
      ) : null}
    </div>
  );
}

export default async function ImportedAppPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
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
  const [identity, projectDetail, imported] = await Promise.all([
    getIdentity(session),
    getAppProjectDetail(session, projectId),
    getAppImportDetail(session, projectId),
  ]);
  if (!projectDetail || !imported) notFound();

  const { project } = projectDetail;
  const { record, baseline, modernizations } = imported;

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-4xl px-5 pb-16 pt-6">
        <Link
          href={`/build/${project.id}`}
          className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          ← {project.name}
        </Link>

        <header className="mt-4">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-black leading-tight tracking-tight sm:text-4xl">Imported app map</h1>
            <span className={chipClass}>Imported</span>
          </div>
          <p className="mt-2 break-all text-sm text-muted">{record.source_label}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className={chipClass}>{IMPORT_STACK.label}</span>
            <span className={chipClass}>{record.file_count} stored files</span>
            <span className={chipClass}>{record.package_manager ?? "unknown package manager"}</span>
            <span className={chipClass}>{record.source_kind === "git" ? "Authorized GitHub" : "Uploaded ZIP"}</span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href={`/build/${project.id}`} className={secondaryButton}>Project files</Link>
            <Link href={`/build/${project.id}/workspace`} className={secondaryButton}>Preview workspace</Link>
            <Link href={`/build/${project.id}/improve`} className={secondaryButton}>Change review</Link>
          </div>
        </header>

        <section aria-labelledby="map-heading" className={`${cardClass} mt-6`}>
          <h2 id="map-heading" className="text-lg font-bold">Application map</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Every finding links to the file it came from. <strong className="text-ink">Inspected</strong> means the fact
            is in the source; <strong className="text-ink">inferred</strong> means behavior is a working interpretation.
          </p>
          <div className="mt-4">
            <MapView projectId={project.id} map={record.map} />
          </div>
        </section>

        <section aria-labelledby="skipped-heading" className={`${cardClass} mt-4`}>
          <h2 id="skipped-heading" className="text-lg font-bold">Excluded from import and future AI context</h2>
          <p className="mt-1 text-sm text-muted">
            Secret files are never stored. Repository instruction files are excluded and cannot override platform
            permissions. Binary and ignored files are skipped.
          </p>
          <div className="mt-2 grid gap-2 text-sm text-muted sm:grid-cols-2">
            <p>Secret files skipped: {record.skipped.counts.secret}</p>
            <p>Instruction files skipped: {record.skipped.counts.instructions}</p>
            <p>Binary / unsupported files skipped: {record.skipped.counts.binary}</p>
            <p>Ignored build/vendor files: {record.skipped.counts.ignored}</p>
            <p>Lockfiles skipped: {record.skipped.counts.lockfiles}</p>
            <p>Files outside the selected app root: {record.skipped.counts.outside}</p>
          </div>
          {record.skipped.secret.length > 0 ? (
            <p className="mt-2 break-all text-xs text-muted">Secret paths (names only): {record.skipped.secret.join(", ")}</p>
          ) : null}
          <p className="mt-2 text-xs leading-relaxed text-muted">
            No install script or project code ran during import. The baseline is the first action that sends files to the
            existing isolated sandbox.
          </p>
        </section>

        <section aria-labelledby="map-edit-heading" className={`${cardClass} mt-4`}>
          <h2 id="map-edit-heading" className="text-lg font-bold">Edit the map</h2>
          <p className="mt-1 text-sm text-muted">
            The map is a working document. Save corrections without changing the imported source.
          </p>
          <div className="mt-3">
            <ImportMapEditor projectId={project.id} map={record.map} />
          </div>
        </section>

        <section aria-labelledby="baseline-heading" className={`${cardClass} mt-4`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="baseline-heading" className="text-lg font-bold">Baseline</h2>
            <span className={chipClass}>
              {record.baseline_status === "not_run"
                ? "Not run"
                : `${record.baseline_status}${record.baseline_at ? ` · ${record.baseline_at.slice(0, 10)}` : ""}`}
            </span>
          </div>
          {!baseline ? (
            <p className="mt-1 text-sm text-muted">
              Run the existing sandbox checks before proposing a modernization. Failures recorded here are pre-existing.
            </p>
          ) : (
            <div className="mt-2 space-y-2 text-sm text-muted">
              <p><span className="font-semibold text-ink">Result:</span> {baseline.summary}</p>
              {baseline.failures.length > 0 ? (
                <p><span className="font-semibold text-ink">Pre-existing failures:</span> {baseline.failures.join(", ")}</p>
              ) : null}
              <ul className="space-y-1">
                {baseline.checks.map((check) => (
                  <li key={check.name} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{check.label}</span>
                    <span className={chipClass}>{check.status}</span>
                    {check.code !== null ? <span className="text-xs">exit {check.code}</span> : null}
                  </li>
                ))}
              </ul>
              <details>
                <summary className={`cursor-pointer text-xs font-semibold ${focusRing}`}>Show sandbox log</summary>
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-paper p-3 text-xs">{baseline.log || "No log."}</pre>
              </details>
            </div>
          )}
          <div className="mt-3">
            <ImportBaselineForm projectId={project.id} />
          </div>
        </section>

        <section aria-labelledby="modernization-heading" className={`${cardClass} mt-4`}>
          <h2 id="modernization-heading" className="text-lg font-bold">One bounded modernization</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Choose one objective. The proposal shows affected files, compatibility concerns, acceptance checks and a
            reversal plan. It is not a rewrite, and it does not apply itself.
          </p>

          <div className="mt-4">
            <ModernizationForm projectId={project.id} hasBaseline={Boolean(baseline)} />
          </div>

          {modernizations.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No proposal has been made yet.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {modernizations.map((modernization) => {
                const proposal = modernization.proposal;
                return (
                  <li key={modernization.id} className="rounded-xl border border-line bg-paper/50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="font-semibold">{proposal.objective_label}</h3>
                        <p className="mt-1 text-sm text-muted">{proposal.request}</p>
                      </div>
                      <span className={chipClass}>{modernization.status.replace("_", " ")}</span>
                    </div>

                    <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wide text-ink">Proposed changes</h4>
                        <ul className="mt-1 space-y-1 text-muted">
                          {proposal.affected_files.map((file) => (
                            <li key={file.path}>
                              <code className="text-xs">{file.action} {file.path}</code> — {file.reason}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wide text-ink">Compatibility concerns</h4>
                        <ul className="mt-1 list-disc space-y-1 pl-4 text-muted">
                          {proposal.compatibility_concerns.map((concern) => <li key={concern}>{concern}</li>)}
                        </ul>
                      </div>
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wide text-ink">Acceptance checks</h4>
                        <ul className="mt-1 list-disc space-y-1 pl-4 text-muted">
                          {proposal.acceptance_checks.map((check) => <li key={check}>{check}</li>)}
                        </ul>
                      </div>
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wide text-ink">Reversal plan</h4>
                        <ul className="mt-1 list-disc space-y-1 pl-4 text-muted">
                          {proposal.reversal_plan.map((step) => <li key={step}>{step}</li>)}
                        </ul>
                      </div>
                    </div>

                    <div className="mt-3 rounded-lg border border-line bg-card p-3 text-xs text-muted">
                      <p><span className="font-semibold text-ink">Baseline at proposal:</span> {proposal.baseline.status} — {proposal.baseline.summary}</p>
                      {proposal.baseline.failures.length > 0 ? (
                        <p className="mt-1"><span className="font-semibold text-ink">Pre-existing failures:</span> {proposal.baseline.failures.join(", ")}. They are not attributed to this change.</p>
                      ) : null}
                      <p className="mt-1">Base version {proposal.base_version}. No project code was executed to make this proposal.</p>
                    </div>

                    {proposal.diff ? (
                      <details className="mt-3">
                        <summary className={`cursor-pointer text-xs font-semibold ${focusRing}`}>Show proposed diff</summary>
                        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-paper p-3 text-xs">{proposal.diff}</pre>
                      </details>
                    ) : (
                      <p className="mt-3 text-xs text-muted">No patch is attached to this proposal; the review will name the bounded change instead.</p>
                    )}

                    {modernization.status === "proposed" ? (
                      <ApproveModernizationForm projectId={project.id} modernizationId={modernization.id} />
                    ) : modernization.change_id ? (
                      <p className="mt-3 border-t border-line pt-3 text-sm">
                        <Link href={`/build/${project.id}/improve`} className={secondaryButton}>Open the existing change review</Link>
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
