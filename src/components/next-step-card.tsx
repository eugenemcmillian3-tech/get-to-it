import Link from "next/link";
import type { NextStep } from "@/lib/progress";
import { cardClass, chipClass, focusRing, primaryButton } from "@/lib/styles";
import type { FocusSessionView } from "@/lib/types";

/**
 * "Continue where you left off."
 *
 * One unfinished task, the smallest version of it, and a way in. No streaks, no
 * days-missed counters, no comment on how long it has been.
 */
export function NextStepCard({
  nextStep,
  activeSession,
}: {
  nextStep: NextStep | null;
  activeSession: { session: FocusSessionView; taskTitle: string } | null;
}) {
  return (
    <section aria-labelledby="continue-heading" className={`${cardClass} mt-6`}>
      <h2 id="continue-heading" className="text-lg font-bold">
        Continue where you left off
      </h2>

      {nextStep ? (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={chipClass}>{nextStep.goalTitle}</span>
            <span className={chipClass}>
              {nextStep.status === "in_progress" ? "In progress" : "To do"}
            </span>
          </div>

          <p className="mt-2 text-lg font-semibold leading-snug">
            {nextStep.taskTitle}
          </p>

          <p className="mt-2 rounded-xl border border-line bg-paper px-3 py-2 text-sm leading-relaxed">
            <span className="font-semibold">A smaller step: </span>
            {nextStep.smallerStep}
          </p>

          <Link
            href={`/goals/${nextStep.goalId}/tasks/${nextStep.taskId}`}
            className={`${primaryButton} mt-3 sm:w-auto`}
          >
            Open this task
          </Link>
        </div>
      ) : (
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Nothing is waiting on you. Start a goal when you want one — today,
          tomorrow, or in a fortnight.
        </p>
      )}

      {activeSession ? (
        <div className="mt-4 rounded-xl border border-brand/30 bg-brand-soft/40 px-3 py-2 text-sm">
          <p className="font-semibold">A focus session is still open.</p>
          <p className="mt-1 text-muted">
            It&apos;s running on “{activeSession.taskTitle}”. Open that task to
            pause or finish it — the clock kept its own time.
          </p>
          <Link
            href={`/goals/${activeSession.session.goal_id}/tasks/${activeSession.session.task_id}`}
            className={`mt-2 inline-block rounded text-sm font-semibold underline decoration-line underline-offset-4 hover:decoration-ink ${focusRing}`}
          >
            Back to that task
          </Link>
        </div>
      ) : null}
    </section>
  );
}
