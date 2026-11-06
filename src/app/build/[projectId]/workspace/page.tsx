import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import {
  PreviewForm,
  RepairWorkspaceForm,
  RunChecksForm,
  StartWorkspaceForm,
  StopWorkspaceForm,
} from "@/components/preview-workspace-forms";
import { requireSession } from "@/lib/auth";
import { BUILD_MAX_CREDITS, BUILD_REPAIR_CREDITS } from "@/lib/credits/pricing";
import { getAppProjectDetail } from "@/lib/data/app-projects";
import { getAppWorkspace } from "@/lib/data/app-workspaces";
import { getIdentity } from "@/lib/identity";
import { getPreviewConfig, PREVIEW_LIMITS } from "@/lib/preview-workspace";
import { cardClass, chipClass, focusRing, secondaryButton } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { isUuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Preview workspace — GET TO IT" };

const STATUS_LABELS: Record<string, string> = {
  stopped: "Stopped",
  checking: "Checking",
  checks_passed: "Checks passed",
  checks_failed: "Checks failed",
  preview: "Preview running",
  failed: "Failed",
  canceled: "Canceled",
  expired: "Expired",
};

export default async function WorkspacePage({
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
  const [identity, detail, workspaceDetail] = await Promise.all([
    getIdentity(session),
    getAppProjectDetail(session, projectId),
    getAppWorkspace(session, projectId),
  ]);

  if (!detail) notFound();

  const { project, files } = detail;
  const { workspace, runs } = workspaceDetail;
  const configured = Boolean(getPreviewConfig());
  const latestChecks = runs.find((run) => run.kind === "checks") ?? null;
  const latestRepair = runs.find((run) => run.kind === "repair") ?? null;
  const failed = latestChecks?.status === "failed" || latestChecks?.status === "timed_out";
  const canStart = files.length > 0 && configured;
  const canRepair =
    Boolean(workspace?.runner_key) &&
    failed &&
    (workspace?.iterations ?? 0) < PREVIEW_LIMITS.maxRepairIterations &&
    (workspace?.credits_spent ?? 0) + BUILD_REPAIR_CREDITS <= (workspace?.credit_budget ?? BUILD_MAX_CREDITS);

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-4xl px-5 pb-16 pt-6">
        <Link
          href={`/build/${project.id}`}
          className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          ← Back to {project.name}
        </Link>

        <header className="mt-4">
          <h1 className="text-3xl font-black leading-tight tracking-tight sm:text-4xl">
            Isolated preview
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            Project code runs in a separate sandbox process, never in this app. It gets its own
            filesystem, no platform credentials, no host filesystem, no external network route and
            a wall-clock limit. A failure is shown, not hidden.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
            <span className={chipClass}>{files.length} stored files</span>
            <span className={chipClass}>
              {workspace ? STATUS_LABELS[workspace.status] ?? workspace.status : "Not started"}
            </span>
            {workspace ? (
              <>
                <span className={chipClass}>
                  {workspace.iterations}/{PREVIEW_LIMITS.maxRepairIterations} repairs
                </span>
                <span className={chipClass}>
                  {workspace.credits_spent ?? 0}/{workspace.credit_budget ?? BUILD_MAX_CREDITS} AI credits
                </span>
              </>
            ) : null}
            <span className={chipClass}>No public deployment</span>
          </div>
        </header>

        {!configured ? (
          <section className={`${cardClass} mt-5 border-danger/40`}>
            <h2 className="text-lg font-bold">The runner is not configured</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              Set <code>PREVIEW_RUNNER_URL</code>, <code>PREVIEW_RUNNER_TOKEN</code>,{" "}
              <code>PREVIEW_SIGNING_SECRET</code> and <code>PREVIEW_PUBLIC_ORIGIN</code> on the app,
              and matching runner values on a Linux host that supports unprivileged namespaces.
              Nothing is executed until then, and the app does not pretend a preview exists.
            </p>
          </section>
        ) : null}

        <section aria-labelledby="controls-heading" className={`${cardClass} mt-6`}>
          <h2 id="controls-heading" className="text-lg font-bold">Controls</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Limits: {PREVIEW_LIMITS.maxRepairIterations} repair iterations ({" "}
            {BUILD_REPAIR_CREDITS} credits each), {PREVIEW_LIMITS.maxAiRequests} AI requests,{" "}
            {BUILD_MAX_CREDITS} credits per workspace, {Math.round(PREVIEW_LIMITS.maxRuntimeMs / 60_000)} minutes,
            and {PREVIEW_LIMITS.maxLogChars.toLocaleString()} characters of log per run.
          </p>

          <div className="mt-4 flex flex-wrap items-start gap-x-6 gap-y-5">
            <StartWorkspaceForm projectId={project.id} />
            {workspace ? (
              <>
                <RunChecksForm projectId={project.id} />
                <PreviewForm projectId={project.id} />
                <RepairWorkspaceForm projectId={project.id} disabled={!canRepair} />
                <StopWorkspaceForm projectId={project.id} />
              </>
            ) : null}
          </div>

          {!canStart && configured && files.length === 0 ? (
            <p className="mt-3 text-sm text-muted">Generate project files before starting a workspace.</p>
          ) : null}
          {workspace && !failed ? (
            <p className="mt-3 text-sm text-muted">
              Repair is available only after a failed check, and never changes tests or configuration.
            </p>
          ) : null}
        </section>

        {latestChecks ? (
          <section aria-labelledby="checks-heading" className="mt-8">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="checks-heading" className="text-xl font-bold">Latest checks</h2>
              <span className={chipClass}>
                {latestChecks.status} · {latestChecks.created_at.slice(0, 19).replace("T", " ")}
              </span>
            </div>
            <div className={`${cardClass} mt-3 overflow-x-auto`}>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                    <th className="pb-2 pr-4">Check</th>
                    <th className="pb-2 pr-4">Result</th>
                    <th className="pb-2">Exit</th>
                  </tr>
                </thead>
                <tbody>
                  {latestChecks.checks.map((check) => (
                    <tr key={check.name} className="border-b border-line/60 last:border-0">
                      <td className="py-2 pr-4 font-medium">{check.label}</td>
                      <td className="py-2 pr-4">
                        <span
                          className={
                            check.status === "passed"
                              ? "text-mint"
                              : check.status === "skipped"
                                ? "text-muted"
                                : "text-danger"
                          }
                        >
                          {check.status === "skipped" ? "not configured" : check.status}
                        </span>
                      </td>
                      <td className="py-2 font-mono text-xs text-muted">{check.code ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={`${cardClass} mt-3`}>
              <h3 className="text-sm font-bold">Log</h3>
              <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-paper p-3 font-mono text-xs text-ink">
                {latestChecks.log || "No log was recorded."}
              </pre>
            </div>
          </section>
        ) : null}

        {latestRepair && latestRepair.changed_files.length > 0 ? (
          <section aria-labelledby="repair-heading" className="mt-8">
            <h2 id="repair-heading" className="text-xl font-bold">Last repair</h2>
            <p className="mt-1 text-sm text-muted">
              Iteration {latestRepair.iteration} · {latestRepair.status} ·{" "}
              {latestRepair.ai_requests} AI request
            </p>
            <div className={`${cardClass} mt-3`}>
              <h3 className="text-sm font-bold">Changed files</h3>
              <ul className="mt-1 space-y-1 font-mono text-xs text-muted">
                {latestRepair.changed_files.map((path) => (
                  <li key={path}>{path}</li>
                ))}
              </ul>
              <h3 className="mt-4 text-sm font-bold">Diff</h3>
              <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-paper p-3 font-mono text-xs text-ink">
                {latestRepair.diff || "No diff was recorded."}
              </pre>
              <p className="mt-2 text-xs text-muted">
                The repair was saved as a new snapshot. Restore an earlier version from the project
                page to undo it.
              </p>
            </div>
          </section>
        ) : null}

        <section aria-labelledby="history-heading" className="mt-8">
          <h2 id="history-heading" className="text-xl font-bold">History</h2>
          {runs.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No runs yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {runs.map((run) => (
                <li key={run.id} className={`${cardClass} text-sm`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold capitalize">
                      {run.kind} {run.iteration > 0 ? `· iteration ${run.iteration}` : ""}
                    </span>
                    <span className={chipClass}>{run.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {run.created_at.slice(0, 19).replace("T", " ")}
                    {run.changed_files.length > 0 ? ` · ${run.changed_files.join(", ")}` : ""}
                  </p>
                  {run.error ? <p className="mt-1 text-xs text-danger">{run.error}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href={`/build/${project.id}`} className={secondaryButton}>
            Back to project files
          </Link>
          <a href={`/build/${project.id}/download`} className={secondaryButton}>
            Download current project
          </a>
        </div>
      </main>
    </div>
  );
}
