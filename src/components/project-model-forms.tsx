"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleBuildState, type BuildState } from "@/lib/action-state";
import {
  approveExperimentAction,
  convertExperimentAction,
  createChangeScenarioAction,
  createExperimentAction,
  createProjectModelAction,
  runExperimentAction,
} from "@/lib/actions/project-model";
import {
  EXPERIMENT_KINDS,
  EXPERIMENT_KIND_LABELS,
  EXPERIMENT_KIND_NOTES,
  EXPERIMENT_LIMITS,
  SCENARIO_KINDS,
  SCENARIO_KIND_LABELS,
} from "@/lib/project-model";
import { inputClass, primaryButton, secondaryButton } from "@/lib/styles";

function Note({ state }: { state: BuildState }) {
  if (state.status === "error") {
    return <p className="text-sm text-danger" role="alert">{state.message}</p>;
  }
  if (state.status === "success") {
    return (
      <p className="text-sm text-mint">
        {state.message}
        {state.link ? (
          <>
            {" "}
            <a href={state.link} className="underline">Open it</a>
          </>
        ) : null}
      </p>
    );
  }
  return null;
}

export function ProjectModelForm({
  projectId,
  label,
}: {
  projectId: string;
  label: string;
}) {
  const [state, action] = useActionState(createProjectModelAction, idleBuildState);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="project_id" value={projectId} />
      <SubmitButton className={primaryButton} pendingLabel="Building the model…">
        {label}
      </SubmitButton>
      <Note state={state} />
    </form>
  );
}

export function ChangeScenarioForm({
  projectId,
  modelId,
  disabled,
}: {
  projectId: string;
  modelId: string;
  disabled: boolean;
}) {
  const [state, action] = useActionState(createChangeScenarioAction, idleBuildState);
  return (
    <form action={action} className="mt-4 space-y-4">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="model_id" value={modelId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-semibold">
          Change kind
          <select name="kind" className={`${inputClass} mt-1`} defaultValue="api_change">
            {SCENARIO_KINDS.map((kind) => (
              <option key={kind} value={kind}>{SCENARIO_KIND_LABELS[kind]}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-semibold">
          Internal target
          <input
            name="target"
            required
            maxLength={160}
            className={`${inputClass} mt-1`}
            placeholder="/api/projects or project.status"
          />
        </label>
      </div>
      <label className="block text-sm font-semibold">
        What could change?
        <textarea
          name="question"
          required
          minLength={5}
          maxLength={1000}
          rows={3}
          className={`${inputClass} mt-1`}
          placeholder="What could be affected if /api/projects changes its response shape?"
        />
      </label>
      <p className="text-xs leading-relaxed text-muted">
        The answer uses stored source and configuration only. It does not call a model,
        send a request, run a load test or forecast performance or cost.
      </p>
      <SubmitButton className={secondaryButton} pendingLabel="Tracing evidence…" disabled={disabled}>
        Analyse change
      </SubmitButton>
      <Note state={state} />
    </form>
  );
}

export function ExperimentForm({
  projectId,
  scenarioId,
  disabled,
}: {
  projectId: string;
  scenarioId: string;
  disabled: boolean;
}) {
  const [state, action] = useActionState(createExperimentAction, idleBuildState);
  return (
    <form action={action} className="mt-3 space-y-3 rounded-xl border border-line bg-paper/60 p-3">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="scenario_id" value={scenarioId} />
      <label className="block text-sm font-semibold">
        Proposed experiment
        <select name="kind" className={`${inputClass} mt-1`} defaultValue="contract_check">
          {EXPERIMENT_KINDS.map((kind) => (
            <option key={kind} value={kind}>{EXPERIMENT_KIND_LABELS[kind]}</option>
          ))}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-semibold">
          Maximum synthetic requests
          <input
            name="requested_requests"
            type="number"
            min={EXPERIMENT_LIMITS.minRequests}
            max={EXPERIMENT_LIMITS.maxRequests}
            defaultValue={1}
            className={`${inputClass} mt-1`}
          />
        </label>
        <label className="block text-sm font-semibold">
          Maximum duration (ms)
          <input
            name="max_duration_ms"
            type="number"
            min={EXPERIMENT_LIMITS.minDurationMs}
            max={EXPERIMENT_LIMITS.maxDurationMs}
            step={500}
            defaultValue={15000}
            className={`${inputClass} mt-1`}
          />
        </label>
      </div>
      <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-muted">
        {EXPERIMENT_KINDS.map((kind) => (
          <li key={kind}>{EXPERIMENT_KIND_NOTES[kind]}</li>
        ))}
      </ul>
      <SubmitButton className={secondaryButton} pendingLabel="Proposing…" disabled={disabled}>
        Propose experiment
      </SubmitButton>
      <Note state={state} />
    </form>
  );
}

export function ExperimentControls({
  projectId,
  experimentId,
  approved,
  status,
  taskId,
}: {
  projectId: string;
  experimentId: string;
  approved: boolean;
  status: string;
  taskId: string | null;
}) {
  const [approveState, approve] = useActionState(approveExperimentAction, idleBuildState);
  const [runState, run] = useActionState(runExperimentAction, idleBuildState);
  const [convertState, convert] = useActionState(convertExperimentAction, idleBuildState);
  const canRun = approved && !taskId && status !== "canceled";
  const canConvert = approved && !taskId && !["proposed", "running", "canceled"].includes(status);

  return (
    <div className="mt-3 space-y-2">
      {!approved ? (
        <form action={approve} className="space-y-2">
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="experiment_id" value={experimentId} />
          <SubmitButton className={secondaryButton} pendingLabel="Approving…">
            Approve experiment
          </SubmitButton>
          <Note state={approveState} />
        </form>
      ) : (
        <span className="inline-flex rounded-full border border-line bg-paper px-3 py-1 text-xs font-medium text-muted">
          Approved for bounded execution
        </span>
      )}

      {canRun ? (
        <form action={run} className="space-y-2">
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="experiment_id" value={experimentId} />
          <SubmitButton className={secondaryButton} pendingLabel="Running bounded checks…">
            Run bounded experiment
          </SubmitButton>
          <Note state={runState} />
        </form>
      ) : null}

      {canConvert ? (
        <form action={convert} className="space-y-2">
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="experiment_id" value={experimentId} />
          <SubmitButton className={primaryButton} pendingLabel="Creating project task…">
            Convert to project task
          </SubmitButton>
          <Note state={convertState} />
        </form>
      ) : null}

      {taskId ? (
        <p className="text-sm text-mint">
          This experiment became a Build Room task. No files or deployment changed.
        </p>
      ) : null}
    </div>
  );
}
