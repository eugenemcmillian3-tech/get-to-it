import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CancelReviewForm,
  DeleteReviewForm,
  OutcomeForm,
  PrioritiesForm,
  RunPerspectiveForm,
} from "@/components/review-forms";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import { getReviewDetail } from "@/lib/data/reviews";
import { getIdentity } from "@/lib/identity";
import { isUuid } from "@/lib/validation";
import {
  CANCELLATION_NOTE,
  EVIDENCE_BASIS_LABELS,
  HUMAN_DECISION_NOTE,
  NO_TOOLS_NOTE,
  PERSPECTIVES,
  PERSPECTIVE_LABELS,
  PERSPECTIVE_NOTES,
  PERSPECTIVE_QUESTIONS,
  SAME_MODEL_NOTE,
  TRANSPARENCY_NOTE,
  USAGE_NOTE,
  disagreementRows,
  experimentRows,
  missingInfoRows,
  optionRows,
  perspectiveErrorMessage,
  type Perspective,
  type ReviewStageOutput,
} from "@/lib/reviews";
import { formatFutureDay } from "@/lib/futures";
import { cardClass, chipClass, focusRing, secondaryButton } from "@/lib/styles";
import type { ReviewStageRecord, ReviewStatus } from "@/lib/types";

export const metadata: Metadata = { title: "Review — GET TO IT" };

const STATUS_LABELS: Record<ReviewStatus, string> = {
  in_progress: "In progress",
  complete: "Complete",
  partial: "Partly complete",
  cancelled: "Cancelled",
};

function stageOutput(stage: ReviewStageRecord): ReviewStageOutput {
  return {
    summary: stage.summary ?? "",
    assumptions: stage.assumptions ?? [],
    options: stage.options ?? [],
    evidence: (stage.evidence ?? []).map((item) => ({
      text: item.text,
      basis: item.basis as ReviewStageOutput["evidence"][number]["basis"],
      source_url: item.source_url,
    })),
    counterarguments: stage.counterarguments ?? [],
    disagreements: stage.disagreements ?? [],
    missing_info: stage.missing_info ?? [],
    experiment: stage.experiment ?? null,
    questions: stage.questions ?? [],
    tradeoffs: stage.tradeoffs ?? [],
    recommendation: stage.recommendation,
  };
}

function StageCard({
  stage,
  canRun,
  reviewId,
}: {
  stage: ReviewStageRecord;
  canRun: boolean;
  reviewId: string;
}) {
  const perspective = stage.perspective as Perspective;

  if (stage.status === "pending" || stage.status === "skipped") {
    return (
      <li className={`${cardClass} mt-3`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-bold">
            <span className="text-muted">{stage.position}.</span>{" "}
            {PERSPECTIVE_LABELS[perspective]}
          </h3>
          <span className={chipClass}>
            {stage.status === "skipped" ? "Skipped" : "Not started"}
          </span>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          {PERSPECTIVE_QUESTIONS[perspective]} — {PERSPECTIVE_NOTES[perspective]}
        </p>
        {canRun ? (
          <RunPerspectiveForm
            reviewId={reviewId}
            label={PERSPECTIVE_LABELS[perspective]}
          />
        ) : null}
      </li>
    );
  }

  if (stage.status === "running") {
    return (
      <li className={`${cardClass} mt-3`}>
        <h3 className="text-base font-bold">
          <span className="text-muted">{stage.position}.</span>{" "}
          {PERSPECTIVE_LABELS[perspective]}
        </h3>
        <p className="mt-1 text-sm text-muted">
          This perspective is being requested. Refresh in a moment.
        </p>
      </li>
    );
  }

  if (stage.status === "failed") {
    return (
      <li className={`${cardClass} mt-3`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-bold">
            <span className="text-muted">{stage.position}.</span>{" "}
            {PERSPECTIVE_LABELS[perspective]}
          </h3>
          <span className={chipClass}>Failed</span>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          {perspectiveErrorMessage(stage.error_code ?? undefined)} Earlier
          perspectives are unchanged, and you can run a later one.
        </p>
      </li>
    );
  }

  const output = stageOutput(stage);

  return (
    <li className={`${cardClass} mt-3`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-base font-bold">
          <span className="text-muted">{stage.position}.</span>{" "}
          {PERSPECTIVE_LABELS[perspective]}
        </h3>
        <span className={chipClass}>Answered</span>
      </div>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        {PERSPECTIVE_QUESTIONS[perspective]}
      </p>

      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{output.summary}</p>

      {output.assumptions.length > 0 ? (
        <div className="mt-3">
          <h4 className="text-xs font-bold uppercase tracking-wide text-muted">
            Assumptions it used
          </h4>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {output.assumptions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {output.options.length > 0 ? (
        <div className="mt-3">
          <h4 className="text-xs font-bold uppercase tracking-wide text-muted">
            Proposed options
          </h4>
          <ul className="mt-1 space-y-2 text-sm">
            {output.options.map((option) => (
              <li key={option.title}>
                <span className="font-semibold">{option.title}</span> —{" "}
                {option.description}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {output.evidence.length > 0 ? (
        <div className="mt-3">
          <h4 className="text-xs font-bold uppercase tracking-wide text-muted">
            Evidence it cites
          </h4>
          <ul className="mt-1 space-y-1.5 text-sm">
            {output.evidence.map((item) => (
              <li key={item.text}>
                {item.text}{" "}
                <span className="inline-flex rounded-full border border-line bg-paper px-2 py-0.5 text-[11px] text-muted">
                  {EVIDENCE_BASIS_LABELS[item.basis]}
                </span>
                {item.source_url ? (
                  <a
                    href={item.source_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={`ml-1 rounded text-xs underline decoration-line underline-offset-2 hover:text-ink ${focusRing}`}
                  >
                    Your source
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {output.counterarguments.length > 0 ? (
        <div className="mt-3">
          <h4 className="text-xs font-bold uppercase tracking-wide text-muted">
            Counterarguments
          </h4>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {output.counterarguments.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {output.disagreements.length > 0 ? (
        <div className="mt-3">
          <h4 className="text-xs font-bold uppercase tracking-wide text-muted">
            Unresolved disagreements
          </h4>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {output.disagreements.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {output.missing_info.length > 0 ? (
        <div className="mt-3">
          <h4 className="text-xs font-bold uppercase tracking-wide text-muted">
            Missing information
          </h4>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {output.missing_info.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {output.experiment ? (
        <div className="mt-3 rounded-xl border border-line bg-paper p-3">
          <h4 className="text-xs font-bold uppercase tracking-wide text-muted">
            Suggested low-risk experiment
          </h4>
          <p className="mt-1 text-sm font-semibold">{output.experiment.title}</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm">
            {output.experiment.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-muted">
            Success: {output.experiment.success_signal}
          </p>
          <p className="text-xs text-muted">Stop: {output.experiment.stop_signal}</p>
        </div>
      ) : null}

      {output.tradeoffs.length > 0 ? (
        <div className="mt-3">
          <h4 className="text-xs font-bold uppercase tracking-wide text-muted">
            Trade-offs that remain
          </h4>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {output.tradeoffs.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {output.recommendation ? (
        <div className="mt-3 rounded-xl border border-brand/30 bg-brand-soft/40 p-3">
          <h4 className="text-xs font-bold uppercase tracking-wide text-muted">
            Optional recommendation
          </h4>
          <p className="mt-1 text-sm leading-relaxed">{output.recommendation}</p>
          <p className="mt-1 text-xs text-muted">
            You can reject this and record your own decision below.
          </p>
        </div>
      ) : null}

      {output.questions.length > 0 ? (
        <div className="mt-3">
          <h4 className="text-xs font-bold uppercase tracking-wide text-muted">
            Questions for you
          </h4>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {output.questions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ reviewId: string }>;
}) {
  const { reviewId } = await params;
  if (!isUuid(reviewId)) notFound();

  const session = await requireSession();
  const [identity, detail] = await Promise.all([
    getIdentity(session),
    getReviewDetail(session, reviewId),
  ]);

  if (!detail) notFound();

  const { review, stages } = detail;
  const answered = stages
    .filter((stage) => stage.status === "succeeded")
    .map((stage) => ({
      perspective: stage.perspective as Perspective,
      output: stageOutput(stage),
    }));

  const next = stages
    .filter((stage) => stage.status === "pending")
    .sort((a, b) => a.position - b.position)[0];

  const canRun =
    review.status === "in_progress" &&
    next !== undefined &&
    (next.perspective !== "synthesizer" || answered.length > 0);

  const disagreements = disagreementRows(answered);
  const missing = missingInfoRows(answered);
  const options = optionRows(answered);
  const experiments = experimentRows(answered);

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-4xl px-5 pb-16 pt-6">
        <Link
          href="/reviews"
          className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          ← All reviews
        </Link>

        <header className="mt-4">
          <h1 className="text-3xl font-black leading-tight tracking-tight sm:text-4xl">
            {review.question}
          </h1>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
            <span className={chipClass}>{STATUS_LABELS[review.status]}</span>
            <span className={chipClass}>Model {review.model}</span>
            <span className={chipClass}>
              {review.current_position} of {PERSPECTIVES.length} perspectives
            </span>
            <span className={chipClass}>Started {formatFutureDay(review.created_at)}</span>
            {review.decided_at ? <span className={chipClass}>Decision saved</span> : null}
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
            {TRANSPARENCY_NOTE}
          </p>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
            {SAME_MODEL_NOTE}
          </p>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
            {NO_TOOLS_NOTE}
          </p>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">{USAGE_NOTE}</p>
        </header>

        <details className={`${cardClass} mt-5`}>
          <summary className="cursor-pointer rounded text-sm font-semibold">
            The shared record
          </summary>
          <dl className="mt-3 space-y-2 text-sm">
            <div>
              <dt className="font-semibold">Your question</dt>
              <dd className="text-muted">{review.question}</dd>
            </div>
            {review.context ? (
              <div>
                <dt className="font-semibold">Context</dt>
                <dd className="whitespace-pre-line text-muted">{review.context}</dd>
              </div>
            ) : null}
            {review.constraints ? (
              <div>
                <dt className="font-semibold">Constraints</dt>
                <dd className="whitespace-pre-line text-muted">{review.constraints}</dd>
              </div>
            ) : null}
            <div>
              <dt className="font-semibold">Your priorities</dt>
              <dd className="text-muted">
                {review.priorities.length > 0
                  ? review.priorities.join("; ")
                  : "None set."}
              </dd>
              <PrioritiesForm review={review} />
            </div>
            <div>
              <dt className="font-semibold">Sources you supplied</dt>
              <dd className="text-muted">
                {review.sources.length === 0 ? (
                  "None. No perspective may cite anything."
                ) : (
                  <ul className="space-y-1">
                    {review.sources.map((source) => (
                      <li key={source.url}>
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className={`rounded underline decoration-line underline-offset-2 hover:text-ink ${focusRing}`}
                        >
                          {source.title || source.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
          </dl>
        </details>

        {review.status === "in_progress" && next ? (
          <section className={`${cardClass} mt-5 border-brand/30 bg-brand-soft/30`}>
            <h2 className="text-lg font-bold">
              Next: {PERSPECTIVE_LABELS[next.perspective as Perspective]}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              {PERSPECTIVE_QUESTIONS[next.perspective as Perspective]}{" "}
              {PERSPECTIVE_NOTES[next.perspective as Perspective]}
            </p>
            {canRun ? (
              <RunPerspectiveForm
                reviewId={review.id}
                label={PERSPECTIVE_LABELS[next.perspective as Perspective]}
              />
            ) : (
              <p className="mt-2 text-sm text-muted">
                Run at least one earlier perspective before the synthesizer.
              </p>
            )}
            <CancelReviewForm reviewId={review.id} />
            <p className="mt-1 text-xs leading-relaxed text-muted">{CANCELLATION_NOTE}</p>
          </section>
        ) : null}

        {review.status === "cancelled" ? (
          <p className={`${cardClass} mt-5 text-sm text-muted`}>
            Cancelled{review.cancel_requested_at ? ` ${formatFutureDay(review.cancel_requested_at)}` : ""}.
            Finished perspectives are still readable; no further requests were made.
          </p>
        ) : null}

        <section aria-labelledby="stages-heading" className="mt-8">
          <h2 id="stages-heading" className="text-xl font-bold">
            The five perspectives
          </h2>
          <ol className="mt-1">
            {stages
              .sort((a, b) => a.position - b.position)
              .map((stage) => (
                <StageCard
                  key={stage.id}
                  stage={stage}
                  canRun={canRun && stage.id === next?.id}
                  reviewId={review.id}
                />
              ))}
          </ol>
        </section>

        {options.length > 0 ? (
          <section aria-labelledby="options-heading" className="mt-8">
            <h2 id="options-heading" className="text-xl font-bold">
              Options on the table
            </h2>
            <p className="mt-1 text-sm text-muted">
              Each option stays attributed to the perspective that proposed it. No
              merging, no ranking, and repeated agreement is not corroboration.
            </p>
            <div className="mt-3 space-y-3">
              {options.map((group) => (
                <div key={group.perspective} className={cardClass}>
                  <h3 className="text-sm font-bold">{group.label}</h3>
                  <ul className="mt-2 space-y-2 text-sm">
                    {group.options.map((option) => (
                      <li key={option.title}>
                        <span className="font-semibold">{option.title}</span> —{" "}
                        {option.description}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {disagreements.length > 0 ? (
          <section aria-labelledby="disagreements-heading" className="mt-8">
            <h2 id="disagreements-heading" className="text-xl font-bold">
              Unresolved disagreements
            </h2>
            <div className="mt-3 space-y-3">
              {disagreements.map((group) => (
                <div key={group.perspective} className={cardClass}>
                  <h3 className="text-sm font-bold">{group.label}</h3>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                    {group.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {missing.length > 0 ? (
          <section aria-labelledby="missing-heading" className="mt-8">
            <h2 id="missing-heading" className="text-xl font-bold">
              Information still missing
            </h2>
            <div className="mt-3 space-y-3">
              {missing.map((group) => (
                <div key={group.perspective} className={cardClass}>
                  <h3 className="text-sm font-bold">{group.label}</h3>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                    {group.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {experiments.length > 0 ? (
          <section aria-labelledby="experiments-heading" className="mt-8">
            <h2 id="experiments-heading" className="text-xl font-bold">
              Low-risk experiments suggested
            </h2>
            <div className="mt-3 space-y-3">
              {experiments.map((group) => (
                <div key={group.perspective} className={cardClass}>
                  <h3 className="text-sm font-bold">{group.label}</h3>
                  <p className="mt-1 text-sm font-semibold">{group.experiment.title}</p>
                  <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm">
                    {group.experiment.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                  <p className="mt-2 text-xs text-muted">
                    Success: {group.experiment.success_signal}
                  </p>
                  <p className="text-xs text-muted">
                    Stop: {group.experiment.stop_signal}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section aria-labelledby="human-heading" className="mt-8">
          <h2 id="human-heading" className="text-xl font-bold">
            Human decision
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">{HUMAN_DECISION_NOTE}</p>
        </section>

        <OutcomeForm review={review} />

        {review.decision ? (
          <section className={`${cardClass} mt-4`} aria-labelledby="saved-outcome">
            <h2 id="saved-outcome" className="text-lg font-bold">
              Saved outcome
            </h2>
            {review.chosen_option ? (
              <p className="mt-1 text-sm font-medium">
                Chosen: {review.chosen_option}
              </p>
            ) : null}
            {review.rejected_recommendation ? (
              <p className="mt-1 text-sm font-medium text-muted">
                The synthesizer&rsquo;s recommendation was rejected.
              </p>
            ) : null}
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted">
              {review.decision}
            </p>
            {review.decided_at ? (
              <p className="mt-2 text-xs text-muted">
                Saved {formatFutureDay(review.decided_at)}.
              </p>
            ) : null}
          </section>
        ) : null}

        <DeleteReviewForm reviewId={review.id} />

        <p className="mt-6">
          <Link href="/reviews" className={secondaryButton}>
            Back to all reviews
          </Link>
        </p>
      </main>
    </div>
  );
}
