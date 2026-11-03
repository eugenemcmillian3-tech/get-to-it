"use client";

import Link from "next/link";
import { useActionState, useId, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleFormState } from "@/lib/action-state";
import {
  approveWorkflowActionAction,
  approveWorkflowDraftAction,
  cancelWorkflowRunAction,
  completeCheckpointAction,
  createWorkflowAction,
  deleteWorkflowAction,
  executeWorkflowActionAction,
  generateWorkflowDraftAction,
  requestWorkflowActionAction,
  retryWorkflowStepAction,
  saveWorkflowInputAction,
  startWorkflowRunAction,
  updateWorkflowAction,
} from "@/lib/actions/workflows";
import { CONNECTORS, NO_REAL_CONNECTOR_NOTE, getConnector } from "@/lib/connectors";
import {
  MAX_DRAFT_LENGTH,
  MAX_INPUT_NOTES,
  RUN_STATUS_LABELS,
  SIMULATED_ACTION_NOTE,
  STEP_KIND_DESCRIPTIONS,
  STEP_KIND_LABELS,
  STEP_STATUS_LABELS,
  WORKFLOW_DESCRIPTION_MAX,
  WORKFLOW_DESTINATION_MAX,
  WORKFLOW_MAX_STEPS,
  WORKFLOW_NAME_MAX,
  WORKFLOW_SCOPE_NOTE,
  WORKFLOW_STEP_INSTRUCTIONS_MAX,
  WORKFLOW_STEP_KINDS,
  WORKFLOW_STEP_TITLE_MAX,
  canCancelRun,
  canRetryStep,
  describeStep,
  formatWorkflowTime,
  parseRunContext,
  preservedOutputs,
  runProgress,
  workflowErrorMessage,
  type RunStatus,
  type RunStepStatus,
} from "@/lib/workflows";
import type {
  ActionApproval,
  ActionRecord,
  WorkflowRun,
  WorkflowStepKind,
} from "@/lib/types";
import type { WorkflowRunDetail } from "@/lib/data/workflows";
import {
  cardClass,
  chipClass,
  dangerButton,
  focusRing,
  hintClass,
  inputClass,
  labelClass,
  primaryButton,
  quietButton,
  secondaryButton,
} from "@/lib/styles";

type EditorStep = {
  kind: WorkflowStepKind;
  title: string;
  instructions: string;
  retry_policy: "manual" | "none";
  config: { connector?: string; destination?: string };
};

type TemplateChoice = { id: string; name: string; stepCount: number };

function Message({ state }: { state: { status: string; message?: string } }) {
  if (!state.message) return null;
  return (
    <p
      role={state.status === "error" ? "alert" : "status"}
      aria-live="polite"
      className={state.status === "error" ? "text-sm text-danger" : "text-sm text-mint"}
    >
      {state.message}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Editor: a plain form with an ordered list of step rows
// ---------------------------------------------------------------------------

export function WorkflowEditor({
  templates,
  goals,
  workflowId,
  initial,
}: {
  templates: TemplateChoice[];
  goals: { id: string; title: string }[];
  workflowId?: string;
  initial?: {
    name: string;
    description: string;
    goal_id: string;
    steps: EditorStep[];
  };
}) {
  const [state, formAction] = useActionState(
    workflowId ? updateWorkflowAction : createWorkflowAction,
    idleFormState,
  );
  const [templateId, setTemplateId] = useState("");
  const [steps, setSteps] = useState<EditorStep[]>(initial?.steps ?? []);
  const [newKind, setNewKind] = useState<WorkflowStepKind>("checkpoint");
  const fieldPrefix = useId();

  function updateStep(index: number, patch: Partial<EditorStep>) {
    setSteps((current) =>
      current.map((step, position) => (position === index ? { ...step, ...patch } : step)),
    );
  }

  function addStep() {
    setSteps((current) =>
      [
        ...current,
        {
          kind: newKind,
          title: STEP_KIND_LABELS[newKind],
          instructions: "",
          retry_policy: "manual" as const,
          config: newKind === "connector_action" ? { connector: "demo_notes" } : {},
        },
      ].slice(0, WORKFLOW_MAX_STEPS),
    );
  }

  function removeStep(index: number) {
    setSteps((current) => current.filter((_, position) => position !== index));
  }

  return (
    <form action={formAction} className={`${cardClass} space-y-5`}>
      {workflowId ? <input type="hidden" name="workflow_id" value={workflowId} /> : null}

      <div>
        <label className={labelClass} htmlFor={`${fieldPrefix}-name`}>
          Workflow name
        </label>
        <input
          id={`${fieldPrefix}-name`}
          name="name"
          required
          maxLength={WORKFLOW_NAME_MAX}
          defaultValue={initial?.name ?? ""}
          placeholder="e.g. Prepare a weekly project update"
          className={`mt-1.5 ${inputClass}`}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor={`${fieldPrefix}-description`}>
          What is it for? <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea
          id={`${fieldPrefix}-description`}
          name="description"
          rows={2}
          maxLength={WORKFLOW_DESCRIPTION_MAX}
          defaultValue={initial?.description ?? ""}
          className={`mt-1.5 ${inputClass}`}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor={`${fieldPrefix}-goal`}>
          Goal <span className="font-normal text-muted">(optional)</span>
        </label>
        <select
          id={`${fieldPrefix}-goal`}
          name="goal_id"
          defaultValue={initial?.goal_id ?? ""}
          className={`mt-1.5 ${inputClass}`}
        >
          <option value="">No goal</option>
          {goals.map((goal) => (
            <option key={goal.id} value={goal.id}>
              {goal.title}
            </option>
          ))}
        </select>
        <p className={hintClass}>
          Runs choose completed work from this goal. Nothing outside it is read.
        </p>
      </div>

      {templates.length > 0 ? (
        <div>
          <label className={labelClass} htmlFor={`${fieldPrefix}-template`}>
            Start from one of your templates <span className="font-normal text-muted">(optional)</span>
          </label>
          <select
            id={`${fieldPrefix}-template`}
            name="template_id"
            value={templateId}
            onChange={(event) => setTemplateId(event.target.value)}
            className={`mt-1.5 ${inputClass}`}
          >
            <option value="">Build the steps below instead</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name} ({template.stepCount} steps)
              </option>
            ))}
          </select>
          <p className={hintClass}>
            A template only supplies step names. Choosing one uses the standard
            input, draft and review steps plus one checkpoint per template step,
            and ignores the rows below.
          </p>
        </div>
      ) : null}

      <div className="rounded-xl border border-line bg-paper p-3">
        <p className="text-xs font-bold uppercase tracking-[0.15em] text-muted">
          Only these five step kinds exist
        </p>
        <ul className="mt-2 space-y-1 text-sm text-muted">
          {WORKFLOW_STEP_KINDS.map((kind) => (
            <li key={kind}>
              <span className="font-semibold text-ink">{STEP_KIND_LABELS[kind]}</span> —{" "}
              {STEP_KIND_DESCRIPTIONS[kind]}
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-[0.15em] text-muted">Steps</h3>

        {steps.length === 0 ? (
          <p className="text-sm text-muted">
            No steps yet. Add input, drafting, review and a checkpoint, in that order.
          </p>
        ) : null}

        <ol className="space-y-3">
          {steps.map((step, index) => (
            <li key={index} className="rounded-xl border border-line bg-paper p-3">
              <div className="flex items-start justify-between gap-2">
                <span className={chipClass}>Step {index + 1}</span>
                <button
                  type="button"
                  onClick={() => removeStep(index)}
                  className={`${quietButton} text-danger`}
                >
                  Remove
                </button>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold text-ink" htmlFor={`${fieldPrefix}-kind-${index}`}>
                    Kind
                  </label>
                  <select
                    id={`${fieldPrefix}-kind-${index}`}
                    name="step_kind"
                    value={step.kind}
                    onChange={(event) =>
                      updateStep(index, { kind: event.target.value as WorkflowStepKind })
                    }
                    className={`mt-1 ${inputClass}`}
                  >
                    {WORKFLOW_STEP_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {STEP_KIND_LABELS[kind]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-ink" htmlFor={`${fieldPrefix}-title-${index}`}>
                    Title
                  </label>
                  <input
                    id={`${fieldPrefix}-title-${index}`}
                    name="step_title"
                    required
                    maxLength={WORKFLOW_STEP_TITLE_MAX}
                    value={step.title}
                    onChange={(event) => updateStep(index, { title: event.target.value })}
                    className={`mt-1 ${inputClass}`}
                  />
                </div>
              </div>

              <div className="mt-3">
                <label className="text-xs font-semibold text-ink" htmlFor={`${fieldPrefix}-notes-${index}`}>
                  Notes for this step
                </label>
                <textarea
                  id={`${fieldPrefix}-notes-${index}`}
                  name="step_instructions"
                  rows={2}
                  maxLength={WORKFLOW_STEP_INSTRUCTIONS_MAX}
                  value={step.instructions}
                  onChange={(event) => updateStep(index, { instructions: event.target.value })}
                  className={`mt-1 ${inputClass}`}
                />
              </div>

              <div className="mt-3">
                <label className="text-xs font-semibold text-ink" htmlFor={`${fieldPrefix}-retry-${index}`}>
                  If this step fails
                </label>
                <select
                  id={`${fieldPrefix}-retry-${index}`}
                  name="step_retry"
                  value={step.retry_policy}
                  onChange={(event) =>
                    updateStep(index, {
                      retry_policy: event.target.value === "none" ? "none" : "manual",
                    })
                  }
                  className={`mt-1 ${inputClass}`}
                >
                  <option value="manual">A person may retry it</option>
                  <option value="none">No retry — the failure ends the run</option>
                </select>
              </div>

              <div className={step.kind === "connector_action" ? "mt-3 grid gap-3 sm:grid-cols-2" : "hidden"}>
                <div>
                  <label className="text-xs font-semibold text-ink" htmlFor={`${fieldPrefix}-connector-${index}`}>
                    Connector
                  </label>
                  <select
                    id={`${fieldPrefix}-connector-${index}`}
                    name="step_connector"
                    value={step.config.connector ?? ""}
                    onChange={(event) =>
                      updateStep(index, {
                        config: { ...step.config, connector: event.target.value },
                      })
                    }
                    className={`mt-1 ${inputClass}`}
                  >
                    <option value="">Choose a connector</option>
                    {CONNECTORS.map((connector) => (
                      <option key={connector.id} value={connector.id}>
                        {connector.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-ink" htmlFor={`${fieldPrefix}-destination-${index}`}>
                    Destination label
                  </label>
                  <input
                    id={`${fieldPrefix}-destination-${index}`}
                    name="step_destination"
                    maxLength={WORKFLOW_DESTINATION_MAX}
                    value={step.config.destination ?? ""}
                    onChange={(event) =>
                      updateStep(index, {
                        config: { ...step.config, destination: event.target.value },
                      })
                    }
                    placeholder="e.g. Weekly updates (demo)"
                    className={`mt-1 ${inputClass}`}
                  />
                </div>
              </div>

              {/* Kept in the form even when hidden, so the parallel inputs stay aligned. */}
              {step.kind === "connector_action" ? null : (
                <>
                  <input type="hidden" name="step_connector" value={step.config.connector ?? ""} />
                  <input type="hidden" name="step_destination" value={step.config.destination ?? ""} />
                </>
              )}
            </li>
          ))}
        </ol>

        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-40 flex-1">
            <label className={labelClass} htmlFor={`${fieldPrefix}-new-kind`}>
              Add a step
            </label>
            <select
              id={`${fieldPrefix}-new-kind`}
              value={newKind}
              onChange={(event) => setNewKind(event.target.value as WorkflowStepKind)}
              className={`mt-1.5 ${inputClass}`}
            >
              {WORKFLOW_STEP_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {STEP_KIND_LABELS[kind]}
                </option>
              ))}
            </select>
          </div>
          <button type="button" onClick={addStep} className={secondaryButton}>
            Add step
          </button>
        </div>
      </div>

      <Message state={state} />

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton
          pendingLabel={workflowId ? "Saving a new version…" : "Creating…"}
          className={primaryButton}
        >
          {workflowId ? "Save as a new version" : "Create workflow"}
        </SubmitButton>
        <p className="text-xs text-muted">
          {workflowId
            ? "Saving adds a version. Runs already in progress keep the steps they started with."
            : "Nothing runs until you start it."}
        </p>
      </div>

      <p className="text-xs leading-relaxed text-muted">{WORKFLOW_SCOPE_NOTE}</p>
      <p className="text-xs leading-relaxed text-muted">{NO_REAL_CONNECTOR_NOTE}</p>
    </form>
  );
}

export function StartWorkflowForm({ workflowId }: { workflowId: string }) {
  const [state, formAction] = useActionState(startWorkflowRunAction, idleFormState);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="workflow_id" value={workflowId} />
      <Message state={state} />
      <SubmitButton pendingLabel="Starting…" className={primaryButton}>
        Start a run
      </SubmitButton>
    </form>
  );
}

export function DeleteWorkflowForm({ workflowId }: { workflowId: string }) {
  const [state, formAction] = useActionState(deleteWorkflowAction, idleFormState);

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="workflow_id" value={workflowId} />
      <Message state={state} />
      <p className="text-xs text-muted">
        Deleting removes the workflow and its versions. Runs already started keep
        their steps, outputs and action records.
      </p>
      <SubmitButton pendingLabel="Deleting…" className={dangerButton}>
        Delete workflow
      </SubmitButton>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Run panel
// ---------------------------------------------------------------------------

function outputText(output: unknown): string {
  if (typeof output !== "object" || output === null) return "";
  const record = output as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  if (typeof record.notes === "string" && record.notes.trim() !== "") return record.notes;
  if (typeof record.message === "string") return record.message;
  return "";
}

function StepBadge({ status }: { status: RunStepStatus }) {
  const tone =
    status === "failed" || status === "outcome_uncertain"
      ? "text-danger"
      : status === "succeeded"
        ? "text-mint"
        : "text-muted";
  return <span className={`text-xs font-semibold ${tone}`}>{STEP_STATUS_LABELS[status]}</span>;
}

function ActionCard({
  action,
  approval,
  runId,
}: {
  action: ActionRecord;
  approval: ActionApproval | undefined;
  runId: string;
}) {
  const [approveState, approveAction] = useActionState(approveWorkflowActionAction, idleFormState);
  const [executeState, executeAction] = useActionState(executeWorkflowActionAction, idleFormState);
  const connector = getConnector(action.connector);

  return (
    <div className="rounded-xl border border-line bg-paper p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          {connector?.label ?? action.connector} → {action.destination}
        </p>
        <span className={chipClass}>{action.status.replaceAll("_", " ")}</span>
      </div>

      <p className="mt-1 text-xs text-muted">
        Content hash {action.content_hash.slice(0, 12)}… · attempt {action.attempts} ·{" "}
        {action.simulated ? "simulated" : "live"}
      </p>

      <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-card p-3 text-sm">
        {action.content}
      </pre>

      {action.status === "pending_approval" ? (
        <form action={approveAction} className="mt-3 space-y-2">
          <input type="hidden" name="run_id" value={runId} />
          <input type="hidden" name="action_id" value={action.id} />
          <p className="text-xs text-muted">
            Approving covers this connector, this destination and exactly this
            text. Changing any of them requires a new approval.
          </p>
          <Message state={approveState} />
          <SubmitButton pendingLabel="Approving…" className={secondaryButton}>
            Approve this exact content
          </SubmitButton>
        </form>
      ) : null}

      {action.status === "approved" ? (
        <form action={executeAction} className="mt-3 space-y-2">
          <input type="hidden" name="run_id" value={runId} />
          <input type="hidden" name="action_id" value={action.id} />
          <p className="text-xs text-muted">
            Approved{" "}
            {approval ? formatWorkflowTime(approval.approved_at) : ""}. Running it
            can happen once; the approval is consumed.
          </p>
          <Message state={executeState} />
          <SubmitButton pendingLabel="Running…" className={primaryButton}>
            Run this approved action
          </SubmitButton>
        </form>
      ) : null}

      {action.status === "executing" ? (
        <p className="mt-3 text-sm text-muted">
          This action is running. It will not be started a second time.
        </p>
      ) : null}

      {action.external_ref ? (
        <p className="mt-2 text-xs text-muted">Recorded as {action.external_ref}</p>
      ) : null}
      {action.last_error ? (
        <p className="mt-2 text-sm text-danger">{action.last_error}</p>
      ) : null}
      <p className="mt-2 text-xs leading-relaxed text-muted">{SIMULATED_ACTION_NOTE}</p>
    </div>
  );
}

export function WorkflowRunPanel({ detail }: { detail: WorkflowRunDetail }) {
  const { run, steps, actions, approvals, work } = detail;
  const context = parseRunContext(run.context);
  const progress = runProgress(steps);
  const outputs = preservedOutputs(steps);

  const [inputState, inputAction] = useActionState(saveWorkflowInputAction, idleFormState);
  const [draftState, draftAction] = useActionState(generateWorkflowDraftAction, idleFormState);
  const [reviewState, reviewAction] = useActionState(approveWorkflowDraftAction, idleFormState);
  const [requestState, requestAction] = useActionState(
    requestWorkflowActionAction,
    idleFormState,
  );
  const [checkpointState, checkpointAction] = useActionState(
    completeCheckpointAction,
    idleFormState,
  );
  const [retryState, retryAction] = useActionState(retryWorkflowStepAction, idleFormState);
  const [cancelState, cancelAction] = useActionState(cancelWorkflowRunAction, idleFormState);

  const current =
    steps.find(
      (step) =>
        step.status === "waiting_for_input" ||
        step.status === "running" ||
        step.status === "waiting_for_approval" ||
        step.status === "failed" ||
        step.status === "outcome_uncertain",
    ) ?? null;

  const currentActions = current
    ? actions.filter((action) => action.run_step_id === current.id)
    : [];
  const liveAction =
    currentActions.find((action) =>
      ["pending_approval", "approved", "executing", "succeeded"].includes(action.status),
    ) ?? null;
  const liveApproval = liveAction
    ? approvals.find((approval) => approval.action_id === liveAction.id)
    : undefined;

  const terminal = ["succeeded", "cancelled", "outcome_uncertain"].includes(run.status);

  return (
    <div className="space-y-6">
      <section className={cardClass}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-2xl font-black leading-tight tracking-tight">
              {run.workflow_name}
            </h1>
            <p className="mt-1 text-sm text-muted">
              Version {run.workflow_version} · started {formatWorkflowTime(run.started_at)}
              {work.goalTitle ? ` · ${work.goalTitle}` : ""}
            </p>
          </div>
          <span className={chipClass}>
            {RUN_STATUS_LABELS[run.status as RunStatus] ?? run.status}
          </span>
        </div>

        <p className="mt-3 text-sm text-muted">
          {progress.done} of {progress.total} steps done ({progress.percent}%).
        </p>

        {terminal ? (
          <p className="mt-3 text-sm leading-relaxed">
            {run.status === "succeeded"
              ? "Every step succeeded and you confirmed the checkpoint. The record below is what happened."
              : run.status === "cancelled"
                ? "Remaining steps were cancelled. Steps that already succeeded keep their outputs."
                : "An action may have reached the connector. It will not be retried automatically; check the destination before starting a new run."}
          </p>
        ) : (
          <form action={cancelAction} className="mt-4 space-y-2">
            <input type="hidden" name="run_id" value={run.id} />
            <Message state={cancelState} />
            {canCancelRun(run.status as RunStatus) ? (
              <SubmitButton pendingLabel="Cancelling…" className={secondaryButton}>
                Cancel remaining steps
              </SubmitButton>
            ) : null}
          </form>
        )}
      </section>

      <section aria-labelledby="steps-heading" className="space-y-3">
        <h2 id="steps-heading" className="text-lg font-bold">
          Steps
        </h2>
        <ol className="space-y-2">
          {steps.map((step) => (
            <li key={step.id} className="rounded-xl border border-line bg-card p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold">
                  {step.position}. {describeStep(step)}
                </p>
                <StepBadge status={step.status} />
              </div>
              {step.instructions ? (
                <p className="mt-1 text-xs leading-relaxed text-muted">{step.instructions}</p>
              ) : null}
              {step.error_code ? (
                <p className="mt-1 text-sm text-danger">
                  {workflowErrorMessage(step.error_code)}
                </p>
              ) : null}
              {outputText(step.output) ? (
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-paper p-2 text-xs">
                  {outputText(step.output)}
                </pre>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      {!terminal && current ? (
        <section aria-labelledby="current-heading" className={cardClass}>
          <h2 id="current-heading" className="text-lg font-bold">
            Now: {STEP_KIND_LABELS[current.kind]}
          </h2>
          <p className="mt-1 text-sm text-muted">{current.title}</p>

          {current.status === "failed" ? (
            <div className="mt-4 space-y-3">
              <p className="text-sm leading-relaxed text-danger">
                {workflowErrorMessage(run.error_code ?? undefined)} The outputs of
                earlier steps are kept.
              </p>
              {canRetryStep(current, currentActions) ? (
                <form action={retryAction} className="space-y-2">
                  <input type="hidden" name="run_id" value={run.id} />
                  <Message state={retryState} />
                  <SubmitButton pendingLabel="Reopening…" className={secondaryButton}>
                    Retry this step
                  </SubmitButton>
                  <p className={hintClass}>
                    {current.kind === "connector_action"
                      ? "A new attempt needs its own exact-content approval. The failed attempt stays in the record."
                      : "Only this step starts again. Completed steps and their outputs are not repeated."}
                  </p>
                </form>
              ) : (
                <p className="text-sm text-muted">
                  This step does not allow a retry. Start a new run to try again.
                </p>
              )}
            </div>
          ) : null}

          {current.status === "waiting_for_input" && current.kind === "user_input" ? (
            <form action={inputAction} className="mt-4 space-y-4">
              <input type="hidden" name="run_id" value={run.id} />

              <div>
                <label className={labelClass} htmlFor="workflow-notes">
                  What should the update include?
                </label>
                <textarea
                  id="workflow-notes"
                  name="notes"
                  rows={3}
                  maxLength={MAX_INPUT_NOTES}
                  defaultValue={context.inputs ?? ""}
                  placeholder="Anything the draft should reflect: what changed, what is next."
                  className={`mt-1.5 ${inputClass}`}
                />
              </div>

              <fieldset>
                <legend className={labelClass}>Completed work to include</legend>
                {work.completed.length === 0 ? (
                  <p className={hintClass}>
                    No completed tasks on this goal yet. The notes above are enough
                    to draft from.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {work.completed.map((task) => (
                      <li key={task.id} className="flex items-start gap-2 text-sm">
                        <input
                          id={`task-${task.id}`}
                          type="checkbox"
                          name="task_id"
                          value={task.id}
                          defaultChecked={(context.selectedTaskIds ?? []).includes(task.id)}
                          className="mt-1"
                        />
                        <label htmlFor={`task-${task.id}`} className="leading-snug">
                          {task.title}
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </fieldset>

              <Message state={inputState} />
              <SubmitButton pendingLabel="Saving…" className={primaryButton}>
                Save input and continue
              </SubmitButton>
            </form>
          ) : null}

          {current.kind === "ai_draft" ? (
            <form action={draftAction} className="mt-4 space-y-2">
              <input type="hidden" name="run_id" value={run.id} />
              <p className="text-sm leading-relaxed text-muted">
                The draft uses only your notes and the selected completed work.
                It costs one AI request and is not sent anywhere.
              </p>
              <Message state={draftState} />
              <SubmitButton pendingLabel="Drafting…" className={primaryButton}>
                Generate the draft
              </SubmitButton>
            </form>
          ) : null}

          {current.status === "waiting_for_approval" && current.kind === "user_review" ? (
            <form action={reviewAction} className="mt-4 space-y-3">
              <input type="hidden" name="run_id" value={run.id} />
              <label className={labelClass} htmlFor="workflow-draft">
                Draft — edit anything before approving
              </label>
              <textarea
                id="workflow-draft"
                name="draft"
                rows={12}
                maxLength={MAX_DRAFT_LENGTH}
                defaultValue={context.draft ?? context.reviewed ?? ""}
                className={`mt-1.5 ${inputClass} font-mono text-sm`}
              />
              <p className={hintClass}>
                Approving approves this exact text. It does not authorize any
                future recipient, destination or content.
              </p>
              <Message state={reviewState} />
              <SubmitButton pendingLabel="Approving…" className={primaryButton}>
                Approve this text
              </SubmitButton>
            </form>
          ) : null}

          {current.status !== "failed" && current.kind === "connector_action" ? (
            <div className="mt-4 space-y-3">
              {liveAction ? (
                <ActionCard
                  action={liveAction}
                  approval={liveApproval}
                  runId={run.id}
                />
              ) : (
                <form action={requestAction} className="space-y-3">
                  <input type="hidden" name="run_id" value={run.id} />
                  <p className="text-sm leading-relaxed text-muted">
                    This workflow may save the approved text through{" "}
                    {getConnector(current.config?.connector ?? "demo_notes")?.label ??
                      "an unavailable connector"}
                    . Nothing happens until you approve the exact content.
                  </p>
                  <pre className="max-h-52 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-paper p-3 text-sm">
                    {context.reviewed ?? "No approved text yet."}
                  </pre>
                  <Message state={requestState} />
                  <SubmitButton
                    pendingLabel="Preparing…"
                    className={secondaryButton}
                    disabled={!context.reviewed}
                  >
                    Prepare this action for approval
                  </SubmitButton>
                </form>
              )}
              <p className="text-xs leading-relaxed text-muted">{NO_REAL_CONNECTOR_NOTE}</p>
            </div>
          ) : null}

          {current.status === "waiting_for_input" && current.kind === "checkpoint" ? (
            <form action={checkpointAction} className="mt-4 space-y-3">
              <input type="hidden" name="run_id" value={run.id} />
              <p className="text-sm leading-relaxed text-muted">
                Nothing marks this run finished on its own. Confirm the work is
                done wherever it needed to go.
              </p>
              <Message state={checkpointState} />
              <SubmitButton pendingLabel="Confirming…" className={primaryButton}>
                Mark this run complete
              </SubmitButton>
            </form>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="outputs-heading" className="space-y-2">
        <h2 id="outputs-heading" className="text-lg font-bold">
          Outputs kept
        </h2>
        {outputs.length === 0 ? (
          <p className="text-sm text-muted">Nothing produced yet.</p>
        ) : (
          <ul className="space-y-2">
            {outputs.map((output) => (
              <li key={output.position} className="rounded-xl border border-line bg-card p-3">
                <p className="text-sm font-semibold">
                  {output.position}. {output.title}
                </p>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-sm">
                  {outputText(output.output) || "(recorded)"}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={cardClass}>
        <h2 className="text-lg font-bold">Action records</h2>
        {actions.length === 0 ? (
          <p className="mt-1 text-sm text-muted">
            No external action has been attempted. Nothing in this run can call a
            service on its own.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {actions.map((action) => (
              <li key={action.id}>
                <ActionCard
                  action={action}
                  approval={approvals.find((approval) => approval.action_id === action.id)}
                  runId={run.id}
                />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs leading-relaxed text-muted">{SIMULATED_ACTION_NOTE}</p>
      </section>

      <p className="text-xs leading-relaxed text-muted">{WORKFLOW_SCOPE_NOTE}</p>
    </div>
  );
}

/** Small preview of what a run would do, before starting it. */
export function WorkflowPreview({
  steps,
  connectorLabel,
}: {
  steps: {
    kind: WorkflowStepKind;
    title: string;
    instructions: string;
    config: { connector?: string; destination?: string };
  }[];
  connectorLabel?: string;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm leading-relaxed text-muted">
        Starting creates a run with these steps. It waits for you at the input,
        review and checkpoint steps, and any connector action needs its own
        exact-content approval.
      </p>
      <ol className="space-y-1 text-sm">
        {steps.map((step, index) => (
          <li key={index}>
            <span className="font-semibold">{index + 1}. {STEP_KIND_LABELS[step.kind]}</span>
            {" — "}
            {step.title}
            {step.kind === "connector_action" && step.config.destination
              ? ` → ${connectorLabel ?? step.config.connector ?? "connector"}: ${step.config.destination}`
              : ""}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function RunRow({
  run,
  href,
}: {
  run: Pick<WorkflowRun, "id" | "status" | "created_at" | "workflow_version">;
  href: string;
}) {
  return (
    <li className={cardClass}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={href} className={`rounded text-sm font-semibold hover:underline ${focusRing}`}>
          Run from {formatWorkflowTime(run.created_at)}
        </Link>
        <span className={chipClass}>{RUN_STATUS_LABELS[run.status as RunStatus] ?? run.status}</span>
      </div>
      <p className="mt-1 text-xs text-muted">Version {run.workflow_version}</p>
    </li>
  );
}
