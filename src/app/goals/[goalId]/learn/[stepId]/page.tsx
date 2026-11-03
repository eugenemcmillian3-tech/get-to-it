import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LearningWorkspace } from "@/components/learning-workspace";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import { getLearningStep } from "@/lib/data/learning";
import {
  GENERATED_CONTENT_NOTE,
  LEARNING_KIND_LABELS,
  SOURCES_NOTE,
} from "@/lib/learning";
import { formatMinutes } from "@/lib/format";
import { getIdentity } from "@/lib/identity";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { chipClass, focusRing } from "@/lib/styles";

export const metadata: Metadata = { title: "Learning step — GET TO IT" };

export default async function LearningStepPage({
  params,
}: {
  params: Promise<{ goalId: string; stepId: string }>;
}) {
  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const session = await requireSession();
  const { goalId, stepId } = await params;
  const detail = await getLearningStep(session, goalId, stepId);
  if (!detail) notFound();

  const identity = await getIdentity(session);
  const { plan, step, record } = detail;

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-3xl px-5 pb-16 pt-6">
        <Link
          href={`/goals/${goalId}/learn`}
          className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          ← Learning path
        </Link>

        <header className="mt-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={chipClass}>{LEARNING_KIND_LABELS[step.kind]}</span>
            <span className={chipClass}>Step {step.position}</span>
            <span className={chipClass}>{formatMinutes(step.estimated_minutes)}</span>
            <span className={chipClass}>AI-generated</span>
            {step.status === "skipped" ? (
              <span className={chipClass}>Skipped</span>
            ) : null}
            {step.kind === "checkpoint" ? (
              <span className={chipClass}>
                {step.approved_at ? "Approved by you" : "Not approved yet"}
              </span>
            ) : null}
          </div>
          <h1 className="mt-3 text-2xl font-black leading-tight tracking-tight sm:text-3xl">
            {step.title}
          </h1>
          <p className="mt-1 text-sm text-muted">{plan.what_to_learn}</p>
        </header>

        <section className="mt-4 rounded-2xl border border-line bg-card p-4">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{step.body}</p>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            {GENERATED_CONTENT_NOTE}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted">{SOURCES_NOTE}</p>
        </section>

        <div className="mt-5">
          <LearningWorkspace goalId={goalId} step={step} record={record} />
        </div>
      </main>
    </div>
  );
}
