"use client";

import Link from "next/link";
import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleFormState } from "@/lib/action-state";
import {
  reminderDeliveryAction,
  saveDailyIntentionAction,
} from "@/lib/actions/reminders";
import { SNOOZE_OPTIONS, dueLabel } from "@/lib/reminders";
import {
  chipClass,
  hintClass,
  inputClass,
  labelClass,
  quietButton,
  secondaryButton,
} from "@/lib/styles";
import type { InboxDelivery } from "@/lib/types";

/**
 * The in-app reminder inbox plus the optional daily check-in.
 *
 * Every action is a server action; the inbox is never built from a browser
 * timer, so a closed tab changes nothing.
 */
export function ReminderInbox({
  deliveries,
  intention,
  timezone,
  dailyCheckin,
}: {
  deliveries: InboxDelivery[];
  intention: string | null;
  timezone: string;
  dailyCheckin: boolean;
}) {
  const checkin = deliveries.find((delivery) => delivery.kind === "checkin") ?? null;
  const reminders = deliveries.filter((delivery) => delivery.kind === "reminder");

  return (
    <div className="space-y-8">
      {dailyCheckin ? (
        <DailyCheckin
          intention={intention}
          deliveryId={checkin?.id ?? null}
          timezone={timezone}
        />
      ) : null}

      <section aria-labelledby="inbox-heading">
        <h2 id="inbox-heading" className="text-lg font-bold">
          Reminder inbox
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Only what is unread. Quiet hours hold reminders back, and a reminder
          never arrives twice for the same time.
        </p>

        {reminders.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-line p-5 text-sm text-muted">
            Nothing waiting. Reminders you make on a goal or task show up here.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {reminders.map((delivery) => (
              <DeliveryRow key={delivery.id} delivery={delivery} timezone={timezone} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function DeliveryRow({
  delivery,
  timezone,
}: {
  delivery: InboxDelivery;
  timezone: string;
}) {
  const [state, formAction] = useActionState(
    reminderDeliveryAction,
    idleFormState,
  );

  const when = dueLabel(delivery.due_at, timezone);
  const href =
    delivery.taskId && delivery.goalId
      ? `/goals/${delivery.goalId}/tasks/${delivery.taskId}`
      : delivery.goalId
        ? `/goals/${delivery.goalId}`
        : null;

  return (
    <li className="rounded-2xl border border-line bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={chipClass}>{delivery.kind === "reminder" ? "Reminder" : "Check-in"}</span>
        {when ? <span className="text-xs text-muted">{when}</span> : null}
        {delivery.state === "snoozed" ? (
          <span className={chipClass}>Snoozed</span>
        ) : null}
      </div>

      <p className="mt-2 font-semibold leading-snug">
        {delivery.taskTitle ?? delivery.goalTitle ?? "Something on your list"}
      </p>
      {delivery.taskTitle && delivery.goalTitle ? (
        <p className="mt-0.5 text-sm text-muted">{delivery.goalTitle}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {href ? (
          <Link href={href} className={`${secondaryButton} w-fit sm:w-auto`}>
            Open task
          </Link>
        ) : null}

        {SNOOZE_OPTIONS.map((option) => (
          <form key={option.minutes} action={formAction}>
            <input type="hidden" name="delivery_id" value={delivery.id} />
            <input type="hidden" name="action" value="snooze" />
            <input type="hidden" name="minutes" value={option.minutes} />
            <SubmitButton pendingLabel="Snoozing…" className={quietButton}>
              Snooze · {option.label.toLowerCase()}
            </SubmitButton>
          </form>
        ))}

        <form action={formAction}>
          <input type="hidden" name="delivery_id" value={delivery.id} />
          <input type="hidden" name="action" value="dismiss" />
          <SubmitButton pendingLabel="Dismissing…" className={quietButton}>
            Dismiss
          </SubmitButton>
        </form>
      </div>

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
    </li>
  );
}

function DailyCheckin({
  intention,
  deliveryId,
  timezone,
}: {
  intention: string | null;
  deliveryId: string | null;
  timezone: string;
}) {
  const [state, formAction] = useActionState(
    saveDailyIntentionAction,
    idleFormState,
  );

  return (
    <section
      aria-labelledby="checkin-heading"
      className="rounded-2xl border border-brand/30 bg-brand-soft/40 p-4 sm:p-5"
    >
      <h2 id="checkin-heading" className="text-lg font-bold">
        Today&apos;s check-in
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        One line is enough. Saved privately for today, in {timezone}.
      </p>

      <form action={formAction} className="mt-3 space-y-3">
        {deliveryId ? (
          <input type="hidden" name="delivery_id" value={deliveryId} />
        ) : null}

        <div>
          <label className={labelClass} htmlFor="daily-intention">
            What&apos;s one thing you want to move forward today?
          </label>
          <input
            id="daily-intention"
            name="intention"
            defaultValue={intention ?? ""}
            maxLength={500}
            placeholder="One thing. Small is fine."
            className={`mt-1.5 ${inputClass}`}
          />
        </div>

        <p aria-live="polite" className="min-h-5 text-sm">
          {state.status === "error" ? (
            <span className="text-danger">{state.message}</span>
          ) : state.status === "success" ? (
            <span className="text-mint">{state.message}</span>
          ) : intention ? (
            <span className="text-muted">
              Saved for today. Change it whenever you like.
            </span>
          ) : (
            <span className="text-muted">Nothing written for today yet.</span>
          )}
        </p>

        <SubmitButton
          pendingLabel="Saving…"
          className={`${secondaryButton} sm:w-auto`}
        >
          Save today&apos;s line
        </SubmitButton>
        <p className={hintClass}>
          This never changes a task or a plan. It is just a note to yourself.
        </p>
      </form>
    </section>
  );
}
