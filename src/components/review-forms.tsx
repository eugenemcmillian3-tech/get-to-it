"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleReviewState } from "@/lib/action-state";
import {
  cancelReviewAction,
  createReviewAction,
  deleteReviewAction,
  runNextPerspectiveAction,
  saveReviewOutcomeAction,
  updateReviewPrioritiesAction,
} from "@/lib/actions/reviews";
import { AI_MODELS, DEFAULT_AI_MODEL } from "@/lib/ai/models";
import { operationChargeLabel } from "@/lib/credits/pricing";
import {
  HUMAN_DECISION_NOTE,
  MAX_CHOSEN_OPTION,
  NO_TOOLS_NOTE,
  SAME_MODEL_NOTE,
  USAGE_NOTE,
} from "@/lib/reviews";
import type { Review } from "@/lib/types";
import {
  cardClass,
  dangerButton,
  hintClass,
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
} from "@/lib/styles";

/**
 * Creates the shared record and the five pending stages. No model call happens
 * here: the cost is stated before anything is spent, and every later stage is a
 * separate click.
 */
export function ReviewForm() {
  const [state, formAction] = useActionState(createReviewAction, idleReviewState);
  const [model, setModel] = useState(DEFAULT_AI_MODEL);

  return (
    <form action={formAction} className={`${cardClass} border-brand/30 bg-brand-soft/30`}>
      <h2 className="text-lg font-bold">New review</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        One decision, five perspectives, answered one at a time. The perspectives
        share the same record and never see anything else.
      </p>

      <div className="mt-4 space-y-4">
        <div>
          <label className={labelClass} htmlFor="review-question">
            What decision do you want to think through?
          </label>
          <input
            id="review-question"
            name="question"
            required
            maxLength={500}
            placeholder="e.g. Should I take the six-month contract and hire help?"
            className={`mt-1.5 ${inputClass}`}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="review-context">
            Relevant context
          </label>
          <textarea
            id="review-context"
            name="context"
            rows={4}
            maxLength={4000}
            placeholder="What has happened so far, and what is at stake"
            className={`mt-1.5 ${inputClass}`}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="review-constraints">
              Constraints
            </label>
            <textarea
              id="review-constraints"
              name="constraints"
              rows={3}
              maxLength={2000}
              placeholder="What you cannot change"
              className={`mt-1.5 ${inputClass}`}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="review-priorities">
              Your priorities
            </label>
            <textarea
              id="review-priorities"
              name="priorities"
              rows={3}
              maxLength={400}
              placeholder={"One per line, e.g.\nPredictable income\nTime with family"}
              className={`mt-1.5 ${inputClass}`}
            />
            <p className={hintClass}>Up to eight, in your own words.</p>
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="review-sources">
            Sources you have already read
          </label>
          <textarea
            id="review-sources"
            name="sources"
            rows={3}
            maxLength={2000}
            placeholder={"One per line: Title | https://example.org/report"}
            className={`mt-1.5 ${inputClass}`}
          />
          <p className={hintClass}>
            Optional. The app does not fetch these links; they are the only
            sources a perspective may cite.
          </p>
        </div>

        <div className="sm:max-w-xs">
          <label className={labelClass} htmlFor="review-model">
            Model
          </label>
          <select
            id="review-model"
            name="model"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            className={`mt-1.5 ${inputClass}`}
          >
            {AI_MODELS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label} — {option.vendor}
              </option>
            ))}
          </select>
          <p className={hintClass}>All five perspectives use this one model.</p>
        </div>
      </div>

      <div className="mt-4 space-y-1 rounded-xl border border-line bg-card p-3 text-xs leading-relaxed text-muted">
        <p>{USAGE_NOTE}</p>
        <p>{NO_TOOLS_NOTE}</p>
        <p>{SAME_MODEL_NOTE}</p>
      </div>

      <label className="mt-4 flex items-start gap-2 text-sm">
        <input type="checkbox" name="acknowledge" value="yes" required className="mt-1" />
        <span>
          I understand this review can make up to five AI requests, one per
          perspective, at {operationChargeLabel("review")} each, and that I start
          each one.
        </span>
      </label>

      <p aria-live="polite" className="mt-3 min-h-5 text-sm">
        {state.status === "error" ? (
          <span className="text-danger">{state.message}</span>
        ) : (
          <span className="text-muted">Creating a review spends nothing by itself.</span>
        )}
      </p>

      <SubmitButton pendingLabel="Setting up the review…" className={`${primaryButton} mt-2`}>
        Create the review
      </SubmitButton>
    </form>
  );
}

/** Changes the priorities used by perspectives that have not run yet. */
export function PrioritiesForm({ review }: { review: Review }) {
  const [state, formAction] = useActionState(
    updateReviewPrioritiesAction,
    idleReviewState,
  );

  return (
    <form action={formAction} className="mt-3">
      <input type="hidden" name="review_id" value={review.id} />
      <label className={labelClass} htmlFor="review-edit-priorities">
        Change your priorities
      </label>
      <textarea
        id="review-edit-priorities"
        name="priorities"
        rows={3}
        maxLength={800}
        defaultValue={review.priorities.join("\n")}
        className={`mt-1.5 ${inputClass}`}
      />
      <p className={hintClass}>
        One per line, up to eight. This applies to perspectives you run next;
        answers already saved keep the priorities they were given.
      </p>
      <p aria-live="polite" className="mt-2 min-h-5 text-sm">
        {state.status === "error" ? (
          <span className="text-danger">{state.message}</span>
        ) : state.status === "success" ? (
          <span className="text-mint">{state.message}</span>
        ) : null}
      </p>
      <SubmitButton className={secondaryButton} pendingLabel="Saving…">
        Save priorities
      </SubmitButton>
    </form>
  );
}

/** Runs exactly one perspective, one request. */
export function RunPerspectiveForm({
  reviewId,
  label,
}: {
  reviewId: string;
  label: string;
}) {
  const [state, formAction] = useActionState(
    runNextPerspectiveAction,
    idleReviewState,
  );

  return (
    <form action={formAction} className="mt-3">
      <input type="hidden" name="review_id" value={reviewId} />
      <SubmitButton pendingLabel="Thinking…" className={primaryButton}>
        Run {label} ({operationChargeLabel("review")})
      </SubmitButton>
      <p aria-live="polite" className="mt-2 min-h-5 text-sm">
        {state.status === "error" ? (
          <span className="text-danger">{state.message}</span>
        ) : state.status === "success" ? (
          <span className="text-mint">{state.message}</span>
        ) : (
          <span className="text-muted">
            Only this perspective is requested, and only when you press the button.
          </span>
        )}
      </p>
    </form>
  );
}

export function CancelReviewForm({ reviewId }: { reviewId: string }) {
  const [state, formAction] = useActionState(cancelReviewAction, idleReviewState);

  return (
    <form action={formAction} className="mt-3">
      <input type="hidden" name="review_id" value={reviewId} />
      <SubmitButton className={secondaryButton} pendingLabel="Cancelling…">
        Cancel between stages
      </SubmitButton>
      <p aria-live="polite" className="mt-2 min-h-5 text-sm">
        {state.status === "error" ? (
          <span className="text-danger">{state.message}</span>
        ) : state.status === "success" ? (
          <span className="text-mint">{state.message}</span>
        ) : (
          <span className="text-muted">
            A request already sent cannot be unsent; cancelling stops the next one.
          </span>
        )}
      </p>
    </form>
  );
}

/** The human decision. Free text is first-class; rejecting is one checkbox. */
export function OutcomeForm({ review }: { review: Review }) {
  const [state, formAction] = useActionState(
    saveReviewOutcomeAction,
    idleReviewState,
  );
  const [rejected, setRejected] = useState(review.rejected_recommendation);

  return (
    <form action={formAction} className={`${cardClass} mt-6`}>
      <input type="hidden" name="review_id" value={review.id} />
      <h2 className="text-lg font-bold">Your decision</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">{HUMAN_DECISION_NOTE}</p>

      <div className="mt-4">
        <label className={labelClass} htmlFor="review-chosen">
          Which option, if any, are you choosing?
        </label>
        <input
          id="review-chosen"
          name="chosen_option"
          maxLength={MAX_CHOSEN_OPTION}
          defaultValue={review.chosen_option ?? ""}
          placeholder="An option from above, or your own shorthand"
          className={`mt-1.5 ${inputClass}`}
        />
        <p className={hintClass}>
          Optional. Leave it blank if your decision is not one of the options.
        </p>
      </div>

      <div className="mt-4">
        <label className={labelClass} htmlFor="review-decision">
          Your decision, in your own words
        </label>
        <textarea
          id="review-decision"
          name="decision"
          rows={4}
          required
          maxLength={4000}
          defaultValue={review.decision ?? ""}
          placeholder="What you will do, and what you are accepting by doing it"
          className={`mt-1.5 ${inputClass}`}
        />
      </div>

      <label className="mt-4 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="rejected_recommendation"
          value="yes"
          checked={rejected}
          onChange={(event) => setRejected(event.target.checked)}
          className="mt-1"
        />
        <span>
          I am rejecting the synthesizer&rsquo;s recommendation. My decision
          stands regardless.
        </span>
      </label>

      <p aria-live="polite" className="mt-3 min-h-5 text-sm">
        {state.status === "error" ? (
          <span className="text-danger">{state.message}</span>
        ) : state.status === "success" ? (
          <span className="text-mint">{state.message}</span>
        ) : review.decided_at ? (
          <span className="text-muted">A decision is saved. Editing it replaces it.</span>
        ) : null}
      </p>

      <SubmitButton pendingLabel="Saving…" className={secondaryButton}>
        Save my decision
      </SubmitButton>
    </form>
  );
}

export function DeleteReviewForm({ reviewId }: { reviewId: string }) {
  const [state, formAction] = useActionState(deleteReviewAction, idleReviewState);
  const [confirmed, setConfirmed] = useState(false);

  return (
    <details className={`${cardClass} mt-6`}>
      <summary className="cursor-pointer rounded text-sm font-semibold">
        Delete this review
      </summary>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        This removes the shared record, every perspective and your saved decision.
        It cannot be undone.
      </p>
      <form action={formAction} className="mt-3 space-y-3">
        <input type="hidden" name="review_id" value={reviewId} />
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-1"
          />
          <span>I understand this review will be deleted.</span>
        </label>
        <SubmitButton className={dangerButton} disabled={!confirmed} pendingLabel="Deleting…">
          Delete review
        </SubmitButton>
        {state.status === "error" ? (
          <p className="text-sm text-danger">{state.message}</p>
        ) : null}
      </form>
    </details>
  );
}
