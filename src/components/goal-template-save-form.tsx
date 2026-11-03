"use client";

import Link from "next/link";
import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleFormState } from "@/lib/action-state";
import { savePlanAsTemplateAction } from "@/lib/actions/templates";
import { TEMPLATE_CATEGORIES } from "@/lib/templates/library";
import {
  focusRing,
  hintClass,
  inputClass,
  labelClass,
  secondaryButton,
} from "@/lib/styles";
import type { GoalCategory } from "@/lib/types";

/**
 * Save this plan as a private, reusable template.
 *
 * The form says what is copied before it is copied: task names and time
 * estimates. Saved work, reflections and AI answers are not read at all.
 */
export function SavePlanAsTemplateForm({
  goalId,
  goalTitle,
  category,
}: {
  goalId: string;
  goalTitle: string;
  category: GoalCategory | null;
}) {
  const [state, formAction] = useActionState(
    savePlanAsTemplateAction,
    idleFormState,
  );

  return (
    <details className="mt-4">
      <summary
        className={`inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg py-1 text-sm font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-ink ${focusRing}`}
      >
        Save this plan as a template
      </summary>

      <form action={formAction} className="mt-3 space-y-3 rounded-xl bg-paper p-3.5">
        <input type="hidden" name="goal_id" value={goalId} />

        <p className="text-sm leading-relaxed text-muted">
          Task names and their time estimates are copied into a private template
          you can reuse. Saved work, weekly reflections and AI answers stay out
          of it.
        </p>

        <div>
          <label className={labelClass} htmlFor="template-save-name">
            Template name
          </label>
          <input
            id="template-save-name"
            name="name"
            required
            maxLength={120}
            defaultValue={goalTitle}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="template-save-description">
            What is it for?
          </label>
          <textarea
            id="template-save-description"
            name="description"
            required
            rows={2}
            maxLength={1000}
            placeholder="When would future-you reach for this?"
            className={`mt-1.5 ${inputClass}`}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="template-save-category">
            Category
          </label>
          <select
            id="template-save-category"
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
          <p className={hintClass}>Only you can see this template.</p>
        </div>

        {state.message ? (
          <p
            role={state.status === "error" ? "alert" : "status"}
            aria-live="polite"
            className={
              state.status === "error" ? "text-sm text-danger" : "text-sm text-mint"
            }
          >
            {state.message}{" "}
            {state.status === "success" ? (
              <Link
                href="/templates"
                className="font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
              >
                See your templates
              </Link>
            ) : null}
          </p>
        ) : null}

        <SubmitButton pendingLabel="Saving…" className={secondaryButton}>
          Save as private template
        </SubmitButton>
      </form>
    </details>
  );
}
