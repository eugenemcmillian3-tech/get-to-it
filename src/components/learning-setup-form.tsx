"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import {
  idleLearningPlanState,
} from "@/lib/action-state";
import { createLearningPlanAction } from "@/lib/actions/learning";
import { AI_MODELS, DEFAULT_AI_MODEL } from "@/lib/ai/models";
import { operationChargeLabel } from "@/lib/credits/pricing";
import {
  LEARNING_EXPERIENCE_OPTIONS,
  GENERATED_CONTENT_NOTE,
} from "@/lib/learning";
import {
  hintClass,
  inputClass,
  labelClass,
  primaryButton,
} from "@/lib/styles";/**
 * Sets up learning mode for one goal. This is the only place a path is
 * generated, and the button says what it costs: one AI request.
 */
export function LearningSetupForm({ goalId }: { goalId: string }) {
  const [state, formAction] = useActionState(
    createLearningPlanAction,
    idleLearningPlanState,
  );
  const [model, setModel] = useState(DEFAULT_AI_MODEL);

  return (
    <form
      action={formAction}
      className="rounded-2xl border border-brand/30 bg-brand-soft/40 p-4 sm:p-5"
    >
      <input type="hidden" name="goal_id" value={goalId} />

      <h2 className="text-lg font-bold">Start learning mode</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Tell GET TO IT what you want to learn and how much time you have. It will
        draft a short path of explanations, practice and small projects. Every
        step is editable, and you can skip any of them.
      </p>

      <div className="mt-4 space-y-4">
        <div>
          <label className={labelClass} htmlFor="what-to-learn">
            What do you want to learn?
          </label>
          <input
            id="what-to-learn"
            name="what_to_learn"
            required
            maxLength={200}
            placeholder="e.g. the basics of CSS grid layout"
            className={`mt-1.5 ${inputClass}`}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="learning-experience">
              Current experience
            </label>
            <select
              id="learning-experience"
              name="experience"
              defaultValue="some"
              className={`mt-1.5 ${inputClass}`}
            >
              {LEARNING_EXPERIENCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} — {option.hint}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass} htmlFor="learning-minutes">
              Time available each week
            </label>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                id="learning-minutes"
                name="minutes_per_week"
                type="number"
                min={15}
                max={2400}
                step={15}
                defaultValue={120}
                required
                className={inputClass}
              />
              <span className="text-sm text-muted">minutes</span>
            </div>
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="learning-outcome">
            One concrete thing you want to be able to do
          </label>
          <textarea
            id="learning-outcome"
            name="outcome"
            required
            rows={2}
            maxLength={500}
            placeholder="e.g. build a page layout with grid without copying a tutorial"
            className={`mt-1.5 ${inputClass}`}
          />
        </div>

        <div className="sm:max-w-xs">
          <label className={labelClass} htmlFor="learning-model">
            Model
          </label>
          <select
            id="learning-model"
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
          <p className={hintClass}>
            This request: {operationChargeLabel("learning")}. Served by Ollama;
            the key stays on the server.
          </p>
        </div>
      </div>

      <p className="mt-4 rounded-xl border border-line bg-card p-3 text-xs leading-relaxed text-muted">
        {GENERATED_CONTENT_NOTE} It will not promise mastery by a date, and it is
        not a course or a qualification.
      </p>

      <p aria-live="polite" className="mt-3 min-h-5 text-sm">
        {state.status === "error" ? (
          <span className="text-danger">{state.message}</span>
        ) : state.status === "saved" ? (
          <span className="text-mint">{state.message}</span>
        ) : (
          <span className="text-muted">
            Nothing is generated until you press the button.
          </span>
        )}
      </p>

      <SubmitButton
        pendingLabel="Drafting a path…"
        className={`${primaryButton} mt-3 sm:w-auto`}
      >
        Generate a learning path
      </SubmitButton>
    </form>
  );
}
