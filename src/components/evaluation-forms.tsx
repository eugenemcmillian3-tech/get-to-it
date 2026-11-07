"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleBuildState, type BuildState } from "@/lib/action-state";
import {
  approveEvaluationBudgetAction,
  createEvaluationAction,
  decideEvaluationChangeAction,
  proposeEvaluationChangeAction,
  refreshCapabilityProfilesAction,
  reviewEvaluationRunAction,
  runEvaluationAction,
} from "@/lib/actions/evaluations";
import { EVAL_BUDGET_NOTE, EVAL_LIMITS, EVAL_REVIEW_STATUSES } from "@/lib/evaluations";
import {
  dangerButton,
  inputClass,
  primaryButton,
  secondaryButton,
} from "@/lib/styles";

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
            <a href={state.link} className="underline">
              Open the evaluation
            </a>
          </>
        ) : null}
      </p>
    );
  }
  return <p className="text-sm text-muted">Nothing has been run or changed yet.</p>;
}

export function CreateEvaluationForm({
  projects,
  defaultProjectId,
}: {
  projects: { id: string; name: string; current_version: number }[];
  defaultProjectId?: string;
}) {
  const [state, action] = useActionState(createEvaluationAction, idleBuildState);
  return (
    <form action={action} className="space-y-4">
      <label className="block text-sm font-semibold">
        Evaluation name
        <input
          name="name"
          required
          minLength={3}
          maxLength={80}
          className={`${inputClass} mt-1`}
          placeholder="Bounded change routing — November"
        />
      </label>
      <label className="block text-sm font-semibold">
        What are you comparing?
        <textarea
          name="description"
          maxLength={1000}
          rows={3}
          className={`${inputClass} mt-1`}
          placeholder="Compare a single backend agent with implement-then-review on safe, bounded tasks."
        />
      </label>

      <div className="rounded-xl border border-line bg-paper/60 p-3">
        <label className="block text-sm font-semibold">
          Input project snapshot
          <select
            name="source_project_id"
            defaultValue={defaultProjectId ?? ""}
            className={`${inputClass} mt-1`}
          >
            <option value="">Synthetic evaluation fixture (recommended)</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}{project.current_version > 0 ? ` — version ${project.current_version}` : " — no snapshot"}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-3 block text-sm font-semibold">
          Snapshot version (optional)
          <input
            name="source_version"
            type="number"
            min={1}
            className={`${inputClass} mt-1`}
            placeholder="Use the latest version"
          />
        </label>
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input type="checkbox" name="permission_confirmed" className="mt-1" />
          <span>
            I confirm I am allowed to use this project snapshot for evaluation.
            Never use a private customer project without permission.
          </span>
        </label>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          A project snapshot is stored as task context. Phase 32 candidates are
          deterministic fixture outputs, so no model reads the source project and
          no customer data is sent anywhere.
        </p>
      </div>

      <p className="text-xs leading-relaxed text-muted">
        This seeds all five task categories plus separate held-out tasks, three
        role configurations, acceptance checks, tool allowlists and runtime/request
        limits. Tasks become immutable after the first run.
      </p>
      <SubmitButton className={primaryButton} pendingLabel="Creating workspace…">
        Create evaluation workspace
      </SubmitButton>
      <Note state={state} />
    </form>
  );
}

export function EvaluationBudgetForm({ workspaceId }: { workspaceId: string }) {
  const [state, action] = useActionState(approveEvaluationBudgetAction, idleBuildState);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <label className="block text-sm font-semibold">
        Approved trials
        <input
          name="approved_runs"
          type="number"
          required
          min={EVAL_LIMITS.minBudgetRuns}
          max={EVAL_LIMITS.maxBudgetRuns}
          defaultValue={60}
          className={`${inputClass} mt-1 max-w-40`}
        />
      </label>
      <p className="text-xs leading-relaxed text-muted">{EVAL_BUDGET_NOTE}</p>
      <SubmitButton className={secondaryButton} pendingLabel="Recording approval…">
        Approve run budget
      </SubmitButton>
      <Note state={state} />
    </form>
  );
}

export function RunEvaluationForm({ workspaceId }: { workspaceId: string }) {
  const [state, action] = useActionState(runEvaluationAction, idleBuildState);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <label className="block text-sm font-semibold">
        Trials per task and configuration
        <input
          name="trials"
          type="number"
          required
          min={EVAL_LIMITS.minTrials}
          max={EVAL_LIMITS.maxTrials}
          defaultValue={2}
          className={`${inputClass} mt-1 max-w-40`}
        />
      </label>
      <p className="text-xs leading-relaxed text-muted">
        Repeated trials are recorded separately, including seeded failures. Existing
        trials are skipped. The whole comparison is refused before anything is
        written if the remaining budget is too small.
      </p>
      <SubmitButton className={primaryButton} pendingLabel="Running fixture trials…">
        Run comparison
      </SubmitButton>
      <Note state={state} />
    </form>
  );
}

export function ReviewRunForm({
  workspaceId,
  runId,
  status,
  note,
}: {
  workspaceId: string;
  runId: string;
  status: string;
  note: string;
}) {
  const [state, action] = useActionState(reviewEvaluationRunAction, idleBuildState);
  return (
    <form action={action} className="mt-3 space-y-2 border-t border-line pt-3">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="run_id" value={runId} />
      <div className="grid gap-2 sm:grid-cols-[minmax(0,12rem)_1fr]">
        <label className="block text-sm font-semibold">
          Human review
          <select
            name="review_status"
            defaultValue={status}
            className={`${inputClass} mt-1`}
          >
            {EVAL_REVIEW_STATUSES.map((review) => (
              <option key={review} value={review}>{review.replace("_", " ")}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-semibold">
          Note
          <textarea
            name="review_note"
            rows={2}
            maxLength={EVAL_LIMITS.maxReviewNote}
            defaultValue={note}
            className={`${inputClass} mt-1`}
            placeholder="What did you check? What would you trust this run for?"
          />
        </label>
      </div>
      <SubmitButton className={secondaryButton} pendingLabel="Saving review…">
        Save human review
      </SubmitButton>
      <p className="text-xs text-muted">
        Review annotates the run. It cannot change the deterministic result or any
        recorded evidence.
      </p>
      <Note state={state} />
    </form>
  );
}

export function RefreshProfilesForm({ workspaceId }: { workspaceId: string }) {
  const [state, action] = useActionState(refreshCapabilityProfilesAction, idleBuildState);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <SubmitButton className={secondaryButton} pendingLabel="Updating profiles…">
        Refresh capability profiles
      </SubmitButton>
      <p className="text-xs leading-relaxed text-muted">
        Creates a new version only when the evidence changes. Profiles cite run IDs
        and limitations; they are not a universal intelligence score.
      </p>
      <Note state={state} />
    </form>
  );
}

export function ProposeEvaluationChangeForm({ workspaceId }: { workspaceId: string }) {
  const [state, action] = useActionState(proposeEvaluationChangeAction, idleBuildState);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <SubmitButton className={secondaryButton} pendingLabel="Comparing evidence…">
        Propose an evidence-backed change
      </SubmitButton>
      <p className="text-xs leading-relaxed text-muted">
        Uses shared tasks only. A proposal records a routing/role recommendation and
        a rollback snapshot; it never edits production configuration.
      </p>
      <Note state={state} />
    </form>
  );
}

export function DecideRecommendationForm({
  workspaceId,
  recommendationId,
}: {
  workspaceId: string;
  recommendationId: string;
}) {
  const [state, action] = useActionState(decideEvaluationChangeAction, idleBuildState);
  return (
    <form action={action} className="mt-3 space-y-2 border-t border-line pt-3">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="recommendation_id" value={recommendationId} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton
          className={secondaryButton}
          pendingLabel="Recording decision…"
          name="decision"
          value="approve"
        >
          Approve recommendation
        </SubmitButton>
        <SubmitButton
          className={dangerButton}
          pendingLabel="Recording decision…"
          name="decision"
          value="reject"
        >
          Reject
        </SubmitButton>
      </div>
      <p className="text-xs leading-relaxed text-muted">
        Approval records your decision only. Production routing, prompts and roles
        remain unchanged; apply any change deliberately and keep the rollback
        snapshot.
      </p>
      <Note state={state} />
    </form>
  );
}
