import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExperimentCreateForm } from "@/components/experiment-forms";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import { listExperiments } from "@/lib/data/experiments";
import {
  EXPERIMENT_NOTES,
  EXPERIMENT_STATUS_LABELS,
  canManageExperiments,
} from "@/lib/experiments";
import { getIdentity } from "@/lib/identity";
import { cardClass, chipClass, focusRing, secondaryButton } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { memberLabel } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Experiments — GET TO IT" };

function addDays(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export default async function ExperimentsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const session = await requireSession();
  const [identity, list] = await Promise.all([
    getIdentity(session),
    listExperiments(session, workspaceId),
  ]);
  if (!list) notFound();

  const canCreate = Boolean(list.myRole);
  const nameOf = (userId: string): string => {
    const member = list.members.find((entry) => entry.user_id === userId);
    return member ? memberLabel(member) : "A workspace member";
  };

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-4xl px-5 pb-16 pt-6">
        <Link
          href={`/workspace/${workspaceId}`}
          className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          ← {list.workspace.name}
        </Link>

        <header className="mt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted">
            Experiment workspace
          </p>
          <h1 className="mt-1 text-3xl font-black leading-tight tracking-tight sm:text-4xl">
            Bounded experiments
          </h1>
          <p className="mt-3 max-w-2xl leading-relaxed text-muted">
            Turn a future-facing idea into a question you can test, a prototype
            you can build, and an honest record of what happened.
          </p>
          <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted">
            {EXPERIMENT_NOTES.voluntary} {EXPERIMENT_NOTES.noFabrication}
          </p>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
            {EXPERIMENT_NOTES.highStakes}
          </p>
        </header>

        <section aria-labelledby="experiment-list-heading" className="mt-8">
          <h2 id="experiment-list-heading" className="text-xl font-bold">
            In this workspace
          </h2>
          {list.experiments.length === 0 ? (
            <div className={`${cardClass} mt-3`}>
              <p className="font-medium">No experiments yet.</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                Start with a question and a review date. An experiment can stay
                in draft until the evidence, consent and stop conditions are clear.
              </p>
            </div>
          ) : (
            <ul className="mt-3 space-y-3">
              {list.experiments.map((experiment) => (
                <li key={experiment.id} className={cardClass}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="max-w-2xl text-lg font-semibold leading-snug">
                      <Link
                        href={`/workspace/${workspaceId}/experiments/${experiment.id}`}
                        className={`rounded hover:underline ${focusRing}`}
                      >
                        {experiment.question}
                      </Link>
                    </h3>
                    <span className={chipClass}>
                      {EXPERIMENT_STATUS_LABELS[experiment.status]}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-muted">
                    {experiment.hypothesis}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
                    <span className={chipClass}>{experiment.target_users}</span>
                    <span className={chipClass}>Review {experiment.review_at}</span>
                    <span className={chipClass}>
                      {experiment.time_limit_minutes} min limit
                    </span>
                    <span className={chipClass}>Created by {nameOf(experiment.created_by)}</span>
                    {experiment.prototype_project_id ? (
                      <span className={chipClass}>Prototype approved</span>
                    ) : (
                      <span className={chipClass}>No prototype yet</span>
                    )}
                  </div>
                  <p className="mt-3">
                    <Link
                      href={`/workspace/${workspaceId}/experiments/${experiment.id}`}
                      className={secondaryButton}
                    >
                      Open the experiment
                    </Link>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="new-experiment-heading" className="mt-10">
          <h2 id="new-experiment-heading" className="sr-only">
            Start an experiment
          </h2>
          {canCreate ? (
            <ExperimentCreateForm
              workspaceId={workspaceId}
              candidates={list.candidates}
              defaultReviewAt={addDays(14)}
            />
          ) : (
            <p className={`${cardClass} text-sm leading-relaxed text-muted`}>
              Only active workspace members can create experiments. You can ask
              an owner or admin to invite you.
            </p>
          )}
        </section>

        <section className={`${cardClass} mt-10`}>
          <h2 className="text-lg font-bold">What is different here</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {EXPERIMENT_NOTES.buildGate}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {EXPERIMENT_NOTES.consent}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {EXPERIMENT_NOTES.outcomeHonesty}
          </p>
        </section>

        {canManageExperiments(list.myRole) ? null : (
          <p className="mt-4 text-xs leading-relaxed text-muted">
            As a member you can create experiments and record observations and
            consented feedback. Owners and admins approve prototypes and
            separate outreach, publication, payment and deployment requests.
          </p>
        )}
      </main>
    </div>
  );
}
