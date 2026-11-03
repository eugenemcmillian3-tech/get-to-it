import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AssessmentForm,
  DeleteReviewForm,
  ForecastForm,
  ForecastResolveForm,
  ObservationForm,
} from "@/components/outcome-forms";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import { getOutcomeDetail } from "@/lib/data/outcomes";
import { getIdentity } from "@/lib/identity";
import {
  CAUSATION_NOTE,
  EVALUATION_DIMENSIONS,
  FORECAST_METHOD_NOTE,
  HISTORICAL_INTEGRITY_NOTE,
  NO_AGGREGATE_SCORE_NOTE,
  REVIEW_QUESTIONS,
  SOURCE_LABELS,
  assessmentLabel,
  assumptionVerdictLabel,
  externalChangeLabel,
  isReviewComplete,
  observationLabel,
  scoreForecasts,
  snapshotLines,
} from "@/lib/outcomes";
import { formatFutureDay } from "@/lib/futures";
import { cardClass, chipClass, focusRing, secondaryButton } from "@/lib/styles";
import { isUuid } from "@/lib/validation";
import { getSupabaseSettings } from "@/lib/supabase/config";
import type { OutcomeReview } from "@/lib/types";

export const metadata: Metadata = { title: "Outcome review — GET TO IT" };

function AnswerRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-semibold">{label}</dt>
      <dd className="text-muted">{value}</dd>
    </div>
  );
}

function assessmentValue(review: OutcomeReview, key: string): string {
  switch (key) {
    case "action_completed":
      return assessmentLabel(review.action_completed);
    case "desired_result":
      return assessmentLabel(review.desired_result);
    case "expectation_accuracy":
      return assessmentLabel(review.expectation_accuracy);
    default:
      return externalChangeLabel(review.external_conditions);
  }
}

export default async function OutcomeReviewPage({
  params,
}: {
  params: Promise<{ reviewId: string }>;
}) {
  const { reviewId } = await params;
  if (!isUuid(reviewId)) notFound();

  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <p className="text-sm text-muted">Sign-in is not configured in this build.</p>
      </main>
    );
  }

  const session = await requireSession();
  const [identity, detail] = await Promise.all([
    getIdentity(session),
    getOutcomeDetail(session, reviewId),
  ]);

  if (!detail) notFound();

  const { review, observations, forecasts } = detail;
  const forecastSummary = scoreForecasts(forecasts);
  const complete = isReviewComplete(review);

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-3xl px-5 pb-16 pt-6">
        <Link
          href="/outcomes"
          className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          ← All outcomes
        </Link>

        <header className="mt-4">
          <h1 className="text-3xl font-black leading-tight tracking-tight sm:text-4xl">
            {review.title}
          </h1>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
            <span className={chipClass}>{SOURCE_LABELS[review.source_kind]}</span>
            <span className={chipClass}>
              {review.status === "completed" ? "Complete" : "Open"}
            </span>
            <span className={chipClass}>
              Captured {formatFutureDay(review.expectation_snapshot.captured_at)}
            </span>
            {review.review_at ? (
              <span className={chipClass}>Planned review {review.review_at}</span>
            ) : null}
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
            {HISTORICAL_INTEGRITY_NOTE}
          </p>
        </header>

        <section aria-labelledby="snapshot-heading" className={`${cardClass} mt-6`}>
          <h2 id="snapshot-heading" className="text-lg font-bold">
            What you expected, captured once
          </h2>
          <p className="mt-1 text-sm text-muted">
            {review.expectation_snapshot.summary}
          </p>
          <dl className="mt-3 space-y-2 text-sm">
            {snapshotLines(review.expectation_snapshot).map((line) => (
              <div key={line.label}>
                <dt className="font-semibold">{line.label}</dt>
                <dd className="whitespace-pre-line text-muted">{line.text}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-muted">
            This snapshot cannot be edited. Later observations are added below and
            never merged into it.
          </p>
        </section>

        <section aria-labelledby="assessment-heading" className="mt-10">
          <h2 id="assessment-heading" className="text-xl font-bold">
            Four separate answers
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            {complete
              ? "All four are answered. Answering one never implies another."
              : "Answer all four to mark the review complete. Until then it stays open."}
          </p>

          <dl className={`${cardClass} mt-3 space-y-3 text-sm`}>
            {EVALUATION_DIMENSIONS.map((dimension) => (
              <div key={dimension.key}>
                <AnswerRow
                  label={dimension.label}
                  value={assessmentValue(review, dimension.key)}
                />
                <p className="mt-0.5 text-xs text-muted">{dimension.note}</p>
              </div>
            ))}
          </dl>

          {review.causation_note ? (
            <div className={`${cardClass} mt-3`}>
              <h3 className="text-sm font-bold">What else could explain it</h3>
              <p className="mt-1 text-sm">{review.causation_note}</p>
            </div>
          ) : null}

          <p className="mt-2 text-xs leading-relaxed text-muted">{CAUSATION_NOTE}</p>

          <div className="mt-3">
            <AssessmentForm review={review} />
          </div>
        </section>

        <section aria-labelledby="observations-heading" className="mt-10">
          <h2 id="observations-heading" className="text-xl font-bold">
            The record, appended
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Notes are append-only. There is no edit or delete for a single note, so
            the earlier record stays intact.
          </p>

          {observations.length === 0 ? (
            <p className={`${cardClass} mt-3 text-sm text-muted`}>
              Nothing appended yet. Answer only the questions that are useful; none
              are required.
            </p>
          ) : (
            <ol className="mt-3 space-y-3">
              {observations.map((observation) => (
                <li key={observation.id} className={cardClass}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="text-sm font-bold">
                      {observationLabel(observation.kind)}
                    </h3>
                    <span className={chipClass}>
                      {formatFutureDay(observation.created_at)}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-line text-sm">{observation.text}</p>
                  {observation.kind === "assumption" ? (
                    <p className="mt-1 text-xs text-muted">
                      Verdict: {assumptionVerdictLabel(observation.verdict)}
                    </p>
                  ) : null}
                  {observation.causation_note ? (
                    <p className="mt-1 text-xs text-muted">
                      Also considered: {observation.causation_note}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          )}

          <div className="mt-4">
            <ObservationForm review={review} />
          </div>
        </section>

        <section aria-labelledby="forecasts-heading" className="mt-10">
          <h2 id="forecasts-heading" className="text-xl font-bold">
            Numerical forecasts (optional)
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            {FORECAST_METHOD_NOTE}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {NO_AGGREGATE_SCORE_NOTE}
          </p>

          {forecasts.length === 0 ? (
            <p className={`${cardClass} mt-3 text-sm text-muted`}>
              No forecasts recorded. You do not need one to learn from this.
            </p>
          ) : (
            <>
              <p className={`${cardClass} mt-3 text-sm`}>{forecastSummary.explanation}</p>
              <ul className="mt-3 space-y-2">
                {forecastSummary.scores.map((score) => {
                  const forecast = forecasts.find((item) => item.id === score.id);
                  if (!forecast) return null;

                  return (
                    <li key={score.id} className={cardClass}>
                      <p className="text-sm font-medium">{score.statement}</p>
                      <p className="mt-1 text-xs text-muted">
                        Stated probability {score.probability}% ·{" "}
                        {score.resolution === "occurred"
                          ? "occurred"
                          : score.resolution === "did_not_occur"
                            ? "did not occur"
                            : "not resolved yet"}
                        {score.score !== null ? ` · Brier score ${score.score}` : ""}
                      </p>
                      <ForecastResolveForm review={review} forecast={forecast} />
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          <div className="mt-4">
            <ForecastForm review={review} />
          </div>
        </section>

        <section aria-labelledby="questions-heading" className={`${cardClass} mt-10`}>
          <h2 id="questions-heading" className="text-sm font-bold">
            The six review questions
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-muted">
            {REVIEW_QUESTIONS.map((question) => (
              <li key={question.key}>{question.question}</li>
            ))}
          </ul>
        </section>

        <DeleteReviewForm review={review} />

        <p className="mt-6">
          <Link href="/outcomes" className={secondaryButton}>
            Back to all outcomes
          </Link>
        </p>
      </main>
    </div>
  );
}
