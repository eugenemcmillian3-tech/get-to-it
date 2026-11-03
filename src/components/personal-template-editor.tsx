"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleFormState } from "@/lib/action-state";
import {
  deletePersonalTemplateAction,
  updatePersonalTemplateAction,
} from "@/lib/actions/templates";
import { TEMPLATE_CATEGORIES } from "@/lib/templates/library";
import {
  dangerButton,
  focusRing,
  hintClass,
  inputClass,
  labelClass,
  secondaryButton,
} from "@/lib/styles";
import type { PersonalTemplate } from "@/lib/types";

/**
 * Edit or delete a private template.
 *
 * Editing a template cannot change a goal that was already created from it:
 * those goals hold their own copies.
 */
export function PersonalTemplateEditor({
  template,
}: {
  template: PersonalTemplate;
}) {
  const [state, formAction] = useActionState(
    updatePersonalTemplateAction,
    idleFormState,
  );
  const [deleteState, deleteAction] = useActionState(
    deletePersonalTemplateAction,
    idleFormState,
  );
  const [confirming, setConfirming] = useState(false);

  const [steps, setSteps] = useState(() =>
    template.steps.map((step) => ({
      title: step.title,
      minutes: step.estimated_minutes,
      example: step.example_deliverable ?? "",
    })),
  );

  function updateStep(
    index: number,
    patch: Partial<{ title: string; minutes: number; example: string }>,
  ) {
    setSteps((current) =>
      current.map((step, position) =>
        position === index ? { ...step, ...patch } : step,
      ),
    );
  }

  return (
    <section aria-labelledby="edit-template-heading" className="mt-10">
      <h2 id="edit-template-heading" className="text-xl font-bold">
        Edit this template
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Changes apply the next time you use it. Goals you already created from
        it keep their own copy.
      </p>

      <form action={formAction} className="mt-4 space-y-4">
        <input type="hidden" name="template_id" value={template.id} />
        <input type="hidden" name="step_count" value={steps.length} />

        <div>
          <label className={labelClass} htmlFor="template-edit-name">
            Template name
          </label>
          <input
            id="template-edit-name"
            name="name"
            required
            maxLength={120}
            defaultValue={template.name}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="template-edit-description">
            Description
          </label>
          <textarea
            id="template-edit-description"
            name="description"
            required
            rows={2}
            maxLength={1000}
            defaultValue={template.description}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="template-edit-outcome">
            Desired outcome
          </label>
          <textarea
            id="template-edit-outcome"
            name="desired_outcome"
            required
            rows={2}
            maxLength={2000}
            defaultValue={template.desired_outcome}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>

        <div className="sm:max-w-xs">
          <label className={labelClass} htmlFor="template-edit-category">
            Category
          </label>
          <select
            id="template-edit-category"
            name="category"
            defaultValue={template.category ?? ""}
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

        <fieldset>
          <legend className="text-sm font-semibold">Steps</legend>
          <p className={hintClass}>
            A blank name removes the step. Times are your own estimates.
          </p>

          <ul className="mt-3 space-y-3">
            {steps.map((step, index) => (
              <li
                key={index}
                className="rounded-xl border border-line bg-paper p-3.5"
              >
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <label
                      htmlFor={`edit-step-title-${index}`}
                      className="sr-only"
                    >
                      Step {index + 1} name
                    </label>
                    <input
                      id={`edit-step-title-${index}`}
                      name={`step_title_${index}`}
                      value={step.title}
                      maxLength={200}
                      onChange={(event) =>
                        updateStep(index, { title: event.target.value })
                      }
                      className={inputClass}
                    />
                  </div>
                  <div className="w-28 shrink-0">
                    <label
                      htmlFor={`edit-step-minutes-${index}`}
                      className="text-xs font-semibold text-muted"
                    >
                      Minutes
                    </label>
                    <input
                      id={`edit-step-minutes-${index}`}
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
                      className={`mt-1 ${inputClass}`}
                    />
                  </div>
                </div>

                <div className="mt-2">
                  <label
                    htmlFor={`edit-step-example-${index}`}
                    className="text-xs font-semibold text-muted"
                  >
                    Example deliverable (optional)
                  </label>
                  <input
                    id={`edit-step-example-${index}`}
                    name={`step_deliverable_${index}`}
                    value={step.example}
                    maxLength={300}
                    onChange={(event) =>
                      updateStep(index, { example: event.target.value })
                    }
                    className={`mt-1 ${inputClass}`}
                  />
                </div>
              </li>
            ))}
          </ul>
        </fieldset>

        {state.message ? (
          <p
            role={state.status === "error" ? "alert" : "status"}
            aria-live="polite"
            className={
              state.status === "error" ? "text-sm text-danger" : "text-sm text-mint"
            }
          >
            {state.message}
          </p>
        ) : null}

        <SubmitButton pendingLabel="Saving…" className={secondaryButton}>
          Save template
        </SubmitButton>
      </form>

      <div className="mt-8 border-t border-line pt-5">
        <h3 className="text-sm font-bold uppercase tracking-[0.15em] text-muted">
          Delete template
        </h3>
        <p className="mt-1 text-sm text-muted">
          This only removes the template. Goals you made from it are not touched.
        </p>

        {confirming ? (
          <form action={deleteAction} className="mt-3 space-y-3">
            <input type="hidden" name="template_id" value={template.id} />
            <p role="alert" className="text-sm font-medium text-danger">
              Delete “{template.name}”?
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <SubmitButton pendingLabel="Deleting…" className={dangerButton}>
                Yes, delete this template
              </SubmitButton>
              <button
                type="button"
                autoFocus
                onClick={() => setConfirming(false)}
                className={secondaryButton}
              >
                Keep it
              </button>
            </div>
            {deleteState.status === "error" ? (
              <p role="alert" className="text-sm text-danger">
                {deleteState.message}
              </p>
            ) : null}
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className={`mt-3 inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-danger/40 px-4 text-sm font-semibold text-danger transition hover:bg-danger/5 ${focusRing}`}
          >
            Delete template
          </button>
        )}
      </div>
    </section>
  );
}
