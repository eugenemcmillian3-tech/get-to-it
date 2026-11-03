import type { Metadata } from "next";
import Link from "next/link";
import {
  ImprovementActions,
  ImprovementForm,
  OutcomeCreateForm,
} from "@/components/outcome-forms";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import {
  listImprovements,
  listOutcomeCandidates,
  listOutcomeReviews,
} from "@/lib/data/outcomes";
import { getIdentity } from "@/lib/identity";
import {
  HISTORICAL_INTEGRITY_NOTE,
  IMPROVEMENT_AREAS,
  NO_AGGREGATE_SCORE_NOTE,
  NO_AUTONOMY_NOTE,
  OPTIONAL_PARTICIPATION_NOTE,
  SOURCE_LABELS,
  USER_BENEFIT_MEASURES,
  improvementAreaLabel,
  versionStatusLabel,
} from "@/lib/outcomes";
import { cardClass, chipClass, focusRing, secondaryButton } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Outcomes and lessons — GET TO IT" };

export default async function OutcomesPage() {
  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const session = await requireSession();
  const [identity, reviews, candidates, improvements] = await Promise.all([
    getIdentity(session),
    listOutcomeReviews(session),
    listOutcomeCandidates(session),
    listImprovements(session),
  ]);

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
          Outcomes and lessons
        </h1>
        <p className="mt-3 max-w-xl leading-relaxed text-muted">
          Look back at what you expected, record what happened, and keep the
          difference. The original expectation is captured once and never
          rewritten to look better afterwards.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          {OPTIONAL_PARTICIPATION_NOTE} {HISTORICAL_INTEGRITY_NOTE}
        </p>

        <section aria-labelledby="new-review-heading" className="mt-8">
          <h2 id="new-review-heading" className="sr-only">
            Start a review
          </h2>
          <OutcomeCreateForm candidates={candidates} />
        </section>

        <section aria-labelledby="review-list-heading" className="mt-10">
          <h2 id="review-list-heading" className="text-xl font-bold">
            Your reviews
          </h2>

          {reviews.length === 0 ? (
            <div className={`${cardClass} mt-3`}>
              <p className="font-medium">Nothing to compare yet.</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                Start with any goal, scenario or decision you already made. A
                review can stay open for as long as you need.
              </p>
            </div>
          ) : (
            <ul className="mt-3 space-y-3">
              {reviews.map((review) => (
                <li key={review.id} className={cardClass}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="text-lg font-semibold leading-snug">
                      <Link
                        href={`/outcomes/${review.id}`}
                        className={`rounded hover:underline ${focusRing}`}
                      >
                        {review.title}
                      </Link>
                    </h3>
                    <span className={chipClass}>
                      {review.status === "completed" ? "Complete" : "Open"}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
                    <span className={chipClass}>{SOURCE_LABELS[review.source_kind]}</span>
                    <span className={chipClass}>
                      Captured {review.created_at.slice(0, 10)}
                    </span>
                    <span className={chipClass}>
                      {review.review_at ? `Review ${review.review_at}` : "No review date"}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-muted">
                    {review.expectation_snapshot.summary}
                  </p>
                  <p className="mt-3">
                    <Link href={`/outcomes/${review.id}`} className={secondaryButton}>
                      Open the review
                    </Link>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="improvements-heading" className="mt-12">
          <h2 id="improvements-heading" className="text-xl font-bold">
            Controlled improvement
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Propose changes to planning prompts, template structure, clarification
            questions or review timing. Proposals record a decision; the shipped
            prompts are code and are never changed at runtime.
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted">{NO_AUTONOMY_NOTE}</p>

          <div className="mt-3">
            <ImprovementForm />
          </div>

          {improvements.proposals.length > 0 ? (
            <ul className="mt-4 space-y-3">
              {improvements.proposals.map((proposal) => (
                <li key={proposal.id} className={cardClass}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold">{proposal.title}</h3>
                      <p className="text-xs text-muted">
                        {improvementAreaLabel(proposal.area)} · recorded{" "}
                        {proposal.created_at.slice(0, 10)}
                      </p>
                    </div>
                    <span className={chipClass}>
                      {proposal.status === "proposed"
                        ? "Proposed"
                        : proposal.status === "approved"
                          ? "Approved record"
                          : proposal.status === "rejected"
                            ? "Rejected"
                            : "Rolled back"}
                    </span>
                  </div>

                  <p className="mt-2 text-sm">{proposal.rationale}</p>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-xl border border-line bg-paper p-3 text-sm">
                    {proposal.change_text}
                  </pre>
                  <p className="mt-2 text-xs text-muted">
                    Consented test set: {proposal.test_scope}
                  </p>

                  <ImprovementActions
                    proposalId={proposal.id}
                    status={proposal.status}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className={`${cardClass} mt-4 text-sm text-muted`}>
              No proposals recorded. Nothing is changed without one.
            </p>
          )}

          {improvements.versions.length > 0 ? (
            <div className={`${cardClass} mt-4`}>
              <h3 className="text-sm font-bold">Version history</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Every approved change keeps its own row. Rollback retires the active
                record and restores the previous one; no version is edited.
              </p>
              <div className="mt-3 space-y-4">
                {IMPROVEMENT_AREAS.map((area) => {
                  const versions = improvements.versions.filter(
                    (version) => version.area === area.slug,
                  );
                  if (versions.length === 0) return null;

                  return (
                    <div key={area.slug}>
                      <h4 className="text-xs font-bold uppercase tracking-wide text-muted">
                        {area.label}
                      </h4>
                      <ul className="mt-1 space-y-2 text-sm">
                        {versions.map((version) => (
                          <li key={version.id} className="border-t border-line pt-2 first:border-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold">v{version.version}</span>
                              <span className={chipClass}>
                                {versionStatusLabel(version.status)}
                              </span>
                              <span className="text-xs text-muted">
                                {version.created_at.slice(0, 10)}
                              </span>
                            </div>
                            <p className="mt-1 whitespace-pre-line text-xs text-muted">
                              {version.content}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </section>

        <section aria-labelledby="benefit-heading" className={`${cardClass} mt-10`}>
          <h2 id="benefit-heading" className="text-lg font-bold">
            What counts as a benefit
          </h2>
          <p className="mt-1 text-sm text-muted">
            Preferred measures, in this order of interest:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {USER_BENEFIT_MEASURES.map((measure) => (
              <li key={measure}>{measure}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-muted">{NO_AGGREGATE_SCORE_NOTE}</p>
        </section>

        <p className="mt-4">
          <Link href="/dashboard" className={secondaryButton}>
            Back to your goals
          </Link>
        </p>
      </main>
    </div>
  );
}
