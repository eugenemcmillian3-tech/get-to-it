"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import {
  idleFormState,
  idleLearningHelpState,
} from "@/lib/action-state";
import {
  deleteLearningRecordAction,
  learningHelpAction,
  saveLearningAnswerAction,
  saveLearningFeedbackAction,
} from "@/lib/actions/learning";
import { AI_MODELS, DEFAULT_AI_MODEL } from "@/lib/ai/models";
import { mergeSuggestion } from "@/lib/ai/task-help";
import {
  CONFIDENCE_OPTIONS,
  LEARNING_HELP_INTENTS,
  LEARNING_HELP_LABELS,
  MAX_LEARNING_ANSWER,
  NOT_QUALIFICATION_NOTE,
  confidenceLabel,
  learningEvidence,
} from "@/lib/learning";
import {
  chipClass,
  hintClass,
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
} from "@/lib/styles";
import type { LearningRecord, LearningStep } from "@/lib/types";

/**
 * The practice workspace for one step.
 *
 * Four things stay visibly separate: your answer, your own confidence, your
 * "I finished this" mark, and the model's feedback. Asking for help saves
 * nothing; keeping the feedback is a separate button, and the note beside it
 * says what it is.
 */
export function LearningWorkspace({
  goalId,
  step,
  record,
}: {
  goalId: string;
  step: LearningStep;
  record: LearningRecord | null;
}) {
  const [answer, setAnswer] = useState(record?.answer ?? "");
  const [confidence, setConfidence] = useState(
    record?.confidence ? String(record.confidence) : "",
  );
  const [revisit, setRevisit] = useState(record?.revisit ?? false);
  const [completed, setCompleted] = useState(Boolean(record?.completed_at));
  const [practicePrompt, setPracticePrompt] = useState(record?.prompt ?? "");
  const [model, setModel] = useState(DEFAULT_AI_MODEL);

  const [saveState, saveAnswer] = useActionState(
    saveLearningAnswerAction,
    idleFormState,
  );
  const [helpState, askHelp] = useActionState(
    learningHelpAction,
    idleLearningHelpState,
  );
  const [feedbackState, saveFeedback] = useActionState(
    saveLearningFeedbackAction,
    idleFormState,
  );

  const evidence = learningEvidence(record);
  const suggestion = helpState.status === "suggestion" ? helpState.text : null;
  const suggestionIntent = helpState.intent ?? "";
  const reviewReady = answer.trim().length >= 2;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-line bg-card p-4">
        <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-muted">
          Where this stands
        </h2>
        <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
          <div className="rounded-xl border border-line bg-paper p-2.5">
            <dt className="text-xs text-muted">AI feedback</dt>
            <dd className="font-medium">
              {evidence.aiFeedback ? "Saved" : "None saved"}
            </dd>
          </div>
          <div className="rounded-xl border border-line bg-paper p-2.5">
            <dt className="text-xs text-muted">Your confidence</dt>
            <dd className="font-medium">{confidenceLabel(record?.confidence ?? null)}</dd>
          </div>
          <div className="rounded-xl border border-line bg-paper p-2.5">
            <dt className="text-xs text-muted">You marked it finished</dt>
            <dd className="font-medium">
              {evidence.completed ? "Yes" : "Not yet"}
            </dd>
          </div>
          <div className="rounded-xl border border-line bg-paper p-2.5">
            <dt className="text-xs text-muted">To revisit</dt>
            <dd className="font-medium">{evidence.revisit ? "Yes" : "No"}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          These are four separate records. Finishing an exercise doesn&apos;t
          create feedback, feedback doesn&apos;t change your confidence, and
          neither proves you have mastered anything.
        </p>
      </section>

      <form action={saveAnswer} className="rounded-2xl border border-line bg-card p-4 sm:p-5">
        <input type="hidden" name="goal_id" value={goalId} />
        <input type="hidden" name="step_id" value={step.id} />
        <input type="hidden" name="prompt" value={practicePrompt} />

        <label className={labelClass} htmlFor="learning-answer">
          Your answer or notes for this step
        </label>
        <p className={hintClass}>
          Write as much or as little as you like. It saves here, so you can come
          back to an unfinished exercise.
        </p>
        <textarea
          id="learning-answer"
          name="answer"
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          rows={8}
          maxLength={MAX_LEARNING_ANSWER}
          placeholder="Try it in your own words first. A wrong first attempt is useful."
          className={`mt-2 min-h-40 font-mono text-sm leading-relaxed ${inputClass}`}
        />

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="learning-confidence">
              How confident do you feel?
            </label>
            <select
              id="learning-confidence"
              name="confidence"
              value={confidence}
              onChange={(event) => setConfidence(event.target.value)}
              className={`mt-1.5 ${inputClass}`}
            >
              <option value="">Not recorded</option>
              {CONFIDENCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className={hintClass}>Your own rating. Nothing derives it for you.</p>
          </div>

          <div className="space-y-2 text-sm">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                name="revisit"
                value="true"
                checked={revisit}
                onChange={(event) => setRevisit(event.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                <span className="font-semibold">Mark this topic to revisit.</span>{" "}
                It stays in your list of things to come back to.
              </span>
            </label>

            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                name="completed"
                value="true"
                checked={completed}
                onChange={(event) => setCompleted(event.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                <span className="font-semibold">I finished this exercise.</span>{" "}
                Your own mark, separate from any feedback.
              </span>
            </label>
          </div>
        </div>

        <p aria-live="polite" className="mt-3 min-h-5 text-sm">
          {saveState.status === "error" ? (
            <span className="text-danger">{saveState.message}</span>
          ) : saveState.status === "success" ? (
            <span className="text-mint">{saveState.message}</span>
          ) : (
            <span className="text-muted">
              {record ? "Your saved answer is loaded here." : "Nothing saved yet."}
            </span>
          )}
        </p>

        <SubmitButton
          pendingLabel="Saving…"
          className={`${primaryButton} mt-2 sm:w-auto`}
        >
          Save my answer
        </SubmitButton>
      </form>

      <form
        action={askHelp}
        className="rounded-2xl border border-brand/30 bg-brand-soft/40 p-4 sm:p-5"
      >
        <input type="hidden" name="goal_id" value={goalId} />
        <input type="hidden" name="step_id" value={step.id} />
        <input type="hidden" name="answer" value={answer} />

        <h2 className="text-lg font-bold">Get help with this step</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Ask for a hint before an answer. Each request is one AI request, and
          nothing is saved automatically.
        </p>

        <div className="mt-3 sm:max-w-xs">
          <label className={labelClass} htmlFor="learning-help-model">
            Model
          </label>
          <select
            id="learning-help-model"
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
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {LEARNING_HELP_INTENTS.map((intent) => (
            <SubmitButton
              key={intent}
              name="intent"
              value={intent}
              pendingLabel="Asking…"
              className={`${secondaryButton} justify-start`}
              disabled={intent === "review-answer" && !reviewReady}
            >
              {LEARNING_HELP_LABELS[intent]}
            </SubmitButton>
          ))}
        </div>
        {!reviewReady ? (
          <p className={hintClass}>
            Write an answer above to turn on “Review my answer”.
          </p>
        ) : null}

        {helpState.status === "error" ? (
          <p role="alert" className="mt-3 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
            {helpState.message}
          </p>
        ) : null}

        {suggestion ? (
          <div className="mt-4 rounded-xl border border-line bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className={chipClass}>AI suggestion</span>
              <span className={chipClass}>Not saved</span>
              <span className={chipClass}>
                {LEARNING_HELP_LABELS[suggestionIntent as keyof typeof LEARNING_HELP_LABELS] ??
                  "Answer"}
              </span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
              {suggestion}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              {NOT_QUALIFICATION_NOTE}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setAnswer((current) => mergeSuggestion(current, suggestion))}
                className={secondaryButton}
              >
                Add to my answer
              </button>

              {suggestionIntent === "practice-exercise" ? (
                <button
                  type="button"
                  onClick={() => setPracticePrompt(suggestion)}
                  className={secondaryButton}
                >
                  Use this as the exercise prompt
                </button>
              ) : null}
            </div>

            {suggestionIntent === "review-answer" ? (
              <div className="mt-3 border-t border-line pt-3">
                <form action={saveFeedback}>
                  <input type="hidden" name="goal_id" value={goalId} />
                  <input type="hidden" name="step_id" value={step.id} />
                  <input type="hidden" name="feedback" value={suggestion} />
                  <SubmitButton
                    pendingLabel="Saving…"
                    className={`${secondaryButton} sm:w-auto`}
                  >
                    Keep this feedback
                  </SubmitButton>
                </form>
                <p aria-live="polite" className="mt-2 min-h-5 text-sm">
                  {feedbackState.status === "error" ? (
                    <span className="text-danger">{feedbackState.message}</span>
                  ) : feedbackState.status === "success" ? (
                    <span className="text-mint">{feedbackState.message}</span>
                  ) : (
                    <span className="text-muted">
                      Only kept if you press the button.
                    </span>
                  )}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </form>

      {record?.feedback ? (
        <section className="rounded-2xl border border-line bg-paper p-4">
          <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-muted">
            Feedback you kept
          </h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
            {record.feedback}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            {NOT_QUALIFICATION_NOTE}
          </p>
        </section>
      ) : null}

      {record ? (
        <form action={deleteLearningRecordAction} className="rounded-2xl border border-line bg-card p-4">
          <input type="hidden" name="goal_id" value={goalId} />
          <input type="hidden" name="step_id" value={step.id} />
          <p className="text-sm font-semibold">Delete this exercise record</p>
          <p className="mt-1 text-sm text-muted">
            Removes your answer, the saved feedback and your confidence for this
            step. The learning material stays.
          </p>
          <button
            type="submit"
            className="mt-2 cursor-pointer rounded text-sm font-medium text-danger underline decoration-line underline-offset-4 hover:decoration-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            Delete my record for this step
          </button>
        </form>
      ) : null}
    </div>
  );
}
