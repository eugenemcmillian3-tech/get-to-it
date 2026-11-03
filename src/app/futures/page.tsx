import type { Metadata } from "next";
import Link from "next/link";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { FuturePathForm } from "@/components/future-forms";
import { requireSession } from "@/lib/auth";
import { listGoals } from "@/lib/data/goals";
import { listFuturePaths } from "@/lib/data/futures";
import { getIdentity } from "@/lib/identity";
import { getSupabaseSettings } from "@/lib/supabase/config";
import {
  ASSUMPTION_BASED_NOTE,
  NO_PREDICTION_NOTE,
  SCENARIO_LABELS,
  formatFutureDay,
  horizonLabel,
} from "@/lib/futures";
import { cardClass, chipClass, focusRing, secondaryButton } from "@/lib/styles";

export const metadata: Metadata = { title: "Future paths — GET TO IT" };

export default async function FuturesPage({
  searchParams,
}: {
  searchParams: Promise<{ goal?: string }>;
}) {
  const { goal } = await searchParams;

  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const session = await requireSession();
  const [identity, paths, goals] = await Promise.all([
    getIdentity(session),
    listFuturePaths(session),
    listGoals(session),
  ]);

  const defaultGoalId = goals.some((entry) => entry.id === goal) ? goal! : "";
  const activeGoals = goals.filter((entry) => entry.archived_at === null);

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-3xl px-5 pb-16 pt-6">
        <Link
          href="/dashboard"
          className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          ← Back to your goals
        </Link>

        <h1 className="mt-4 text-3xl font-black leading-tight tracking-tight sm:text-4xl">
          Future paths
        </h1>
        <p className="mt-3 max-w-xl leading-relaxed text-muted">
          Sketch three plausible futures for a decision you are weighing, then
          compare the assumptions behind them. You choose what, if anything, to
          do next.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted">{NO_PREDICTION_NOTE}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">{ASSUMPTION_BASED_NOTE}</p>

        <section aria-labelledby="path-list-heading" className="mt-8">
          <h2 id="path-list-heading" className="text-lg font-bold">
            Your paths
          </h2>

          {paths.length === 0 ? (
            <div className={`${cardClass} mt-3`}>
              <p className="font-medium">No future paths yet.</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                Start with the decision that is actually on your mind. The three
                scenarios are a thinking aid, not a forecast.
              </p>
            </div>
          ) : (
            <ul className="mt-3 space-y-3">
              {paths.map((path) => (
                <li key={path.id} className={cardClass}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="text-lg font-semibold leading-snug">
                      <Link
                        href={`/futures/${path.id}`}
                        className={`rounded hover:underline ${focusRing}`}
                      >
                        {path.decision}
                      </Link>
                    </h3>
                    <span className={chipClass}>{horizonLabel(path.horizon)}</span>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
                    <span className={chipClass}>
                      {path.chosen_kind
                        ? SCENARIO_LABELS[path.chosen_kind]
                        : "No choice saved"}
                    </span>
                    {path.review_at ? (
                      <span className={chipClass}>
                        Review {formatFutureDay(path.review_at)}
                      </span>
                    ) : null}
                    <span className={chipClass}>
                      Created {formatFutureDay(path.created_at)}
                    </span>
                  </div>

                  <p className="mt-3">
                    <Link href={`/futures/${path.id}`} className={secondaryButton}>
                      Compare the three scenarios
                    </Link>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="new-path-heading" className="mt-10">
          <h2 id="new-path-heading" className="sr-only">
            New future path
          </h2>
          <FuturePathForm
            goals={activeGoals.map((entry) => ({ id: entry.id, title: entry.title }))}
            defaultGoalId={defaultGoalId}
          />
        </section>

        <p className="mt-8 text-xs leading-relaxed text-muted">
          Scenarios are labelled by source: what you provided, a retrieved fact
          with a source you supplied, an assumption, an AI-generated possibility,
          or an unknown. This build connects no research tool, so nothing is
          retrieved and the exercise stays assumption-based.
        </p>
      </main>
    </div>
  );
}
