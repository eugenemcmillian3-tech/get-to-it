import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import {
  ApproveDeploymentForm,
  CreatePlanForm,
  DisconnectForm,
  EnvValueForm,
  GitHubConnectionForm,
  PrecheckForm,
  RedeploySnapshotForm,
  RefreshDeploymentForm,
  SupabaseConnectionForm,
  VercelConnectionForm,
} from "@/components/deploy-forms";
import { SupabaseOAuthPanel } from "@/components/supabase-oauth-panel";
import { requireSession } from "@/lib/auth";
import { getAppProjectDetail } from "@/lib/data/app-projects";
import { getDeploymentDetail } from "@/lib/data/app-deployments";
import {
  extractEnvRequirements,
  planProblems,
  type DeploymentPlan,
} from "@/lib/deployments";
import { getIdentity } from "@/lib/identity";
import { cardClass, chipClass, focusRing, secondaryButton } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { vaultConfigured } from "@/lib/deploy/vault";
import type {
  AppDeployment,
  AppProviderConnection,
  SupabaseAccountConnection,
} from "@/lib/types";
import { isUuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Deploy — GET TO IT" };

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft plan",
  checks_ready: "Ready for approval",
  approved: "Approved",
  repository: "Repository commit",
  migrations: "Production migration",
  infrastructure: "Environment settings",
  deploying: "Hosting deployment",
  succeeded: "Succeeded",
  partial_failure: "Partial failure",
  failed: "Failed",
};

function List({ title, items, mono }: { title: string; items: string[]; mono?: boolean }) {
  return (
    <div>
      <h3 className="text-sm font-bold">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted">None.</p>
      ) : (
        <ul className={`mt-1 space-y-1 text-sm text-muted ${mono ? "font-mono text-xs" : ""}`}>
          {items.map((item) => <li key={item}>{item}</li>)}
        </ul>
      )}
    </div>
  );
}

function ConnectionCard({
  projectId,
  provider,
  title,
  connection,
}: {
  projectId: string;
  provider: "github" | "vercel";
  title: string;
  connection: AppProviderConnection | null;
}) {
  return (
    <div className={cardClass}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-base font-bold">{title}</h3>
        <span className={chipClass}>{connection?.status === "connected" ? "Connected" : "Not connected"}</span>
      </div>
      {connection?.status === "connected" ? (
        <div className="mt-2 space-y-2 text-sm">
          <p className="font-semibold">{connection.account_label}</p>
          <p className="break-all text-xs text-muted">{connection.scope_label}</p>
          <p className="break-all font-mono text-xs text-muted">{connection.external_ref}</p>
          <DisconnectForm projectId={projectId} provider={provider} />
        </div>
      ) : (
        <div className="mt-3">
          {provider === "github" ? <GitHubConnectionForm projectId={projectId} /> : null}
          {provider === "vercel" ? <VercelConnectionForm projectId={projectId} /> : null}
        </div>
      )}
    </div>
  );
}

function SupabaseConnectionCard({
  projectId,
  connection,
  account,
}: {
  projectId: string;
  connection: AppProviderConnection | null;
  account: SupabaseAccountConnection | null;
}) {
  return (
    <div className={cardClass}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-base font-bold">Supabase databases</h3>
        <span className={chipClass}>{connection?.status === "connected" ? "Connected" : "Not connected"}</span>
      </div>
      {connection?.status === "connected" ? (
        <div className="mt-2 space-y-2 text-sm">
          <p className="font-semibold">{connection.account_label}</p>
          <p className="break-all text-xs text-muted">{connection.scope_label}</p>
          <p className="break-all font-mono text-xs text-muted">{connection.external_ref}</p>
          <DisconnectForm projectId={projectId} provider="supabase" />
        </div>
      ) : null}
      <SupabaseOAuthPanel projectId={projectId} account={account} connection={connection} />
      {connection?.status !== "connected" ? (
        <details id="supabase-connection-string-fallback" className="mt-3 rounded-xl border border-line p-3">
          <summary className="cursor-pointer text-sm font-semibold">Use connection strings instead</summary>
          <div className="mt-3">
            <SupabaseConnectionForm projectId={projectId} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

const SUPABASE_ERROR_MESSAGES: Record<string, string> = {
  oauth_not_configured:
    "Supabase OAuth is not configured. Add SUPABASE_OAUTH_CLIENT_ID and SUPABASE_OAUTH_CLIENT_SECRET on the server.",
  oauth_client_invalid:
    "Supabase rejected this OAuth client. Create it under Organization Settings → OAuth Apps (Management API), not Authentication → OAuth Apps.",
  oauth_preflight_failed:
    "Supabase could not validate the OAuth client. Nothing was connected; try again.",
  vault_missing: "The deployment vault is not configured, so the OAuth grant cannot be stored.",
  oauth_state_failed: "The OAuth state could not be saved. Nothing was connected; try again.",
  oauth_state_invalid: "That OAuth attempt expired or was already used. Start the connection again.",
  oauth_missing_code: "Supabase did not return an authorization code. Start the connection again.",
  oauth_denied: "Supabase access was cancelled or denied. Nothing was connected.",
  oauth_failed: "Supabase OAuth did not complete. Nothing was changed; try again.",
  invalid_project: "That app project is not available to you.",
};

function PlanDetails({ plan }: { plan: DeploymentPlan }) {
  return (
    <div className="mt-4 space-y-5 text-sm">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="text-sm font-bold">Exact source snapshot</h3>
          <p>Version {plan.source.version} · {plan.source.file_count} files</p>
          <p className="break-all font-mono text-xs text-muted">{plan.source.digest}</p>
          <details className="mt-1">
            <summary className="cursor-pointer text-xs text-muted">Show source paths</summary>
            <ul className="mt-1 space-y-0.5 font-mono text-xs text-muted">
              {plan.source.paths.map((path) => <li key={path}>{path}</li>)}
            </ul>
          </details>
        </div>
        <div>
          <h3 className="text-sm font-bold">Repository and branch</h3>
          <p>{plan.repository.full_name}</p>
          <p className="text-muted">{plan.repository.branch} · {plan.repository.visibility}</p>
          <p className="mt-2 text-xs text-muted">{plan.repository.action}</p>
        </div>
        <div>
          <h3 className="text-sm font-bold">Hosting account and project</h3>
          <p>{plan.hosting.account}</p>
          <p className="text-muted">{plan.hosting.project_name}</p>
          <p className="break-all font-mono text-xs text-muted">{plan.hosting.project_id}</p>
        </div>
        <div>
          <h3 className="text-sm font-bold">Database target</h3>
          <p>Development: {plan.database.development_ref}</p>
          <p>Production: {plan.database.production_ref}</p>
          <p className="text-muted">This deploy writes: {plan.database.target_ref}</p>
          <p className="text-xs text-muted">{plan.database.action}</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="text-sm font-bold">Environment-variable names</h3>
          <p className="text-xs text-muted">Values are never shown. {plan.environment.environment} requirements:</p>
          <ul className="mt-1 space-y-1 font-mono text-xs">
            {plan.environment.names.map((item) => (
              <li key={item.name}>
                {item.name} <span className="text-muted">({item.visibility}, {item.set ? "set" : "missing"})</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-bold">Proposed migrations</h3>
          {plan.database.migrations.length === 0 ? (
            <p className="text-muted">No migration files. No database write.</p>
          ) : (
            <ul className="mt-1 space-y-2">
              {plan.database.migrations.map((migration) => (
                <li key={migration.path}>
                  <p className="break-all font-mono text-xs">{migration.path}</p>
                  <p className="text-xs text-muted">{migration.statement_count} statement(s)</p>
                  {migration.destructive.length > 0 ? (
                    <p className="text-xs text-danger">Destructive: {migration.destructive.join("; ")}</p>
                  ) : (
                    <p className="text-xs text-mint">No destructive pattern detected.</p>
                  )}
                  <details>
                    <summary className="cursor-pointer text-xs text-muted">Preview SQL</summary>
                    <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-paper p-2 font-mono text-[11px]">{migration.preview}</pre>
                  </details>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted">
            {plan.database.apply_migrations
              ? "These files will be applied to the production target only after explicit approval."
              : "No production migration is included in this plan."}
          </p>
        </div>
      </div>

      <List title="Resolved actions" items={plan.actions} />
      <div className="grid gap-4 sm:grid-cols-2">
        <List title="Known costs" items={plan.costs.known} />
        <List title="Unknown costs" items={plan.costs.unknown} />
      </div>
      <List title="Visibility" items={[plan.visibility.note, `Repository: ${plan.visibility.repository}`, `Deployment: ${plan.visibility.deployment}`]} />
      <List title="Rollback limitations" items={plan.rollback} />
      <List title="Known limitations" items={plan.limitations} />
    </div>
  );
}

function DeploymentCard({
  projectId,
  deployment,
  canRedeploy,
}: {
  projectId: string;
  deployment: AppDeployment;
  canRedeploy: boolean;
}) {
  return (
    <li className={`${cardClass} text-sm`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">
            {deployment.target} · source version {deployment.snapshot_version}
          </p>
          <p className="text-xs text-muted">
            {deployment.created_at.slice(0, 19).replace("T", " ")} · {STATUS_LABEL[deployment.status] ?? deployment.status}
          </p>
        </div>
        <span className={chipClass}>{deployment.status}</span>
      </div>
      {deployment.deployment_url ? (
        <p className="mt-2 break-all">
          <a href={deployment.deployment_url} target="_blank" rel="noreferrer noopener" className="font-medium underline">
            {deployment.deployment_url}
          </a>
        </p>
      ) : null}
      <dl className="mt-2 grid gap-1 text-xs text-muted sm:grid-cols-2">
        <div><dt className="inline font-semibold text-ink">Source revision: </dt><dd className="inline break-all font-mono">{deployment.source_commit ?? "not committed"}</dd></div>
        <div><dt className="inline font-semibold text-ink">Deployment id: </dt><dd className="inline break-all font-mono">{deployment.external_deployment_id ?? "not created"}</dd></div>
        <div><dt className="inline font-semibold text-ink">Migrations: </dt><dd className="inline">{deployment.migration_state}</dd></div>
        <div><dt className="inline font-semibold text-ink">Plan: </dt><dd className="inline font-mono">{deployment.plan_hash.slice(0, 12)}…</dd></div>
      </dl>
      {deployment.checks.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs">
          {deployment.checks.map((check) => (
            <li key={check.name}>
              <span className="font-semibold">{check.label}:</span>{" "}
              <span className={check.status === "passed" ? "text-mint" : check.status === "skipped" ? "text-muted" : "text-danger"}>{check.status}</span>
              {check.detail ? <span className="text-muted"> — {check.detail}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {deployment.error ? <p className="mt-2 text-xs text-danger">{deployment.error}</p> : null}
      {deployment.partial_failure ? <p className="mt-1 text-xs text-danger">{deployment.partial_failure}</p> : null}
      {deployment.status === "deploying" ? (
        <RefreshDeploymentForm projectId={projectId} deploymentId={deployment.id} />
      ) : null}
      {canRedeploy && ["succeeded", "partial_failure"].includes(deployment.status) ? (
        <RedeploySnapshotForm projectId={projectId} deploymentId={deployment.id} target={deployment.target} />
      ) : null}
    </li>
  );
}

export default async function DeployPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  if (!isUuid(projectId)) notFound();
  const supabaseNotice = typeof query.supabase === "string" ? query.supabase : "";
  const supabaseError = typeof query.supabase_error === "string" ? query.supabase_error : "";

  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <p className="text-sm text-muted">Sign-in is not configured in this build.</p>
      </main>
    );
  }

  const session = await requireSession();
  const [identity, detail, deployDetail] = await Promise.all([
    getIdentity(session),
    getAppProjectDetail(session, projectId),
    getDeploymentDetail(session, projectId),
  ]);
  if (!detail) notFound();

  const { project, files } = detail;
  const { connections, envValues, deployments, events, supabaseAccount } = deployDetail;
  const connectionFor = (provider: "github" | "vercel" | "supabase") =>
    connections.find((item) => item.provider === provider) ?? null;
  const requirements = extractEnvRequirements(files);
  const setFor = (environment: "preview" | "production") =>
    new Set(envValues.filter((item) => item.environment === environment).map((item) => item.name));
  const latest = deployments[0] ?? null;
  const configured = vaultConfigured();
  const missingConnections = !connectionFor("github") || !connectionFor("vercel") || !connectionFor("supabase");

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />
      <main className="mx-auto w-full max-w-5xl px-5 pb-16 pt-6">
        <Link href={`/build/${project.id}`} className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}>
          ← Back to {project.name}
        </Link>
        <header className="mt-4">
          <h1 className="text-3xl font-black leading-tight tracking-tight sm:text-4xl">Deploy</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
            Connect one repository, one application host and one database pair. A deployment plan pins an exact source
            snapshot and shows every external action before anything is written. Creating a plan does not authorize it.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
            <span className={chipClass}>GitHub</span>
            <span className={chipClass}>Vercel</span>
            <span className={chipClass}>Supabase</span>
            <span className={chipClass}>No purchase or DNS change</span>
          </div>
        </header>

        {supabaseNotice === "connected" ? (
          <section className={`${cardClass} mt-5 border-mint/40 bg-mint/5`}>
            <h2 className="text-lg font-bold">Supabase account connected</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              Choose an organization and two existing projects below. The grant is encrypted on the server and can be
              revoked from this page or from your Supabase account settings.
            </p>
          </section>
        ) : null}

        {supabaseError ? (
          <section className={`${cardClass} mt-5 border-danger/40`} role="alert">
            <h2 className="text-lg font-bold">Supabase connection did not complete</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              {SUPABASE_ERROR_MESSAGES[supabaseError] ?? "The Supabase connection stopped before it could finish. Try again."}
            </p>
          </section>
        ) : null}

        {!configured ? (
          <section className={`${cardClass} mt-5 border-danger/40`}>
            <h2 className="text-lg font-bold">The deployment vault is not configured</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              Set a server-only <code>DEPLOYMENT_VAULT_KEY</code> as 32 bytes of base64 or 64 hex characters. No provider
              connection can be stored until then, and the app does not use a fallback key.
            </p>
          </section>
        ) : null}

        <section aria-labelledby="connections-heading" className="mt-8">
          <h2 id="connections-heading" className="text-xl font-bold">Connections</h2>
          <p className="mt-1 text-sm text-muted">
            Each connection is stored only for this project. Tokens are encrypted server-side; the UI and logs receive no token or connection-string value.
          </p>
          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            <ConnectionCard projectId={project.id} provider="github" title="GitHub repository" connection={connectionFor("github")} />
            <ConnectionCard projectId={project.id} provider="vercel" title="Vercel project" connection={connectionFor("vercel")} />
            <SupabaseConnectionCard projectId={project.id} connection={connectionFor("supabase")} account={supabaseAccount} />
          </div>
        </section>

        <section aria-labelledby="environment-heading" className="mt-8">
          <h2 id="environment-heading" className="text-xl font-bold">Environment values</h2>
          <p className="mt-1 text-sm text-muted">
            Names come from the actual generated code and <code>.env.example</code>. Public names start with <code>NEXT_PUBLIC_</code>;
            every other value is server-only. Values are encrypted and never rendered or logged. Use the protected fields below.
          </p>
          {requirements.length === 0 ? (
            <p className={`${cardClass} mt-3 text-sm text-muted`}>No environment requirements were found in the current files.</p>
          ) : (
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              {(["preview", "production"] as const).map((environment) => {
                const set = setFor(environment);
                return (
                  <div key={environment} className={cardClass}>
                    <h3 className="text-base font-bold capitalize">{environment}</h3>
                    <p className="mt-1 text-xs text-muted">Used by {environment} deployments only.</p>
                    <div className="mt-2">
                      {requirements.map((requirement) => (
                        <EnvValueForm
                          key={`${environment}:${requirement.name}`}
                          projectId={project.id}
                          environment={environment}
                          name={requirement.name}
                          visibility={requirement.visibility}
                          set={set.has(requirement.name)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section aria-labelledby="plan-heading" className="mt-8">
          <h2 id="plan-heading" className="text-xl font-bold">Deployment plans</h2>
          <p className="mt-1 text-sm text-muted">
            A plan is bound to the exact files, provider targets, environment names and migration preview below. Any change invalidates approval.
          </p>
          <div className={`${cardClass} mt-3`}>
            <CreatePlanForm projectId={project.id} />
            {missingConnections ? <p className="mt-2 text-xs text-danger">Connect all three providers before creating a plan.</p> : null}
          </div>

          {latest ? (
            <div className={`${cardClass} mt-4`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-lg font-bold">Latest plan · <span className="capitalize">{latest.target}</span></h3>
                  <p className="text-xs text-muted">
                    Status: {STATUS_LABEL[latest.status] ?? latest.status} · fingerprint {latest.plan_hash.slice(0, 16)}…
                  </p>
                </div>
                <span className={chipClass}>{latest.status}</span>
              </div>
              <PlanDetails plan={latest.plan} />
              {planProblems(latest.plan).length > 0 ? (
                <div className="mt-4 rounded-xl border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
                  <p className="font-semibold">Approval is blocked:</p>
                  <ul className="mt-1 list-disc pl-5">
                    {planProblems(latest.plan).map((problem) => <li key={problem}>{problem}</li>)}
                  </ul>
                </div>
              ) : null}
              <div className="mt-5 border-t border-line pt-4">
                {latest.status === "draft" ? <PrecheckForm projectId={project.id} deploymentId={latest.id} /> : null}
                {latest.status === "checks_ready" ? (
                  <div className="space-y-3">
                    <PrecheckForm projectId={project.id} deploymentId={latest.id} />
                    <ApproveDeploymentForm
                      projectId={project.id}
                      deploymentId={latest.id}
                      planHash={latest.plan_hash}
                      disabled={latest.checks.length === 0 || latest.checks.some((check) => !["passed", "skipped"].includes(check.status))}
                    />
                  </div>
                ) : null}
                {latest.status === "deploying" ? (
                  <RefreshDeploymentForm projectId={project.id} deploymentId={latest.id} />
                ) : null}
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">No deployment plan yet.</p>
          )}
        </section>

        <section aria-labelledby="deployments-heading" className="mt-8">
          <h2 id="deployments-heading" className="text-xl font-bold">Deployment history</h2>
          <p className="mt-1 text-sm text-muted">
            A successful hosting request is not success. The result below separates deployment API state, smoke checks and database migration state.
          </p>
          {deployments.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No deployments yet.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {deployments.map((deployment) => (
                <DeploymentCard
                  key={deployment.id}
                  projectId={project.id}
                  deployment={deployment}
                  canRedeploy={!missingConnections}
                />
              ))}
            </ul>
          )}
        </section>

        {events.length > 0 ? (
          <section aria-labelledby="events-heading" className="mt-8">
            <h2 id="events-heading" className="text-xl font-bold">Latest deployment audit</h2>
            <p className="mt-1 text-sm text-muted">No tokens, environment values or provider request bodies are recorded.</p>
            <ul className="mt-3 space-y-1 text-sm">
              {events.map((item) => (
                <li key={item.id} className="border-b border-line py-1.5 last:border-0">
                  <span className="font-semibold">{item.kind}</span>{" "}
                  <span className="text-xs text-muted">{item.created_at.slice(0, 19).replace("T", " ")}</span>
                  <p className="break-words text-xs text-muted">{item.detail}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="mt-8">
          <Link href={`/build/${project.id}`} className={secondaryButton}>Back to project</Link>
        </div>
      </main>
    </div>
  );
}
