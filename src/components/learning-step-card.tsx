import Link from "next/link";
import {
  GENERATED_CONTENT_NOTE,
  LEARNING_KIND_LABELS,
} from "@/lib/learning";
import { approveLearningCheckpointAction, setLearningStepStatusAction, updateLearningStepAction } from "@/lib/actions/learning";
import { formatMinutes } from "@/lib/format";
import { chipClass, focusRing, inputClass, labelClass, secondaryButton } from "@/lib/styles";
import type { LearningStep } from "@/lib/types";

/**
 * One step of the path: reading, practice, a small project or a checkpoint.
 * Editing, skipping and approving are plain forms, so they work without any
 * client JavaScript; the page re-renders from the database afterwards.
 */
export function LearningStepCard({
  goalId,
  step,
}: {
  goalId: string;
  step: LearningStep;
}) {
  const skipped = step.status === "skipped";
  const approved = step.approved_at !== null;

  return (
    <li
      className={`rounded-2xl border p-4 ${
        skipped ? "border-dashed border-line bg-paper" : "border-line bg-card"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={chipClass}>{LEARNING_KIND_LABELS[step.kind]}</span>
        <span className={chipClass}>Step {step.position}</span>
        <span className={chipClass}>{formatMinutes(step.estimated_minutes)}</span>
        <span className={chipClass}>AI-generated</span>
        {skipped ? <span className={chipClass}>Skipped</span> : null}
        {step.kind === "checkpoint" ? (
          <span className={chipClass}>
            {approved ? "Approved by you" : "Waiting for your approval"}
          </span>
        ) : null}
      </div>

      <h3
        className={`mt-2 text-lg font-semibold leading-snug ${
          skipped ? "text-muted line-through" : ""
        }`}
      >
        {step.title}
      </h3>

      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink/90">
        {step.body}
      </p>

      <p className="mt-2 text-xs leading-relaxed text-muted">
        {GENERATED_CONTENT_NOTE}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Link
          href={`/goals/${goalId}/learn/${step.id}`}
          className={`rounded text-sm font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-ink ${focusRing}`}
        >
          Practice this step
        </Link>

        <form action={setLearningStepStatusAction}>
          <input type="hidden" name="goal_id" value={goalId} />
          <input type="hidden" name="step_id" value={step.id} />
          <input type="hidden" name="status" value={skipped ? "active" : "skipped"} />
          <button
            type="submit"
            className={`cursor-pointer rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
          >
            {skipped ? "Bring this step back" : "Skip this step"}
          </button>
        </form>
      </div>

      {step.kind === "checkpoint" ? (
        <form action={approveLearningCheckpointAction} className="mt-2">
          <input type="hidden" name="goal_id" value={goalId} />
          <input type="hidden" name="step_id" value={step.id} />
          <input type="hidden" name="intent" value={approved ? "withdraw" : "approve"} />
          <button type="submit" className={`${secondaryButton} mt-1`}>
            {approved ? "Withdraw my approval" : "I've met this checkpoint"}
          </button>
          <p className="mt-1 text-xs text-muted">
            Approval is your own judgement. No model decides whether a checkpoint
            is met, and nothing is graded.
          </p>
        </form>
      ) : null}

      <details className="mt-3">
        <summary
          className={`cursor-pointer rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          Edit this step
        </summary>
        <form action={updateLearningStepAction} className="mt-3 space-y-3">
          <input type="hidden" name="goal_id" value={goalId} />
          <input type="hidden" name="step_id" value={step.id} />
          <div>
            <label className={labelClass} htmlFor={`title-${step.id}`}>
              Title
            </label>
            <input
              id={`title-${step.id}`}
              name="title"
              defaultValue={step.title}
              required
              minLength={2}
              maxLength={200}
              className={`mt-1.5 ${inputClass}`}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor={`body-${step.id}`}>
              Material
            </label>
            <textarea
              id={`body-${step.id}`}
              name="body"
              defaultValue={step.body}
              required
              rows={5}
              minLength={10}
              maxLength={4000}
              className={`mt-1.5 ${inputClass}`}
            />
          </div>
          <div className="sm:max-w-40">
            <label className={labelClass} htmlFor={`minutes-${step.id}`}>
              Estimated minutes
            </label>
            <input
              id={`minutes-${step.id}`}
              name="estimated_minutes"
              type="number"
              min={5}
              max={120}
              defaultValue={step.estimated_minutes}
              className={`mt-1.5 ${inputClass}`}
            />
          </div>
          <button type="submit" className={secondaryButton}>
            Save this step
          </button>
        </form>
      </details>
    </li>
  );
}
