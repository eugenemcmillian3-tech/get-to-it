import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import {
  ActionControls,
  ConnectComposioForm,
  ConnectionControls,
  DiscoverToolsForm,
  GrantToolForm,
  ProposeComposioActionForm,
  RevokeGrantForm,
} from "@/components/composio-forms";
import { SiteHeader } from "@/components/site-header";
import { TEAM_ROLE_LABELS, type TeamRole } from "@/lib/agent-team";
import { requireSession } from "@/lib/auth";
import {
  COMPOSIO_SECURITY_NOTE,
  COMPOSIO_SETUP_MESSAGE,
  COMPOSIO_SDK_PACKAGE,
  COMPOSIO_SDK_VERSION,
  COMPOSIO_TOOLKITS,
  composioToolkit,
} from "@/lib/composio/contracts";
import { isComposioConfigured } from "@/lib/composio/sdk";
import { getComposioPage } from "@/lib/data/composio";
import { getIdentity } from "@/lib/identity";
import { cardClass, chipClass, focusRing, secondaryButton } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { isUuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Connections — GET TO IT" };

function statusTone(status: string): string {
  if (status === "active") return "border-emerald-300 bg-emerald-50 text-emerald-900";
  if (status === "expired") return "border-amber-300 bg-amber-50 text-amber-900";
  if (status === "revoked" || status === "removed") return "border-line bg-paper text-muted";
  return "border-line bg-paper text-muted";
}

function actionTone(status: string): string {
  if (status === "succeeded") return "border-emerald-300 bg-emerald-50 text-emerald-900";
  if (status === "failed") return "border-danger/40 bg-danger/5 text-danger";
  if (status === "uncertain") return "border-amber-300 bg-amber-50 text-amber-900";
  return "border-line bg-paper text-muted";
}

export default async function ConnectionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ composio?: string }>;
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
  const [identity, data, query] = await Promise.all([
    getIdentity(session),
    getComposioPage(session, projectId),
    searchParams,
  ]);
  if (!data) notFound();

  const configured = isComposioConfigured();
  const toolsByConnection = new Map<string, typeof data.tools>();
  for (const tool of data.tools) {
    const list = toolsByConnection.get(tool.connection_id) ?? [];
    list.push(tool);
    toolsByConnection.set(tool.connection_id, list);
  }

  const grantsByTool = new Map<string, typeof data.grants>();
  for (const grant of data.grants) {
    const key = `${grant.connection_id}:${grant.tool_slug}`;
    const list = grantsByTool.get(key) ?? [];
    list.push(grant);
    grantsByTool.set(key, list);
  }

  const taskById = new Map(data.tasks.map((task) => [task.id, task]));
  const activeConnections = data.connections.filter((connection) => connection.status === "active");
  const proposalKey = randomUUID().replace(/-/g, "");

  const flash =
    query.composio === "connected"
      ? "The account is connected. Discover its tools, then grant one to an agent role."
      : query.composio === "cancelled"
        ? "Authorization was cancelled. No connection was saved."
        : query.composio === "failed"
          ? "The provider did not complete the connection. Nothing was saved. You can try again."
          : null;

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-5xl px-5 pb-16 pt-6">
        <Link
          href={`/build/${projectId}`}
          className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          ← Back to {data.project.name}
        </Link>

        <header className="mt-4">
          <h1 className="text-3xl font-black leading-tight tracking-tight sm:text-4xl">Connections</h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">
            Connect external accounts for this project. GET TO IT can then discover the tools those
            accounts expose. A connected account authorizes <strong className="text-ink">no action by itself</strong>:
            an agent role needs a specific tool grant, and every call is proposed with exact arguments and
            approved by you before it runs.
          </p>
        </header>

        {flash ? (
          <p className="mt-4 rounded-xl border border-line bg-paper p-3 text-sm text-muted" role="status">
            {flash}
          </p>
        ) : null}

        {!configured ? (
          <section className={`${cardClass} mt-5 border-amber-300 bg-amber-50`}>
            <h2 className="text-lg font-bold text-amber-900">Composio is not configured</h2>
            <p className="mt-1 text-sm leading-relaxed text-amber-900">{COMPOSIO_SETUP_MESSAGE}</p>
            <p className="mt-2 text-xs leading-relaxed text-amber-900">
              Required server-only variables: <code className="font-mono">COMPOSIO_API_KEY</code> and{" "}
              <code className="font-mono">APP_ORIGIN</code>. The callback URL is{" "}
              <code className="font-mono">{`{APP_ORIGIN}/api/composio/callback`}</code>. No connection
              attempt is made until both are set.
            </p>
          </section>
        ) : null}

        <section aria-labelledby="supported-heading" className="mt-8">
          <h2 id="supported-heading" className="text-xl font-bold">
            Supported integrations
          </h2>
          <p className="mt-1 text-sm text-muted">
            These use Composio-managed authorization (OAuth, or an API key for providers that require
            one). Only these toolkits are exposed by this build; a toolkit is available only because its
            connection flow and tool discovery are implemented. Your Composio project must also allow it.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {COMPOSIO_TOOLKITS.map((toolkit) => {
              const connected = activeConnections.filter(
                (connection) => connection.toolkit === toolkit.slug,
              );
              return (
                <div key={toolkit.slug} className={cardClass}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="text-base font-bold">{toolkit.label}</h3>
                      <p className="text-xs uppercase tracking-wide text-muted">{toolkit.category}</p>
                      <p className="mt-1 text-xs text-muted">Authorization: {toolkit.auth}</p>
                    </div>
                    <span className={chipClass}>{connected.length > 0 ? `${connected.length} connected` : "Not connected"}</span>
                  </div>
                  <p className="mt-2 text-sm text-muted">{toolkit.description}</p>
                  <ConnectComposioForm projectId={projectId} toolkit={toolkit.slug} label={toolkit.label} />
                </div>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="accounts-heading" className="mt-8">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 id="accounts-heading" className="text-xl font-bold">
                Connected accounts
              </h2>
              <p className="mt-1 text-sm text-muted">
                Multiple accounts are allowed. Every action names the exact account it will use.
              </p>
            </div>
            <span className={chipClass}>
              Today: {data.usage.calls}/{data.usage.calls_limit} calls · {data.usage.writes}/{data.usage.writes_limit} writes
            </span>
          </div>

          {data.connections.length === 0 ? (
            <p className={`${cardClass} mt-3 text-sm text-muted`}>No accounts connected yet.</p>
          ) : (
            <ul className="mt-3 space-y-4">
              {data.connections.map((connection) => {
                const toolkit = composioToolkit(connection.toolkit);
                const tools = toolsByConnection.get(connection.id) ?? [];
                const active = connection.status === "active";
                return (
                  <li key={connection.id} className={cardClass}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="text-base font-bold">{connection.account_label || toolkit?.label}</h3>
                        <p className="text-xs text-muted">
                          {toolkit?.label ?? connection.toolkit} · connected{" "}
                          {connection.connected_at.slice(0, 10)}
                          {connection.last_verified_at
                            ? ` · checked ${connection.last_verified_at.slice(0, 16).replace("T", " ")}`
                            : ""}
                        </p>
                      </div>
                      <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${statusTone(connection.status)}`}>
                        {connection.status}
                      </span>
                    </div>

                    <ConnectionControls projectId={projectId} connection={connection} />

                    {active ? (
                      <div className="mt-4 border-t border-line pt-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h4 className="text-sm font-bold">Tool catalogue ({tools.length})</h4>
                          <DiscoverToolsForm projectId={projectId} connectionId={connection.id} />
                        </div>
                        {tools.length === 0 ? (
                          <p className="mt-2 text-sm text-muted">
                            No tools discovered yet. Discovery reads Composio&apos;s catalogue and does not
                            call any tool.
                          </p>
                        ) : (
                          <ul className="mt-2 space-y-2">
                            {tools.map((tool) => {
                              const grants = (grantsByTool.get(`${connection.id}:${tool.tool_slug}`) ?? []).filter(
                                (grant) => grant.enabled,
                              );
                              return (
                                <li key={tool.tool_slug} className="rounded-lg border border-line bg-paper p-3">
                                  <p className="text-sm font-semibold">{tool.name}</p>
                                  <p className="break-all font-mono text-[11px] text-muted">{tool.tool_slug}</p>
                                  {tool.description ? (
                                    <p className="mt-1 text-xs leading-relaxed text-muted">{tool.description}</p>
                                  ) : null}
                                  <div className="mt-1 flex flex-wrap items-center gap-1">
                                    <span className="text-xs font-semibold">Granted:</span>
                                    {grants.length === 0 ? (
                                      <span className="text-xs text-muted">nobody</span>
                                    ) : (
                                      grants.map((grant) => (
                                        <span key={grant.id} className="inline-flex items-center gap-1 rounded-full border border-line bg-card px-2 py-0.5 text-[11px]">
                                          {TEAM_ROLE_LABELS[grant.role as TeamRole] ?? grant.role}
                                          <RevokeGrantForm
                                            projectId={projectId}
                                            connectionId={connection.id}
                                            toolSlug={tool.tool_slug}
                                            role={grant.role}
                                            label="×"
                                          />
                                        </span>
                                      ))
                                    )}
                                  </div>
                                  <GrantToolForm
                                    projectId={projectId}
                                    connectionId={connection.id}
                                    toolSlug={tool.tool_slug}
                                    roles={grants.map((grant) => grant.role)}
                                  />
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    ) : (
                      <p className="mt-3 rounded-lg border border-line bg-paper p-2 text-xs text-muted">
                        This connection is {connection.status}. Reconnect the account to use it; existing
                        grants are disabled and pending proposals were cancelled.
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="propose-heading" className="mt-8">
          <h2 id="propose-heading" className="text-xl font-bold">
            Request a tool action
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted">
            This is the agent-facing request path. An agent role can request only a tool granted to that
            role, for one of its current tasks, with a complete argument object. The proposal is inert until
            you approve it.
          </p>
          <div className={`${cardClass} mt-3`}>
            <ProposeComposioActionForm
              projectId={projectId}
              connections={data.connections}
              tools={data.tools}
              grants={data.grants}
              tasks={data.tasks}
              idempotencyKey={proposalKey}
            />
          </div>
        </section>

        <section aria-labelledby="actions-heading" className="mt-8">
          <h2 id="actions-heading" className="text-xl font-bold">
            Action records
          </h2>
          <p className="mt-1 text-sm text-muted">
            Exact proposals, approvals and execution outcomes. Provider results are stored only after
            sensitive fields are redacted and the size is bounded.
          </p>

          {data.actions.length === 0 ? (
            <p className={`${cardClass} mt-3 text-sm text-muted`}>No action proposals yet.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {data.actions.map((action) => {
                const task = action.task_id ? taskById.get(action.task_id) : null;
                const connection = data.connections.find((entry) => entry.id === action.connection_id);
                return (
                  <li key={action.id} className={cardClass}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold">{action.tool_name}</p>
                        <p className="break-all font-mono text-[11px] text-muted">{action.tool_slug}</p>
                        <p className="mt-1 text-xs text-muted">
                          {TEAM_ROLE_LABELS[action.role] ?? action.role} ·{" "}
                          {connection?.account_label ?? "connection removed"} ·{" "}
                          {task ? `task ${task.position + 1}: ${task.objective.slice(0, 80)}` : "task removed"} ·{" "}
                          {action.created_at.slice(0, 16).replace("T", " ")}
                        </p>
                      </div>
                      <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${actionTone(action.status)}`}>
                        {action.status}
                      </span>
                    </div>

                    <div className="mt-2 grid gap-2 lg:grid-cols-2">
                      <div>
                        <p className="text-xs font-semibold">Exact arguments</p>
                        <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-paper p-2 text-[11px] leading-relaxed">
                          {JSON.stringify(action.arguments, null, 2)}
                        </pre>
                        <p className="mt-1 break-all font-mono text-[10px] text-muted">
                          sha256: {action.arguments_hash}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold">Stored result</p>
                        {action.result ? (
                          <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-paper p-2 text-[11px] leading-relaxed">
                            {JSON.stringify(action.result, null, 2)}
                          </pre>
                        ) : (
                          <p className="mt-1 text-xs text-muted">No result stored.</p>
                        )}
                        {action.provider_ref ? (
                          <p className="mt-1 break-all font-mono text-[10px] text-muted">
                            provider ref: {action.provider_ref}
                          </p>
                        ) : null}
                        {action.error_code ? (
                          <p className="mt-1 text-xs text-danger">
                            {action.error_code}
                            {action.error_message ? `: ${action.error_message}` : ""}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-semibold text-muted">
                        Show the approved preview
                      </summary>
                      <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-paper p-2 text-[11px] leading-relaxed">
                        {action.preview}
                      </pre>
                    </details>

                    <ActionControls projectId={projectId} action={action} />
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className={`${cardClass} mt-8`}>
          <h2 className="text-lg font-bold">How this stays bounded</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">{COMPOSIO_SECURITY_NOTE}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
            <li>Composio access is server-only; the API key never reaches the browser or generated projects.</li>
            <li>Sessions are references stored per project and toolkit. Session MCP URLs are never shown or logged.</li>
            <li>One in-flight call per user; {data.usage.calls_limit} calls and {data.usage.writes_limit} writes per project per day. The automation add-on raises these limits; every action still needs approval.</li>
            <li>Timeouts and network failures are recorded as uncertain, never retried automatically.</li>
            <li>Tool usage is counted separately from AI request credits.</li>
          </ul>
          <p className="mt-3 text-xs text-muted">
            SDK: <code className="font-mono">{COMPOSIO_SDK_PACKAGE}@{COMPOSIO_SDK_VERSION}</code>. Setup and
            known limitations:{" "}
            <a className="underline decoration-line underline-offset-4" href="/docs/composio-connections.md">
              Composio setup
            </a>
            .
          </p>
        </section>

        <p className="mt-6">
          <Link href={`/build/${projectId}/team`} className={secondaryButton}>
            Open the agent team
          </Link>
        </p>
      </main>
    </div>
  );
}
