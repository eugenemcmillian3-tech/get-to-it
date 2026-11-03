import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LearningSetupForm } from "@/components/learning-setup-form";
import { LearningStepCard } from "@/components/learning-step-card";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { deleteLearningPlanAction } from "@/lib/actions/learning";
import { aiModelLabel } from "@/lib/ai/models";
import { requireSession } from "@/lib/auth";
import { getGoalDetail } from "@/lib/data/goals";
import { getLearningPlan, getLearningRecords } from "@/lib/data/learning";
import { formatMinutes } from "@/lib/format";
import { getIdentity } from "@/lib/identity";
import {
  GENERATED_CONTENT_NOTE,
  LEARNING_EXPERIENCE_OPTIONS,
  NOT_QUALIFICATION_NOTE,
  SOURCES_NOTE,
  learningProgress,
  resumeStep,
} from "@/lib/learning";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { chipClass, focusRing, secondaryButton } from "@/lib/styles";

export const metadata: Metadata = { title: "Learning mode — GET TO IT" };

export default async function LearningPage({
  params,
}: {
  params: Promise<{ goalId: string }>;
}) {
  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const session = await requireSession();
  const { goalId } = await params;
  const detail = await getGoalDetail(session, goalId);
  if (!detail) notFound();

  const identity = await getIdentity(session);
  const learning = await getLearningPlan(session, goalId);
  const records = learning ? await getLearningRecords(session, goalId) : [];
  const progress = learning ? learningProgress(learning.steps) : null;
  const resume = learning ? resumeStep(learning.steps, records) : null;
  const experienceLabel = learning
    ? (LEARNING_EXPERIENCE_OPTIONS.find(
        (option) => option.value === learning.plan.experience,
      )?.label ?? learning.plan.experience)
    : null;

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-3xl px-5 pb-16 pt-6">
        <Link
          href={`/goals/${goalId}`}
          className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          ← {detail.goal.title}
        </Link>

        <header className="mt-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={chipClass}>Learning mode</span>
            <span className={chipClass}>Optional</span>
          </div>
          <h1 className="mt-3 text-2xl font-black leading-tight tracking-tight sm:text-3xl">
            {learning ? learning.plan.what_to_learn : "Learn this, a step at a time"}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            A short path of explanations, practice and small projects, attached
            to this goal. Nothing here is graded, certified or required.
          </p>
        </header>

        <div className="mt-4 space-y-2 rounded-2xl border border-line bg-paper p-3 text-xs leading-relaxed text-muted">
          <p>{GENERATED_CONTENT_NOTE}</p>
          <p>{SOURCES_NOTE}</p>
          <p>{NOT_QUALIFICATION_NOTE}</p>
        </div>

        {!learning ? (
          <div className="mt-5">
            <LearningSetupForm goalId={goalId} />
          </div>
        ) : (
          <>
            <section className="mt-5 rounded-2xl border border-line bg-card p-4">
              <div className="flex flex-wrap gap-2">
                <span className={chipClass}>{experienceLabel}</span>
                <span className={chipClass}>
                  {formatMinutes(learning.plan.minutes_per_week)} a week
                </span>
                <span className={chipClass}>
                  {progress?.total} steps · {progress?.skipped} skipped
                </span>
                <span className={chipClass}>
                  Checkpoints approved {progress?.approvedCheckpoints}/
                  {progress?.checkpoints}
                </span>
              </div>

              <p className="mt-3 text-sm leading-relaxed">
                <span className="font-semibold">Your outcome:</span>{" "}
                {learning.plan.outcome}
              </p>
              <p className="mt-1 text-xs text-muted">
                Drafted with {aiModelLabel(learning.plan.model)}. The path is a
                draft you own: edit or skip anything.
              </p>

              {resume ? (
                <p className="mt-3 text-sm">
                  <Link
                    href={`/goals/${goalId}/learn/${resume.id}`}
                    className={`rounded font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-ink ${focusRing}`}
                  >
                    {records.length > 0
                      ? "Continue where you left off"
                      : "Start with step 1"}
                  </Link>{" "}
                  <span className="text-muted">— {resume.title}</span>
                </p>
              ) : (
                <p className="mt-3 text-sm text-muted">
                  Every step is skipped or none are active. Bring one back below,
                  or delete the path and start again.
                </p>
              )}
            </section>

            <section aria-labelledby="path-heading" className="mt-6">
              <h2 id="path-heading" className="text-lg font-bold">
                Your learning path
              </h2>
              <p className="mt-1 text-sm text-muted">
                Work through it in any order. A checkpoint only counts once you
                approve it yourself.
              </p>

              <ul className="mt-3 space-y-3">
                {learning.steps.map((step) => (
                  <LearningStepCard key={step.id} goalId={goalId} step={step} />
                ))}
              </ul>
            </section>

            <details className="mt-8 rounded-2xl border border-line bg-card p-4">
              <summary
                className={`cursor-pointer rounded text-sm font-semibold text-danger ${focusRing}`}
              >
                Delete this learning path
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Removes every step and every saved answer or feedback record for
                this goal. Your goal and its tasks are not touched.
              </p>
              <form action={deleteLearningPlanAction} className="mt-3">
                <input type="hidden" name="goal_id" value={goalId} />
                <button type="submit" className={secondaryButton}>
                  Delete the learning path and its records
                </button>
              </form>
            </details>
          </>
        )}

        <p className="mt-8 text-xs leading-relaxed text-muted">
          Learning material is private to your account. Only you can open it, and
          nothing here is shared with a partner, an owner dashboard or anyone
          else.
        </p>
      </main>
    </div>
  );
}
