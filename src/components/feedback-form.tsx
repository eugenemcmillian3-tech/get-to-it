"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleFormState } from "@/lib/action-state";
import { submitFeedbackAction } from "@/lib/actions/feedback";
import {
  cardClass,
  inputClass,
  labelClass,
  secondaryButton,
} from "@/lib/styles";

const AREAS = [
  { value: "starting", label: "Starting a task" },
  { value: "working", label: "Producing useful work" },
  { value: "stuck", label: "Getting unstuck" },
  { value: "returning", label: "Coming back to it later" },
  { value: "other", label: "Something else" },
];

/**
 * Feedback form. Saves one row in `public.feedback`; nothing else changes.
 */
export function FeedbackForm({ className = "mt-10" }: { className?: string } = {}) {
  const [state, formAction] = useActionState(
    submitFeedbackAction,
    idleFormState,
  );

  return (
    <section aria-labelledby="feedback-heading" className={className}>
      <h2 id="feedback-heading" className="text-lg font-bold">
        Tell us how it went
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Optional. Anything that helped, anything that got in the way, anything
        that felt off.
      </p>

      <form action={formAction} className={`${cardClass} mt-3 space-y-4`}>
        <div className="sm:max-w-sm">
          <label className={labelClass} htmlFor="feedback-area">
            What is this about?
          </label>
          <select
            id="feedback-area"
            name="area"
            defaultValue="other"
            className={`mt-1.5 ${inputClass}`}
          >
            {AREAS.map((area) => (
              <option key={area.value} value={area.value}>
                {area.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="feedback-message">
            Your feedback
          </label>
          <textarea
            id="feedback-message"
            name="message"
            required
            rows={4}
            maxLength={2000}
            placeholder="What worked, what didn't, what you expected."
            className={`mt-1.5 ${inputClass}`}
          />
        </div>

        <label className="flex items-start gap-2 text-sm leading-relaxed">
          <input
            type="checkbox"
            name="contact_ok"
            value="true"
            className="mt-0.5 h-4 w-4"
          />
          <span>
            It&apos;s OK to contact me about this at the email I signed up with.
          </span>
        </label>

        <p aria-live="polite" className="min-h-5 text-sm">
          {state.status === "error" ? (
            <span className="text-danger">{state.message}</span>
          ) : state.status === "success" ? (
            <span className="text-mint">{state.message}</span>
          ) : (
            <span className="text-muted">
              Read by the person running GET TO IT. Not shared with anyone else.
            </span>
          )}
        </p>

        <SubmitButton
          pendingLabel="Sending…"
          className={`${secondaryButton} sm:w-auto`}
        >
          Send feedback
        </SubmitButton>
      </form>
    </section>
  );
}
