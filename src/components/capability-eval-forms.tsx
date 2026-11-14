"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleBuildState, type BuildState } from "@/lib/action-state";
import {
  completeCapabilityReviewAction,
  createCapabilityEvalAction,
  declineCapabilityReviewAction,
  prepareLiveCapabilityAction,
  recordHumanBaselineAction,
  requestCapabilityReviewAction,
  runCapabilityEvalAction,
  runLiveCapabilityTrialAction,
} from "@/lib/actions/capability-eval";
import type { CapabilityReviewer } from "@/lib/data/capability-eval";
import { AI_MODELS } from "@/lib/ai/models";
import {
  LIVE_TRIAL_COST_CENTS,
  LIVE_TRIAL_CREDIT_COST,
  LIVE_TRIAL_LIMITS,
} from "@/lib/capability-eval-live";
import {
  CAPABILITY_DOMAINS,
  CAPABILITY_LIMITS,
  CAPABILITY_NO_SCORE_NOTE,
} from "@/lib/capability-eval";
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

export function CreateCapabilityEvalForm() {
  const [state, action] = useActionState(createCapabilityEvalAction, idleBuildState);
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
          placeholder="Eight-domain capability check — November"
        />
      </label>
      <label className="block text-sm font-semibold">
        What are you comparing?
        <textarea
          name="description"
          maxLength={1000}
          rows={3}
          className={`${inputClass} mt-1`}
          placeholder="Compare a single-model baseline with the orchestrated system across eight capability domains."
        />
      </label>
      <label className="block text-sm font-semibold">
        Dataset version
        <input
          name="dataset_version"
          maxLength={80}
          defaultValue="dataset-v1"
          className={`${inputClass} mt-1 max-w-60`}
        />
      </label>
      <p className="text-xs leading-relaxed text-muted">
        This seeds all eight domains across development, validation and held-out
        splits, two versioned configurations, per-task rubrics, runtime and spend
        limits, and server-side answer keys the application cannot read.{" "}
        {CAPABILITY_NO_SCORE_NOTE}
      </p>
      <SubmitButton className={primaryButton} pendingLabel="Seeding the evaluation…">
        Create capability evaluation
      </SubmitButton>
      <Note state={state} />
    </form>
  );
}

export function RunCapabilityEvalForm({ evalId }: { evalId: string }) {
  const [state, action] = useActionState(runCapabilityEvalAction, idleBuildState);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="eval_id" value={evalId} />
      <label className="block text-sm font-semibold">
        Trials per task and version
        <input
          name="trials"
          type="number"
          required
          min={1}
          max={CAPABILITY_LIMITS.maxTrials}
          defaultValue={1}
          className={`${inputClass} mt-1 max-w-40`}
        />
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="include_held_out" className="mt-1" defaultChecked />
        <span>
          Include held-out tasks. Repeated held-out exposure is recorded as
          contamination, not hidden.
        </span>
      </label>
      <SubmitButton className={primaryButton} pendingLabel="Recording trials…">
        Run the comparison
      </SubmitButton>
      <p className="text-xs leading-relaxed text-muted">
        Every trial is scored in the database against the stored key. The
        application never receives held-out key content, only counts and a
        failure category. Existing trials are skipped.
      </p>
      <Note state={state} />
    </form>
  );
}

export function HumanBaselineForm({ evalId }: { evalId: string }) {
  const [state, action] = useActionState(recordHumanBaselineAction, idleBuildState);
  return (
    <form action={action} className="mt-3 space-y-3">
      <input type="hidden" name="eval_id" value={evalId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-semibold">
          Domain
          <select name="domain" className={`${inputClass} mt-1`}>
            {CAPABILITY_DOMAINS.map((domain) => (
              <option key={domain.id} value={domain.id}>{domain.label}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-semibold">
          Collected by
          <input name="collected_by" required minLength={3} maxLength={160} className={`${inputClass} mt-1`} />
        </label>
        <label className="block text-sm font-semibold">
          Sample size
          <input
            name="sample_size"
            type="number"
            required
            min={1}
            max={1000}
            className={`${inputClass} mt-1 max-w-40`}
          />
        </label>
        <label className="block text-sm font-semibold">
          Measured results (JSON)
          <input
            name="results"
            required
            className={`${inputClass} mt-1`}
            placeholder='{"verified_rate": 0.62}'
          />
        </label>
      </div>
      <label className="block text-sm font-semibold">
        Collection protocol
        <textarea
          name="protocol_document"
          required
          minLength={CAPABILITY_LIMITS.minProtocolChars}
          maxLength={CAPABILITY_LIMITS.maxProtocolChars}
          rows={4}
          className={`${inputClass} mt-1`}
          placeholder="Who was sampled, how tasks were assigned, how answers were scored, and what was excluded."
        />
      </label>
      <SubmitButton className={secondaryButton} pendingLabel="Recording baseline…">
        Record human baseline
      </SubmitButton>
      <p className="text-xs leading-relaxed text-muted">
        A baseline needs a documented protocol and at least one measured numeric
        result. Nothing is estimated or imputed if you have not collected it.
      </p>
      <Note state={state} />
    </form>
  );
}

export function PrepareLiveTrialForm({ evalId }: { evalId: string }) {
  const [state, action] = useActionState(prepareLiveCapabilityAction, idleBuildState);
  return (
    <form action={action} className="mt-3 space-y-3">
      <input type="hidden" name="eval_id" value={evalId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm font-semibold">
          Model
          <select name="model" className={`${inputClass} mt-1`} defaultValue={AI_MODELS[0]?.id}>
            {AI_MODELS.map((model) => (
              <option key={model.id} value={model.id}>{model.label}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-semibold">
          Spend ceiling (cents)
          <input
            name="spend_limit_cents"
            type="number"
            required
            min={LIVE_TRIAL_LIMITS.minSpendCents}
            max={LIVE_TRIAL_LIMITS.maxSpendCents}
            defaultValue={LIVE_TRIAL_COST_CENTS}
            className={`${inputClass} mt-1`}
          />
        </label>
        <label className="block text-sm font-semibold">
          Runtime limit (seconds)
          <input
            name="runtime_seconds"
            type="number"
            required
            min={LIVE_TRIAL_LIMITS.minRuntimeSeconds}
            max={LIVE_TRIAL_LIMITS.maxRuntimeSeconds}
            defaultValue={120}
            className={`${inputClass} mt-1`}
          />
        </label>
      </div>
      <SubmitButton className={secondaryButton} pendingLabel="Adding the live task set…">
        Add a machine-checkable task set
      </SubmitButton>
      <p className="text-xs leading-relaxed text-muted">
        Adds one development and one held-out task whose expected answers are stored
        only in the answer key, plus a paid configuration. Nothing is charged here.
        A live trial costs {LIVE_TRIAL_CREDIT_COST} credits (
        {LIVE_TRIAL_COST_CENTS} cents).
      </p>
      <Note state={state} />
    </form>
  );
}

export function RunLiveTrialForm({
  evalId,
  tasks,
  versions,
}: {
  evalId: string;
  tasks: { id: string; title: string }[];
  versions: { id: string; label: string }[];
}) {
  const [state, action] = useActionState(runLiveCapabilityTrialAction, idleBuildState);
  return (
    <form action={action} className="mt-3 space-y-3">
      <input type="hidden" name="eval_id" value={evalId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-semibold">
          Machine-checkable task
          <select name="task_id" className={`${inputClass} mt-1`}>
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>{task.title}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-semibold">
          Configuration
          <select name="version_id" className={`${inputClass} mt-1`}>
            {versions.map((version) => (
              <option key={version.id} value={version.id}>{version.label}</option>
            ))}
          </select>
        </label>
      </div>
      <SubmitButton className={primaryButton} pendingLabel="Calling the model…">
        Run one live trial
      </SubmitButton>
      <p className="text-xs leading-relaxed text-muted">
        This makes one paid model call of {LIVE_TRIAL_CREDIT_COST} credits (
        {LIVE_TRIAL_COST_CENTS} cents) and records the real cost against the
        configuration&apos;s ceiling. The expected answer is never sent to the model.
      </p>
      <Note state={state} />
    </form>
  );
}


export function RequestCapabilityReviewForm({
  evalId,
  versionId,
  versionLabel,
  reviewers,
}: {
  evalId: string;
  versionId: string;
  versionLabel: string;
  reviewers: CapabilityReviewer[];
}) {
  const [state, action] = useActionState(requestCapabilityReviewAction, idleBuildState);
  if (reviewers.length === 0) {
    return (
      <p className="text-sm text-muted">
        This experiment workspace has no other active member to review {versionLabel}. Invite a
        member first; a review by the evaluation owner is not independent.
      </p>
    );
  }
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="evalId" value={evalId} />
      <input type="hidden" name="versionId" value={versionId} />
      <label className="block text-sm font-semibold">
        Ask a workspace member to review {versionLabel}
        <select name="reviewerId" required className={`${inputClass} mt-1 max-w-72`}>
          <option value="">Choose a reviewer</option>
          {reviewers.map((reviewer) => (
            <option key={reviewer.user_id} value={reviewer.user_id}>
              {reviewer.display_name}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-muted">
        The reviewer sees a read-only summary of this version: run counts by domain and split,
        contamination, cost, latency and failure categories. Never answer keys or submissions.
      </p>
      <SubmitButton className={secondaryButton}>Request independent review</SubmitButton>
      <Note state={state} />
    </form>
  );
}

export function CompleteCapabilityReviewForm({ reviewId }: { reviewId: string }) {
  const [state, action] = useActionState(completeCapabilityReviewAction, idleBuildState);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="reviewId" value={reviewId} />
      <label className="block text-sm font-semibold">
        Findings
        <textarea
          name="findings"
          required
          minLength={20}
          maxLength={4000}
          rows={5}
          className={`${inputClass} mt-1`}
          placeholder="What the recorded numbers do and do not support, and anything inconsistent."
        />
      </label>
      <label className="block text-sm font-semibold">
        Limitations of this review
        <textarea
          name="limitations"
          required
          minLength={10}
          maxLength={2000}
          rows={3}
          className={`${inputClass} mt-1`}
          placeholder="What you could not check from the summary."
        />
      </label>
      <p className="text-xs text-muted">
        Completing this review does not release, deploy or permit anything. It records that a
        second person examined the measured evidence.
      </p>
      <SubmitButton className={primaryButton}>Record review</SubmitButton>
      <Note state={state} />
    </form>
  );
}

export function DeclineCapabilityReviewForm({ reviewId }: { reviewId: string }) {
  const [state, action] = useActionState(declineCapabilityReviewAction, idleBuildState);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="reviewId" value={reviewId} />
      <SubmitButton className={secondaryButton}>Decline this review</SubmitButton>
      <Note state={state} />
    </form>
  );
}
