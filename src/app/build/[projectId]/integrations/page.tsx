import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import {
  DatabaseIntegrationForm,
  IntegrationCodeForm,
  IntegrationDisconnectForm,
  IntegrationRotateForm,
  IntegrationSelectionForm,
  IntegrationTestForm,
  OpenApiIntegrationForm,
} from "@/components/integration-forms";
import { APP_INTEGRATION_KINDS, integrationEnvPrefix, integrationKindLabel, statusLabel } from "@/lib/integrations/registry";
import { requireSession } from "@/lib/auth";
import { getAppProjectDetail } from "@/lib/data/app-projects";
import { listAppIntegrations } from "@/lib/data/app-integrations";
import { vaultConfigured } from "@/lib/deploy/vault";
import { getIdentity } from "@/lib/identity";
import { cardClass, chipClass, focusRing, secondaryButton } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";
import type { AppIntegration } from "@/lib/types";
import { isUuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Integrations — GET TO IT" };

function IntegrationCard({ projectId, integration }: { projectId: string; integration: AppIntegration }) {
  const isDatabase = integration.kind === "postgres";
  const operations = integration.config.operations ?? [];
  const tables = integration.config.tables ?? [];
  const prefix = integrationEnvPrefix(integration.name);

  return (
    <li className={cardClass}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-bold">{integration.name}</h3>
          <p className="text-xs text-muted">
            {integrationKindLabel(integration.kind)}
            {integration.config.title ? ` · ${integration.config.title}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={chipClass}>{statusLabel(integration.status)}</span>
          <span className={chipClass}>{isDatabase ? `${tables.length} tables` : `${operations.length} operations`}</span>
        </div>
      </div>

      {!isDatabase ? (
        <div className="mt-2 space-y-1 text-sm">
          <p className="break-all font-mono text-xs">{integration.config.base_url}</p>
          <p className="text-xs text-muted">
            Required access: one public HTTPS base URL, a bearer credential if the API requires one, and
            only the operations you select. The connection test performs one bounded GET; generated wrappers
            call selected operations only.
          </p>
          <p className="text-xs text-muted">
            Generated server wrappers read <code>{prefix}_BASE_URL</code> and <code>{prefix}_API_KEY</code> from
            the server environment. No value is stored in the project.
          </p>
        </div>
      ) : (
        <div className="mt-2 space-y-1 text-sm">
          <p className="text-muted">
            Development: <span className="font-mono text-xs">{integration.config.development_label}</span>
          </p>
          <p className="text-muted">
            Production: <span className="font-mono text-xs">{integration.config.production_label}</span>
          </p>
          <p className="text-xs text-muted">
            Required access: CONNECT, read <code>information_schema</code>, and SELECT the tables you allow.
            Inspection runs read-only. No production records are copied, and no migration is applied.
          </p>
        </div>
      )}

      {isDatabase && tables.length > 0 ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium">Inspect read-only schema</summary>
          <ul className="mt-1 space-y-1 text-xs text-muted">
            {tables.slice(0, 20).map((table) => (
              <li key={table.name}>
                <span className="font-mono">{table.name}</span>: {table.columns.map((column) => column.name).join(", ")}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {integration.config.migration_preview ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium">Preview proposed migration</summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-paper p-2 font-mono text-[11px]">
            {integration.config.migration_preview}
          </pre>
          <p className="mt-1 text-xs text-muted">Preview only. It is not applied by this action.</p>
        </details>
      ) : null}

      <IntegrationSelectionForm projectId={projectId} integration={integration} />

      <div className="mt-4 border-t border-line pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <IntegrationTestForm projectId={projectId} integration={integration} />
          <span className="text-xs text-muted">
            Last test: {statusLabel(integration.last_test_status)}
            {integration.last_tested_at ? ` · ${integration.last_tested_at.slice(0, 16).replace("T", " ")}` : ""}
          </span>
        </div>
        {integration.last_test_note ? <p className="mt-1 text-xs text-muted">{integration.last_test_note}</p> : null}
        <IntegrationCodeForm projectId={projectId} integration={integration} />
        <IntegrationRotateForm projectId={projectId} integration={integration} />
        <IntegrationDisconnectForm projectId={projectId} integration={integration} />
      </div>
    </li>
  );
}

export default async function IntegrationsPage({
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
  const [identity, detail, integrations] = await Promise.all([
    getIdentity(session),
    getAppProjectDetail(session, projectId),
    listAppIntegrations(session, projectId),
  ]);
  if (!detail) notFound();

  const { project } = detail;
  const vaultReady = vaultConfigured();

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />
      <main className="mx-auto w-full max-w-5xl px-5 pb-16 pt-6">
        <Link
          href={`/build/${project.id}`}
          className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          ← Back to {project.name}
        </Link>

        <header className="mt-4">
          <h1 className="text-3xl font-black leading-tight tracking-tight sm:text-4xl">Integration Studio</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
            Connect one supported service, review the permissions and operations, map data to app
            features, then add generated server-side code to this project. The studio supports two kinds
            only: JSON OpenAPI 3 HTTP APIs and PostgreSQL.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
            {APP_INTEGRATION_KINDS.map((kind) => <span key={kind.id} className={chipClass}>{kind.label}</span>)}
            <span className={chipClass}>No production writes</span>
          </div>
        </header>

        {!vaultReady ? (
          <section className={`${cardClass} mt-5 border-danger/40`}>
            <h2 className="text-lg font-bold">The vault is not configured</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              Set a server-only <code>DEPLOYMENT_VAULT_KEY</code> as 32 bytes of base64 or 64 hex characters.
              Credentials cannot be saved until then. There is no fallback key.
            </p>
          </section>
        ) : null}

        <section aria-labelledby="add-integration-heading" className="mt-8">
          <h2 id="add-integration-heading" className="text-xl font-bold">Add an integration</h2>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <OpenApiIntegrationForm projectId={project.id} vaultReady={vaultReady} />
            <DatabaseIntegrationForm projectId={project.id} vaultReady={vaultReady} />
          </div>
        </section>

        <section aria-labelledby="configured-heading" className="mt-8">
          <h2 id="configured-heading" className="text-xl font-bold">Configured integrations</h2>
          <p className="mt-1 text-sm text-muted">
            Credentials are sealed, never shown here, and can be replaced or cleared. Generated code is
            inserted into the project as a new version and is not executed by GET TO IT.
          </p>
          {integrations.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No integrations yet.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {integrations.map((integration) => (
                <IntegrationCard key={integration.id} projectId={project.id} integration={integration} />
              ))}
            </ul>
          )}
        </section>

        <section className={`${cardClass} mt-8`}>
          <h2 className="text-lg font-bold">Safety boundaries</h2>
          <ul className="mt-2 space-y-1 text-sm text-muted">
            <li>Imported descriptions and examples are untrusted documentation; they are never fetched, executed or placed in generated code.</li>
            <li>Before a test request, private, loopback, link-local and metadata destinations are refused; redirects are checked again and response size/time are bounded.</li>
            <li>Database inspection is read-only and selects schema metadata only. No rows are copied into AI context.</li>
            <li>Proposed migrations are previews. No write or destructive change is applied without a separate approval path.</li>
            <li>Only selected operations or tables are generated. Secrets stay in the existing vault and appear only as environment-variable names.</li>
          </ul>
        </section>

        <div className="mt-8">
          <Link href={`/build/${project.id}`} className={secondaryButton}>Back to project</Link>
        </div>
      </main>
    </div>
  );
}
