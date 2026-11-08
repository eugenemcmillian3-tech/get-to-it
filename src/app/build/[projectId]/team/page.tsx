import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import {
  AdvanceTeamForm,
  IntegrateTeamForm,
  RunControlForms,
  StartTeamForm,
  TaskReviewForm,
} from "@/components/team-forms";
import {
  MODEL_HEALTH_MIN_TASKS,
  TEAM_ROLES_SPEC,
  TEAM_ROLE_LABELS,
  TEAM_ROLE_MODELS,
  taskCallsLabel,
  teamStatusLabel,
  type TeamModelHealthStatus,
  type TeamTaskRecord,
} from "@/lib/agent-team";
import { aiModelLabel } from "@/lib/ai/models";
import { requireSession } from "@/lib/auth";
import { getAppTeam } from "@/lib/data/app-team";
import { getIdentity } from "@/lib/identity";
import { cardClass, chipClass, focusRing, secondaryButton } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { isUuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Agent team — GET TO IT" };

const MODEL_HEALTH_LABELS: Record<TeamModelHealthStatus, string> = {
  stable: "Stable",
  watch: "Watch",
  degraded: "Regression",
  insufficient: "Too few tasks",
};

function modelHealthTone(status: TeamModelHealthStatus): string {
  if (status === "degraded") return "text-danger";
  if (status === "watch") return "text-amber-700";
  if (status === "stable") return "text-mint";
  return "text-muted";
}

function TaskCard({
  projectId,
  task,
  canReassign,
}: {
  projectId: string;
  task: TeamTaskRecord;
  canReassign: boolean;
}) {
  const output = task.output;
  return (
    <li className={cardClass}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            {TEAM_ROLE_LABELS[task.role]} · position {task.position + 1}
          </p>
          <h3 className="mt-1 text-base font-semibold leading-snug">{task.objective}</h3>
        </div>
        <span className={chipClass}>{teamStatusLabel(task.status)}</span>
      </div>

      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <div>
          <dt className="font-semibold">Allowed tools</dt>
          <dd className="break-words font-mono text-muted">{task.allowed_tools.join(", ") || "none"}</dd>
        </div>
        <div>
          <dt className="font-semibold">Budget</dt>
          <dd className="text-muted">
            {task.budget_seconds}s · {task.budget_calls} AI call(s) · {taskCallsLabel(task.calls_used)}
            {task.model ? ` · ${aiModelLabel(task.model)}` : " · fixture"}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Declared file ownership</dt>
          <dd className="break-words font-mono text-muted">{task.file_claims.join(", ") || "no files"}</dd>
        </div>
        <div>
          <dt className="font-semibold">Acceptance checks</dt>
          <dd className="text-muted">{task.acceptance_checks.join(" ")}</dd>
        </div>
      </dl>

      {task.blocker ? (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900" role="status">
          Blocked: {task.blocker}
        </p>
      ) : null}
      {task.error ? <p className="mt-2 text-sm text-danger">{task.error}</p> : null}
      {task.retries > 0 ? (
        <p className="mt-2 text-xs text-muted">
          {task.retries === 1 ? "One reply was rejected and retried" : `${task.retries} replies were rejected`}
          {task.retry_reason ? ` — ${task.retry_reason}` : ""}
        </p>
      ) : null}
      {output ? (
        <div className="mt-3 rounded-lg bg-paper p-3 text-sm">
          <p>{output.summary}</p>
          {output.evidence?.length ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted">
              {output.evidence.map((item) => <li key={item}>{item}</li>)}
            </ul>
          ) : null}
          {output.findings?.length ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted">
              {output.findings.map((item) => <li key={item}>{item}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}
      {task.changed_files.length > 0 ? (
        <p className="mt-2 break-words font-mono text-xs text-muted">
          Branch files: {task.changed_files.join(", ")}
        </p>
      ) : null}

      <TaskReviewForm projectId={projectId} task={task} canReassign={canReassign} />
    </li>
  );
}

export default async function AppTeamPage({ params }: { params: Promise<{ projectId: string }> }) {
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
  const [identity, detail] = await Promise.all([getIdentity(session), getAppTeam(session, projectId)]);
  if (!detail) notFound();

  const { project, run, tasks, integration, events, modelHealth } = detail;
  const tasksByStatus = (status: string) => tasks.filter((task) => task.status === status).length;
  const codeTasks = tasks.filter((task) => ["frontend", "backend", "data"].includes(task.role));
  const codeReady = codeTasks.length > 0 && codeTasks.every((task) => task.status === "completed" || task.status === "cancelled");
  const canIntegrate = Boolean(run) && run!.integration_status === "pending" && codeReady && !tasks.some((task) => task.status === "blocked");
  const changedFiles = [...new Set(tasks.flatMap((task) => task.changed_files))];

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
          <h1 className="text-3xl font-black leading-tight tracking-tight sm:text-4xl">Agent team</h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">
            Optional team mode for {project.name}. One approved specification, a durable task queue,
            scoped roles, logical branches and one controlled integration step. Fixture mode is free;
            model mode maps the six roles to the six Ollama models and reserves credits per task.
            Neither mode has deployment credentials or external actions.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className={chipClass}>Version {project.current_version || "none"}</span>
            {run ? <span className={chipClass}>Run: {run.status}</span> : <span className={chipClass}>Not started</span>}
            {run ? <span className={chipClass}>Mode: {run.mode}</span> : null}
            {run ? <span className={chipClass}>AI credits: {run.credits_spent ?? 0} / {run.credit_budget ?? 0}</span> : null}
            {run ? <span className={chipClass}>Integration: {run.integration_status}</span> : null}
          </div>
        </header>

        {!run ? (
          <>
            <section className={`${cardClass} mt-6`} aria-labelledby="start-team">
              <h2 id="start-team" className="text-lg font-bold">Start a bounded run</h2>
              <p className="mt-1 text-sm text-muted">
                The queue is built only from the approved specification. The coordinator cannot add
                scope, and the run stops at the configured call, runtime and concurrency limits.
              </p>
              <div className="mt-4">
                <StartTeamForm projectId={project.id} />
              </div>
            </section>

            <section className={`${cardClass} mt-6`} aria-labelledby="roles">
              <h2 id="roles" className="text-lg font-bold">Roles and permissions</h2>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-line">
                      <th className="py-2 pr-3 font-semibold">Role</th>
                      <th className="py-2 pr-3 font-semibold">Writes</th>
                      <th className="py-2 pr-3 font-semibold">Model (model mode)</th>
                      <th className="py-2 font-semibold">Tools/capabilities</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(TEAM_ROLES_SPEC).map(([role, definition]) => (
                      <tr key={role} className="border-b border-line align-top">
                        <td className="py-2 pr-3 font-medium">{definition.label}</td>
                        <td className="py-2 pr-3 font-mono text-xs text-muted">
                          {definition.writeRoots.join(", ") || "none"}
                        </td>
                        <td className="py-2 pr-3 text-xs text-muted">
                          {aiModelLabel(TEAM_ROLE_MODELS[role as keyof typeof TEAM_ROLE_MODELS])}
                        </td>
                        <td className="py-2 text-xs text-muted">
                          <p className="font-mono">{definition.tools.join(", ")}</p>
                          <p className="mt-1">{definition.note}</p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-muted">
                No role has a deployment, billing, credential or arbitrary-execution tool. External
                actions are not part of this mode. A security review is issue-finding, not a
                complete audit.
              </p>
            </section>
          </>
        ) : (
          <>
            <section className={`${cardClass} mt-6`} aria-labelledby="controls">
              <h2 id="controls" className="text-lg font-bold">Controls</h2>
              <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
                <p><span className="font-semibold">Agent cap</span><br />{run.max_agents} per advance, {run.active_count} active</p>
                <p><span className="font-semibold">AI calls</span><br />{run.calls_used} / {run.max_calls || "no calls allowed"}</p>
                <p><span className="font-semibold">AI credits</span><br />{run.credits_spent ?? 0} / {run.credit_budget ?? 0} ({run.mode})</p>
                <p><span className="font-semibold">Runtime</span><br />{run.runtime_seconds}s / {run.max_runtime_seconds}s</p>
                <p><span className="font-semibold">Tasks</span><br />{tasksByStatus("completed")} completed, {tasksByStatus("awaiting_review")} awaiting review</p>
              </div>
              <div className="mt-4 flex flex-wrap items-start gap-3">
                {run.status === "running" ? <AdvanceTeamForm projectId={project.id} /> : null}
                <RunControlForms projectId={project.id} status={run.status} />
              </div>
              <div className="mt-4 border-t border-line pt-4">
                <IntegrateTeamForm projectId={project.id} disabled={!canIntegrate} />
                <p className="mt-1 text-xs text-muted">
                  Integration is available only after every code task is completed or rejected and no
                  claim conflict remains. It writes all branches in one step and runs checks.
                </p>
              </div>
              {run.last_error ? (
                <p className="mt-3 rounded-lg border border-red-300 bg-red-50 p-2 text-sm text-danger" role="alert">
                  {run.last_error}
                </p>
              ) : null}
              {tasks.some((task) => task.status === "blocked") ? (
                <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
                  A task is blocked. Open it below to reassign, reject, or resolve its file claim.
                </p>
              ) : null}
            </section>

            <section className={`${cardClass} mt-6`} aria-labelledby="model-health">
              <h2 id="model-health" className="text-lg font-bold">Model health</h2>
              <p className="mt-1 text-sm text-muted">
                Retry and failure counts from the model calls this project actually ran. One row
                counts one finished task: a retry means the first reply broke the schema or the
                role&apos;s permissions and the same model was asked once more, and a failure means
                no usable reply arrived. A rate is not a verdict below {MODEL_HEALTH_MIN_TASKS} tasks.
              </p>
              {modelHealth.length === 0 ? (
                <p className="mt-2 text-sm text-muted">
                  No model-backed task has finished yet, so there is nothing to measure.
                </p>
              ) : (
                <>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-line">
                          <th className="py-2 pr-3 font-semibold">Role</th>
                          <th className="py-2 pr-3 font-semibold">Model</th>
                          <th className="py-2 pr-3 font-semibold">Tasks</th>
                          <th className="py-2 pr-3 font-semibold">Retries</th>
                          <th className="py-2 pr-3 font-semibold">Failures</th>
                          <th className="py-2 pr-3 font-semibold">Retry rate</th>
                          <th className="py-2 font-semibold">Signal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {modelHealth.map((row) => (
                          <tr key={`${row.role}-${row.model}`} className="border-b border-line">
                            <td className="py-2 pr-3 font-medium">{TEAM_ROLE_LABELS[row.role]}</td>
                            <td className="py-2 pr-3 text-xs text-muted">{aiModelLabel(row.model)}</td>
                            <td className="py-2 pr-3 font-mono text-xs">{row.tasks}</td>
                            <td className="py-2 pr-3 font-mono text-xs">{row.retried}</td>
                            <td className="py-2 pr-3 font-mono text-xs">{row.failed}</td>
                            <td className="py-2 pr-3 font-mono text-xs">
                              {Math.round(row.retryRate * 100)}%
                            </td>
                            <td className={`py-2 text-xs font-semibold ${modelHealthTone(row.status)}`}>
                              {MODEL_HEALTH_LABELS[row.status]}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {modelHealth.some((row) => row.lastRetryReason) ? (
                    <ul className="mt-3 space-y-1 text-xs text-muted">
                      {modelHealth
                        .filter((row) => row.lastRetryReason)
                        .map((row) => (
                          <li key={`${row.role}-${row.model}-reason`}>
                            <span className="font-semibold">{TEAM_ROLE_LABELS[row.role]}</span> last
                            retry: {row.lastRetryReason}
                          </li>
                        ))}
                    </ul>
                  ) : null}
                </>
              )}
            </section>

            <section className="mt-8" aria-labelledby="queue">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="queue" className="text-xl font-bold">Work queue</h2>
                <span className="text-xs text-muted">
                  Spec version {run.spec_version} · {tasks.length} tasks · who is working: {" "}
                  {tasks.filter((task) => task.status === "running").map((task) => TEAM_ROLE_LABELS[task.role]).join(", ") || "no one"}
                </span>
              </div>
              <ul className="mt-3 space-y-3">
                {tasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    projectId={project.id}
                    task={task}
                    canReassign={run.status === "running" || run.status === "paused"}
                  />
                ))}
              </ul>
            </section>

            <section className={`${cardClass} mt-8`} aria-labelledby="evidence">
              <h2 id="evidence" className="text-lg font-bold">Integration evidence</h2>
              {!integration ? (
                <p className="mt-1 text-sm text-muted">No integration attempt yet.</p>
              ) : (
                <div className="mt-2 space-y-3 text-sm">
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className={chipClass}>Status: {integration.status}</span>
                    {integration.version ? <span className={chipClass}>App version {integration.version}</span> : null}
                  </div>
                  <p className="text-xs text-muted">
                    Contributors:{" "}
                    {Object.entries(integration.contributors).length === 0
                      ? "none"
                      : Object.entries(integration.contributors).map(([path, roles]) => `${path} (${roles.join(", ")})`).join("; ")}
                  </p>
                  {integration.conflict_files.length > 0 ? (
                    <p className="text-danger">Conflicts: {integration.conflict_files.join(", ")}</p>
                  ) : null}
                  {integration.checks.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead><tr className="border-b border-line"><th className="py-1 pr-3">Check</th><th className="py-1">Result</th></tr></thead>
                        <tbody>
                          {integration.checks.map((check) => (
                            <tr key={check.name} className="border-b border-line">
                              <td className="py-1 pr-3">{check.label}</td>
                              <td className={check.status === "passed" ? "text-mint" : "text-danger"}>{check.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : <p className="text-xs text-muted">No runner checks were recorded.</p>}
                  {integration.error ? <p className="text-xs text-danger">{integration.error}</p> : null}
                  {integration.log ? (
                    <details>
                      <summary className="cursor-pointer text-xs font-semibold">Show integration log</summary>
                      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-paper p-3 font-mono text-xs">{integration.log}</pre>
                    </details>
                  ) : null}
                </div>
              )}
            </section>

            <section className={`${cardClass} mt-6`} aria-labelledby="files">
              <h2 id="files" className="text-lg font-bold">Files changed in branches</h2>
              {changedFiles.length === 0 ? (
                <p className="mt-1 text-sm text-muted">No branch has changed a file yet.</p>
              ) : (
                <ul className="mt-2 space-y-1 font-mono text-xs text-muted">
                  {changedFiles.map((path) => <li key={path}>{path}</li>)}
                </ul>
              )}
            </section>

            <section className={`${cardClass} mt-6`} aria-labelledby="events">
              <h2 id="events" className="text-lg font-bold">Oversight log</h2>
              <ol className="mt-2 space-y-2 text-sm">
                {events.map((item) => (
                  <li key={item.id} className="border-b border-line pb-2 last:border-0">
                    <span className="text-xs text-muted">{item.created_at.slice(0, 19).replace("T", " ")} · {item.actor}</span>
                    <p><span className="font-mono text-xs">{item.kind}</span> — {item.detail}</p>
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}

        <section className={`${cardClass} mt-8`}>
          <h2 className="text-lg font-bold">What this mode does not do</h2>
          <ul className="mt-2 space-y-1 text-sm text-muted">
            <li>No public deployment, production credentials or external actions.</li>
            <li>No recursive spawning, unlimited retries, or permission changes by an agent.</li>
            <li>No claim that a fixture run exercises the models, or that a security review is a complete audit.</li>
            <li>No integration without an explicit owner click and passing sandbox checks.</li>
          </ul>
          <p className="mt-3">
            <Link href={`/build/${project.id}/workspace`} className={secondaryButton}>
              Open the preview workspace
            </Link>
          </p>
        </section>
      </main>
    </div>
  );
}
