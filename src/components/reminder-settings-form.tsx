"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleFormState } from "@/lib/action-state";
import { saveReminderSettingsAction } from "@/lib/actions/reminders";
import {
  DEFAULT_WEEKDAYS,
  REMINDER_TIMEZONES,
  WEEKDAY_LABELS,
  formatTime12,
  weekdaySummary,
} from "@/lib/reminders";
import {
  cardClass,
  hintClass,
  inputClass,
  labelClass,
  primaryButton,
} from "@/lib/styles";
import type { ReminderSettings } from "@/lib/types";

const trimmed = (value: string) => value.slice(0, 5);

/**
 * Reminder preferences. Reminders are off until a person makes one, and this
 * page can switch all of them off at once.
 */
export function ReminderSettingsForm({
  settings,
}: {
  settings: ReminderSettings;
}) {
  const [state, formAction] = useActionState(
    saveReminderSettingsAction,
    idleFormState,
  );

  const weekdays =
    settings.weekdays.length > 0 ? settings.weekdays : DEFAULT_WEEKDAYS;

  return (
    <form action={formAction} className={`${cardClass} space-y-5`}>
      <div>
        <h2 className="text-lg font-bold">Reminders</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Optional. Reminders appear in your in-app inbox — nothing is emailed,
          texted or pushed. You can switch them all off here at any time.
        </p>
      </div>

      <label className="flex items-start gap-2 text-sm leading-relaxed">
        <input
          type="checkbox"
          name="enabled"
          value="true"
          defaultChecked={settings.enabled}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          <span className="font-semibold">Reminders on.</span> Uncheck to pause
          every reminder without deleting them.
        </span>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="reminder-timezone">
            Timezone
          </label>
          <select
            id="reminder-timezone"
            name="timezone"
            defaultValue={
              REMINDER_TIMEZONES.includes(settings.timezone)
                ? settings.timezone
                : "UTC"
            }
            className={`mt-1.5 ${inputClass}`}
          >
            {REMINDER_TIMEZONES.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
          <p className={hintClass}>
            Changing this reschedules future reminders. Anything already due
            keeps its original time.
          </p>
        </div>

        <div>
          <label className={labelClass} htmlFor="reminder-time">
            Reminder time
          </label>
          <input
            id="reminder-time"
            name="remind_at"
            type="time"
            defaultValue={trimmed(settings.remind_at)}
            className={`mt-1.5 ${inputClass}`}
          />
          <p className={hintClass}>
            Currently {formatTime12(settings.remind_at)}, your timezone.
          </p>
        </div>
      </div>

      <fieldset>
        <legend className={labelClass}>Days</legend>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
          {WEEKDAY_LABELS.map((label, index) => (
            <label key={label} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                name="weekdays"
                value={index}
                defaultChecked={weekdays.includes(index)}
                className="h-4 w-4"
              />
              {label}
            </label>
          ))}
        </div>
        <p className={hintClass}>{weekdaySummary(weekdays)} right now.</p>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="quiet-from">
            Quiet hours start
          </label>
          <input
            id="quiet-from"
            name="quiet_from"
            type="time"
            defaultValue={trimmed(settings.quiet_from)}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="quiet-to">
            Quiet hours end
          </label>
          <input
            id="quiet-to"
            name="quiet_to"
            type="time"
            defaultValue={trimmed(settings.quiet_to)}
            className={`mt-1.5 ${inputClass}`}
          />
          <p className={hintClass}>
            Nothing is delivered during quiet hours. A reminder that falls inside
            them arrives once afterwards, not twice.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-paper p-3">
        <label className="flex items-start gap-2 text-sm leading-relaxed">
          <input
            type="checkbox"
            name="daily_checkin"
            value="true"
            defaultChecked={settings.daily_checkin}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            <span className="font-semibold">Daily check-in.</span> Ask one
            question: “What&apos;s one thing you want to move forward today?”
          </span>
        </label>

        <div className="mt-3 sm:max-w-40">
          <label className={labelClass} htmlFor="checkin-at">
            Check-in time
          </label>
          <input
            id="checkin-at"
            name="checkin_at"
            type="time"
            defaultValue={trimmed(settings.checkin_at)}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
      </div>

      <p aria-live="polite" className="min-h-5 text-sm">
        {state.status === "error" ? (
          <span className="text-danger">{state.message}</span>
        ) : state.status === "success" ? (
          <span className="text-mint">{state.message}</span>
        ) : (
          <span className="text-muted">
            Reminders are set per goal or task, from its page.
          </span>
        )}
      </p>

      <SubmitButton
        pendingLabel="Saving…"
        className={`${primaryButton} sm:w-auto`}
      >
        Save reminder settings
      </SubmitButton>
    </form>
  );
}
