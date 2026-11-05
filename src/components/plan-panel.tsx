"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idlePlanState, type PlanState } from "@/lib/action-state";
import { planGoalAction, savePlanAction } from "@/lib/actions/plan";
import { remainingNote } from "@/lib/ai/limits";
import { AI_MODELS, DEFAULT_AI_MODEL } from "@/lib/ai/models";
import { MAX_PLAN_TASKS, MIN_PLAN_TASKS, type PlanTask } from "@/lib/ai/plan";
import { formatMinutes } from "@/lib/format";
import {
  focusRing,
  hintClass,
  inputClass,
  labelClass,
  primaryButton,
  quietButton,
  secondaryButton,
} from "@/lib/styles";

type FormAction = (formData: FormData) => void;
type DraftField = "title" | "instructions" | "first_action" | "expected_deliverable";

/**
 * "Help me plan this goal."
 *
 * The preview is browser state on purpose: a generated plan is never written to
 * the task list until the person approves it. The preview is keyed by the
 * generation nonce, so a fresh plan replaces it, a failed regeneration leaves
 * the edits in place, and discarding simply returns to the start state.
 */
export function PlanPanel({ goalId }: { goalId: string }) {
  const [planState, generate] = useActionState(planGoalAction, idlePlanState);
  const [saveState, savePlan] = useActionState(savePlanAction, idlePlanState);
  const [model, setModel] = useState(DEFAULT_AI_MODEL);
  const [clearedNonce, setClearedNonce] = useState<number | null>(null);

  const dismissed =
    clearedNonce !== null && planState.nonce === clearedNonce;
  const preview =
    !dismissed && planState.status === "preview" && planState.tasks
      ? planState
      : null;
  const clarify =
    !dismissed && planState.status === "clarify" && planState.questions
      ? planState
      : null;
  const savedVisible = saveState.status === "saved" && !dismissed;
  const note = remainingNote();

  return (
    <section
      aria-labelledby="plan-heading"
      className="mt-4 rounded-2xl border border-brand/30 bg-brand-soft/40 p-4 sm:p-5"
    >
      <h2 id="plan-heading" className="text-xl font-bold">
        Help me plan this goal
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        An open model drafts {MIN_PLAN_TASKS}–{MAX_PLAN_TASKS} tasks from this
        goal, your deadline, the time you have today and what&apos;s been in the
        way. Nothing is saved until you approve the preview, and your existing
        tasks are never touched.
      </p>

      {planState.status === "error" && planState.message ? (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger"
        >
          {planState.message}
        </p>
      ) : null}

      {savedVisible ? (
        <div
          aria-live="polite"
          className="mt-4 rounded-xl border border-mint/30 bg-mint-soft p-4"
        >
          <p className="text-sm font-semibold text-mint">
            {saveState.message ?? "Plan saved."}
          </p>
          <p className="mt-1 text-sm text-muted">
            They are in the task list above, ready to open and start.
          </p>
          <button
            type="button"
            onClick={() => setClearedNonce(planState.nonce ?? null)}
            className={`${secondaryButton} mt-3`}
          >
            Plan something else
          </button>
        </div>
      ) : preview ? (
        <PlanPreview
          key={preview.nonce}
          goalId={goalId}
          initialTasks={preview.tasks ?? []}
          snapshot={preview.snapshot ?? ""}
          planId={preview.planId ?? ""}
          model={preview.model ?? model}
          saveAction={savePlan}
          saveState={saveState}
          generateAction={generate}
          onDiscard={() => setClearedNonce(preview.nonce ?? null)}
        />
      ) : clarify && clarify.questions ? (
        <PlanQuestions
          key={clarify.nonce}
          goalId={goalId}
          model={clarify.model ?? model}
          questions={clarify.questions}
          action={generate}
          onStartOver={() => setClearedNonce(clarify.nonce ?? null)}
        />
      ) : (
        <form action={generate} className="mt-4 space-y-3">
          <input type="hidden" name="goal_id" value={goalId} />
          <input type="hidden" name="mode" value="start" />

          <div className="sm:max-w-xs">
            <label className={labelClass} htmlFor="plan-model">
              Model
            </label>
            <select
              id="plan-model"
              name="model"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              aria-describedby="plan-model-hint"
              className={`mt-1.5 ${inputClass}`}
            >
              {AI_MODELS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label} — {option.vendor}
                </option>
              ))}
            </select>
            <p id="plan-model-hint" className={hintClass}>
              Served by Ollama&apos;s cloud API. The key stays on the server.
            </p>
          </div>

          <SubmitButton
            pendingLabel="Planning…"
            className={`${primaryButton} sm:w-auto`}
          >
            Help me plan this goal
          </SubmitButton>

          <p className={hintClass}>
            {note ??
              "One AI request at a time, with a daily allowance per account."}
          </p>
        </form>
      )}
    </section>
  );
}

/** Up to three questions, only asked when the goal is too vague to plan. */
function PlanQuestions({
  goalId,
  model,
  questions,
  action,
  onStartOver,
}: {
  goalId: string;
  model: string;
  questions: string[];
  action: FormAction;
  onStartOver: () => void;
}) {
  return (
    <form action={action} className="mt-4 space-y-3">
      <input type="hidden" name="goal_id" value={goalId} />
      <input type="hidden" name="mode" value="answer" />
      <input type="hidden" name="model" value={model} />

      <p className="text-sm font-medium">
        The model needs a little more detail before it plans:
      </p>

      {questions.map((question, index) => (
        <div key={index}>
          <input type="hidden" name={`question-${index}`} value={question} />
          <label className={labelClass} htmlFor={`plan-question-${index}`}>
            {question}
          </label>
          <input
            id={`plan-question-${index}`}
            name={`answer-${index}`}
            maxLength={500}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
      ))}

      <div className="flex flex-col gap-2 sm:flex-row">
        <SubmitButton
          pendingLabel="Planning…"
          className={`${primaryButton} sm:w-auto`}
        >
          Generate plan
        </SubmitButton>
        <button type="button" onClick={onStartOver} className={secondaryButton}>
          Start over
        </button>
      </div>
      <p className={hintClass}>
        Answer at least one question, or start over and plan without them.
      </p>
    </form>
  );
}

/** The editable preview. Nothing here touches the database until Save plan. */
function PlanPreview({
  goalId,
  initialTasks,
  snapshot,
  planId,
  model,
  saveAction,
  saveState,
  generateAction,
  onDiscard,
}: {
  goalId: string;
  initialTasks: PlanTask[];
  snapshot: string;
  planId: string;
  model: string;
  saveAction: FormAction;
  saveState: PlanState;
  generateAction: FormAction;
  onDiscard: () => void;
}) {
  const [drafts, setDrafts] = useState<PlanTask[]>(() =>
    initialTasks.map((task) => ({ ...task })),
  );
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);

  const totalMinutes = drafts.reduce(
    (total, task) => total + (Number(task.estimated_minutes) || 0),
    0,
  );
  const titlesComplete = drafts.every((task) => task.title.trim().length >= 2);
  const canSave =
    drafts.length > 0 && drafts.length <= MAX_PLAN_TASKS && titlesComplete;

  function updateDraft(index: number, field: DraftField, value: string) {
    setDrafts((current) =>
      current.map((task, position) =>
        position === index ? { ...task, [field]: value } : task,
      ),
    );
  }

  function updateMinutes(index: number, value: string) {
    const minutes = value === "" ? 0 : Number(value);
    setDrafts((current) =>
      current.map((task, position) =>
        position === index ? { ...task, estimated_minutes: minutes } : task,
      ),
    );
  }

  function removeDraft(index: number) {
    setDrafts((current) => current.filter((_, position) => position !== index));
  }

  return (
    <>
      <form action={saveAction} className="mt-4 space-y-4">
        <input type="hidden" name="goal_id" value={goalId} />
        <input type="hidden" name="snapshot" value={snapshot} />
        <input type="hidden" name="plan_id" value={planId} />
        <input type="hidden" name="model" value={model} />
        <input type="hidden" name="tasks_json" value={JSON.stringify(drafts)} />

        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-muted">
            Preview · nothing saved yet
          </p>
          <p className="text-sm text-muted">
            {drafts.length} {drafts.length === 1 ? "task" : "tasks"}
            {totalMinutes > 0 ? ` · about ${formatMinutes(totalMinutes)}` : ""}
          </p>
        </div>

        <ul className="space-y-3">
          {drafts.map((task, index) => (
            <li
              key={index}
              className="rounded-xl border border-line bg-card p-3.5"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Task {index + 1}
                </p>
                <button
                  type="button"
                  onClick={() => removeDraft(index)}
                  className={`${quietButton} text-danger`}
                >
                  Remove
                </button>
              </div>

              <div className="mt-2 space-y-3">
                <div>
                  <label className={labelClass} htmlFor={`plan-title-${index}`}>
                    Title
                  </label>
                  <input
                    id={`plan-title-${index}`}
                    value={task.title}
                    onChange={(event) =>
                      updateDraft(index, "title", event.target.value)
                    }
                    maxLength={200}
                    className={`mt-1.5 ${inputClass}`}
                  />
                </div>

                <div>
                  <label
                    className={labelClass}
                    htmlFor={`plan-instructions-${index}`}
                  >
                    Instructions
                  </label>
                  <textarea
                    id={`plan-instructions-${index}`}
                    value={task.instructions}
                    onChange={(event) =>
                      updateDraft(index, "instructions", event.target.value)
                    }
                    rows={3}
                    maxLength={2000}
                    className={`mt-1.5 ${inputClass}`}
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      className={labelClass}
                      htmlFor={`plan-first-${index}`}
                    >
                      First action
                    </label>
                    <input
                      id={`plan-first-${index}`}
                      value={task.first_action}
                      onChange={(event) =>
                        updateDraft(index, "first_action", event.target.value)
                      }
                      maxLength={300}
                      className={`mt-1.5 ${inputClass}`}
                    />
                  </div>
                  <div>
                    <label
                      className={labelClass}
                      htmlFor={`plan-deliverable-${index}`}
                    >
                      Expected deliverable
                    </label>
                    <input
                      id={`plan-deliverable-${index}`}
                      value={task.expected_deliverable}
                      onChange={(event) =>
                        updateDraft(
                          index,
                          "expected_deliverable",
                          event.target.value,
                        )
                      }
                      maxLength={300}
                      className={`mt-1.5 ${inputClass}`}
                    />
                  </div>
                </div>

                <div className="sm:max-w-40">
                  <label className={labelClass} htmlFor={`plan-minutes-${index}`}>
                    Estimated minutes
                  </label>
                  <input
                    id={`plan-minutes-${index}`}
                    type="number"
                    inputMode="numeric"
                    min={5}
                    max={240}
                    value={
                      Number.isFinite(task.estimated_minutes)
                        ? task.estimated_minutes
                        : ""
                    }
                    onChange={(event) => updateMinutes(index, event.target.value)}
                    className={`mt-1.5 ${inputClass}`}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>

        {!titlesComplete ? (
          <p role="alert" className="text-sm text-danger">
            Every task needs a name before you can save.
          </p>
        ) : null}

        {saveState.status === "error" && saveState.message ? (
          <p
            role="alert"
            className="rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger"
          >
            {saveState.message}
          </p>
        ) : null}

        <SubmitButton
          pendingLabel="Saving plan…"
          className={`${primaryButton} sm:w-auto`}
          disabled={!canSave}
        >
          Save plan
        </SubmitButton>
        <p className={hintClass}>
          Saving adds these as new tasks. Completed tasks and saved work stay as
          they are.
        </p>
      </form>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        {confirmRegenerate ? (
          <div className="w-full rounded-xl border border-line bg-card p-3">
            <p className="text-sm font-medium">
              Generate again? This replaces the preview, not your saved tasks.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <form action={generateAction}>
                <input type="hidden" name="goal_id" value={goalId} />
                <input type="hidden" name="mode" value="start" />
                <input type="hidden" name="model" value={model} />
                <SubmitButton
                  pendingLabel="Regenerating…"
                  className={`${secondaryButton} sm:w-auto`}
                >
                  Yes, regenerate
                </SubmitButton>
              </form>
              <button
                type="button"
                onClick={() => setConfirmRegenerate(false)}
                className={secondaryButton}
              >
                Keep this preview
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmRegenerate(true)}
            className={secondaryButton}
          >
            Regenerate
          </button>
        )}

        <button
          type="button"
          onClick={onDiscard}
          className={`${quietButton} ${focusRing}`}
        >
          Discard preview
        </button>
      </div>
    </>
  );
}
