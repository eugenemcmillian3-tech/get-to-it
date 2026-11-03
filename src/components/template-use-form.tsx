"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleFormState } from "@/lib/action-state";
import { createGoalFromTemplateAction } from "@/lib/actions/templates";
import { TIME_AVAILABLE_OPTIONS } from "@/lib/constants";
import { formatMinutes } from "@/lib/format";
import { EXAMPLE_LABEL } from "@/lib/templates/helpers";
import { TEMPLATE_CATEGORIES } from "@/lib/templates/library";
import {
  cardClass,
  focusRing,
  hintClass,
  inputClass,
  labelClass,
  primaryButton,
} from "@/lib/styles";
import type { GoalCategory, TemplateStep } from "@/lib/types";

type DraftStep = {
  include: boolean;
  title: string;
  minutes: number;
  example: string | null;
};

/**
 * Customise a template, then create a real goal from it.
 *
 * Everything here is a copy: the terms are prefilled from the template, the
 * person can rename a step, change a time estimate or drop a step entirely, and
 * nothing is written until the button is pressed.
 */
export function TemplateUseForm({
  kind,
  templateKey,
  templateName,
  desiredOutcome,
  category,
  steps,
}: {
  kind: "static" | "personal";
  templateKey: string;
  templateName: string;
  desiredOutcome: string;
  category: GoalCategory | null;
  steps: TemplateStep[];
}) {
  const [state, formAction] = useActionState(
    createGoalFromTemplateAction,
    idleFormState,
  );

  const [draft, setDraft] = useState<DraftStep[]>(() =>
    steps.map((step) => ({
      include: true,
      title: step.title,
      minutes: step.estimated_minutes,
      example: step.example_deliverable,
    })),
  );

  const included = draft.filter((step) => step.include);
  const totalMinutes = included.reduce(
    (total, step) => total + (Number.isFinite(step.minutes) ? step.minutes : 0),
    0,
  );

  function updateStep(index: number, patch: Partial<DraftStep>) {
    setDraft((current) =>
      current.map((step, position) =>
        position === index ? { ...step, ...patch } : step,
      ),
    );
  }

  return (
    <form action={formAction} className={`${cardClass} mt-6`}>
      <input type="hidden" name="template_kind" value={kind} />
      <input type="hidden" name="template_key" value={templateKey} />
      <input type="hidden" name="step_count" value={draft.length} />

      <h2 className="text-xl font-bold">Make it yours</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Change anything below. Nothing is saved until you press the button, and
        the template you started from stays exactly as it was.
      </p>

      <div className="mt-5 space-y-4">
        <div>
          <label className={labelClass} htmlFor="template-goal-title">
            Goal title
          </label>
          <input
            id="template-goal-title"
            name="title"
            required
            maxLength={160}
            defaultValue={templateName}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="template-goal-outcome">
            Desired outcome
          </label>
          <textarea
            id="template-goal-outcome"
            name="desired_outcome"
            required
            rows={3}
            maxLength={2000}
            defaultValue={desiredOutcome}
            className={`mt-1.5 ${inputClass}`}
          />
          <p className={hintClass}>Edit this until it describes your version.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className={labelClass} htmlFor="template-goal-category">
              Category
            </label>
            <select
              id="template-goal-category"
              name="category"
              defaultValue={category ?? ""}
              className={`mt-1.5 ${inputClass}`}
            >
              <option value="">No category</option>
              {TEMPLATE_CATEGORIES.map((entry) => (
                <option key={entry.slug} value={entry.slug}>
                  {entry.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="template-goal-deadline">
              Deadline <span className="font-normal text-muted">(optional)</span>
            </label>
            <input
              id="template-goal-deadline"
              name="deadline"
              type="date"
              className={`mt-1.5 ${inputClass}`}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="template-goal-time">
              Time available today
            </label>
            <select
              id="template-goal-time"
              name="time_available_minutes"
              defaultValue="30"
              className={`mt-1.5 ${inputClass}`}
            >
              {TIME_AVAILABLE_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {formatMinutes(minutes)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <fieldset className="mt-7">
        <legend className="text-base font-semibold">Steps</legend>
        <p className={`${hintClass} mb-3`}>
          These become tasks you can edit, reorder or delete later.{" "}
          {included.length > 0
            ? `About ${formatMinutes(totalMinutes)} in total as estimated.`
            : "No steps selected."}
        </p>

        <ul className="space-y-3">
          {draft.map((step, index) => (
            <li
              key={index}
              className="rounded-xl border border-line bg-paper p-3.5"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-start gap-2">
                  <input
                    type="checkbox"
                    id={`template-step-include-${index}`}
                    checked={step.include}
                    onChange={(event) =>
                      updateStep(index, { include: event.target.checked })
                    }
                    className={`mt-2.5 size-4 shrink-0 cursor-pointer accent-[var(--color-brand)] ${focusRing}`}
                  />
                  <div className="min-w-0 flex-1">
                    <label
                      htmlFor={`template-step-title-${index}`}
                      className="sr-only"
                    >
                      Step {index + 1} name
                    </label>
                    <input
                      id={`template-step-title-${index}`}
                      name={`step_title_${index}`}
                      value={step.title}
                      onChange={(event) =>
                        updateStep(index, { title: event.target.value })
                      }
                      disabled={!step.include}
                      maxLength={200}
                      className={`${inputClass} disabled:opacity-50`}
                    />
                  </div>
                </div>
                <div className="w-28 shrink-0">
                  <label
                    htmlFor={`template-step-minutes-${index}`}
                    className="text-xs font-semibold text-muted"
                  >
                    Minutes
                  </label>
                  <input
                    id={`template-step-minutes-${index}`}
                    name={`step_minutes_${index}`}
                    type="number"
                    min={5}
                    max={480}
                    step={5}
                    value={step.minutes}
                    onChange={(event) =>
                      updateStep(index, {
                        minutes: Number.parseInt(event.target.value, 10) || 0,
                      })
                    }
                    disabled={!step.include}
                    className={`mt-1 ${inputClass} disabled:opacity-50`}
                  />
                </div>
              </div>

              <input
                type="hidden"
                name={`step_deliverable_${index}`}
                value={step.example ?? ""}
                disabled={!step.include}
              />

              {step.example ? (
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  <span className="rounded-full border border-line bg-card px-2 py-0.5 font-semibold uppercase tracking-wide">
                    {EXAMPLE_LABEL}
                  </span>{" "}
                  {step.example}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </fieldset>

      {state.message ? (
        <p
          role={state.status === "error" ? "alert" : "status"}
          aria-live="polite"
          className={
            state.status === "error"
              ? "mt-4 text-sm text-danger"
              : "mt-4 text-sm text-mint"
          }
        >
          {state.message}
        </p>
      ) : null}

      <div className="mt-5">
        <SubmitButton
          pendingLabel="Creating your goal…"
          className={`${primaryButton} w-full sm:w-auto`}
        >
          Create this goal
        </SubmitButton>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted">
        Steps are examples to start from, not instructions you owe anyone.
      </p>
    </form>
  );
}
