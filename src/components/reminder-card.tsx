"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleFormState } from "@/lib/action-state";
import { setReminderAction } from "@/lib/actions/reminders";
import { dueLabel, formatTime12, weekdaySummary } from "@/lib/reminders";
import { secondaryButton } from "@/lib/styles";
import type { Reminder } from "@/lib/types";

/**
 * One optional reminder for this goal or task.
 *
 * Turning it on reschedules it to the person's chosen time and timezone; the
 * database does that maths, so a timezone change is explicit rather than
 * guessed at here.
 */
export function ReminderCard({
  goalId,
  taskId = null,
  reminder,
  timezone,
  remindAt,
  weekdays,
}: {
  goalId: string;
  taskId?: string | null;
  reminder: Reminder | null;
  timezone: string;
  remindAt: string;
  weekdays: number[];
}) {
  const [state, formAction] = useActionState(setReminderAction, idleFormState);
  const enabled = reminder?.enabled ?? false;
  const next = enabled ? dueLabel(reminder?.next_due_at ?? null, timezone) : null;

  return (
    <section
      aria-labelledby={`reminder-heading-${taskId ?? goalId}`}
      className="rounded-2xl border border-line bg-card p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id={`reminder-heading-${taskId ?? goalId}`}
          className="text-sm font-bold uppercase tracking-[0.15em] text-muted"
        >
          Reminder
        </h2>
        <span className="text-xs text-muted">{timezone}</span>
      </div>

      <p className="mt-2 text-sm leading-relaxed">
        {enabled
          ? next
            ? `On. Next: ${next}.`
            : "On, waiting for the next scheduled day."
          : `Off. If you turn this on it arrives at ${formatTime12(remindAt)}, ${weekdaySummary(weekdays).toLowerCase()}.`}
      </p>

      <form action={formAction} className="mt-3 flex flex-wrap items-center gap-3">
        <input type="hidden" name="goal_id" value={goalId} />
        {taskId ? <input type="hidden" name="task_id" value={taskId} /> : null}
        <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />

        <SubmitButton
          pendingLabel="Saving…"
          className={`${secondaryButton} w-fit sm:w-auto`}
        >
          {enabled ? "Turn reminder off" : "Remind me"}
        </SubmitButton>

        <span className="text-xs text-muted">
          In-app only. Nothing is emailed or texted.
        </span>
      </form>

      {state.message ? (
        <p
          role={state.status === "error" ? "alert" : "status"}
          aria-live="polite"
          className={
            state.status === "error"
              ? "mt-2 text-sm text-danger"
              : "mt-2 text-sm text-mint"
          }
        >
          {state.message}
        </p>
      ) : null}
    </section>
  );
}
