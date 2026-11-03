import type { Metadata } from "next";
import Link from "next/link";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { ReviewForm } from "@/components/review-forms";
import { requireSession } from "@/lib/auth";
import { listReviews } from "@/lib/data/reviews";
import { getIdentity } from "@/lib/identity";
import { getSupabaseSettings } from "@/lib/supabase/config";
import {
  NO_TOOLS_NOTE,
  PERSPECTIVES,
  PERSPECTIVE_LABELS,
  SAME_MODEL_NOTE,
  TRANSPARENCY_NOTE,
  USAGE_NOTE,
} from "@/lib/reviews";
import { cardClass, chipClass, focusRing, secondaryButton } from "@/lib/styles";
import { formatFutureDay } from "@/lib/futures";
import type { ReviewStatus } from "@/lib/types";

export const metadata: Metadata = { title: "Think it through — GET TO IT" };

const STATUS_LABELS: Record<ReviewStatus, string> = {
  in_progress: "In progress",
  complete: "Complete",
  partial: "Partly complete",
  cancelled: "Cancelled",
};

export default async function ReviewsPage() {
  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const session = await requireSession();
  const [identity, reviews] = await Promise.all([
    getIdentity(session),
    listReviews(session),
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
          Think it through
        </h1>
        <p className="mt-3 max-w-xl leading-relaxed text-muted">
          Review one decision from five fixed perspectives — planner, critic,
          research reviewer, human-impact reviewer and synthesizer. They run one at
          a time, from the same record, and you decide what to do with the result.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted">{USAGE_NOTE}</p>

        <section aria-labelledby="review-list-heading" className="mt-8">
          <h2 id="review-list-heading" className="text-lg font-bold">
            Your reviews
          </h2>

          {reviews.length === 0 ? (
            <div className={`${cardClass} mt-3`}>
              <p className="font-medium">No reviews yet.</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                Start with the decision you keep circling. Nothing is reviewed
                until you run a perspective.
              </p>
            </div>
          ) : (
            <ul className="mt-3 space-y-3">
              {reviews.map((review) => (
                <li key={review.id} className={cardClass}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="text-lg font-semibold leading-snug">
                      <Link
                        href={`/reviews/${review.id}`}
                        className={`rounded hover:underline ${focusRing}`}
                      >
                        {review.question}
                      </Link>
                    </h3>
                    <span className={chipClass}>{STATUS_LABELS[review.status]}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
                    <span className={chipClass}>{review.model}</span>
                    <span className={chipClass}>
                      Started {formatFutureDay(review.created_at)}
                    </span>
                    {review.decided_at ? (
                      <span className={chipClass}>Decision saved</span>
                    ) : null}
                  </div>
                  <p className="mt-3">
                    <Link href={`/reviews/${review.id}`} className={secondaryButton}>
                      Open review
                    </Link>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="new-review-heading" className="mt-10">
          <h2 id="new-review-heading" className="sr-only">
            New review
          </h2>
          <ReviewForm />
        </section>

        <section aria-labelledby="perspectives-heading" className={`${cardClass} mt-8`}>
          <h2 id="perspectives-heading" className="text-sm font-bold">
            The five perspectives
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-muted">
            {PERSPECTIVES.map((perspective) => (
              <li key={perspective}>
                <span className="font-semibold text-ink">
                  {PERSPECTIVE_LABELS[perspective]}:
                </span>{" "}
                {perspective === "planner"
                  ? "how could this work?"
                  : perspective === "critic"
                    ? "what could fail?"
                    : perspective === "research"
                      ? "what evidence is missing?"
                      : perspective === "human_impact"
                        ? "who could benefit or be harmed?"
                        : "what choices and trade-offs remain?"}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-muted">{TRANSPARENCY_NOTE}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">{SAME_MODEL_NOTE}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">{NO_TOOLS_NOTE}</p>
        </section>
      </main>
    </div>
  );
}
