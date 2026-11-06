"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleAiHelpState } from "@/lib/action-state";
import { getUnstuckAction } from "@/lib/actions/ai";
import { remainingNote } from "@/lib/ai/limits";
import { AI_MODELS, aiModelLabel, DEFAULT_AI_MODEL } from "@/lib/ai/models";
import { focusRing, hintClass, inputClass, labelClass, secondaryButton } from "@/lib/styles";

export function UnstuckPanel({ goalId }: { goalId: string }) {
  const [state, formAction] = useActionState(getUnstuckAction, idleAiHelpState);
  const selectedModel = state.model ? aiModelLabel(state.model) : null;

  return (
    <section
      aria-labelledby="unstuck-heading"
      className="mt-10 rounded-2xl border border-line bg-brand-soft/60 p-4 sm:p-5"
    >
      <h2 id="unstuck-heading" className="text-xl font-bold">
        Stuck? Ask for a starting point
      </h2>
      <p className="mt-1 text-sm text-muted">
        An open model can suggest a small first step from this goal and the tasks
        you already wrote. You still decide what to do.
      </p>

      <form action={formAction} className="mt-4 space-y-3">
        <input type="hidden" name="goal_id" value={goalId} />

        <div>
          <label className={labelClass} htmlFor="ai-model">
            Model
          </label>
          <select
            id="ai-model"
            name="model"
            defaultValue={DEFAULT_AI_MODEL}
            aria-describedby="ai-model-hint"
            className={`mt-1.5 ${inputClass}`}
          >
            {AI_MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label} — {model.vendor}
              </option>
            ))}
          </select>
          <p id="ai-model-hint" className={hintClass}>
            Served by Ollama&apos;s cloud API. The key stays on the server.
          </p>
        </div>

        <SubmitButton pendingLabel="Asking…" className={`${secondaryButton} sm:w-auto`}>
          I&apos;M STUCK
        </SubmitButton>

        <p className="text-xs text-muted">
          {remainingNote("unstuck")}
        </p>
      </form>

      {state.status === "error" && state.message ? (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger"
        >
          {state.message}
        </p>
      ) : null}

      {state.status === "success" && state.answer ? (
        <div
          aria-live="polite"
          className="mt-4 rounded-xl border border-line bg-card p-4"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted">
            {selectedModel ?? "Suggestion"}
          </p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
            {state.answer}
          </p>
          <p className={`mt-3 text-xs text-muted`}>
            A model wrote this and can be wrong. Take the part that helps.
          </p>
        </div>
      ) : null}

      <p className="mt-4 text-xs text-muted">
        <a
          href="https://ollama.com/library/glm-5.3-flash"
          target="_blank"
          rel="noreferrer"
          className={`rounded underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          About the default model
        </a>
      </p>
    </section>
  );
}
