import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  DecideRecommendationForm,
  EvaluationBudgetForm,
  ProposeEvaluationChangeForm,
  RefreshProfilesForm,
  ReviewRunForm,
  RunEvaluationForm,
} from "@/components/evaluation-forms";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import { getEvaluationDetail } from "@/lib/data/evaluations";
import {
  EVAL_BUDGET_NOTE,
  EVAL_CATEGORY_LABELS,
  EVAL_NO_SCORE_NOTE,
  EVAL_SPLIT_LABELS,
  summarizeEvaluationRuns,
  type EvaluationRunRecord,
} from "@/lib/evaluations";
import { getIdentity } from "@/lib/identity";
import { cardClass, chipClass, focusRing } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { isUuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Evaluation workspace — GET TO IT" };

const STATUS_LABELS: Record<string, string> = {
  passed: "Passed",
  failed: "Failed",
  errored: "Errored",
  pending: "Review pending",
  accepted: "Accepted",
  rejected: "Rejected",
  follow_up: "Follow-up",
};

function formatCost(run: EvaluationRunRecord): string {
  const known = `$${(run.cost_known_cents / 100).toFixed(2)} known`;
  const estimated = `$${(run.cost_estimated_cents / 100).toFixed(2)} estimated`;
  return `${known} · ${estimated}`;
}

function RunEvidence({
  run,
  workspaceId,
  taskTitle,
  configLabel,
}: {
  run: EvaluationRunRecord;
  workspaceId: string;
  taskTitle: string;
  configLabel: string;
}) {
  return (
    <article className={`${cardClass} mt-3`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="font-semibold">{taskTitle}</h4>
          <p className="text-sm text-muted">
            {configLabel} · trial {run.trial} · {EVAL_SPLIT_LABELS[run.split]} · {EVAL_CATEGORY_LABELS[run.category]}
          </p>
        </div>
        <span className={chipClass}>
          {STATUS_LABELS[run.status] ?? run.status} · {STATUS_LABELS[run.human_review_status] ?? run.human_review_status}
        </span>
      </div>

      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <div>
          <dt className="font-semibold">Configured / returned model</dt>
          <dd className="text-muted">
            {run.model_configured} / {run.model_reported ?? "not returned (fixture makes no provider call)"}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Prompt version</dt>
          <dd className="text-muted">{run.prompt_version}</dd>
        </div>
        <div>
          <dt className="font-semibold">Completion</dt>
          <dd className="text-muted">{run.completion_status.replace("_", " ")}</dd>
        </div>
        <div>
          <dt className="font-semibold">Runtime</dt>
          <dd className="text-muted">{run.runtime_ms} ms</dd>
        </div>
        <div>
          <dt className="font-semibold">Reported token usage</dt>
          <dd className="text-muted">
            {run.tokens_reported.total.toLocaleString()} total — {run.tokens_reported.note}
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Cost</dt>
          <dd className="text-muted">
            {formatCost(run)}. {run.cost_basis}
          </dd>
        </div>
      </dl>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <h5 className="text-sm font-bold">Tool calls</h5>
          <ul className="mt-1 space-y-1 text-xs text-muted">
            {run.tool_calls.map((call) => (
              <li key={`${call.tool}-${call.role ?? "none"}`}>
                <code className="rounded bg-paper px-1 py-0.5">{call.tool}</code>{" "}
                {call.role ? `(${call.role})` : "(no role)"} — {call.status}. {call.detail}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h5 className="text-sm font-bold">Deterministic checks</h5>
          <ul className="mt-1 space-y-1 text-xs text-muted">
            {run.test_results.map((check) => (
              <li key={check.id}>
                <strong className={check.status === "passed" ? "text-mint" : "text-danger"}>
                  {check.status === "passed" ? "PASS" : "FAIL"}
                </strong>{" "}
                {check.label} — {check.evidence}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-line bg-paper/60 p-3">
        <h5 className="text-sm font-bold">AI-judged opinions — not counted in the result</h5>
        {run.ai_judgements.length === 0 ? (
          <p className="mt-1 text-xs text-muted">No AI-judged notes were recorded.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-xs text-muted">
            {run.ai_judgements.map((judgement) => (
              <li key={judgement.id}>
                <strong>{judgement.label}:</strong> {judgement.opinion}
              </li>
            ))}
          </ul>
        )}
      </div>

      {run.error ? <p className="mt-3 text-sm text-danger">Run error: {run.error}</p> : null}

      <ReviewRunForm
        workspaceId={workspaceId}
        runId={run.id}
        status={run.human_review_status}
        note={run.human_review_note}
      />
    </article>
  );
}

export default async function EvaluationPage({
  params,
}: {
  params: Promise<{ evaluationId: string }>;
}) {
  const { evaluationId } = await params;
  if (!isUuid(evaluationId)) notFound();

  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const session = await requireSession();
  const [identity, detail] = await Promise.all([
    getIdentity(session),
    getEvaluationDetail(session, evaluationId),
  ]);
  if (!detail) notFound();

  const { workspace, sourceProjectName, tasks, configurations, budget, runs, profiles, recommendations } = detail;
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const configById = new Map(configurations.map((config) => [config.id, config]));
  const matrix = summarizeEvaluationRuns(tasks, configurations, runs);
  const failedRuns = [...runs]
    .reverse()
    .filter((run) => run.status !== "passed" || run.human_review_status !== "pending");
  const latestProfiles = [
    ...new Map(
      profiles.map((profile) => [`${profile.config_id}:${profile.profile_key}`, profile]),
    ).values(),
  ];
  const remainingBudget = budget ? Math.max(0, budget.approved_runs - budget.used_runs) : 0;

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-5xl px-5 pb-16 pt-6">
        <Link
          href="/evaluations"
          className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          ← All evaluations
        </Link>

        <header className="mt-4">
          <h1 className="text-3xl font-black leading-tight tracking-tight sm:text-4xl">
            {workspace.name}
          </h1>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className={chipClass}>
              {workspace.source_kind === "synthetic"
                ? "Synthetic fixture"
                : `Approved project snapshot${sourceProjectName ? `: ${sourceProjectName}` : ""}`}
            </span>
            <span className={chipClass}>Snapshot version {workspace.source_version}</span>
            <span className={chipClass}>{tasks.length} bounded tasks</span>
            <span className={chipClass}>{configurations.length} configurations</span>
            <span className={chipClass}>{runs.length} preserved runs</span>
          </div>
          {workspace.description ? (
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">{workspace.description}</p>
          ) : null}
          <p className="mt-3 max-w-3xl text-xs leading-relaxed text-muted">
            The input snapshot is task context. Phase 32 candidates are deterministic
            fixture outputs, so no provider or model reads it. {EVAL_NO_SCORE_NOTE}
          </p>
        </header>

        <section aria-labelledby="budget-heading" className={`${cardClass} mt-6`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 id="budget-heading" className="text-lg font-bold">Run budget</h2>
              <p className="mt-1 text-sm text-muted">
                {budget
                  ? `${budget.used_runs} of ${budget.approved_runs} approved trials used · ${budget.status}. ${remainingBudget} remain.`
                  : "No budget has been approved. Runs are blocked."}
              </p>
            </div>
            <span className={chipClass}>{budget ? STATUS_LABELS[budget.status] ?? budget.status : "Blocked"}</span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted">{EVAL_BUDGET_NOTE}</p>
          <div className="mt-3">
            <EvaluationBudgetForm workspaceId={workspace.id} />
          </div>
        </section>

        <section aria-labelledby="run-heading" className={`${cardClass} mt-6`}>
          <h2 id="run-heading" className="text-lg font-bold">Run the same bounded comparison</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Every active configuration runs every task for the selected number of
            trials. The full comparison is checked against the remaining budget
            before any evidence is written.
          </p>
          <div className="mt-3">
            <RunEvaluationForm workspaceId={workspace.id} />
          </div>
        </section>

        <section aria-labelledby="matrix-heading" className="mt-10">
          <h2 id="matrix-heading" className="text-xl font-bold">Configuration comparison</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Counts include repeated trials. A blank cell means that configuration has
            no evidence for that task yet. Failed and errored trials remain visible.
          </p>
          {matrix.length === 0 ? (
            <div className={`${cardClass} mt-3`}>
              <p className="font-medium">No runs yet.</p>
              <p className="mt-1 text-sm text-muted">Approve a budget, then run the comparison.</p>
            </div>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-card">
              <table className="w-full min-w-[44rem] border-collapse text-sm">
                <caption className="sr-only">
                  Deterministic pass, fail and error counts by task and configuration.
                </caption>
                <thead className="bg-paper text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th scope="col" className="px-3 py-2">Task</th>
                    <th scope="col" className="px-3 py-2">Split</th>
                    <th scope="col" className="px-3 py-2">Configuration</th>
                    <th scope="col" className="px-3 py-2">Trials</th>
                    <th scope="col" className="px-3 py-2">Passed</th>
                    <th scope="col" className="px-3 py-2">Failed</th>
                    <th scope="col" className="px-3 py-2">Errored</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.map((row) => (
                    <tr
                      key={`${row.task_id}:${row.config_id}`}
                      className="border-t border-line align-top"
                    >
                      <th scope="row" className="px-3 py-2 text-left font-medium">{row.task_title}</th>
                      <td className="px-3 py-2 text-muted">{EVAL_SPLIT_LABELS[row.split]}</td>
                      <td className="px-3 py-2 text-muted">{row.config_label}</td>
                      <td className="px-3 py-2">{row.trials}</td>
                      <td className="px-3 py-2">{row.passed}</td>
                      <td className="px-3 py-2">{row.failed}</td>
                      <td className="px-3 py-2">{row.errored}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="failures-heading" className="mt-10">
          <h2 id="failures-heading" className="text-xl font-bold">Inspect failures and reviews</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Failed trials and runs with a human decision are shown newest first. A
            review annotates evidence; it never rewrites a check result.
          </p>
          {failedRuns.length === 0 ? (
            <div className={`${cardClass} mt-3`}>
              <p className="text-sm text-muted">
                No failed trials or reviewed runs to inspect yet. Every run stays in
                the record even when it passes.
              </p>
            </div>
          ) : (
            failedRuns.slice(0, 60).map((run) => (
              <RunEvidence
                key={run.id}
                run={run}
                workspaceId={workspace.id}
                taskTitle={taskById.get(run.task_id)?.title ?? "Unknown task"}
                configLabel={configById.get(run.config_id)?.label ?? "Unknown configuration"}
              />
            ))
          )}
          {failedRuns.length > 60 ? (
            <p className="mt-2 text-xs text-muted">
              Showing the 60 newest of {failedRuns.length} runs. The rest remain
              recorded in the workspace.
            </p>
          ) : null}
        </section>

        <section aria-labelledby="tasks-heading" className="mt-10">
          <h2 id="tasks-heading" className="text-xl font-bold">Bounded tasks</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Development examples and held-out tests are stored separately. Acceptance
            material is immutable after the first run.
          </p>
          {(["development", "held_out"] as const).map((split) => {
            const splitTasks = tasks.filter((task) => task.split === split);
            return (
              <div key={split} className="mt-4">
                <h3 className="text-sm font-bold uppercase tracking-wide text-muted">
                  {EVAL_SPLIT_LABELS[split]} ({splitTasks.length})
                </h3>
                {splitTasks.length === 0 ? (
                  <p className="mt-1 text-sm text-muted">None in this split.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {splitTasks.map((task) => (
                      <li key={task.id} className={cardClass}>
                        <details>
                          <summary className="cursor-pointer text-sm font-semibold">
                            {task.title}{" "}
                            <span className="font-normal text-muted">
                              — {EVAL_CATEGORY_LABELS[task.category]}
                            </span>
                          </summary>
                          <div className="mt-3 space-y-2 text-xs leading-relaxed text-muted">
                            <p><strong className="text-ink">Expected output:</strong> {task.expected_output}</p>
                            <p>
                              <strong className="text-ink">Allowed tools:</strong>{" "}
                              {task.allowed_tools.join(", ") || "none"}
                            </p>
                            <p>
                              <strong className="text-ink">Limits:</strong>{" "}
                              {task.runtime_seconds}s runtime, {task.request_limit} requests
                            </p>
                            <div>
                              <strong className="text-ink">Acceptance checks:</strong>
                              <ul className="mt-1 list-disc space-y-1 pl-5">
                                {task.acceptance_checks.map((check) => (
                                  <li key={check.id}>
                                    {check.label} — {check.description}
                                  </li>
                                ))}
                              </ul>
                            </div>
                            <p>
                              <strong className="text-ink">Snapshot:</strong>{" "}
                              {task.input_snapshot.length} file(s), version {task.snapshot_version}:{" "}
                              {task.input_snapshot.map((file) => file.path).join(", ")}
                            </p>
                          </div>
                        </details>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </section>

        <section aria-labelledby="configs-heading" className="mt-10">
          <h2 id="configs-heading" className="text-xl font-bold">Configurations under test</h2>
          <ul className="mt-3 space-y-3">
            {configurations.map((config) => (
              <li key={config.id} className={cardClass}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">{config.label}</h3>
                  <span className={chipClass}>v{config.version} · {config.mode} · {config.status}</span>
                </div>
                <dl className="mt-2 grid gap-2 text-xs text-muted sm:grid-cols-2">
                  <div>
                    <dt className="font-semibold text-ink">Model / prompt</dt>
                    <dd>{config.model_identifier} / {config.prompt_version}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-ink">Roles</dt>
                    <dd>{config.agent_roles.join(", ")}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-ink">Routing</dt>
                    <dd><code>{JSON.stringify(config.routing)}</code></dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-ink">Tools and limits</dt>
                    <dd>
                      {config.allowed_tools.join(", ")} · {config.runtime_seconds}s ·{" "}
                      {config.request_limit} requests
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="profiles-heading" className="mt-10">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 id="profiles-heading" className="text-xl font-bold">Capability registry</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                Versioned profiles cite evidence run IDs and limitations. No universal
                intelligence score is produced.
              </p>
            </div>
            <RefreshProfilesForm workspaceId={workspace.id} />
          </div>
          {latestProfiles.length === 0 ? (
            <div className={`${cardClass} mt-3`}>
              <p className="text-sm text-muted">
                No profiles yet. Run evidence, then refresh the registry.
              </p>
            </div>
          ) : (
            <ul className="mt-3 space-y-3">
              {latestProfiles.map((profile) => (
                <li key={profile.id} className={cardClass}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold">{profile.label}</h3>
                    <span className={chipClass}>v{profile.version} · {profile.status}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted">{profile.summary}</p>
                  {profile.suitable_for.length > 0 ? (
                    <p className="mt-2 text-xs text-muted">
                      <strong className="text-ink">Suitable for:</strong>{" "}
                      {profile.suitable_for.join("; ")}
                    </p>
                  ) : null}
                  {profile.requires_review.length > 0 ? (
                    <p className="mt-1 text-xs text-muted">
                      <strong className="text-ink">Requires review:</strong>{" "}
                      {profile.requires_review.join("; ")}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-muted">
                    <strong className="text-ink">Limitations:</strong>{" "}
                    {profile.limitations.join("; ")}
                  </p>
                  <p className="mt-1 break-all text-xs text-muted">
                    <strong className="text-ink">Evidence runs:</strong>{" "}
                    {profile.evidence_run_ids.length > 0
                      ? profile.evidence_run_ids.join(", ")
                      : "none"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="recommendations-heading" className="mt-10">
          <h2 id="recommendations-heading" className="text-xl font-bold">
            Approval-gated configuration change
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">
            A recommendation compares configurations on shared tasks only. It records
            a rollback snapshot. Approval records your decision; it does not change
            production routing, roles or prompts.
          </p>
          <div className={`${cardClass} mt-3`}>
            <ProposeEvaluationChangeForm workspaceId={workspace.id} />
          </div>

          {recommendations.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No recommendations proposed yet.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {recommendations.map((recommendation) => (
                <li key={recommendation.id} className={cardClass}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold">{recommendation.title}</h3>
                    <span className={chipClass}>{recommendation.status}</span>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{recommendation.rationale}</p>
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wide text-muted">Proposed diff</h4>
                      <pre className="mt-1 overflow-x-auto rounded-xl bg-paper p-3 text-xs text-muted">
                        {JSON.stringify(recommendation.config_diff, null, 2)}
                      </pre>
                    </div>
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wide text-muted">Rollback snapshot</h4>
                      <pre className="mt-1 overflow-x-auto rounded-xl bg-paper p-3 text-xs text-muted">
                        {JSON.stringify(recommendation.rollback, null, 2)}
                      </pre>
                    </div>
                  </div>
                  <p className="mt-2 break-all text-xs text-muted">
                    Evidence runs: {recommendation.evidence_run_ids.join(", ") || "none"}
                  </p>
                  {recommendation.status === "proposed" ? (
                    <DecideRecommendationForm
                      workspaceId={workspace.id}
                      recommendationId={recommendation.id}
                    />
                  ) : (
                    <p className="mt-3 text-xs text-muted">
                      Decision recorded {recommendation.approved_at ? recommendation.approved_at.slice(0, 10) : "without approval"}. No production configuration was changed.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
