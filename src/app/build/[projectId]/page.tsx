import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AppFileEditor,
  ApproveSpecForm,
  DeleteAppProjectForm,
  GenerateAppForm,
  RestoreVersionForm,
  ReviseSpecForm,
  SpecEditor,
} from "@/components/build-forms";
import { SiteHeader } from "@/components/site-header";
import {
  GENERATION_NOTE,
  MOCKED_NOTE,
  NOT_PRODUCTION_NOTE,
  SUPPORTED_STACK,
  isSafeProjectPath,
} from "@/lib/app-builder";
import { requireSession } from "@/lib/auth";
import { getAppProjectDetail } from "@/lib/data/app-projects";
import { getIdentity } from "@/lib/identity";
import { cardClass, chipClass, focusRing, secondaryButton } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { isUuid } from "@/lib/validation";
import type { AppSpec } from "@/lib/app-builder";

export const metadata: Metadata = { title: "App project — GET TO IT" };

function ListBlock({ title, items, mono }: { title: string; items: string[]; mono?: boolean }) {
  return (
    <div>
      <h3 className="text-sm font-bold">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted">None.</p>
      ) : (
        <ul className={`mt-1 space-y-1 text-sm text-muted ${mono ? "font-mono text-xs" : ""}`}>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SpecSummary({ spec }: { spec: AppSpec }) {
  return (
    <div className="mt-4 space-y-5">
      <ListBlock title="Features" items={spec.features} />
      <ListBlock title="Exclusions" items={spec.exclusions} />
      <div>
        <h3 className="text-sm font-bold">Pages and navigation</h3>
        <ul className="mt-1 space-y-1 text-sm text-muted">
          {spec.pages.map((page) => (
            <li key={page.path}>
              <code className="rounded bg-paper px-1.5 py-0.5 text-xs">{page.path}</code>{" "}
              {page.title} — {page.purpose}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="text-sm font-bold">Data model</h3>
        {spec.entities.length === 0 ? (
          <p className="text-sm text-muted">No data entities were specified.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm text-muted">
            {spec.entities.map((entity) => (
              <li key={entity.name}>
                <code className="rounded bg-paper px-1.5 py-0.5 text-xs">{entity.name}</code>{" "}
                id, user_id, {entity.fields.join(", ")}, created_at
              </li>
            ))}
          </ul>
        )}
      </div>
      <ListBlock
        title="Server-side operations"
        items={spec.server_operations.map(
          (operation) => `${operation.entity}: ${operation.operations.join(", ")}`,
        )}
      />
      <ListBlock title="Authorization rules" items={spec.authorization_rules} />
      <div>
        <h3 className="text-sm font-bold">Integrations</h3>
        {spec.integrations.length === 0 ? (
          <p className="text-sm text-muted">None.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm text-muted">
            {spec.integrations.map((integration) => (
              <li key={integration.env_var}>
                {integration.name} — <strong className="text-ink">MOCKED</strong>{" "}
                <code className="text-xs">{integration.env_var}</code>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-xs text-muted">{MOCKED_NOTE}</p>
      </div>
      <ListBlock title="Environment-variable names (no values)" items={spec.env_vars} mono />
      <ListBlock title="Acceptance checks" items={spec.acceptance_checks} />
    </div>
  );
}

export default async function AppProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ file?: string | string[] }>;
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
  const [identity, detail, query] = await Promise.all([
    getIdentity(session),
    getAppProjectDetail(session, projectId),
    searchParams,
  ]);

  if (!detail) notFound();

  const { project, specs, files, versions } = detail;
  const latest = specs[0] ?? null;
  const draft = latest && latest.approved_at === null ? latest : null;
  const approved = specs.find((record) => record.approved_at !== null) ?? null;
  const spec = latest?.spec ?? null;

  const requested = typeof query.file === "string" ? query.file : "";
  const selected =
    files.find((file) => file.path === requested && isSafeProjectPath(file.path)) ??
    files.find((file) => file.path === "README.md") ??
    files[0] ??
    null;

  const latestVersion = versions[0] ?? null;

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-4xl px-5 pb-16 pt-6">
        <Link
          href="/build"
          className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          ← All app projects
        </Link>

        <header className="mt-4">
          <h1 className="text-3xl font-black leading-tight tracking-tight sm:text-4xl">
            {project.name}
          </h1>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
            <span className={chipClass}>{SUPPORTED_STACK.label}</span>
            <span className={chipClass}>
              {project.status === "spec_approved"
                ? "Specification approved"
                : project.status === "generated"
                  ? "Generated"
                  : "Specification draft"}
            </span>
            <span className={chipClass}>
              {project.current_version > 0 ? `Version ${project.current_version}` : "No generated files"}
            </span>
            <span className={chipClass}>
              {project.auth_requirements === "supabase" ? "Supabase accounts" : "No accounts"}
            </span>
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">{project.purpose}</p>
        </header>

        <section aria-labelledby="intake-heading" className={`${cardClass} mt-6`}>
          <h2 id="intake-heading" className="text-lg font-bold">Intake</h2>
          <dl className="mt-2 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-semibold">Target users</dt>
              <dd className="text-muted">{project.target_users}</dd>
            </div>
            <div>
              <dt className="font-semibold">Definition of done</dt>
              <dd className="text-muted">{project.definition_of_done}</dd>
            </div>
            <div>
              <dt className="font-semibold">Design preferences</dt>
              <dd className="text-muted">{project.design_preferences || "None given."}</dd>
            </div>
            <div>
              <dt className="font-semibold">External integrations</dt>
              <dd className="text-muted">{project.integrations || "None given."}</dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="spec-heading" className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="spec-heading" className="text-xl font-bold">
              Specification
            </h2>
            {latest ? (
              <span className={chipClass}>
                Version {latest.version} · {latest.approved_at ? "approved" : "draft"}
              </span>
            ) : null}
          </div>

          {!spec ? (
            <p className="mt-2 text-sm text-muted">No specification exists for this project.</p>
          ) : (
            <>
              <div className={`${cardClass} mt-3`}>
                <SpecSummary spec={spec} />
                {draft ? (
                  <div className="mt-5 border-t border-line pt-4">
                    <p className="text-sm text-muted">
                      This draft is editable. Generation stays blocked until it is approved.
                    </p>
                    <div className="mt-2">
                      <ApproveSpecForm projectId={project.id} />
                    </div>
                  </div>
                ) : approved ? (
                  <div className="mt-5 border-t border-line pt-4">
                    <p className="text-sm text-muted">
                      Approved{" "}
                      {approved.approved_at ? approved.approved_at.slice(0, 10) : ""} as
                      version {approved.version}. Approved specifications are immutable.
                    </p>
                    <ReviseSpecForm projectId={project.id} />
                  </div>
                ) : null}
              </div>

              {draft ? (
                <div className="mt-3">
                  <SpecEditor projectId={project.id} spec={spec} draft />
                </div>
              ) : null}
            </>
          )}
        </section>

        <section aria-labelledby="generate-heading" className="mt-8">
          <h2 id="generate-heading" className="sr-only">Generate</h2>
          {approved ? (
            <GenerateAppForm projectId={project.id} />
          ) : (
            <div className={cardClass}>
              <h2 className="text-lg font-bold">Generate the project</h2>
              <p className="mt-1 text-sm text-muted">
                Approve the specification first. Generation is blocked until then.
              </p>
            </div>
          )}

          <div className={`${cardClass} mt-3`}>
            <h3 className="text-sm font-bold">Generation status</h3>
            <p className="mt-1 text-sm text-muted">
              {project.last_generation_status === "none"
                ? "No generation has run yet."
                : project.last_generation_status === "failed"
                  ? `Last generation failed: ${project.last_generation_note ?? "unknown reason"}. The last usable snapshot was kept.`
                  : `Last generation succeeded${project.last_generated_at ? ` on ${project.last_generated_at.slice(0, 10)}` : ""}.`}
            </p>
            {latestVersion ? (
              <p className="mt-1 text-sm text-muted">
                Change summary for version {latestVersion.version}: {latestVersion.summary}
              </p>
            ) : null}
            <p className="mt-2 text-xs leading-relaxed text-muted">{GENERATION_NOTE}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">{NOT_PRODUCTION_NOTE}</p>
          </div>
        </section>

        <section aria-labelledby="files-heading" className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="files-heading" className="text-xl font-bold">Project files</h2>
            {files.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                <Link href={`/build/${project.id}/workspace`} className={secondaryButton}>
                  Preview workspace
                </Link>
                <Link href={`/build/${project.id}/team`} className={secondaryButton}>
                  Agent team
                </Link>
                <Link href={`/build/${project.id}/improve`} className={secondaryButton}>
                  Improve
                </Link>
                <Link href={`/build/${project.id}/deploy`} className={secondaryButton}>
                  Deploy
                </Link>
                <a
                  href={`/build/${project.id}/download`}
                  className={secondaryButton}
                >
                  Download project (.zip)
                </a>
              </div>
            ) : null}
          </div>

          {files.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No files generated yet.</p>
          ) : (
            <div className="mt-3 grid gap-4 lg:grid-cols-[16rem_1fr]">
              <div className={cardClass}>
                <h3 className="text-sm font-bold">File tree ({files.length})</h3>
                <ul className="mt-2 space-y-1 text-xs">
                  {files.map((file) => (
                    <li key={file.id}>
                      <Link
                        href={`/build/${project.id}?file=${encodeURIComponent(file.path)}`}
                        className={`block break-all rounded px-1 py-0.5 font-mono hover:bg-paper ${
                          selected?.path === file.path ? "bg-brand-soft font-semibold" : ""
                        } ${focusRing}`}
                      >
                        {file.path}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>

              <div className={cardClass}>
                {selected ? (
                  <AppFileEditor
                    key={selected.id}
                    projectId={project.id}
                    path={selected.path}
                    content={selected.content}
                  />
                ) : (
                  <p className="text-sm text-muted">Choose a file to view it.</p>
                )}
              </div>
            </div>
          )}
        </section>

        {versions.length > 0 ? (
          <section aria-labelledby="versions-heading" className="mt-8">
            <h2 id="versions-heading" className="text-xl font-bold">Versions</h2>
            <p className="mt-1 text-sm text-muted">
              Every generation and file save stores a complete snapshot. Restoring
              creates a new version, so it can be undone.
            </p>
            <ul className="mt-3 space-y-2">
              {versions.map((version) => (
                <li key={version.id} className={`${cardClass} flex flex-wrap items-center justify-between gap-3`}>
                  <div>
                    <p className="text-sm font-semibold">Version {version.version}</p>
                    <p className="text-xs text-muted">
                      {version.created_at.slice(0, 19).replace("T", " ")} · {version.summary}
                    </p>
                  </div>
                  {version.version !== project.current_version ? (
                    <RestoreVersionForm projectId={project.id} version={version.version} />
                  ) : (
                    <span className={chipClass}>Current</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="delete-heading" className={`${cardClass} mt-10`}>
          <h2 id="delete-heading" className="text-lg font-bold">Delete this app project</h2>
          <p className="mt-1 text-sm text-muted">
            This removes the intake, specification versions, files, snapshots and
            any agent-team queue or integration evidence. It has no undo. Download
            a copy first if you want to keep one.
          </p>
          <DeleteAppProjectForm projectId={project.id} />
        </section>
      </main>
    </div>
  );
}
