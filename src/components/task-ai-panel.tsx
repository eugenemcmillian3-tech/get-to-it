"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleTaskAiState, type TaskAiState } from "@/lib/action-state";
import { taskAiAction } from "@/lib/actions/task-ai";
import { remainingNote } from "@/lib/ai/limits";
import { AI_MODELS, aiModelLabel, DEFAULT_AI_MODEL } from "@/lib/ai/models";
import {
  MAIN_INTENTS,
  STUCK_INTENTS,
  TASK_HELP_LABELS,
} from "@/lib/ai/task-help";
import {
  chipClass,
  hintClass,
  inputClass,
  labelClass,
  primaryButton,
  quietButton,
  secondaryButton,
} from "@/lib/styles";

/**
 * Task workspace help.
 *
 * Every answer appears in a card first. The person can edit it, add it to their
 * notes, or discard it — and adding it only changes the editor, never the saved
 * task and never its status. Marking a task complete stays a separate choice.
 */
export function TaskAiPanel({
  goalId,
  taskId,
  content,
  onUseSuggestion,
}: {
  goalId: string;
  taskId: string;
  /** The editor as it stands, so reviews include unsaved typing. */
  content: string;
  /** Appends accepted text to the editor. Never writes to the database. */
  onUseSuggestion: (text: string) => void;
}) {
  const [state, formAction] = useActionState(taskAiAction, idleTaskAiState);
  const [model, setModel] = useState(DEFAULT_AI_MODEL);

  const hasNotes = content.trim() !== "";
  const note = remainingNote("task_help");

  return (
    <section
      aria-labelledby="task-ai-heading"
      className="rounded-2xl border border-brand/30 bg-brand-soft/40 p-4 sm:p-5"
    >
      <h2 id="task-ai-heading" className="text-xl font-bold">
        Get help with this step
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Help uses this task, its goal and the notes you have saved. Whatever
        comes back waits here until you add it, edit it or throw it away.
      </p>

      <form action={formAction} className="mt-4 space-y-3">
        <input type="hidden" name="goal_id" value={goalId} />
        <input type="hidden" name="task_id" value={taskId} />
        <input type="hidden" name="content" value={content} />

        <div className="sm:max-w-xs">
          <label className={labelClass} htmlFor="task-ai-model">
            Model
          </label>
          <select
            id="task-ai-model"
            name="model"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            aria-describedby="task-ai-model-hint"
            className={`mt-1.5 ${inputClass}`}
          >
            {AI_MODELS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label} — {option.vendor}
              </option>
            ))}
          </select>
          <p id="task-ai-model-hint" className={hintClass}>
            Served by Ollama&apos;s cloud API. The key stays on the server.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {MAIN_INTENTS.map((intent) => (
            <SubmitButton
              key={intent}
              name="intent"
              value={intent}
              pendingLabel="Asking…"
              className={`${secondaryButton} justify-start`}
              disabled={intent === "review" && !hasNotes}
            >
              {TASK_HELP_LABELS[intent]}
            </SubmitButton>
          ))}
        </div>
        {!hasNotes ? (
          <p className={hintClass}>
            Write a line in your notes to turn on “Review my work”.
          </p>
        ) : null}

        <fieldset className="rounded-xl border border-line bg-card p-3">
          <legend className="px-1 text-xs font-bold uppercase tracking-[0.15em] text-muted">
            I&apos;M STUCK
          </legend>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {STUCK_INTENTS.map((intent) => (
              <SubmitButton
                key={intent}
                name="intent"
                value={intent}
                pendingLabel="Asking…"
                className={quietButton}
              >
                {TASK_HELP_LABELS[intent]}
              </SubmitButton>
            ))}
          </div>
        </fieldset>

        <p className={hintClass}>
          {note}
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

      {state.status === "suggestion" && state.text ? (
        <SuggestionCard
          key={state.nonce}
          state={state}
          onUseSuggestion={onUseSuggestion}
        />
      ) : null}
    </section>
  );
}

type CardOutcome = "waiting" | "added" | "discarded";

/** One suggestion: editable text, then add or discard. Nothing else happens. */
function SuggestionCard({
  state,
  onUseSuggestion,
}: {
  state: TaskAiState;
  onUseSuggestion: (text: string) => void;
}) {
  const [draft, setDraft] = useState(state.text ?? "");
  const [outcome, setOutcome] = useState<CardOutcome>("waiting");

  if (outcome === "discarded") return null;

  if (outcome === "added") {
    return (
      <div
        aria-live="polite"
        className="mt-4 rounded-xl border border-mint/30 bg-mint-soft p-4"
      >
        <p className="text-sm font-semibold text-mint">Added to your notes.</p>
        <p className="mt-1 text-sm text-muted">
          It isn&apos;t saved and the task isn&apos;t complete until you choose
          those yourself — press “Save work” below to keep it.
        </p>
      </div>
    );
  }

  const trimmed = draft.trim();
  const label = state.intent
    ? TASK_HELP_LABELS[state.intent]
    : "AI suggestion";

  return (
    <div
      aria-live="polite"
      className="mt-4 rounded-xl border border-line bg-card p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={chipClass}>{label}</span>
        <span className={chipClass}>Not saved</span>
        {state.model ? (
          <span className="text-xs text-muted">{aiModelLabel(state.model)}</span>
        ) : null}
      </div>

      <label className={`${labelClass} mt-3`} htmlFor="task-ai-draft">
        Edit it before you use it
      </label>
      <textarea
        id="task-ai-draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={9}
        maxLength={2000}
        className={`mt-1.5 font-mono text-sm leading-relaxed ${inputClass}`}
      />

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => {
            onUseSuggestion(trimmed);
            setOutcome("added");
          }}
          disabled={trimmed === ""}
          className={`${primaryButton} sm:w-auto`}
        >
          Add to my notes
        </button>
        <button
          type="button"
          onClick={() => setOutcome("discarded")}
          className={secondaryButton}
        >
          Discard
        </button>
      </div>

      <p className="mt-2 text-xs text-muted">
        Adding it only fills the notes box. Nothing is stored until you save, and
        a suggestion can never mark this task complete.
      </p>
    </div>
  );
}
