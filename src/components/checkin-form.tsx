"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleFormState } from "@/lib/action-state";
import { saveCheckinAction } from "@/lib/actions/focus";
import { formatDeadline } from "@/lib/format";
import {
  cardClass,
  hintClass,
  inputClass,
  labelClass,
  secondaryButton,
} from "@/lib/styles";
import type { WeeklyCheckin } from "@/lib/types";

/**
 * Weekly check-in.
 *
 * Three optional prompts, saved to a private row for this week. Nothing here
 * changes a task, a goal or a plan — reflections are only ever read back by the
 * person who wrote them.
 */
export function CheckinForm({
  weekStart,
  existing,
  className = "mt-10",
}: {
  weekStart: string;
  existing: WeeklyCheckin | null;
  className?: string;
}) {
  const [state, formAction] = useActionState(saveCheckinAction, idleFormState);
  const weekLabel = formatDeadline(weekStart) ?? weekStart;

  return (
    <section aria-labelledby="checkin-heading" className={className}>
      <h2 id="checkin-heading" className="text-lg font-bold">
        Weekly check-in
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Optional, and private to your account. It&apos;s a place to notice what
        happened — nothing in your plan changes because of it.
      </p>

      <form action={formAction} className={`${cardClass} mt-3 space-y-4`}>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          Week of {weekLabel}
          {existing ? " · saved" : ""}
        </p>

        <div>
          <label className={labelClass} htmlFor="checkin-moved">
            What moved forward?
          </label>
          <textarea
            id="checkin-moved"
            name="moved_forward"
            defaultValue={existing?.moved_forward ?? ""}
            rows={3}
            maxLength={2000}
            placeholder="Anything at all. A sentence counts."
            className={`mt-1.5 ${inputClass}`}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="checkin-blocked">
            What got in the way?
          </label>
          <textarea
            id="checkin-blocked"
            name="got_in_the_way"
            defaultValue={existing?.got_in_the_way ?? ""}
            rows={3}
            maxLength={2000}
            className={`mt-1.5 ${inputClass}`}
          />
          <p className={hintClass}>
            Naming it is enough. This is not a mark against the week.
          </p>
        </div>

        <div>
          <label className={labelClass} htmlFor="checkin-next">
            What is your next useful step?
          </label>
          <textarea
            id="checkin-next"
            name="next_step"
            defaultValue={existing?.next_step ?? ""}
            rows={2}
            maxLength={500}
            className={`mt-1.5 ${inputClass}`}
          />
          <p className={hintClass}>
            Saved as a note for you. Tasks and plans change only when you change
            them.
          </p>
        </div>

        <p aria-live="polite" className="min-h-5 text-sm">
          {state.status === "error" ? (
            <span className="text-danger">{state.message}</span>
          ) : state.status === "success" ? (
            <span className="text-mint">
              {state.message}
              {state.savedAt ? ` Last saved at ${state.savedAt}.` : ""}
            </span>
          ) : existing ? (
            <span className="text-muted">
              You can edit this week&apos;s notes and save again.
            </span>
          ) : (
            <span className="text-muted">Nothing saved for this week yet.</span>
          )}
        </p>

        <SubmitButton
          pendingLabel="Saving…"
          className={`${secondaryButton} sm:w-auto`}
        >
          Save reflection
        </SubmitButton>
      </form>
    </section>
  );
}
