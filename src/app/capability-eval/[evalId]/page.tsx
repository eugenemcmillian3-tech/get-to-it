import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  HumanBaselineForm,
  PrepareLiveTrialForm,
  RunCapabilityEvalForm,
  RunLiveTrialForm,
} from "@/components/capability-eval-forms";
import { isAiModel } from "@/lib/ai/models";
import { AUTHORED_TASK_MODE } from "@/lib/capability-eval-live";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import { getCapabilityEvalDetail } from "@/lib/data/capability-eval";
import {
  CAPABILITY_BASELINE_LABELS,
  CAPABILITY_CONTAMINATION_NOTE,
  CAPABILITY_HUMAN_NOTE,
  CAPABILITY_NO_SCORE_NOTE,
  CAPABILITY_OUTCOME_LABELS,
  CAPABILITY_PERMISSION_NOTE,
  CAPABILITY_SPLIT_LABELS,
  capabilityMatrix,
  compareCapabilityVersions,
  compareHumanBaselines,
  contaminationReport,
  permissionStatement,
  summarizeCapabilityByDifficulty,
  summarizeCapabilityByDomain,
} from "@/lib/capability-eval";
import { getIdentity } from "@/lib/identity";
import { cardClass, chipClass, focusRing } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { isUuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Capability evaluation — GET TO IT" };

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export default async function CapabilityEvalPage({
  params,
}: {
  params: Promise<{ evalId: string }>;
}) {
  const { evalId } = await params;
  if (!isUuid(evalId)) notFound();

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
    getCapabilityEvalDetail(session, evalId),
  ]);
  if (!detail) notFound();

  const { evaluation, versions, tasks, runs, humanBaselines, linkedExperimentName } = detail;
  const byDomain = summarizeCapabilityByDomain(runs);
  const byDifficulty = summarizeCapabilityByDifficulty(runs);
  const comparison = compareCapabilityVersions(runs, versions);
  const contamination = contaminationReport(runs);
  const human = compareHumanBaselines(humanBaselines);
  const matrix = capabilityMatrix(tasks, versions, runs);
  const failures = runs.filter((run) => run.outcome !== "verified_success").slice(-12).reverse();
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const versionById = new Map(versions.map((version) => [version.id, version]));
  const heldOutTasks = tasks.filter((task) => task.split === "held_out").length;
  const authoredTasks = tasks
    .filter((task) => task.task_spec?.mode === AUTHORED_TASK_MODE)
    .map((task) => ({ id: task.id, title: task.title }));
  const liveVersions = versions
    .filter((version) => isAiModel(version.model_version))
    .map((version) => ({ id: version.id, label: version.label }));
  const authoredTaskIds = new Set(authoredTasks.map((task) => task.id));
  const liveTrials = runs
    .filter((run) => authoredTaskIds.has(run.task_id))
    .slice(-5)
    .reverse();

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-6xl px-5 pb-16 pt-6">
        <Link
          href="/capability-eval"
          className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          ← All capability evaluations
        </Link>

        <header className="mt-4">
          <h1 className="text-3xl font-black leading-tight tracking-tight sm:text-4xl">
            {evaluation.name}
          </h1>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className={chipClass}>dataset {evaluation.dataset_version}</span>
            <span className={chipClass}>{tasks.length} tasks</span>
            <span className={chipClass}>{heldOutTasks} held-out tasks</span>
            <span className={chipClass}>{runs.length} trials</span>
            <span className={chipClass}>{versions.length} versioned configurations</span>
            {linkedExperimentName ? (
              <span className={chipClass}>experiment: {linkedExperimentName}</span>
            ) : null}
          </div>
          {evaluation.description ? (
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">
              {evaluation.description}
            </p>
          ) : null}
          <p className="mt-3 max-w-3xl text-xs leading-relaxed text-muted">
            {CAPABILITY_NO_SCORE_NOTE}
          </p>
        </header>

        <section aria-labelledby="versions-heading" className={`${cardClass} mt-6`}>
          <h2 id="versions-heading" className="text-lg font-bold">
            Versions under comparison
          </h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[52rem] border-collapse text-sm">
              <caption className="sr-only">
                Versioned configuration record: model, orchestration and prompt versions,
                dataset, limits, human assistance and autonomy permission.
              </caption>
              <thead className="bg-paper text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2">Configuration</th>
                  <th scope="col" className="px-3 py-2">Kind</th>
                  <th scope="col" className="px-3 py-2">Model / orchestration / prompt</th>
                  <th scope="col" className="px-3 py-2">Tools</th>
                  <th scope="col" className="px-3 py-2">Limits</th>
                  <th scope="col" className="px-3 py-2">Human help</th>
                  <th scope="col" className="px-3 py-2">Permission</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((version) => {
                  const permission = permissionStatement(version);
                  return (
                    <tr key={version.id} className="border-t border-line align-top">
                      <th scope="row" className="px-3 py-2 text-left font-medium">
                        {version.label} · v{version.version}
                      </th>
                      <td className="px-3 py-2 text-muted">
                        {CAPABILITY_BASELINE_LABELS[version.baseline_kind]}
                      </td>
                      <td className="px-3 py-2 text-muted">
                        {version.model_version} / {version.orchestration_version} /{" "}
                        {version.prompt_version}
                      </td>
                      <td className="px-3 py-2 text-muted">
                        {version.permitted_tools.join(", ")}
                      </td>
                      <td className="px-3 py-2 text-muted">
                        {version.runtime_limit_seconds}s · $
                        {(version.spend_limit_cents / 100).toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-muted">{version.human_assistance}</td>
                      <td className="px-3 py-2 text-muted">
                        {permission.label}
                        <span className="block text-xs">{permission.note}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted">{CAPABILITY_PERMISSION_NOTE}</p>
        </section>

        <section aria-labelledby="run-heading" className={`${cardClass} mt-6`}>
          <h2 id="run-heading" className="text-lg font-bold">Run the comparison</h2>
          <div className="mt-3">
            <RunCapabilityEvalForm evalId={evaluation.id} />
          </div>
        </section>

        <section aria-labelledby="comparison-heading" className="mt-10">
          <h2 id="comparison-heading" className="text-xl font-bold">
            Baseline versus orchestrated system
          </h2>
          {comparison.comparable && comparison.baseline && comparison.orchestrated ? (
            <>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                {comparison.trials_per_version} shared task(s) with equal trials on both
                sides. Rates count verified and partial success separately.
              </p>
              <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-card">
                <table className="w-full min-w-[46rem] border-collapse text-sm">
                  <thead className="bg-paper text-left text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th scope="col" className="px-3 py-2">Configuration</th>
                      <th scope="col" className="px-3 py-2">Trials</th>
                      <th scope="col" className="px-3 py-2">Verified</th>
                      <th scope="col" className="px-3 py-2">Partial</th>
                      <th scope="col" className="px-3 py-2">Failed / errored</th>
                      <th scope="col" className="px-3 py-2">Latency</th>
                      <th scope="col" className="px-3 py-2">Cost</th>
                      <th scope="col" className="px-3 py-2">Variability</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[comparison.baseline, comparison.orchestrated].map((side) => (
                      <tr key={side.domain_label} className="border-t border-line align-top">
                        <th scope="row" className="px-3 py-2 text-left font-medium">
                          {side.domain_label}
                        </th>
                        <td className="px-3 py-2">{side.trials}</td>
                        <td className="px-3 py-2">{percent(side.verified_rate)}</td>
                        <td className="px-3 py-2">{percent(side.partial_rate)}</td>
                        <td className="px-3 py-2">{side.failed + side.errored}</td>
                        <td className="px-3 py-2">{side.average_latency_ms} ms</td>
                        <td className="px-3 py-2">${(side.average_cost_cents / 100).toFixed(2)}</td>
                        <td className="px-3 py-2">{side.variability.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-sm text-muted">
                Verified-rate difference:{" "}
                {comparison.verified_rate_delta === null
                  ? "not computed"
                  : `${(comparison.verified_rate_delta * 100).toFixed(1)} points`}
                . Latency difference: {comparison.latency_delta_ms} ms. This is evidence
                for these tasks only, not a general claim.
              </p>
            </>
          ) : (
            <div className={`${cardClass} mt-3`}>
              <p className="font-medium">Not comparable yet.</p>
              <p className="mt-1 text-sm text-muted">{comparison.reason}</p>
            </div>
          )}
        </section>

        <section aria-labelledby="domain-heading" className="mt-10">
          <h2 id="domain-heading" className="text-xl font-bold">Performance by domain</h2>
          <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-card">
            <table className="w-full min-w-[62rem] border-collapse text-sm">
              <caption className="sr-only">
                Trials, outcomes, unsupported claims, permission violations, human
                interventions, recovery, cost, latency, variability and contamination by
                capability domain.
              </caption>
              <thead className="bg-paper text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2">Domain</th>
                  <th scope="col" className="px-3 py-2">Trials</th>
                  <th scope="col" className="px-3 py-2">Verified</th>
                  <th scope="col" className="px-3 py-2">Partial</th>
                  <th scope="col" className="px-3 py-2">Failed</th>
                  <th scope="col" className="px-3 py-2">Errored</th>
                  <th scope="col" className="px-3 py-2">Unsupported</th>
                  <th scope="col" className="px-3 py-2">Permission</th>
                  <th scope="col" className="px-3 py-2">Interventions</th>
                  <th scope="col" className="px-3 py-2">Recovery</th>
                  <th scope="col" className="px-3 py-2">Latency</th>
                  <th scope="col" className="px-3 py-2">Variability</th>
                  <th scope="col" className="px-3 py-2">Contaminated</th>
                </tr>
              </thead>
              <tbody>
                {byDomain.map((row) => (
                  <tr key={row.domain} className="border-t border-line align-top">
                    <th scope="row" className="px-3 py-2 text-left font-medium">
                      {row.domain_label}
                    </th>
                    <td className="px-3 py-2">{row.trials}</td>
                    <td className="px-3 py-2">{row.verified}</td>
                    <td className="px-3 py-2">{row.partial}</td>
                    <td className="px-3 py-2">{row.failed}</td>
                    <td className="px-3 py-2">{row.errored}</td>
                    <td className="px-3 py-2">{row.unsupported_claims}</td>
                    <td className="px-3 py-2">{row.permission_violations}</td>
                    <td className="px-3 py-2">{row.human_interventions}</td>
                    <td className="px-3 py-2">
                      {row.recovery_success_rate === null
                        ? "n/a"
                        : percent(row.recovery_success_rate)}
                    </td>
                    <td className="px-3 py-2">{row.average_latency_ms} ms</td>
                    <td className="px-3 py-2">{row.variability.toFixed(2)}</td>
                    <td className="px-3 py-2">{row.contaminated_trials}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {runs.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              No trials yet. Run the comparison to record evidence by domain.
            </p>
          ) : null}
        </section>

        <section aria-labelledby="difficulty-heading" className="mt-10">
          <h2 id="difficulty-heading" className="text-xl font-bold">Performance by difficulty</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {byDifficulty.map((row) => (
              <div key={row.difficulty} className={cardClass}>
                <h3 className="font-bold">{row.difficulty}</h3>
                <p className="mt-1 text-sm text-muted">
                  {row.trials} trial(s) · {percent(row.verified_rate)} verified ·{" "}
                  {percent(row.partial_rate)} verified or partial
                </p>
                <p className="mt-1 text-xs text-muted">
                  {row.failed + row.errored} failed · {row.unsupported_claims} unsupported
                  claim(s) · variability {row.variability.toFixed(2)}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="contamination-heading" className={`${cardClass} mt-10`}>
          <h2 id="contamination-heading" className="text-lg font-bold">
            Contamination and repeated exposure
          </h2>
          <p className="mt-1 text-sm text-muted">
            {contamination.contaminated_runs.length} contaminated trial(s);{" "}
            {contamination.clean_held_out_trials} clean held-out trial(s);{" "}
            {contamination.exposed_held_out_tasks.length} held-out task(s) exposed more than
            once to the same configuration.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            {CAPABILITY_CONTAMINATION_NOTE}
          </p>
        </section>

        <section aria-labelledby="human-heading" className={`${cardClass} mt-6`}>
          <h2 id="human-heading" className="text-lg font-bold">Human baseline</h2>
          {human.available ? (
            <ul className="mt-2 space-y-2 text-sm text-muted">
              {human.baselines.map((baseline) => (
                <li key={baseline.id}>
                  <strong>{baseline.domain}</strong> — {baseline.sample_size} participant(s),
                  collected by {baseline.collected_by}. Protocol: {baseline.protocol_document}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">{human.reason}</p>
          )}
          <p className="mt-2 text-xs leading-relaxed text-muted">{CAPABILITY_HUMAN_NOTE}</p>
          <HumanBaselineForm evalId={evaluation.id} />
        </section>

        <section aria-labelledby="live-heading" className={`${cardClass} mt-6`}>
          <h2 id="live-heading" className="text-lg font-bold">
            Machine-checkable live trial
          </h2>
          <p className="mt-1 text-sm text-muted">
            The seeded tasks are graded by naming elements that appear in their own
            prompt, so a model could pass them by repeating the prompt. A live trial
            uses a task whose expected answer is stored only in the answer key, and
            that answer is computed rather than quoted.
          </p>
          {authoredTasks.length === 0 || liveVersions.length === 0 ? (
            <PrepareLiveTrialForm evalId={evaluation.id} />
          ) : (
            <RunLiveTrialForm
              evalId={evaluation.id}
              tasks={authoredTasks}
              versions={liveVersions}
            />
          )}
          {liveTrials.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No live trial has been recorded yet.</p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-card">
              <table className="w-full min-w-[40rem] border-collapse text-sm">
                <thead className="bg-paper text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th scope="col" className="px-3 py-2">Task</th>
                    <th scope="col" className="px-3 py-2">Trial</th>
                    <th scope="col" className="px-3 py-2">Answer</th>
                    <th scope="col" className="px-3 py-2">Outcome</th>
                    <th scope="col" className="px-3 py-2">Cost</th>
                    <th scope="col" className="px-3 py-2">Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {liveTrials.map((run) => (
                    <tr key={run.id} className="border-t border-line">
                      <th scope="row" className="px-3 py-2 text-left font-medium">
                        {taskById.get(run.task_id)?.title ?? "Unknown task"}
                      </th>
                      <td className="px-3 py-2 text-muted">{run.trial}</td>
                      <td className="px-3 py-2">
                        {typeof run.submission?.answer === "number" ||
                        typeof run.submission?.answer === "string"
                          ? String(run.submission.answer)
                          : "not kept"}
                      </td>
                      <td className="px-3 py-2 text-muted">
                        {CAPABILITY_OUTCOME_LABELS[run.outcome]}
                      </td>
                      <td className="px-3 py-2 text-muted">{run.cost_cents} cents</td>
                      <td className="px-3 py-2 text-muted">{run.latency_ms} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="matrix-heading" className="mt-10">
          <h2 id="matrix-heading" className="text-xl font-bold">Task-by-task evidence</h2>
          {matrix.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No task has evidence yet.</p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-card">
              <table className="w-full min-w-[48rem] border-collapse text-sm">
                <thead className="bg-paper text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th scope="col" className="px-3 py-2">Task</th>
                    <th scope="col" className="px-3 py-2">Split</th>
                    <th scope="col" className="px-3 py-2">Difficulty</th>
                    <th scope="col" className="px-3 py-2">Configuration</th>
                    <th scope="col" className="px-3 py-2">Trials</th>
                    <th scope="col" className="px-3 py-2">Verified</th>
                    <th scope="col" className="px-3 py-2">Partial</th>
                    <th scope="col" className="px-3 py-2">Failed</th>
                    <th scope="col" className="px-3 py-2">Contaminated</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.map((row) => (
                    <tr key={`${row.task_id}:${row.version_id}`} className="border-t border-line align-top">
                      <th scope="row" className="px-3 py-2 text-left font-medium">
                        {row.task_title}
                      </th>
                      <td className="px-3 py-2 text-muted">
                        {CAPABILITY_SPLIT_LABELS[row.split]}
                      </td>
                      <td className="px-3 py-2 text-muted">{row.difficulty}</td>
                      <td className="px-3 py-2 text-muted">{row.version_label}</td>
                      <td className="px-3 py-2">{row.trials}</td>
                      <td className="px-3 py-2">{row.verified}</td>
                      <td className="px-3 py-2">{row.partial}</td>
                      <td className="px-3 py-2">{row.failed + row.errored}</td>
                      <td className="px-3 py-2">{row.contaminated}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="failures-heading" className="mt-10">
          <h2 id="failures-heading" className="text-xl font-bold">Preserved failures</h2>
          <p className="mt-1 text-sm text-muted">
            Partial and failed trials stay visible with their scoring counts, failure
            category and contamination state.
          </p>
          {failures.length === 0 ? (
            <div className={`${cardClass} mt-3`}>
              <p className="text-sm text-muted">No failed trials recorded.</p>
            </div>
          ) : (
            <ul className="mt-3 space-y-3">
              {failures.map((run) => (
                <li key={run.id} className={cardClass}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold">
                        {taskById.get(run.task_id)?.title ?? "Unknown task"}
                      </h3>
                      <p className="text-xs text-muted">
                        {versionById.get(run.version_id)?.label ?? "Unknown version"} · trial{" "}
                        {run.trial} · {CAPABILITY_SPLIT_LABELS[run.split]} · {run.difficulty}
                      </p>
                    </div>
                    <span className={chipClass}>
                      {CAPABILITY_OUTCOME_LABELS[run.outcome]}
                      {run.failure_category ? ` · ${run.failure_category}` : ""}
                      {run.contaminated ? " · contaminated" : ""}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    {run.unsupported_claims} unsupported claim(s) ·{" "}
                    {run.permission_violations} permission violation(s) ·{" "}
                    {run.human_interventions} human intervention(s) · exposure{" "}
                    {run.exposure_count} · {run.latency_ms} ms
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
