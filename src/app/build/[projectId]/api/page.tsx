import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CreateApiKeyForm,
  CreateApiWebhookForm,
  RevokeApiKeyForm,
  RevokeApiWebhookForm,
} from "@/components/api-key-forms";
import { SiteHeader } from "@/components/site-header";
import { API_LIMITS, API_SCOPES, API_VERSION, SCOPE_LABELS } from "@/lib/api/contracts";
import { keyIsExpired, summarizeRecentUsage } from "@/lib/api/usage-summary";
import { requireSession } from "@/lib/auth";
import { vaultConfigured } from "@/lib/deploy/vault";
import { getIdentity } from "@/lib/identity";
import { cardClass, chipClass, focusRing } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { isUuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Developer API — GET TO IT" };

type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  rate_limit_per_minute: number;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
};

type UsageRow = {
  key_id: string;
  operation: string;
  status: number;
  error_code: string | null;
  created_at: string;
};

type WebhookRow = {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  created_at: string;
};

const ENDPOINTS = [
  ["POST", "/api/v1/projects", "Create an app project", "projects:write"],
  ["POST", "/api/v1/projects/{id}/specification", "Submit or update a specification", "specs:write"],
  ["POST", "/api/v1/projects/{id}/jobs", "Start an approved build job", "builds:write"],
  ["GET", "/api/v1/projects/{id}/jobs", "List jobs (paginated)", "builds:read"],
  ["GET", "/api/v1/jobs/{id}", "Read job status", "builds:read"],
  ["DELETE", "/api/v1/jobs/{id}", "Cancel a queued job", "builds:write"],
  ["GET", "/api/v1/jobs/{id}/artifacts", "Retrieve generated artifacts", "builds:read"],
  ["GET", "/api/v1/projects/{id}/previews", "List previews (paginated)", "previews:read"],
  ["POST", "/api/v1/projects/{id}/deployment-proposals", "Request a draft deployment proposal", "deployments:propose"],
] as const;

export default async function DeveloperApiPage({
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
  const { data: project } = await session.supabase
    .from("app_projects")
    .select("id, name")
    .eq("id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (!project) notFound();

  const [identity, keysResult, usageResult, hooksResult] = await Promise.all([
    getIdentity(session),
    session.supabase
      .from("app_api_keys_safe")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
    session.supabase
      .from("app_api_usage")
      .select("key_id, operation, status, error_code, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(500),
    session.supabase
      .from("app_api_webhooks_safe")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
  ]);

  if (keysResult.error) {
    console.error("Developer API keys read failed:", keysResult.error.message);
  }
  if (usageResult.error) {
    console.error("Developer API usage read failed:", usageResult.error.message);
  }
  if (hooksResult.error) {
    console.error("Developer API webhooks read failed:", hooksResult.error.message);
  }

  const keys = (keysResult.data ?? []) as ApiKeyRow[];
  const usage = (usageResult.data ?? []) as UsageRow[];
  const hooks = (hooksResult.data ?? []) as WebhookRow[];

  const stats = summarizeRecentUsage(usage);

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-5xl px-5 pb-16 pt-6">
        <Link
          href={`/build/${project.id}`}
          className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          ← {project.name}
        </Link>

        <header className="mt-4">
          <h1 className="text-3xl font-black leading-tight tracking-tight sm:text-4xl">
            Developer API
          </h1>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
            <span className={chipClass}>Version {API_VERSION}</span>
            <span className={chipClass}>Project-scoped keys only</span>
            <span className={chipClass}>No shell or arbitrary execution</span>
          </div>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">
            A limited, versioned interface over the same project capabilities as the web
            app. Credentials are scoped to this project, expire, can be revoked, and are
            rate-limited per key. A deployment proposal created from the API is a draft
            only; approval stays with you in this app.
          </p>
          <p className="mt-2 text-sm">
            <a
              href="/docs/developer-api.md"
              className={`font-semibold underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
            >
              API and TypeScript SDK reference
            </a>
            {" · "}
            <a
              href="/api/v1"
              className={`font-semibold underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
            >
              Supported-version endpoint
            </a>
          </p>
        </header>

        <section aria-labelledby="keys-heading" className={`${cardClass} mt-6`}>
          <h2 id="keys-heading" className="text-lg font-bold">Create a key</h2>
          <p className="mt-1 text-sm text-muted">
            Choose only the scopes the client needs. The token is displayed once and stored
            as a SHA-256 hash.
          </p>
          <div className="mt-3">
            <CreateApiKeyForm projectId={project.id} />
          </div>
        </section>

        <section aria-labelledby="key-list-heading" className="mt-8">
          <h2 id="key-list-heading" className="text-xl font-bold">Keys</h2>
          {keys.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No API keys exist for this project.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {keys.map((key) => {
                const stat = stats.get(key.id);
                const expired = keyIsExpired(key.expires_at);
                return (
                  <li key={key.id} className={cardClass}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold">
                          {key.name}{" "}
                          <code className="ml-1 text-xs font-normal text-muted">
                            {key.prefix}…
                          </code>
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          {key.scopes
                            .map((scope) => SCOPE_LABELS[scope as (typeof API_SCOPES)[number]] ?? scope)
                            .join(" · ")}
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          {key.rate_limit_per_minute}/min · expires{" "}
                          {key.expires_at.slice(0, 10)} · last used{" "}
                          {key.last_used_at
                            ? key.last_used_at.slice(0, 16).replace("T", " ")
                            : "never"}
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          24h: {stat?.calls ?? 0} calls
                          {stat?.limited ? `, ${stat.limited} rate-limited` : ""}
                        </p>
                      </div>
                      <div className="text-right">
                        {key.revoked_at ? (
                          <span className={chipClass}>Revoked</span>
                        ) : expired ? (
                          <span className={chipClass}>Expired</span>
                        ) : (
                          <RevokeApiKeyForm projectId={project.id} keyId={key.id} />
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="webhooks-heading" className={`${cardClass} mt-8`}>
          <h2 id="webhooks-heading" className="text-lg font-bold">Signed webhooks</h2>
          <p className="mt-1 text-sm text-muted">
            Job completion sends at most five signed attempts. Each request carries a stable{" "}
            <code className="text-xs">X-GETTOIT-Delivery</code> id, so a receiver can discard a
            duplicate. Secrets are sealed with the deployment vault and never returned by a read.
          </p>
          <div className="mt-3">
            <CreateApiWebhookForm projectId={project.id} vaultReady={vaultConfigured()} />
          </div>

          {hooks.length > 0 ? (
            <ul className="mt-5 space-y-2 border-t border-line pt-4">
              {hooks.map((hook) => (
                <li key={hook.id} className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="break-all font-mono text-xs">{hook.url}</p>
                    <p className="mt-1 text-xs text-muted">
                      {hook.events.join(", ")} · added {hook.created_at.slice(0, 10)}
                    </p>
                  </div>
                  <RevokeApiWebhookForm projectId={project.id} webhookId={hook.id} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-muted">No webhook is registered.</p>
          )}
        </section>

        <section aria-labelledby="endpoints-heading" className="mt-8">
          <h2 id="endpoints-heading" className="text-xl font-bold">Implemented endpoints</h2>
          <p className="mt-1 text-sm text-muted">
            Only these operations exist. Limits: {API_LIMITS.defaultRateLimitPerMinute} requests
            per minute by default and at most {API_LIMITS.maxPageSize} records per page.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 pr-3 font-semibold">Method</th>
                  <th className="py-2 pr-3 font-semibold">Path</th>
                  <th className="py-2 pr-3 font-semibold">Operation</th>
                  <th className="py-2 font-semibold">Scope</th>
                </tr>
              </thead>
              <tbody>
                {ENDPOINTS.map(([method, path, label, scope]) => (
                  <tr key={`${method}${path}`} className="border-b border-line/60">
                    <td className="py-2 pr-3 font-mono text-xs">{method}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{path}</td>
                    <td className="py-2 pr-3 text-muted">{label}</td>
                    <td className="py-2 font-mono text-xs">{scope}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            Optional MCP gateway: <code>POST /api/mcp</code> exposes seven tools that call the
            same operations with the same key and scopes. There is no separate privileged path.
            A proposal cannot deploy itself, spend credits, or publish to any provider account.
          </p>
        </section>
      </main>
    </div>
  );
}
