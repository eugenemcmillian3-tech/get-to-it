"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleOutcomeState, type OutcomeState } from "@/lib/action-state";
import {
  addForecastAction,
  addObservationAction,
  approveImprovementAction,
  createImprovementAction,
  createOutcomeReviewAction,
  deleteOutcomeReviewAction,
  rejectImprovementAction,
  resolveForecastAction,
  rollbackImprovementAction,
  saveAssessmentAction,
} from "@/lib/actions/outcomes";
import type { OutcomeCandidates } from "@/lib/data/outcomes";
import {
  ASSESSMENT_ANSWERS,
  ASSUMPTION_VERDICTS,
  CAUSATION_NOTE,
  EVALUATION_DIMENSIONS,
  EXTERNAL_CHANGES,
  IMPROVEMENT_AREAS,
  IMPROVEMENT_NOTE,
  NO_TRAINING_NOTE,
  OPTIONAL_PARTICIPATION_NOTE,
  REVIEW_QUESTIONS,
} from "@/lib/outcomes";
import {
  cardClass,
  dangerButton,
  hintClass,
  inputClass,
  labelClass,
  primaryButton,
  quietButton,
  secondaryButton,
} from "@/lib/styles";
import type {
  OutcomeForecast,
  OutcomeReview,
} from "@/lib/types";

function StateNote({ state, idle }: { state: OutcomeState; idle?: string }) {
  if (state.status === "error") {
    return <span className="text-danger">{state.message}</span>;
  }
  if (state.status === "success") {
    return <span className="text-mint">{state.message}</span>;
  }
  return idle ? <span className="text-muted">{idle}</span> : null;
}

function CandidateOptions({
  label,
  items,
  kind,
}: {
  label: string;
  items: { id: string; title: string; detail: string; reviewAt: string | null }[];
  kind: string;
}) {
  if (items.length === 0) return null;

  return (
    <optgroup label={label}>
      {items.map((item) => (
        <option key={`${kind}-${item.id}`} value={`${kind}:${item.id}`}>
          {item.title}
          {item.reviewAt ? ` — review ${item.reviewAt}` : ""}
        </option>
      ))}
    </optgroup>
  );
}

export function OutcomeCreateForm({ candidates }: { candidates: OutcomeCandidates }) {
  const [state, formAction] = useActionState(
    createOutcomeReviewAction,
    idleOutcomeState,
  );

  const total =
    candidates.goals.length + candidates.paths.length + candidates.reviews.length;

  if (total === 0) {
    return (
      <div className={cardClass}>
        <h2 className="text-lg font-bold">Start a review</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          You have no goals, future paths or reviews to look back on yet. A review
          can also be started later from those pages.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className={cardClass}>
      <h2 className="text-lg font-bold">Start a review</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Pick an earlier goal, scenario or review. Its expectation is captured now
        and cannot be edited afterwards.
      </p>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        {OPTIONAL_PARTICIPATION_NOTE}
      </p>

      <div className="mt-4 space-y-4">
        <div>
          <label className={labelClass} htmlFor="outcome-source">
            What are you looking back on?
          </label>
          <select id="outcome-source" name="source" className={`mt-1.5 ${inputClass}`}>
            <CandidateOptions label="Goals" items={candidates.goals} kind="goal" />
            <CandidateOptions
              label="Future paths"
              items={candidates.paths}
              kind="future_path"
            />
            <CandidateOptions
              label="Reviews"
              items={candidates.reviews}
              kind="review"
            />
          </select>
        </div>

        <div className="sm:max-w-xs">
          <label className={labelClass} htmlFor="outcome-review-date">
            When will you look again?
          </label>
          <input
            id="outcome-review-date"
            name="review_at"
            type="date"
            className={`mt-1.5 ${inputClass}`}
          />
          <p className={hintClass}>Optional, and never a deadline.</p>
        </div>
      </div>

      <p aria-live="polite" className="mt-3 min-h-5 text-sm">
        <StateNote state={state} />
      </p>

      <SubmitButton className={primaryButton} pendingLabel="Capturing…">
        Capture this expectation
      </SubmitButton>
    </form>
  );
}

export function ObservationForm({ review }: { review: OutcomeReview }) {
  const [state, formAction] = useActionState(addObservationAction, idleOutcomeState);
  const [kind, setKind] = useState("observation");

  return (
    <form action={formAction} className={cardClass}>
      <input type="hidden" name="review_id" value={review.id} />
      <h3 className="text-base font-bold">Append an observation</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Nothing here changes the original expectation or an earlier note.
      </p>

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="observation-kind">
            Question
          </label>
          <select
            id="observation-kind"
            name="kind"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            className={`mt-1.5 ${inputClass}`}
          >
            {REVIEW_QUESTIONS.map((question) => (
              <option key={question.key} value={question.key}>
                {question.question}
              </option>
            ))}
          </select>
          <p className={hintClass}>
            {REVIEW_QUESTIONS.find((question) => question.key === kind)?.hint}
          </p>
        </div>

        {kind === "assumption" ? (
          <div>
            <label className={labelClass} htmlFor="observation-verdict">
              Did it hold?
            </label>
            <select
              id="observation-verdict"
              name="verdict"
              required
              className={`mt-1.5 ${inputClass}`}
            >
              {ASSUMPTION_VERDICTS.map((verdict) => (
                <option key={verdict.slug} value={verdict.slug}>
                  {verdict.label}
                </option>
              ))}
            </select>
            <p className={hintClass}>
              {ASSUMPTION_VERDICTS.map((verdict) => `${verdict.label}: ${verdict.note}`).join(
                " ",
              )}
            </p>
          </div>
        ) : null}
      </div>

      <div className="mt-4">
        <label className={labelClass} htmlFor="observation-text">
          Your note
        </label>
        <textarea
          id="observation-text"
          name="text"
          rows={3}
          required
          maxLength={2000}
          className={`mt-1.5 ${inputClass}`}
        />
      </div>

      <div className="mt-4">
        <label className={labelClass} htmlFor="observation-causation">
          Anything else that could explain it? (optional)
        </label>
        <input
          id="observation-causation"
          name="causation_note"
          maxLength={2000}
          className={`mt-1.5 ${inputClass}`}
        />
        <p className={hintClass}>{CAUSATION_NOTE}</p>
      </div>

      <p aria-live="polite" className="mt-3 min-h-5 text-sm">
        <StateNote state={state} />
      </p>

      <SubmitButton className={secondaryButton} pendingLabel="Appending…">
        Append to the record
      </SubmitButton>
    </form>
  );
}

export function AssessmentForm({ review }: { review: OutcomeReview }) {
  const [state, formAction] = useActionState(saveAssessmentAction, idleOutcomeState);

  return (
    <form action={formAction} className={cardClass}>
      <input type="hidden" name="review_id" value={review.id} />
      <h3 className="text-base font-bold">Evaluate, in four separate answers</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        These are different questions. A completed action does not mean the result
        occurred, and a wrong expectation can still be a useful experiment.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="assess-action">
            Action completed
          </label>
          <select
            id="assess-action"
            name="action_completed"
            defaultValue={review.action_completed ?? "unknown"}
            className={`mt-1.5 ${inputClass}`}
          >
            {ASSESSMENT_ANSWERS.map((answer) => (
              <option key={answer.slug} value={answer.slug}>
                {answer.label}
              </option>
            ))}
          </select>
          <p className={hintClass}>{EVALUATION_DIMENSIONS[0].note}</p>
        </div>

        <div>
          <label className={labelClass} htmlFor="assess-result">
            Desired result occurred
          </label>
          <select
            id="assess-result"
            name="desired_result"
            defaultValue={review.desired_result ?? "unknown"}
            className={`mt-1.5 ${inputClass}`}
          >
            {ASSESSMENT_ANSWERS.map((answer) => (
              <option key={answer.slug} value={answer.slug}>
                {answer.label}
              </option>
            ))}
          </select>
          <p className={hintClass}>{EVALUATION_DIMENSIONS[1].note}</p>
        </div>

        <div>
          <label className={labelClass} htmlFor="assess-expectation">
            Original expectation was accurate
          </label>
          <select
            id="assess-expectation"
            name="expectation_accuracy"
            defaultValue={review.expectation_accuracy ?? "unknown"}
            className={`mt-1.5 ${inputClass}`}
          >
            {ASSESSMENT_ANSWERS.map((answer) => (
              <option key={answer.slug} value={answer.slug}>
                {answer.label}
              </option>
            ))}
          </select>
          <p className={hintClass}>{EVALUATION_DIMENSIONS[2].note}</p>
        </div>

        <div>
          <label className={labelClass} htmlFor="assess-conditions">
            External conditions
          </label>
          <select
            id="assess-conditions"
            name="external_conditions"
            defaultValue={review.external_conditions ?? "unclear"}
            className={`mt-1.5 ${inputClass}`}
          >
            {EXTERNAL_CHANGES.map((change) => (
              <option key={change.slug} value={change.slug}>
                {change.label}
              </option>
            ))}
          </select>
          <p className={hintClass}>{EVALUATION_DIMENSIONS[3].note}</p>
        </div>
      </div>

      <div className="mt-4">
        <label className={labelClass} htmlFor="assess-causation">
          What else could explain the result?
        </label>
        <textarea
          id="assess-causation"
          name="causation_note"
          rows={2}
          maxLength={2000}
          defaultValue={review.causation_note ?? ""}
          className={`mt-1.5 ${inputClass}`}
        />
        <p className={hintClass}>{CAUSATION_NOTE}</p>
      </div>

      <p aria-live="polite" className="mt-3 min-h-5 text-sm">
        <StateNote state={state} />
      </p>

      <SubmitButton className={secondaryButton} pendingLabel="Saving…">
        Save the four answers
      </SubmitButton>
    </form>
  );
}

export function ForecastForm({ review }: { review: OutcomeReview }) {
  const [state, formAction] = useActionState(addForecastAction, idleOutcomeState);

  return (
    <form action={formAction} className={`${cardClass} mt-3`}>
      <input type="hidden" name="review_id" value={review.id} />
      <h3 className="text-sm font-bold">Record a numerical forecast (optional)</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Only if you had a stated probability in mind. It is scored later; it is
        never rewritten.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_8rem]">
        <input
          name="statement"
          required
          maxLength={300}
          placeholder="What did you expect, specifically?"
          className={inputClass}
        />
        <div className="flex items-center gap-2">
          <input
            name="probability"
            type="number"
            min={1}
            max={99}
            required
            placeholder="70"
            className={inputClass}
          />
          <span className="text-sm text-muted">%</span>
        </div>
      </div>
      <p aria-live="polite" className="mt-2 min-h-5 text-sm">
        <StateNote state={state} />
      </p>
      <SubmitButton className={secondaryButton} pendingLabel="Recording…">
        Record forecast
      </SubmitButton>
    </form>
  );
}

export function ForecastResolveForm({
  review,
  forecast,
}: {
  review: OutcomeReview;
  forecast: OutcomeForecast;
}) {
  const [state, formAction] = useActionState(
    resolveForecastAction,
    idleOutcomeState,
  );

  if (forecast.resolution !== "pending") {
    return (
      <p className="mt-1 text-xs text-muted">
        Resolved. A resolved forecast cannot be rewritten.
      </p>
    );
  }

  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name="review_id" value={review.id} />
      <input type="hidden" name="forecast_id" value={forecast.id} />
      <button type="submit" name="resolution" value="occurred" className={quietButton}>
        It occurred
      </button>
      <button
        type="submit"
        name="resolution"
        value="did_not_occur"
        className={quietButton}
      >
        It did not occur
      </button>
      <span aria-live="polite" className="text-xs">
        <StateNote state={state} />
      </span>
    </form>
  );
}

export function ImprovementForm() {
  const [state, formAction] = useActionState(
    createImprovementAction,
    idleOutcomeState,
  );

  return (
    <form action={formAction} className={cardClass}>
      <h3 className="text-base font-bold">Propose a controlled improvement</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted">{IMPROVEMENT_NOTE}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted">{NO_TRAINING_NOTE}</p>

      <div className="mt-3 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="improvement-area">
              What would change?
            </label>
            <select id="improvement-area" name="area" className={`mt-1.5 ${inputClass}`}>
              {IMPROVEMENT_AREAS.map((area) => (
                <option key={area.slug} value={area.slug}>
                  {area.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="improvement-title">
              Proposal title
            </label>
            <input
              id="improvement-title"
              name="title"
              required
              maxLength={160}
              className={`mt-1.5 ${inputClass}`}
            />
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="improvement-rationale">
            Why might it help?
          </label>
          <textarea
            id="improvement-rationale"
            name="rationale"
            rows={2}
            required
            maxLength={2000}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="improvement-change">
            The proposed change
          </label>
          <textarea
            id="improvement-change"
            name="change_text"
            rows={4}
            required
            maxLength={3000}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="improvement-scope">
            Consented test set
          </label>
          <input
            id="improvement-scope"
            name="test_scope"
            required
            maxLength={500}
            placeholder="e.g. My own last five planning requests, nothing else"
            className={`mt-1.5 ${inputClass}`}
          />
          <p className={hintClass}>
            Describe exactly what may be looked at. Nothing outside it is used.
          </p>
        </div>
      </div>

      <label className="mt-3 flex items-start gap-2 text-sm">
        <input type="checkbox" name="consent_confirmed" value="yes" required className="mt-1" />
        <span>
          I consent to evaluating this change on the scope above only, and I
          understand nothing changes in the app until I approve a version.
        </span>
      </label>

      <p aria-live="polite" className="mt-3 min-h-5 text-sm">
        <StateNote state={state} />
      </p>

      <SubmitButton className={secondaryButton} pendingLabel="Recording…">
        Record proposal
      </SubmitButton>
    </form>
  );
}

export function ImprovementActions({
  proposalId,
  status,
}: {
  proposalId: string;
  status: string;
}) {
  const [approveState, approveAction] = useActionState(
    approveImprovementAction,
    idleOutcomeState,
  );
  const [rejectState, rejectAction] = useActionState(
    rejectImprovementAction,
    idleOutcomeState,
  );
  const [rollbackState, rollbackAction] = useActionState(
    rollbackImprovementAction,
    idleOutcomeState,
  );

  return (
    <div className="mt-2 space-y-2">
      {status === "proposed" ? (
        <div className="flex flex-wrap gap-2">
          <form action={approveAction}>
            <input type="hidden" name="proposal_id" value={proposalId} />
            <SubmitButton className={secondaryButton} pendingLabel="Approving…">
              Approve as a new version
            </SubmitButton>
            <span aria-live="polite" className="ml-2 text-xs">
              <StateNote state={approveState} />
            </span>
          </form>
          <form action={rejectAction}>
            <input type="hidden" name="proposal_id" value={proposalId} />
            <SubmitButton className={quietButton} pendingLabel="Rejecting…">
              Reject
            </SubmitButton>
            <span aria-live="polite" className="ml-2 text-xs">
              <StateNote state={rejectState} />
            </span>
          </form>
        </div>
      ) : null}

      {status === "approved" ? (
        <form action={rollbackAction}>
          <input type="hidden" name="proposal_id" value={proposalId} />
          <SubmitButton className={secondaryButton} pendingLabel="Rolling back…">
            Roll back this version
          </SubmitButton>
          <span aria-live="polite" className="ml-2 text-xs">
            <StateNote state={rollbackState} />
          </span>
        </form>
      ) : null}
    </div>
  );
}

export function DeleteReviewForm({ review }: { review: OutcomeReview }) {
  const [state, formAction] = useActionState(
    deleteOutcomeReviewAction,
    idleOutcomeState,
  );
  const [confirmed, setConfirmed] = useState(false);

  return (
    <details className={`${cardClass} mt-6`}>
      <summary className="cursor-pointer rounded text-sm font-semibold">
        Delete this review
      </summary>
      <p className="mt-2 text-sm text-muted">
        This removes the snapshot, every observation and every forecast. It cannot
        be undone.
      </p>
      <form action={formAction} className="mt-3 space-y-2">
        <input type="hidden" name="review_id" value={review.id} />
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-1"
          />
          <span>I understand this history will be deleted.</span>
        </label>
        <SubmitButton
          className={dangerButton}
          disabled={!confirmed}
          pendingLabel="Deleting…"
        >
          Delete review
        </SubmitButton>
        {state.status === "error" ? (
          <p className="text-sm text-danger">{state.message}</p>
        ) : null}
      </form>
    </details>
  );
}
