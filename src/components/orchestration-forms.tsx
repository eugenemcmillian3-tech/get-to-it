"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import {
  idleOrchestrationState,
  type OrchestrationState,
} from "@/lib/action-state";
import {
  addEvidenceAction,
  approveContractAction,
  createOrchestrationAction,
  createPrototypeAction,
  decideCheckpointAction,
  generatePlanAction,
  requestCheckpointAction,
  reserveTaskAction,
  saveOrchestrationReviewAction,
  settleTaskAction,
  submitContractAction,
  transitionAction,
  verifyTaskAction,
} from "@/lib/actions/orchestration";
import type {
  CheckpointRow,
  ContractRow,
  OrchestrationCandidates,
  ReviewRow,
  TaskRow,
} from "@/lib/data/orchestration";
import {
  ALLOWED_TOOLS,
  DELIVERABLE_KIND_NOTES,
  EVIDENCE_KINDS,
  EVIDENCE_KIND_LABELS,
  EXECUTION_ENVIRONMENTS,
  ORIGIN_LABELS,
  REVIEW_DECISIONS,
  REVIEW_DECISION_LABELS,
  VERIFICATION_METHODS,
  VERIFICATION_METHOD_LABELS,
  VERIFICATION_NOTE,
  CHECKPOINT_LABELS,
  type CheckpointKind,
  type OrchestrationOrigin,
  type OrchestrationStatus,
  type ReviewDecision,
} from "@/lib/orchestration";
import {
  cardClass,
  hintClass,
  inputClass,
  labelClass,
  quietButton,
  secondaryButton,
} from "@/lib/styles";

function StateNote({ state }: { state: OrchestrationState }) {
  if (state.status === "error") {
    return (
      <p className="text-sm text-danger" role="alert">
        {state.message}
      </p>
    );
  }
  if (state.status === "success") {
    return <p className="text-sm text-mint">{state.message}</p>;
  }
  return null;
}

const ORIGIN_ORDER: OrchestrationOrigin[] = [
  "mission",
  "experiment",
  "learning_goal",
  "radar_signal",
  "future_path",
  "outcome_review",
  "new_goal",
];

export function OrchestrationCreateForm({
  workspaceId,
  candidates,
  defaultReviewAt,
}: {
  workspaceId: string;
  candidates: OrchestrationCandidates;
  defaultReviewAt: string;
}) {
  const [state, formAction] = useActionState(
    createOrchestrationAction,
    idleOrchestrationState,
  );
  const [origin, setOrigin] = useState<OrchestrationOrigin>("mission");

  const options =
    origin === "mission"
      ? candidates.missions
      : origin === "experiment"
        ? candidates.experiments
        : origin === "learning_goal"
          ? candidates.learningGoals
          : origin === "radar_signal"
            ? candidates.radarSignals
            : origin === "future_path"
              ? candidates.futurePaths
              : origin === "outcome_review"
                ? candidates.outcomeReviews
                : [];

  const selected =
    options.find((option) => option.id === "") ?? null;

  return (
    <form action={formAction} className={cardClass}>
      <h2 className="text-lg font-bold">Start an orchestration</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Link an existing mission, experiment, learning goal, opportunity or
        earlier review — or turn a new goal into a mission. The contract is
        drafted first; nothing runs until a person approves that exact version.
      </p>
      <input type="hidden" name="workspace_id" value={workspaceId} />

      <div className="mt-4 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="orchestration-origin">
              Start from
            </label>
            <select
              id="orchestration-origin"
              name="origin_kind"
              value={origin}
              onChange={(event) =>
                setOrigin(event.target.value as OrchestrationOrigin)
              }
              className={`mt-1.5 ${inputClass}`}
            >
              {ORIGIN_ORDER.map((value) => (
                <option key={value} value={value}>
                  {ORIGIN_LABELS[value]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass} htmlFor="orchestration-origin-id">
              {origin === "new_goal" ? "Existing record" : "Which record"}
            </label>
            {origin === "new_goal" ? (
              <p className="mt-1.5 rounded-xl border border-line bg-paper px-3.5 py-2.5 text-sm text-muted">
                A new mission is created from the goal below. Nothing existing is
                copied.
              </p>
            ) : (
              <select
                id="orchestration-origin-id"
                name="origin_id"
                required
                className={`mt-1.5 ${inputClass}`}
                defaultValue=""
              >
                <option value="" disabled>
                  Choose a record
                </option>
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label} — {option.detail}
                  </option>
                ))}
              </select>
            )}
            {origin === "new_goal" ? null : selected ? null : options.length ===
              0 ? (
              <p className={hintClass}>
                Nothing to link yet. Create a mission or experiment in this
                workspace first, or start from a new goal.
              </p>
            ) : null}
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="orchestration-goal">
            Goal
          </label>
          <input
            id="orchestration-goal"
            name="goal"
            required
            minLength={8}
            maxLength={1000}
            placeholder="Ship a prototype that lets volunteers find the next shift"
            className={`mt-1.5 ${inputClass}`}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="orchestration-stakeholders">
              Stakeholders
            </label>
            <input
              id="orchestration-stakeholders"
              name="stakeholders"
              required
              minLength={5}
              maxLength={2000}
              placeholder="Volunteers, the coordinator, and people considering joining"
              className={`mt-1.5 ${inputClass}`}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="orchestration-review-at">
              Review date
            </label>
            <input
              id="orchestration-review-at"
              name="review_at"
              type="date"
              required
              defaultValue={defaultReviewAt}
              className={`mt-1.5 ${inputClass}`}
            />
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="orchestration-scope">
            Scope
          </label>
          <textarea
            id="orchestration-scope"
            name="scope"
            required
            minLength={10}
            maxLength={2000}
            rows={3}
            placeholder="One prototype with three pages, built in the existing sandbox and reviewed before any deployment."
            className={`mt-1.5 ${inputClass}`}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="orchestration-exclusions">
            Explicit exclusions (one per line)
          </label>
          <textarea
            id="orchestration-exclusions"
            name="exclusions"
            required
            rows={3}
            placeholder={"No real outreach\nNo public launch\nNo payment or paid ads"}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="orchestration-evidence">
              Evidence available
            </label>
            <textarea
              id="orchestration-evidence"
              name="evidence_available"
              rows={3}
              placeholder="What you already know, or say plainly that there is none."
              className={`mt-1.5 ${inputClass}`}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="orchestration-assumptions">
              Assumptions
            </label>
            <textarea
              id="orchestration-assumptions"
              name="assumptions"
              rows={3}
              placeholder="What would have to be true for this goal to make sense?"
              className={`mt-1.5 ${inputClass}`}
            />
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="orchestration-questions">
            Unresolved questions
          </label>
          <textarea
            id="orchestration-questions"
            name="unresolved_questions"
            rows={2}
            placeholder="What is still unknown before you start?"
            className={`mt-1.5 ${inputClass}`}
          />
        </div>

        <fieldset className="rounded-xl border border-line p-3">
          <legend className="px-1 text-sm font-semibold">
            Intended outcomes, labelled honestly
          </legend>
          <p className="text-xs leading-relaxed text-muted">
            {DELIVERABLE_KIND_NOTES.deliverable} {DELIVERABLE_KIND_NOTES.observation}{" "}
            {DELIVERABLE_KIND_NOTES.external_effect}
          </p>
          <div className="mt-3 space-y-3">
            <div>
              <label className={labelClass} htmlFor="orchestration-deliverables">
                Deliverables the system can produce (one per line)
              </label>
              <textarea
                id="orchestration-deliverables"
                name="deliverable_lines"
                required
                rows={2}
                placeholder="A three-page prototype that runs in the sandbox"
                className={`mt-1.5 ${inputClass}`}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="orchestration-observations">
                Outcomes that require observation (one per line)
              </label>
              <textarea
                id="orchestration-observations"
                name="observation_lines"
                rows={2}
                placeholder="Whether volunteers can finish the flow without help"
                className={`mt-1.5 ${inputClass}`}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="orchestration-external">
                External effects that cannot be guaranteed (one per line)
              </label>
              <textarea
                id="orchestration-external"
                name="external_effect_lines"
                rows={2}
                placeholder="A coordinator agrees to try it with their group"
                className={`mt-1.5 ${inputClass}`}
              />
            </div>
          </div>
        </fieldset>

        <div>
          <label className={labelClass} htmlFor="orchestration-criteria">
            Acceptance criteria — one per line:{" "}
            <span className="font-mono text-xs text-muted">
              criterion :: automated_test
            </span>
          </label>
          <textarea
            id="orchestration-criteria"
            name="criteria_lines"
            required
            rows={3}
            placeholder={"A visitor can finish the flow without help :: direct_observation\nEvery page builds and the generated tests pass :: automated_test"}
            className={`mt-1.5 ${inputClass}`}
          />
          <p className={hintClass}>
            Methods: {VERIFICATION_METHODS.map((method) => VERIFICATION_METHOD_LABELS[method]).join(", ")}.
            {" "}A criterion with no method cannot be verified.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <fieldset className="rounded-xl border border-line p-3">
            <legend className="px-1 text-sm font-semibold">Allowed tools</legend>
            {ALLOWED_TOOLS.map((tool) => (
              <label key={tool} className="mt-1 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="allowed_tools"
                  value={tool}
                  defaultChecked={
                    tool === "workspace_read" ||
                    tool === "app_builder_generate" ||
                    tool === "sandbox_run_tests"
                  }
                />
                <span className="font-mono text-xs">{tool}</span>
              </label>
            ))}
          </fieldset>
          <fieldset className="rounded-xl border border-line p-3">
            <legend className="px-1 text-sm font-semibold">
              Execution environments
            </legend>
            {EXECUTION_ENVIRONMENTS.map((environment) => (
              <label
                key={environment}
                className="mt-1 flex items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  name="execution_environments"
                  value={environment}
                  defaultChecked={environment === "sandbox"}
                />
                <span>{environment}</span>
              </label>
            ))}
          </fieldset>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="orchestration-credits">
              Maximum authorized credits
            </label>
            <input
              id="orchestration-credits"
              name="max_credits"
              type="number"
              min={1}
              max={200}
              defaultValue={10}
              required
              className={`mt-1.5 ${inputClass}`}
            />
            <p className={hintClass}>
              1 credit = $0.10 retail. Pricing is fixed by the existing rate card;
              this is a ceiling, not a price change.
            </p>
          </div>
          <div>
            <label className={labelClass} htmlFor="orchestration-time">
              Time limit (minutes)
            </label>
            <input
              id="orchestration-time"
              name="time_limit_minutes"
              type="number"
              min={15}
              max={10080}
              defaultValue={240}
              required
              className={`mt-1.5 ${inputClass}`}
            />
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="orchestration-resources">
            Resource limits
          </label>
          <input
            id="orchestration-resources"
            name="resource_limits"
            placeholder="One person, no paid ads, one sandbox"
            className={`mt-1.5 ${inputClass}`}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="orchestration-privacy">
              Privacy constraints
            </label>
            <textarea
              id="orchestration-privacy"
              name="privacy_constraints"
              required
              rows={2}
              placeholder="No personal data leaves the workspace; no analytics on participants."
              className={`mt-1.5 ${inputClass}`}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="orchestration-consent">
              Consent constraints
            </label>
            <textarea
              id="orchestration-consent"
              name="consent_constraints"
              required
              rows={2}
              placeholder="Ask before recording anything a person says; participation is voluntary."
              className={`mt-1.5 ${inputClass}`}
            />
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="orchestration-stop">
            Stop conditions
          </label>
          <textarea
            id="orchestration-stop"
            name="stop_conditions"
            required
            rows={2}
            placeholder="Stop if anyone cannot find the way to stop, or if a check fails twice."
            className={`mt-1.5 ${inputClass}`}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="orchestration-decisions">
            Required human decisions (one per line)
          </label>
          <textarea
            id="orchestration-decisions"
            name="required_human_decisions"
            rows={2}
            placeholder={"Approve any deployment\nApprove any contact with real people"}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Drafting contract…">Draft the contract</SubmitButton>
        <StateNote state={state} />
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted">
        {VERIFICATION_NOTE}
      </p>
    </form>
  );
}

export function SubmitContractForm({
  workspaceId,
  orchestrationId,
}: {
  workspaceId: string;
  orchestrationId: string;
}) {
  const [state, formAction] = useActionState(
    submitContractAction,
    idleOrchestrationState,
  );
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="orchestration_id" value={orchestrationId} />
      <SubmitButton pendingLabel="Submitting…">Submit for approval</SubmitButton>
      <StateNote state={state} />
    </form>
  );
}

export function ApproveContractForm({
  workspaceId,
  orchestrationId,
  contract,
}: {
  workspaceId: string;
  orchestrationId: string;
  contract: ContractRow;
}) {
  const [state, formAction] = useActionState(
    approveContractAction,
    idleOrchestrationState,
  );
  return (
    <form action={formAction} className="mt-3 space-y-2">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="orchestration_id" value={orchestrationId} />
      <input type="hidden" name="contract_id" value={contract.id} />
      <label className={labelClass} htmlFor="orchestration-approval-note">
        Approval note (optional)
      </label>
      <input
        id="orchestration-approval-note"
        name="note"
        placeholder="I reviewed version 1 and the scope is what I intend."
        className={inputClass}
      />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Recording…">
          Approve version {contract.version}
        </SubmitButton>
        <StateNote state={state} />
      </div>
    </form>
  );
}

export function GeneratePlanForm({
  workspaceId,
  orchestrationId,
}: {
  workspaceId: string;
  orchestrationId: string;
}) {
  const [state, formAction] = useActionState(
    generatePlanAction,
    idleOrchestrationState,
  );
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="orchestration_id" value={orchestrationId} />
      <SubmitButton pendingLabel="Drafting plan…">Draft the bounded plan</SubmitButton>
      <StateNote state={state} />
    </form>
  );
}

export function TaskActions({
  workspaceId,
  orchestrationId,
  task,
}: {
  workspaceId: string;
  orchestrationId: string;
  task: TaskRow;
}) {
  const [reserveState, reserveAction] = useActionState(
    reserveTaskAction,
    idleOrchestrationState,
  );
  const [settleState, settleAction] = useActionState(
    settleTaskAction,
    idleOrchestrationState,
  );
  const [verifyState, verifyAction] = useActionState(
    verifyTaskAction,
    idleOrchestrationState,
  );

  return (
    <div className="mt-3 space-y-3 border-t border-line pt-3">
      {task.status === "pending" || task.status === "ready" ? (
        <form action={reserveAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="workspace_id" value={workspaceId} />
          <input type="hidden" name="orchestration_id" value={orchestrationId} />
          <input type="hidden" name="task_id" value={task.id} />
          <button type="submit" className={quietButton}>
            Start task and reserve credits
          </button>
          <StateNote state={reserveState} />
        </form>
      ) : null}

      {task.status === "running" ? (
        <form action={settleAction} className="space-y-2">
          <input type="hidden" name="workspace_id" value={workspaceId} />
          <input type="hidden" name="orchestration_id" value={orchestrationId} />
          <input type="hidden" name="task_id" value={task.id} />
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="text-xs font-semibold">
              Outcome
              <select name="outcome" className={`mt-1 ${inputClass}`} defaultValue="produced">
                <option value="produced">Produced</option>
                <option value="failed">Failed</option>
              </select>
            </label>
            <label className="text-xs font-semibold">
              Actual credits used
              <input
                name="actual_credits"
                type="number"
                min={0}
                step="0.001"
                defaultValue={(task.credits_micros / 1_000_000).toFixed(3)}
                className={`mt-1 ${inputClass}`}
              />
            </label>
            <label className="text-xs font-semibold">
              Failure note
              <input
                name="error"
                placeholder="What failed, if anything"
                className={`mt-1 ${inputClass}`}
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton pendingLabel="Recording…">Record result</SubmitButton>
            <StateNote state={settleState} />
          </div>
        </form>
      ) : null}

      {task.status === "produced" ? (
        <form action={verifyAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="workspace_id" value={workspaceId} />
          <input type="hidden" name="orchestration_id" value={orchestrationId} />
          <input type="hidden" name="task_id" value={task.id} />
          <button type="submit" className={quietButton}>
            Verify with attached evidence
          </button>
          <StateNote state={verifyState} />
        </form>
      ) : null}
    </div>
  );
}

export function EvidenceForm({
  workspaceId,
  orchestrationId,
  tasks,
  criteria,
}: {
  workspaceId: string;
  orchestrationId: string;
  tasks: TaskRow[];
  criteria: { key: string; criterion: string }[];
}) {
  const [state, formAction] = useActionState(addEvidenceAction, idleOrchestrationState);

  return (
    <form action={formAction} className={`${cardClass} mt-3`}>
      <h3 className="text-sm font-bold">Attach evidence</h3>
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="orchestration_id" value={orchestrationId} />

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold">
          Task (optional)
          <select name="task_id" className={`mt-1 ${inputClass}`} defaultValue="">
            <option value="">No task</option>
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.task_key} — {task.title.slice(0, 60)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold">
          Acceptance criterion (optional)
          <select name="criterion_key" className={`mt-1 ${inputClass}`} defaultValue="">
            <option value="">No criterion</option>
            {criteria.map((criterion) => (
              <option key={criterion.key} value={criterion.key}>
                {criterion.key} — {criterion.criterion.slice(0, 60)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold">
          Kind
          <select name="kind" className={`mt-1 ${inputClass}`} defaultValue="automated_test">
            {EVIDENCE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {EVIDENCE_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold">
          Result
          <select name="result" className={`mt-1 ${inputClass}`} defaultValue="pass">
            <option value="pass">Pass</option>
            <option value="fail">Fail</option>
            <option value="inconclusive">Inconclusive</option>
          </select>
        </label>
        <label className="text-xs font-semibold">
          Source or artifact reference
          <input
            name="source_ref"
            required
            placeholder="build/app.log, preview screenshot, interview note"
            className={`mt-1 ${inputClass}`}
          />
        </label>
        <label className="text-xs font-semibold">
          Artifact version
          <input name="artifact_version" placeholder="v1 / commit abc123" className={`mt-1 ${inputClass}`} />
        </label>
        <label className="text-xs font-semibold">
          Verification method
          <input
            name="method"
            required
            placeholder="npm test, manual click-through, document review"
            className={`mt-1 ${inputClass}`}
          />
        </label>
        <label className="text-xs font-semibold">
          Verified by
          <input
            name="verifier"
            required
            placeholder="automated test runner, name of the reviewer"
            className={`mt-1 ${inputClass}`}
          />
        </label>
      </div>
      <label className={`${labelClass} mt-3 block`} htmlFor="orchestration-limitations">
        Known limitations
      </label>
      <textarea
        id="orchestration-limitations"
        name="limitations"
        rows={2}
        placeholder="What this evidence does not cover."
        className={`mt-1 ${inputClass}`}
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Appending…">Append evidence</SubmitButton>
        <StateNote state={state} />
      </div>
    </form>
  );
}

const CHECKPOINT_KINDS: CheckpointKind[] = [
  "external_action_approval",
  "missing_information",
  "consent_missing",
  "budget_shortfall",
  "stop_condition",
  "contradicted_assumption",
  "outside_scope",
  "high_stakes",
];

export function CheckpointForm({
  workspaceId,
  orchestrationId,
  taskKey,
}: {
  workspaceId: string;
  orchestrationId: string;
  taskKey: string;
}) {
  const [state, formAction] = useActionState(
    requestCheckpointAction,
    idleOrchestrationState,
  );
  return (
    <form action={formAction} className="mt-3 space-y-2">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="orchestration_id" value={orchestrationId} />
      <input type="hidden" name="requested_by_kind" value="human" />
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs font-semibold">
          Decision type
          <select name="kind" className={`mt-1 ${inputClass}`} defaultValue="external_action_approval">
            {CHECKPOINT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {CHECKPOINT_LABELS[kind]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold">
          Title
          <input name="title" required placeholder="Approve deployment of the prototype" className={`mt-1 ${inputClass}`} />
        </label>
      </div>
      <label className="block text-xs font-semibold">
        What happened
        <textarea
          name="what_happened"
          required
          rows={2}
          defaultValue={`Task ${taskKey} needs a decision before it continues.`}
          className={`mt-1 ${inputClass}`}
        />
      </label>
      <label className="block text-xs font-semibold">
        Evidence available
        <textarea name="evidence" rows={2} className={`mt-1 ${inputClass}`} />
      </label>
      <label className="block text-xs font-semibold">
        Decision required
        <textarea
          name="decision"
          required
          rows={2}
          placeholder="Approve or reject this specific action, and say why."
          className={`mt-1 ${inputClass}`}
        />
      </label>
      <label className="block text-xs font-semibold">
        Cost and scope implication
        <input name="implication" className={`mt-1 ${inputClass}`} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Recording…">Request a decision</SubmitButton>
        <StateNote state={state} />
      </div>
    </form>
  );
}

export function DecideCheckpointForm({
  workspaceId,
  orchestrationId,
  checkpoint,
}: {
  workspaceId: string;
  orchestrationId: string;
  checkpoint: CheckpointRow;
}) {
  const [state, formAction] = useActionState(
    decideCheckpointAction,
    idleOrchestrationState,
  );
  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-end gap-2">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="orchestration_id" value={orchestrationId} />
      <input type="hidden" name="checkpoint_id" value={checkpoint.id} />
      <label className="text-xs font-semibold">
        Decision
        <select name="decision" className={`mt-1 ${inputClass}`} defaultValue="approved">
          <option value="approved">Approve</option>
          <option value="rejected">Reject</option>
        </select>
      </label>
      <label className="text-xs font-semibold">
        Note
        <input name="note" className={`mt-1 ${inputClass}`} />
      </label>
      <SubmitButton pendingLabel="Recording…">Record decision</SubmitButton>
      <StateNote state={state} />
    </form>
  );
}

const LIFECYCLE_TARGETS: { to: OrchestrationStatus; label: string }[] = [
  { to: "running", label: "Resume" },
  { to: "paused", label: "Pause" },
  { to: "awaiting_input", label: "Needs input" },
  { to: "verifying", label: "Start verification" },
  { to: "awaiting_review", label: "Send to human review" },
  { to: "needs_revision", label: "Needs revision" },
  { to: "stopped", label: "Stop" },
];

export function LifecycleForm({
  workspaceId,
  orchestrationId,
}: {
  workspaceId: string;
  orchestrationId: string;
}) {
  const [state, formAction] = useActionState(
    transitionAction,
    idleOrchestrationState,
  );
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="orchestration_id" value={orchestrationId} />
      <label className="text-xs font-semibold">
        Move to
        <select name="to" className={`mt-1 ${inputClass}`} defaultValue="running">
          {LIFECYCLE_TARGETS.map((target) => (
            <option key={target.to} value={target.to}>
              {target.label}
            </option>
          ))}
          <option value="cancellation_requested">Cancel</option>
        </select>
      </label>
      <label className="text-xs font-semibold">
        Note
        <input name="note" className={`mt-1 ${inputClass}`} />
      </label>
      <button type="submit" className={secondaryButton}>
        Apply
      </button>
      <StateNote state={state} />
    </form>
  );
}

export function ReviewForm({
  workspaceId,
  orchestrationId,
  review,
  canDecide,
}: {
  workspaceId: string;
  orchestrationId: string;
  review: ReviewRow | null;
  canDecide: boolean;
}) {
  const [state, formAction] = useActionState(
    saveOrchestrationReviewAction,
    idleOrchestrationState,
  );

  if (review && review.decision !== "undecided") {
    return (
      <div className={`${cardClass} mt-3`}>
        <p className="text-sm font-semibold">
          Decision: {REVIEW_DECISION_LABELS[review.decision as ReviewDecision]}
        </p>
        <p className="mt-1 text-sm text-muted">
          {review.decision === "accept"
            ? "Accepted by a person. Evidence and unverified items stay attached."
            : "Recorded. The original goal and approved contract stay visible."}
        </p>
        {review.unknown ? (
          <p className="mt-2 text-xs text-muted">Still unknown: {review.unknown}</p>
        ) : null}
      </div>
    );
  }

  if (!canDecide) {
    return (
      <p className="mt-3 text-sm text-muted">
        Only an owner or admin can record the outcome decision.
      </p>
    );
  }

  return (
    <form action={formAction} className={`${cardClass} mt-3`}>
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="orchestration_id" value={orchestrationId} />
      <h3 className="text-sm font-bold">Human outcome decision</h3>
      <label className={`${labelClass} mt-3 block`} htmlFor="orchestration-decision">
        Decision
      </label>
      <select
        id="orchestration-decision"
        name="decision"
        className={`mt-1 ${inputClass}`}
        defaultValue="revise"
      >
        {REVIEW_DECISIONS.map((decision) => (
          <option key={decision} value={decision}>
            {REVIEW_DECISION_LABELS[decision]}
          </option>
        ))}
      </select>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-xs font-semibold">
          What was produced
          <textarea name="built" rows={2} className={`mt-1 ${inputClass}`} />
        </label>
        <label className="text-xs font-semibold">
          What was verified
          <textarea name="verified" rows={2} className={`mt-1 ${inputClass}`} />
        </label>
        <label className="text-xs font-semibold">
          What failed
          <textarea name="failed" rows={2} className={`mt-1 ${inputClass}`} />
        </label>
        <label className="text-xs font-semibold">
          What remains unknown (required)
          <textarea name="unknown" rows={2} required className={`mt-1 ${inputClass}`} />
        </label>
        <label className="text-xs font-semibold">
          Deviations and their approvals
          <textarea name="deviations" rows={2} className={`mt-1 ${inputClass}`} />
        </label>
        <label className="text-xs font-semibold">
          Recommended next steps
          <textarea name="next_steps" rows={2} className={`mt-1 ${inputClass}`} />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Recording…">Record outcome decision</SubmitButton>
        <StateNote state={state} />
      </div>
    </form>
  );
}

export function PrototypeForm({
  workspaceId,
  orchestrationId,
}: {
  workspaceId: string;
  orchestrationId: string;
}) {
  const [state, formAction] = useActionState(
    createPrototypeAction,
    idleOrchestrationState,
  );
  return (
    <form action={formAction} className="mt-3 flex flex-wrap items-center gap-3">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="orchestration_id" value={orchestrationId} />
      <SubmitButton pendingLabel="Creating project…">
        Create the normal app-builder project
      </SubmitButton>
      <StateNote state={state} />
    </form>
  );
}
