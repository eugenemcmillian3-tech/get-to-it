import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CompleteCapabilityReviewForm,
  DeclineCapabilityReviewForm,
} from "@/components/capability-eval-forms";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import {
  CAPABILITY_DOMAIN_LABELS,
  CAPABILITY_SPLIT_LABELS,
  type CapabilityDomain,
  type CapabilitySplit,
} from "@/lib/capability-eval";
import { getCapabilityReview } from "@/lib/data/capability-eval";
import { getIdentity } from "@/lib/identity";
import { cardClass, chipClass } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Independent review — GET TO IT" };

function date(value: string | null): string {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default async function CapabilityReviewPage({
  params,
}: {
  params: Promise<{ reviewId: string }>;
}) {
  const { reviewId } = await params;
  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const session = await requireSession();
  const [identity, detail] = await Promise.all([
    getIdentity(session),
    getCapabilityReview(session, reviewId),
  ]);
  if (!detail) notFound();

  const { review, brief, isReviewer, isOwner } = detail;
  const readable = brief?.ok === true;
  const evaluation = brief?.evaluation;
  const version = brief?.version;
  const totals = brief?.totals;

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-3xl px-5 pb-16 pt-6">
        <Link
          href={isOwner ? `/capability-eval/${review.eval_id}` : "/capability-eval"}
          className="text-sm text-muted underline"
        >
          {isOwner ? "Back to the evaluation" : "Back to capability evaluation"}
        </Link>

        <header className="mt-3">
          <h1 className="text-2xl font-black tracking-tight">Independent capability review</h1>
          <p className="mt-2 text-sm text-muted">
            {evaluation?.name ?? "Capability evaluation"}
            {version ? ` · ${version.label} v${version.number}` : ""}
          </p>
          <p className="mt-2 flex flex-wrap gap-2">
            <span className={chipClass}>{review.status}</span>
            <span className={chipClass}>dataset {evaluation?.dataset_version ?? "unknown"}</span>
            <span className={chipClass}>
              {version
                ? `${version.model_version} / ${version.orchestration_version} / ${version.prompt_version}`
                : "version unavailable"}
            </span>
          </p>
        </header>

        {!readable ? (
          <section className={`${cardClass} mt-6`}>
            <h2 className="text-lg font-bold">This brief is not available</h2>
            <p className="mt-2 text-sm text-muted">
              It may have been withdrawn, or your session is not the owner or the named reviewer.
            </p>
          </section>
        ) : (
          <>
            <section className={`${cardClass} mt-6`}>
              <h2 className="text-lg font-bold">What this review covers</h2>
              <p className="mt-1 text-sm text-muted">
                {evaluation?.experiment_question ?? "No linked experiment question."}
              </p>
              <p className="mt-2 text-sm">
                Permission at version creation:{" "}
                <span className="font-semibold">{version?.autonomy_permission ?? "unknown"}</span>{" "}
                · human assistance:{" "}
                <span className="font-semibold">{version?.human_assistance ?? "unknown"}</span>.
                The summary below never includes answer keys, submissions or scoring detail, and
                nothing you record here releases or permits anything.
              </p>
            </section>

            <section className={`${cardClass} mt-4`}>
              <h2 className="text-lg font-bold">Recorded numbers for this version</h2>
              {totals && totals.runs > 0 ? (
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted">Runs</dt>
                    <dd className="font-semibold">{totals.runs}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted">Verified</dt>
                    <dd className="font-semibold">
                      {totals.verified} / {totals.runs}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted">Contaminated</dt>
                    <dd className="font-semibold">{totals.contaminated}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted">
                      Permission violations
                    </dt>
                    <dd className="font-semibold">{totals.permission_violations}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted">
                      Human interventions
                    </dt>
                    <dd className="font-semibold">{totals.human_interventions}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted">Unsupported claims</dt>
                    <dd className="font-semibold">{totals.unsupported_claims}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted">Mean cost</dt>
                    <dd className="font-semibold">
                      ${(totals.average_cost_cents / 100).toFixed(2)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted">Mean latency</dt>
                    <dd className="font-semibold">
                      {Math.round(totals.average_latency_ms)} ms
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-2 text-sm text-muted">No run is recorded for this version.</p>
              )}

              {brief?.splits && brief.splits.length > 0 ? (
                <div className="mt-4">
                  <h3 className="text-sm font-bold">By split</h3>
                  <ul className="mt-1 grid gap-1 text-sm">
                    {brief.splits.map((split) => (
                      <li key={split.split}>
                        {CAPABILITY_SPLIT_LABELS[split.split as CapabilitySplit] ?? split.split}:{" "}
                        {split.verified}/{split.trials} verified · {split.contaminated} contaminated
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {brief?.domains && brief.domains.length > 0 ? (
                <div className="mt-4">
                  <h3 className="text-sm font-bold">By domain</h3>
                  <ul className="mt-1 grid gap-1 text-sm">
                    {brief.domains.map((domain) => (
                      <li key={domain.domain}>
                        {CAPABILITY_DOMAIN_LABELS[domain.domain as CapabilityDomain] ??
                          domain.domain}
                        : {domain.verified}/{domain.trials} verified
                        {domain.failure_category ? ` · ${domain.failure_category}` : ""}
                        {domain.contaminated > 0 ? ` · ${domain.contaminated} contaminated` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>

            {review.status === "completed" ? (
              <section className={`${cardClass} mt-4`}>
                <h2 className="text-lg font-bold">Review recorded</h2>
                <p className="mt-1 text-xs text-muted">Decided {date(review.reviewed_at)}</p>
                <p className="mt-3 whitespace-pre-wrap text-sm">
                  <span className="font-semibold">Findings:</span> {review.findings}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm">
                  <span className="font-semibold">Limitations:</span> {review.limitations}
                </p>
              </section>
            ) : review.status === "declined" ? (
              <section className={`${cardClass} mt-4`}>
                <h2 className="text-lg font-bold">Review declined</h2>
                <p className="mt-2 text-sm text-muted">
                  Nothing was recorded against the version. The evaluation owner can request a
                  different reviewer.
                </p>
              </section>
            ) : isReviewer ? (
              <section className={`${cardClass} mt-4`}>
                <h2 className="text-lg font-bold">Record your review</h2>
                <p className="mt-1 text-sm text-muted">
                  You were named as the reviewer. Check the numbers against what the version
                  records, then state what they support and what you could not check.
                </p>
                <div className="mt-3">
                  <CompleteCapabilityReviewForm reviewId={review.id} />
                </div>
                <div className="mt-4 border-t border-line pt-3">
                  <DeclineCapabilityReviewForm reviewId={review.id} />
                </div>
              </section>
            ) : (
              <section className={`${cardClass} mt-4`}>
                <h2 className="text-lg font-bold">Waiting for the reviewer</h2>
                <p className="mt-2 text-sm text-muted">
                  Only the named reviewer can complete or decline this review. The evaluation owner
                  cannot record it on their behalf.
                </p>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
