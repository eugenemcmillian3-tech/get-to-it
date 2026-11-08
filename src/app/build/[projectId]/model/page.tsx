import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ChangeScenarioForm,
  ExperimentControls,
  ExperimentForm,
  ProjectModelForm,
} from "@/components/project-model-forms";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import {
  getProjectModelWorkspace,
  modelInputForWorkspace,
  type ChangeExperimentRecord,
  type ChangeScenarioRecord,
  type ProjectBuildTaskRecord,
  type ProjectModelRecord,
} from "@/lib/data/project-model";
import { getIdentity } from "@/lib/identity";
import {
  EXPERIMENT_KIND_LABELS,
  MODEL_BASIS_NOTE,
  SCENARIO_BASIS_NOTE,
  SCENARIO_KIND_LABELS,
  diffProjectModels,
  type ModelDependencyDiff,
  type ModelEvidence,
  type ModelFieldChange,
  type ModelNode,
  type ModelNodeDiff,
  type ModelStringDiff,
  type ProjectModel,
  type ProjectModelDiff,
  type ScenarioAnalysis,
} from "@/lib/project-model";
import { buildModelSource, modelStaleness } from "@/lib/project-model-source";
import { cardClass, chipClass, focusRing, inputClass, secondaryButton } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { isUuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Project model — GET TO IT" };

function EvidenceList({
  projectId,
  items,
}: {
  projectId: string;
  items: ModelEvidence[];
}) {
  if (items.length === 0) return null;
  return (
    <details className="mt-2 text-xs text-muted">
      <summary className={`cursor-pointer rounded ${focusRing}`}>
        Evidence ({items.length})
      </summary>
      <ul className="mt-2 space-y-2">
        {items.map((item, index) => (
          <li key={`${item.source}-${item.path ?? ""}-${item.line ?? ""}-${index}`}>
            <span className="font-semibold uppercase tracking-wide">{item.source}</span>
            {item.path ? (
              <>
                {" "}
                <Link
                  href={`/build/${projectId}?file=${encodeURIComponent(item.path)}`}
                  className={`rounded font-mono underline decoration-line underline-offset-2 ${focusRing}`}
                >
                  {item.path}
                  {item.line ? `:${item.line}` : ""}
                </Link>
              </>
            ) : null}
            <span className="block">{item.detail}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function NodeList({
  projectId,
  title,
  nodes,
  empty,
}: {
  projectId: string;
  title: string;
  nodes: ModelNode[];
  empty: string;
}) {
  return (
    <div>
      <h3 className="text-sm font-bold">{title}</h3>
      {nodes.length === 0 ? (
        <p className="mt-1 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {nodes.slice(0, 24).map((node) => (
            <li key={node.id} className="rounded-xl border border-line bg-paper/50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={chipClass}>{node.kind}</span>
                <span className="break-words text-sm font-semibold">{node.label}</span>
              </div>
              <p className="mt-1 text-sm text-muted">{node.summary}</p>
              {node.metadata ? (
                <p className="mt-1 break-words font-mono text-[11px] text-muted">
                  {Object.entries(node.metadata)
                    .filter(([, value]) => value !== null && value !== "")
                    .map(([key, value]) => `${key}: ${String(value)}`)
                    .join(" · ")}
                </p>
              ) : null}
              <EvidenceList projectId={projectId} items={node.evidence} />
            </li>
          ))}
        </ul>
      )}
      {nodes.length > 24 ? (
        <p className="mt-1 text-xs text-muted">Showing the first 24 of {nodes.length}.</p>
      ) : null}
    </div>
  );
}

function dependencyLabels(model: ProjectModel): Map<string, string> {
  const labels = new Map<string, string>();
  for (const node of [
    ...model.pages,
    ...model.services,
    ...model.entities,
    ...model.integrations,
    ...model.environments,
  ]) {
    labels.set(node.id, node.label);
  }
  return labels;
}

function ModelSummary({ projectId, model }: { projectId: string; model: ProjectModel }) {
  const labels = dependencyLabels(model);
  return (
    <div className="mt-4 space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <NodeList projectId={projectId} title="Pages" nodes={model.pages} empty="No page is declared or stored." />
        <NodeList
          projectId={projectId}
          title="User journeys"
          nodes={model.journeys.map((journey) => ({
            id: journey.id,
            kind: "page" as const,
            label: journey.title,
            summary: journey.summary,
            evidence: journey.evidence,
          }))}
          empty="No workflow is declared."
        />
      </div>
      <NodeList
        projectId={projectId}
        title="Services and routes"
        nodes={model.services}
        empty="No route or service source is stored."
      />
      <div>
        <h3 className="text-sm font-bold">Static dependencies</h3>
        {model.dependencies.length === 0 ? (
          <p className="mt-1 text-sm text-muted">No static dependency edge was found.</p>
        ) : (
          <details className="mt-2">
            <summary className={`cursor-pointer text-sm font-semibold ${focusRing}`}>
              {model.dependencies.length} static edge(s)
            </summary>
            <ul className="mt-2 space-y-1 text-xs text-muted">
              {model.dependencies.slice(0, 120).map((edge) => (
                <li key={edge.id} className="break-words">
                  <span className="font-mono">{labels.get(edge.from) ?? edge.from}</span>{" "}
                  <span className="uppercase">{edge.kind.replace("_", " ")}</span>{" "}
                  <span className="font-mono">{labels.get(edge.to) ?? edge.to}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        <p className="mt-1 text-xs text-muted">
          Imports and literal API strings only. This is not a runtime dependency trace.
        </p>
      </div>
      <NodeList
        projectId={projectId}
        title="Data entities and fields"
        nodes={model.entities}
        empty="No data entity is declared."
      />
      <NodeList
        projectId={projectId}
        title="External integrations"
        nodes={model.integrations}
        empty="No integration is declared."
      />
      <NodeList
        projectId={projectId}
        title="Deployment environments"
        nodes={model.environments}
        empty="No environment record exists."
      />
    </div>
  );
}

function ScenarioCard({
  projectId,
  scenario,
  experiments,
  tasks,
  stale,
}: {
  projectId: string;
  scenario: ChangeScenarioRecord;
  experiments: ChangeExperimentRecord[];
  tasks: Map<string, ProjectBuildTaskRecord>;
  stale: boolean;
}) {
  const analysis = scenario.analysis as ScenarioAnalysis;
  return (
    <li className={`${cardClass} mt-3`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            {SCENARIO_KIND_LABELS[scenario.kind]} · {scenario.target}
          </p>
          <h3 className="mt-1 text-lg font-bold leading-snug">{scenario.question}</h3>
        </div>
        <span className={chipClass}>Static analysis · not measured</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted">{analysis.summary}</p>

      <div className="mt-4">
        <h4 className="text-sm font-bold">Potentially affected components</h4>
        {analysis.affected.length === 0 ? (
          <p className="mt-1 text-sm text-muted">No component was connected by static evidence.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {analysis.affected.map((item) => (
              <li key={item.id} className="rounded-xl border border-line bg-paper/50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={chipClass}>{item.kind}</span>
                  <span className="break-words text-sm font-semibold">{item.label}</span>
                  <span className="text-xs text-muted">{item.relation}</span>
                </div>
                <p className="mt-1 text-sm text-muted">{item.why}</p>
                <EvidenceList projectId={projectId} items={item.evidence} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <h4 className="text-sm font-bold">Assumptions</h4>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted">
            {analysis.assumptions.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
        <div>
          <h4 className="text-sm font-bold">Unknowns</h4>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted">
            {analysis.unknowns.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
        <div>
          <h4 className="text-sm font-bold">Proposed tests</h4>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted">
            {analysis.proposed_tests.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
        <div>
          <h4 className="text-sm font-bold">Suggested implementation order</h4>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-muted">
            {analysis.implementation_order.map((item) => <li key={item}>{item}</li>)}
          </ol>
        </div>
        <div>
          <h4 className="text-sm font-bold">Reversible experiments</h4>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted">
            {analysis.reversible_experiments.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted">
        {analysis.basis_note} Measured results: none.
      </p>

      <div className="mt-4 border-t border-line pt-3">
        <h4 className="text-sm font-bold">Experiments</h4>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          An experiment must be approved before it can run or become a task. Synthetic
          requests stay blocked without an isolated HTTP runner.
        </p>
        {experiments.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No experiment has been proposed for this scenario.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {experiments.map((experiment) => {
              const task = experiment.task_id ? tasks.get(experiment.task_id) ?? null : null;
              return (
                <li key={experiment.id} className="rounded-xl border border-line bg-paper/50 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">
                      {EXPERIMENT_KIND_LABELS[experiment.kind]}
                    </span>
                    <span className={chipClass}>{experiment.status}</span>
                    {experiment.approved_at ? <span className={chipClass}>approved</span> : null}
                    {experiment.task_id ? <span className={chipClass}>task created</span> : null}
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    Target {experiment.target} · {experiment.requested_requests} request(s) ·
                    {" "}{experiment.max_duration_ms} ms limit · source-only data
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted">
                    {experiment.plan.checks.map((check) => <li key={check}>{check}</li>)}
                  </ul>
                  {experiment.observations.length > 0 ? (
                    <ul className="mt-2 space-y-1 text-xs">
                      {experiment.observations.map((observation, index) => (
                        <li key={`${observation.name}-${index}`}>
                          <span className="font-semibold">{observation.name}: </span>
                          <span className="text-muted">{observation.detail}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {experiment.note ? <p className="mt-2 text-xs text-muted">{experiment.note}</p> : null}
                  {task ? (
                    <p className="mt-2 text-sm">
                      Project task:{" "}
                      <Link href={`/build/${projectId}/room`} className={`underline ${focusRing}`}>
                        {task.title}
                      </Link>{" "}
                      <span className="text-muted">({task.status})</span>
                    </p>
                  ) : null}
                  <ExperimentControls
                    projectId={projectId}
                    experimentId={experiment.id}
                    approved={Boolean(experiment.approved_at)}
                    status={experiment.status}
                    taskId={experiment.task_id}
                  />
                </li>
              );
            })}
          </ul>
        )}
        <ExperimentForm projectId={projectId} scenarioId={scenario.id} disabled={stale} />
      </div>
    </li>
  );
}

function DiffFieldChanges({
  changes,
  projectId,
  beforeEvidence,
  afterEvidence,
}: {
  changes: ModelFieldChange[];
  projectId: string;
  beforeEvidence: ModelEvidence[];
  afterEvidence: ModelEvidence[];
}) {
  return (
    <div className="mt-2 space-y-2">
      {changes.length > 0 ? (
        <dl className="space-y-2">
          {changes.map((change) => (
            <div key={change.field} className="rounded-lg border border-line bg-paper p-2">
              <dt className="font-mono text-[11px] font-semibold uppercase tracking-wide text-muted">
                {change.field}
              </dt>
              <dd className="mt-1 grid gap-1 text-xs sm:grid-cols-2">
                <div>
                  <span className="font-semibold">Before</span>
                  <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] text-muted">
                    {change.before || "—"}
                  </pre>
                </div>
                <div>
                  <span className="font-semibold">After</span>
                  <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] text-muted">
                    {change.after || "—"}
                  </pre>
                </div>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-xs text-muted">
          {beforeEvidence.length === 0 ? "This record appears in the newer version." : "This record was removed from the newer version."}
        </p>
      )}
      {beforeEvidence.length > 0 ? (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Before evidence</p>
          <EvidenceList projectId={projectId} items={beforeEvidence} />
        </div>
      ) : null}
      {afterEvidence.length > 0 ? (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">After evidence</p>
          <EvidenceList projectId={projectId} items={afterEvidence} />
        </div>
      ) : null}
    </div>
  );
}

function DiffNodeRow({
  projectId,
  item,
}: {
  projectId: string;
  item: ModelNodeDiff | ModelDependencyDiff;
}) {
  const kind = "kind" in item ? item.kind : "dependency";
  return (
    <li className="rounded-xl border border-line bg-paper/50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={chipClass}>{item.status}</span>
        <span className={chipClass}>{kind}</span>
        <span className="break-words text-sm font-semibold">{item.label}</span>
      </div>
      <DiffFieldChanges
        changes={item.changes}
        projectId={projectId}
        beforeEvidence={item.before_evidence}
        afterEvidence={item.after_evidence}
      />
    </li>
  );
}

function DiffNodeSection({
  projectId,
  title,
  items,
}: {
  projectId: string;
  title: string;
  items: Array<ModelNodeDiff | ModelDependencyDiff>;
}) {
  return (
    <section className="mt-5 border-t border-line pt-4">
      <h3 className="flex flex-wrap items-center gap-2 text-sm font-bold">
        {title}
        <span className={chipClass}>{items.length} changed</span>
      </h3>
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-muted">No changes in this section.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map((item) => (
            <DiffNodeRow key={item.key} projectId={projectId} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}

function DiffStringSection({
  title,
  items,
}: {
  title: string;
  items: ModelStringDiff[];
}) {
  return (
    <section className="mt-5 border-t border-line pt-4">
      <h3 className="flex flex-wrap items-center gap-2 text-sm font-bold">
        {title}
        <span className={chipClass}>{items.length} changed</span>
      </h3>
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-muted">No changes in this section.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm">
          {items.map((item) => (
            <li key={item.key} className="flex gap-2">
              <span className={chipClass}>{item.status}</span>
              <span className="break-words text-muted">{item.value}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ModelVersionDiff({
  projectId,
  models,
  from,
  to,
  diff,
}: {
  projectId: string;
  models: ProjectModelRecord[];
  from: ProjectModelRecord;
  to: ProjectModelRecord;
  diff: ProjectModelDiff;
}) {
  return (
    <section className={`${cardClass} mt-8`} aria-labelledby="model-diff-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="model-diff-heading" className="text-xl font-bold">
            Compare model versions
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">
            Comparing version {from.version} with version {to.version} from their stored
            snapshots. This does not re-read project files or runtime state.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={chipClass}>{diff.counts.total} change(s)</span>
          <a
            href={`/build/${projectId}/model/changelog?from=${from.version}&to=${to.version}`}
            download
            className={secondaryButton}
          >
            Download Markdown
          </a>
        </div>
      </div>

      <form method="get" className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="text-sm font-semibold">
          From version
          <select className={`${inputClass} mt-1`} name="from" defaultValue={String(from.version)}>
            {models.map((model) => (
              <option key={model.id} value={model.version}>
                Version {model.version} · spec {model.spec_version || "none"}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          To version
          <select className={`${inputClass} mt-1`} name="to" defaultValue={String(to.version)}>
            {models.map((model) => (
              <option key={model.id} value={model.version}>
                Version {model.version} · spec {model.spec_version || "none"}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={secondaryButton}>
          Compare
        </button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <span className={chipClass}>{diff.counts.added} added</span>
        <span className={chipClass}>{diff.counts.removed} removed</span>
        <span className={chipClass}>{diff.counts.changed} changed</span>
        <span className={chipClass}>
          source {from.source_digest.slice(0, 12)}… → {to.source_digest.slice(0, 12)}…
        </span>
      </div>

      <DiffNodeSection projectId={projectId} title="Pages" items={diff.pages} />
      <DiffNodeSection projectId={projectId} title="Dependencies" items={diff.dependencies} />
      <DiffNodeSection projectId={projectId} title="Integrations" items={diff.integrations} />
      <DiffNodeSection
        projectId={projectId}
        title="Deployment environments"
        items={diff.environments}
      />
      <DiffStringSection title="Assumptions" items={diff.assumptions} />
      <DiffNodeSection projectId={projectId} title="User journeys" items={diff.journeys} />
      <DiffNodeSection projectId={projectId} title="Services and routes" items={diff.services} />
      <DiffNodeSection projectId={projectId} title="Data entities" items={diff.entities} />
      <DiffStringSection title="Constraints" items={diff.constraints} />
      <DiffStringSection title="Missing information" items={diff.missing_information} />
    </section>
  );
}

function modelVersion(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function ModelHistory({ models }: { models: ProjectModelRecord[] }) {
  return (
    <details className={`${cardClass} mt-6`}>
      <summary className={`cursor-pointer text-lg font-bold ${focusRing}`}>
        Model version history
      </summary>
      <ul className="mt-3 space-y-2">
        {models.map((model) => (
          <li key={model.id} className="rounded-xl border border-line bg-paper/50 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">Version {model.version}</span>
              <span className={chipClass}>{model.status}</span>
              <span className={chipClass}>Spec {model.spec_version || "none"}</span>
              <span className={chipClass}>Project {model.app_version}</span>
            </div>
            <p className="mt-1 text-xs text-muted">
              {model.created_at.slice(0, 19).replace("T", " ")} · source {model.source_digest.slice(0, 12)}…
            </p>
          </li>
        ))}
      </ul>
    </details>
  );
}

export default async function ProjectModelPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ from?: string | string[]; to?: string | string[] }>;
}) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  if (!isUuid(projectId)) notFound();

  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <p className="text-sm text-muted">Sign-in is not configured in this build.</p>
      </main>
    );
  }

  const session = await requireSession();
  const [identity, workspace] = await Promise.all([
    getIdentity(session),
    getProjectModelWorkspace(session, projectId),
  ]);
  if (!workspace) notFound();

  const input = modelInputForWorkspace(workspace);
  const currentSource = buildModelSource(input);
  const latest = workspace.models[0] ?? null;
  const stale = latest ? modelStaleness(latest, currentSource) : null;
  const scenarios = latest
    ? workspace.scenarios.filter((scenario) => scenario.model_id === latest.id)
    : [];
  const tasks = new Map(workspace.tasks.map((task) => [task.id, task]));

  const previousModel = workspace.models[1] ?? null;
  const newestModel = workspace.models[0] ?? null;
  const requestedFrom = modelVersion(query.from);
  const requestedTo = modelVersion(query.to);
  let compareFrom =
    (requestedFrom ? workspace.models.find((model) => model.version === requestedFrom) : null) ??
    previousModel;
  let compareTo =
    (requestedTo ? workspace.models.find((model) => model.version === requestedTo) : null) ??
    newestModel;
  if (compareFrom && compareTo && compareFrom.version === compareTo.version) {
    compareFrom = previousModel;
    compareTo = newestModel;
  }
  if (compareFrom && compareTo && compareFrom.version > compareTo.version) {
    [compareFrom, compareTo] = [compareTo, compareFrom];
  }
  const modelDiff =
    compareFrom && compareTo ? diffProjectModels(compareFrom.model, compareTo.model) : null;

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-5xl px-5 pb-16 pt-6">
        <Link
          href={`/build/${projectId}`}
          className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          ← Back to {workspace.project.name}
        </Link>

        <header className="mt-4">
          <h1 className="text-3xl font-black leading-tight tracking-tight sm:text-4xl">
            Project model
          </h1>
          <p className="mt-3 max-w-3xl leading-relaxed text-muted">
            Explore a proposed change against a versioned model of this project. Every
            scenario separates static evidence from unknowns, and every experiment is
            bounded, approved and source-only.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {latest ? <span className={chipClass}>Model v{latest.version}</span> : null}
            {latest ? <span className={chipClass}>Spec v{latest.spec_version || "none"}</span> : null}
            <span className={chipClass}>Project v{workspace.project.current_version}</span>
            <span className={chipClass}>{workspace.files.length} stored files</span>
            <span className={chipClass}>{workspace.integrations.length} integrations</span>
            <span className={chipClass}>{workspace.deployments.length} deployments</span>
            {stale?.stale ? <span className={chipClass}>Stale model</span> : null}
          </div>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-muted">{MODEL_BASIS_NOTE}</p>
        </header>

        {!latest ? (
          <section className={`${cardClass} mt-6`} aria-labelledby="build-model-heading">
            <h2 id="build-model-heading" className="text-lg font-bold">Build the first model</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              The model reads the approved specification, stored files, integration metadata
              and deployment records. It uses the latest draft only when no approved
              specification exists, and it records that assumption.
            </p>
            <div className="mt-4">
              <ProjectModelForm projectId={projectId} label="Build project model" />
            </div>
          </section>
        ) : (
          <>
            {stale?.stale ? (
              <section
                className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950 sm:p-5"
                aria-labelledby="stale-heading"
              >
                <h2 id="stale-heading" className="text-lg font-bold">This model is stale</h2>
                <p className="mt-1 text-sm leading-relaxed">
                  Scenarios and experiments are blocked until a fresh version is built.
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                  {stale.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
                <div className="mt-3">
                  <ProjectModelForm projectId={projectId} label="Build fresh model version" />
                </div>
              </section>
            ) : null}

            <section className={`${cardClass} mt-6`} aria-labelledby="model-heading">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 id="model-heading" className="text-xl font-bold">
                    Model version {latest.version}
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    Built from spec version {latest.spec_version || "none"} and project version{" "}
                    {latest.app_version}.
                  </p>
                </div>
                <ProjectModelForm projectId={projectId} label="Create new version" />
              </div>
              <ModelSummary projectId={projectId} model={latest.model} />
            </section>

            {compareFrom && compareTo && modelDiff ? (
              <ModelVersionDiff
                projectId={projectId}
                models={workspace.models}
                from={compareFrom}
                to={compareTo}
                diff={modelDiff}
              />
            ) : null}

            <section className="mt-8" aria-labelledby="scenarios-heading">
              <h2 id="scenarios-heading" className="text-xl font-bold">Change scenarios</h2>
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">
                Ask what an API change, new role, background job or database field could
                affect. The answer cites stored code and configuration; it does not prove
                runtime behavior.
              </p>
              <div className={`${cardClass} mt-3`}>
                <ChangeScenarioForm projectId={projectId} modelId={latest.id} disabled={Boolean(stale?.stale)} />
              </div>

              {scenarios.length === 0 ? (
                <p className={`${cardClass} mt-3 text-sm text-muted`}>
                  No scenario has been analysed against this model version.
                </p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {scenarios.map((scenario) => (
                    <ScenarioCard
                      key={scenario.id}
                      projectId={projectId}
                      scenario={scenario}
                      experiments={workspace.experiments.filter(
                        (experiment) => experiment.scenario_id === scenario.id,
                      )}
                      tasks={tasks}
                      stale={Boolean(stale?.stale)}
                    />
                  ))}
                </ul>
              )}
            </section>

            <section className={`${cardClass} mt-8`} aria-labelledby="gaps-heading">
              <h2 id="gaps-heading" className="text-lg font-bold">Limits, assumptions and missing information</h2>
              <div className="mt-3 grid gap-5 lg:grid-cols-3">
                <div>
                  <h3 className="text-sm font-bold">Known constraints</h3>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted">
                    {latest.model.constraints.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
                <div>
                  <h3 className="text-sm font-bold">Model assumptions</h3>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted">
                    {latest.model.assumptions.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
                <div>
                  <h3 className="text-sm font-bold">Missing information</h3>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted">
                    {latest.model.missing_information.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
              </div>
              <p className="mt-4 text-xs leading-relaxed text-muted">{SCENARIO_BASIS_NOTE}</p>
            </section>

            <ModelHistory models={workspace.models} />
          </>
        )}
      </main>
    </div>
  );
}
