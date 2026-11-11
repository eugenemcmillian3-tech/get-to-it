import type { Metadata } from "next";
import Link from "next/link";
import { CreateCapabilityEvalForm } from "@/components/capability-eval-forms";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import { listCapabilityEvals } from "@/lib/data/capability-eval";
import { CAPABILITY_NO_SCORE_NOTE, CAPABILITY_PERMISSION_NOTE } from "@/lib/capability-eval";
import { getIdentity } from "@/lib/identity";
import { cardClass, chipClass, focusRing } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Capability evaluation — GET TO IT" };

export default async function CapabilityEvalIndexPage() {
  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const session = await requireSession();
  const [identity, evaluations] = await Promise.all([
    getIdentity(session),
    listCapabilityEvals(session),
  ]);

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-5xl px-5 pb-16 pt-6">
        <header>
          <h1 className="text-3xl font-black leading-tight tracking-tight sm:text-4xl">
            Capability evaluation
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">
            A versioned comparison of two configurations across eight domains,
            with development, validation and held-out tasks scored against keys the
            application cannot read.
          </p>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-muted">
            {CAPABILITY_NO_SCORE_NOTE} {CAPABILITY_PERMISSION_NOTE}
          </p>
        </header>

        <section aria-labelledby="new-heading" className={`${cardClass} mt-6`}>
          <h2 id="new-heading" className="text-lg font-bold">New evaluation</h2>
          <div className="mt-3">
            <CreateCapabilityEvalForm />
          </div>
        </section>

        <section aria-labelledby="list-heading" className="mt-10">
          <h2 id="list-heading" className="text-xl font-bold">Your evaluations</h2>
          {evaluations.length === 0 ? (
            <div className={`${cardClass} mt-3`}>
              <p className="font-medium">No capability evaluations yet.</p>
              <p className="mt-1 text-sm text-muted">
                Create one to seed the eight domains and both versioned configurations.
              </p>
            </div>
          ) : (
            <ul className="mt-3 space-y-3">
              {evaluations.map((evaluation) => (
                <li key={evaluation.id} className={cardClass}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-bold">
                        <Link
                          href={`/capability-eval/${evaluation.id}`}
                          className={`rounded underline decoration-line underline-offset-4 hover:text-brand ${focusRing}`}
                        >
                          {evaluation.name}
                        </Link>
                      </h3>
                      <p className="mt-1 text-sm text-muted">
                        {evaluation.description || "No description."}
                      </p>
                    </div>
                    <span className={chipClass}>{evaluation.status}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className={chipClass}>{evaluation.task_count} tasks</span>
                    <span className={chipClass}>{evaluation.run_count} trials</span>
                    <span className={chipClass}>{evaluation.held_out_runs} held-out</span>
                    <span className={chipClass}>
                      {evaluation.contaminated_runs} contaminated
                    </span>
                    <span className={chipClass}>dataset {evaluation.dataset_version}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
