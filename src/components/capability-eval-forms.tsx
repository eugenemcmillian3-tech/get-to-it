"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleBuildState, type BuildState } from "@/lib/action-state";
import {
  createCapabilityEvalAction,
  recordHumanBaselineAction,
  runCapabilityEvalAction,
} from "@/lib/actions/capability-eval";
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
