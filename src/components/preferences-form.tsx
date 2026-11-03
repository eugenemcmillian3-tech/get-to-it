"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleFormState } from "@/lib/action-state";
import {
  deletePreferencesAction,
  disablePersonalizationAction,
  resetPreferencesAction,
  savePreferencesAction,
} from "@/lib/actions/preferences";
import {
  COMMUNICATION_STYLE_OPTIONS,
  MAX_HELP_TOPICS,
  SESSION_LENGTH_OPTIONS,
  TASK_SIZE_OPTIONS,
  preferenceSummary,
  topicsToText,
  workDaySummary,
} from "@/lib/preferences";
import {
  WEEKDAY_LABELS,
  formatTime12,
} from "@/lib/reminders";
import {
  cardClass,
  dangerButton,
  hintClass,
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
} from "@/lib/styles";
import type { ReminderSettings, UserPreferences } from "@/lib/types";

const asOption = (minutes: number) => `${minutes} min`;
const trimmed = (value: string) => value.slice(0, 5);

/**
 * The preferences panel.
 *
 * Every field is optional and nothing is prefilled from anything the person
 * wrote elsewhere. Saving is the only thing that stores a preference, and the
 * reminder fields in this form edit the same settings the reminder card uses.
 */
export function PreferencesPanel({
  preferences,
  reminder,
}: {
  preferences: UserPreferences;
  reminder: ReminderSettings;
}) {
  const [state, formAction] = useActionState(
    savePreferencesAction,
    idleFormState,
  );

  const summary = preferenceSummary(preferences);
  const reminderDays =
    reminder.weekdays.length > 0 ? reminder.weekdays : [1, 2, 3, 4, 5];

  return (
    <section aria-labelledby="preferences-heading" className="space-y-4">
      <div className={`${cardClass} space-y-4`}>
        <div>
          <h2 id="preferences-heading" className="text-lg font-bold">
            How you like to work
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Optional. These are the only things GET TO IT uses to shape a
            suggestion, and you can change or remove any of them. Nothing here
            is inferred: if it appears, you typed it.
          </p>
        </div>

        {summary.length > 0 ? (
          <dl className="rounded-xl border border-line bg-paper p-3">
            {summary.map((row) => (
              <div
                key={row.label}
                className="flex flex-wrap justify-between gap-2 py-0.5 text-sm"
              >
                <dt className="text-muted">{row.label}</dt>
                <dd className="font-medium">{row.value}</dd>
              </div>
            ))}
            <p className="mt-2 text-xs text-muted">
              Personalisation is{" "}
              <strong className="font-semibold">
                {preferences.personalization_enabled ? "on" : "off"}
              </strong>
              .
            </p>
          </dl>
        ) : (
          <p className="rounded-xl border border-dashed border-line p-3 text-sm text-muted">
            Nothing saved yet. Suggestions use only the time you give them until
            you add a preference.
          </p>
        )}

        <form action={formAction} className="space-y-5">
          <label className="flex items-start gap-2 text-sm leading-relaxed">
            <input
              type="checkbox"
              name="personalization_enabled"
              value="true"
              defaultChecked={preferences.personalization_enabled}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <span className="font-semibold">
                Use my preferences to shape suggestions.
              </span>{" "}
              Unchecking this keeps them saved but stops them being used, and
              stops the explanation lines.
            </span>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="session-length">
                Preferred work-session length
              </label>
              <select
                id="session-length"
                name="session_length_minutes"
                defaultValue={
                  preferences.session_length_minutes
                    ? String(preferences.session_length_minutes)
                    : ""
                }
                className={`mt-1.5 ${inputClass}`}
              >
                <option value="">No preference</option>
                {SESSION_LENGTH_OPTIONS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {asOption(minutes)}
                  </option>
                ))}
              </select>
              <p className={hintClass}>
                Used to size suggested steps, not to start a timer.
              </p>
            </div>

            <div>
              <label className={labelClass} htmlFor="task-size">
                Preferred task size
              </label>
              <select
                id="task-size"
                name="task_size"
                defaultValue={preferences.task_size ?? ""}
                className={`mt-1.5 ${inputClass}`}
              >
                <option value="">No preference</option>
                {TASK_SIZE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label} — {option.hint}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass} htmlFor="work-start">
                Usual working hours
              </label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  id="work-start"
                  name="work_start"
                  type="time"
                  defaultValue={trimmed(preferences.work_start ?? "")}
                  aria-label="Usual start time"
                  className={inputClass}
                />
                <span aria-hidden="true" className="text-muted">
                  –
                </span>
                <input
                  name="work_end"
                  type="time"
                  defaultValue={trimmed(preferences.work_end ?? "")}
                  aria-label="Usual end time"
                  className={inputClass}
                />
              </div>
              <p className={hintClass}>Leave both blank if you don&apos;t have usual hours.</p>
            </div>

            <div>
              <label className={labelClass} htmlFor="communication-style">
                Communication style
              </label>
              <select
                id="communication-style"
                name="communication_style"
                defaultValue={preferences.communication_style ?? ""}
                className={`mt-1.5 ${inputClass}`}
              >
                <option value="">No preference</option>
                {COMMUNICATION_STYLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label} — {option.hint}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <fieldset>
            <legend className={labelClass}>Usual working days</legend>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
              {WEEKDAY_LABELS.map((label, index) => (
                <label key={label} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    name="work_days"
                    value={index}
                    defaultChecked={(preferences.work_days ?? []).includes(index)}
                    className="h-4 w-4"
                  />
                  {label}
                </label>
              ))}
            </div>
            <p className={hintClass}>
              {workDaySummary(preferences.work_days) ?? "No days chosen."}
            </p>
          </fieldset>

          <div>
            <label className={labelClass} htmlFor="help-topics">
              Topics or goals you want help with{" "}
              <span className="font-normal text-muted">(optional)</span>
            </label>
            <textarea
              id="help-topics"
              name="help_topics"
              rows={3}
              maxLength={800}
              defaultValue={topicsToText(preferences.help_topics)}
              placeholder={"e.g. finishing my portfolio\njob applications"}
              className={`mt-1.5 ${inputClass}`}
            />
            <p className={hintClass}>
              One per line or comma-separated, up to {MAX_HELP_TOPICS}. Included
              when you ask for a suggestion so it can be relevant.
            </p>
          </div>

          <fieldset className="rounded-xl border border-line bg-paper p-3">
            <legend className="px-1 text-xs font-bold uppercase tracking-[0.15em] text-muted">
              Preferred reminder schedule
            </legend>
            <p className="text-sm leading-relaxed text-muted">
              These are your existing reminder settings. Saving this form
              reschedules future reminders to match; it never creates a new
              channel.
            </p>

            <label className="mt-3 flex items-start gap-2 text-sm leading-relaxed">
              <input
                type="checkbox"
                name="reminders_enabled"
                value="true"
                defaultChecked={reminder.enabled}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                <span className="font-semibold">Reminders on.</span> In-app only.
              </span>
            </label>

            <div className="mt-3 sm:max-w-40">
              <label className={labelClass} htmlFor="preference-remind-at">
                Time
              </label>
              <input
                id="preference-remind-at"
                name="remind_at"
                type="time"
                defaultValue={trimmed(reminder.remind_at)}
                className={`mt-1.5 ${inputClass}`}
              />
              <p className={hintClass}>
                Currently {formatTime12(reminder.remind_at)} in{" "}
                {reminder.timezone}.
              </p>
            </div>

            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
              {WEEKDAY_LABELS.map((label, index) => (
                <label key={label} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    name="reminder_weekdays"
                    value={index}
                    defaultChecked={reminderDays.includes(index)}
                    className="h-4 w-4"
                  />
                  {label}
                </label>
              ))}
            </div>
            <p className={hintClass}>
              Timezone, quiet hours and the daily check-in stay in Reminder
              settings below.
            </p>
          </fieldset>

          <p aria-live="polite" className="min-h-5 text-sm">
            {state.status === "error" ? (
              <span className="text-danger">{state.message}</span>
            ) : state.status === "success" ? (
              <span className="text-mint">{state.message}</span>
            ) : (
              <span className="text-muted">
                Nothing is shared with anyone else, and no preference changes a
                deadline, plan or task.
              </span>
            )}
          </p>

          <SubmitButton
            pendingLabel="Saving…"
            className={`${primaryButton} sm:w-auto`}
          >
            Save preferences
          </SubmitButton>
        </form>
      </div>

      <div className={`${cardClass} space-y-3`}>
        <h3 className="text-sm font-bold">Control your preferences</h3>
        <p className="text-sm leading-relaxed text-muted">
          Turning personalisation off keeps your answers but stops them being
          used. Resetting clears every value. Deleting removes the saved row.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <form action={disablePersonalizationAction}>
            <button type="submit" className={secondaryButton}>
              Disable personalisation
            </button>
          </form>

          <form action={resetPreferencesAction}>
            <button type="submit" className={secondaryButton}>
              Reset preferences
            </button>
          </form>

          <form action={deletePreferencesAction}>
            <button type="submit" className={dangerButton}>
              Delete saved preferences
            </button>
          </form>
        </div>

        <p className="text-xs leading-relaxed text-muted">
          None of these buttons touch your goals, tasks, deadlines or saved work.
        </p>
      </div>
    </section>
  );
}
