import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import { getObservatory } from "@/lib/data/observatory";
import { getIdentity } from "@/lib/identity";
import {
  AUTHORITY_AREAS,
  EVIDENCE_LABELS,
  EVIDENCE_LABEL_INFO,
  NO_AUTOMATIC_AUTHORITY_NOTE,
  RELEASE_REVIEW_AREAS,
  RESEARCH_AREA,
  buildCapabilityClaims,
  capabilityEvidenceLabel,
  candidateEvidenceLabel,
  classificationFor,
  costLatencyChanges,
  deploymentEvidenceLabel,
  domainStrengthsAndFailures,
  domainStats,
  generalizationSummary,
  humanInterventionRows,
  incidentEvidenceLabel,
  recommendNextExperiment,
  renderableClaims,
  type CapabilityClaim,
} from "@/lib/observatory";
import { cardClass, chipClass, secondaryButton } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Research observatory — GET TO IT" };

const COUNT = (value: number, one: string, many = `${one}s`) =>
  `${value} ${value === 1 ? one : many}`;

const DATE = (value: string | null) => {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const PERCENT = (value: number) => `${Math.round(value * 100)}%`;

const MONEY = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const LATENCY = (ms: number) => `${Math.round(ms)} ms`;

const DELTA = (value: number | null) =>
  value === null ? "Not measurable" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;

export default async function ObservatoryPage({
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
  const [identity, data] = await Promise.all([
    getIdentity(session),
    getObservatory(session, workspaceId),
  ]);
  if (!data) notFound();

  const { workspace, myRole, improvements, programs, evaluations, missions, hypotheses } = data;
  const candidates = improvements.candidates;
  const blocks = improvements.blocks;

  const promotionClaims: CapabilityClaim[] = candidates
    .filter((candidate) => candidate.status === "promoted")
    .map((candidate) => {
      const label = candidateEvidenceLabel(candidate.status, candidate.verdict);
      const deployment = data.deployments.find(
        (row) => row.id === candidate.deployment_id,
      );
      const claim: CapabilityClaim = {
        id: `candidate:${candidate.id}`,
        statement: `${candidate.title} passed its frozen evaluation and a person approved its promotion.`,
        label,
        classification: classificationFor(label),
        version: {
          kind: "system_version",
          label: `${candidate.base_ref} → ${candidate.candidate_ref}`,
          href: `/workspace/${workspaceId}/improvements`,
        },
        experiment: null,
        evaluation: {
          kind: "evaluation",
          label: `Frozen criteria, ${candidate.verdict ?? "no verdict"} verdict`,
          href: `/workspace/${workspaceId}/improvements`,
        },
        evidence: {
          kind: "evidence",
          label: candidate.evaluation_plan,
          href: `/workspace/${workspaceId}/improvements`,
        },
        releaseDecision: {
          kind: "release_decision",
          label: deployment?.approvalAt
            ? `Deployment approved ${DATE(deployment.approvalAt)}`
            : `Promotion recorded ${DATE(candidate.promoted_at)}`,
          href: candidate.project_id
            ? `/build/${candidate.project_id}/deploy`
            : `/workspace/${workspaceId}/improvements/promotions`,
        },
      };
      return claim;
    });

  const claims = renderableClaims([
    ...evaluations.flatMap((evaluation) => buildCapabilityClaims(evaluation, workspaceId)),
    ...promotionClaims,
  ]);

  const demonstrated = claims.filter((claim) => claim.classification === "demonstrated");
  const experimental = claims.filter((claim) => claim.classification === "experimental");
  const failedClaims = claims.filter((claim) => claim.classification === "unsupported");

  const allRuns = evaluations.flatMap((evaluation) => evaluation.runs);
  const reviewedVersions = evaluations.reduce(
    (sum, evaluation) =>
      sum +
      new Set(
        evaluation.reviews
          .filter((review) => review.reviewedAt !== null)
          .map((review) => review.versionId),
      ).size,
    0,
  );
  const openIncidents = data.incidents.filter(
    (incident) => incident.status !== "resolved" && incident.status !== "dismissed",
  );
  const rejected = candidates.filter((candidate) => candidate.status === "rejected");
  const contaminatedHeldOut = evaluations.reduce(
    (sum, evaluation) =>
      sum + evaluation.runs.filter((run) => run.split === "held_out" && run.contaminated).length,
    0,
  );
  const heldOutTrials = allRuns.filter((run) => run.split === "held_out").length;
  const measuredPromotions = candidates.filter(
    (candidate) =>
      candidate.status === "promoted" &&
      (candidate.verdict === "better" || candidate.verdict === "equal"),
  ).length;
  const openQuestions = missions.filter(
    (mission) => mission.status !== "complete" && mission.status !== "cancelled",
  );
  const openHypotheses = hypotheses.filter(
    (hypothesis) =>
      (hypothesis.status === "open" || hypothesis.status === "unresolved") &&
      openQuestions.some((mission) => mission.id === hypothesis.missionId),
  );

  const nextExperiment = recommendNextExperiment({
    linkedEvaluations: evaluations.length,
    heldOutTrials,
    contaminatedHeldOut,
    independentlyReviewed: reviewedVersions,
    measuredPromotions,
    openQuestions: openQuestions.length,
  });

  const reviewCounts = {
    holds: RELEASE_REVIEW_AREAS.filter((area) => area.state === "holds").length,
    limits: RELEASE_REVIEW_AREAS.filter((area) => area.state === "holds_with_limits").length,
    open: RELEASE_REVIEW_AREAS.filter((area) => area.state === "open").length,
  };

  const knownFailures = evaluations.flatMap((evaluation) =>
    domainStrengthsAndFailures(domainStats(evaluation.runs)).failures.map((stat) => ({
      evaluation: evaluation.name,
      label: stat.label,
      detail: `${stat.verified} of ${stat.trials} verified${stat.topFailure ? ` · ${stat.topFailure}` : ""}`,
      href: `/capability-eval/${evaluation.id}`,
    })),
  );

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-6xl px-5 pb-16 pt-6">
        <Link href={`/workspace/${workspaceId}`} className="text-sm text-muted underline">
          Back to {workspace.name}
        </Link>

        <header className="mt-3">
          <h1 className="text-3xl font-black tracking-tight">Research observatory</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
            One read-only view of what this workspace has actually measured. It reuses the
            capability evaluations, improvement proposals, deployments, incidents, releases and
            research missions that already exist; it keeps no second copy of them and adds no
            score of its own. Every capability claim links to its system version, its experiment or
            evaluation, its evidence and its human release decision.
          </p>
          <p className="mt-3 flex flex-wrap gap-2">
            <span className={chipClass}>{myRole}</span>
            <span className={chipClass}>{COUNT(evaluations.length, "linked evaluation")}</span>
            <span className={chipClass}>{COUNT(claims.length, "traceable claim")}</span>
            <span className={chipClass}>{COUNT(programs.length, "controlled comparison")}</span>
          </p>
        </header>

        <section aria-labelledby="research-area-heading" className={`${cardClass} mt-6`}>
          <h2 id="research-area-heading" className="text-lg font-bold">
            Research area: {RESEARCH_AREA.name}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">{RESEARCH_AREA.scope}</p>
          <p className="mt-2 rounded-xl border border-line bg-paper p-3 text-sm font-medium">
            {RESEARCH_AREA.disclaimer}
          </p>
        </section>

        <section aria-labelledby="deliverables-heading" className="mt-8">
          <h2 id="deliverables-heading" className="text-xl font-bold">
            What the evidence supports
          </h2>
          <div className="mt-3 grid gap-4 lg:grid-cols-3">
            <div className={cardClass}>
              <h3 className="text-sm font-bold uppercase tracking-wide text-muted">
                Demonstrated capabilities
              </h3>
              {demonstrated.length === 0 ? (
                <p className="mt-2 text-sm text-muted">
                  None. No claim here has a recorded independent review or a human release
                  decision.
                </p>
              ) : (
                <ul className="mt-2 grid gap-2 text-sm">
                  {demonstrated.map((claim) => (
                    <li key={claim.id} className="break-words">
                      {claim.statement}{" "}
                      <Link href={claim.evaluation.href} className="underline">
                        evidence
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className={cardClass}>
              <h3 className="text-sm font-bold uppercase tracking-wide text-muted">
                Experimental capabilities
              </h3>
              {experimental.length === 0 ? (
                <p className="mt-2 text-sm text-muted">
                  None. No measured version is linked to this workspace yet.
                </p>
              ) : (
                <ul className="mt-2 grid gap-2 text-sm">
                  {experimental.slice(0, 6).map((claim) => (
                    <li key={claim.id} className="break-words">
                      {claim.statement}{" "}
                      <span className="text-xs text-muted">
                        ({EVIDENCE_LABEL_INFO[claim.label].label})
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className={cardClass}>
              <h3 className="text-sm font-bold uppercase tracking-wide text-muted">
                Unsupported aspirations
              </h3>
              <p className="mt-2 text-sm text-muted">
                None are presented as capability. The observatory makes no claim beyond a traceable
                record, no general-intelligence claim, and no claim that a singularity has occurred
                or been achieved.
              </p>
              {failedClaims.length > 0 ? (
                <p className="mt-2 text-xs text-muted">
                  {COUNT(failedClaims.length, "record")} reached a failed or superseded state and is
                  shown below rather than counted as a capability.
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className={cardClass}>
              <h3 className="text-sm font-bold uppercase tracking-wide text-muted">
                Known failures
              </h3>
              {knownFailures.length === 0 && openIncidents.length === 0 && rejected.length === 0 ? (
                <p className="mt-2 text-sm text-muted">
                  No recorded evaluation failure, open incident or rejected proposal.
                </p>
              ) : (
                <ul className="mt-2 grid gap-2 text-sm">
                  {knownFailures.slice(0, 5).map((failure) => (
                    <li key={`${failure.evaluation}:${failure.label}`} className="break-words">
                      <Link href={failure.href} className="underline">
                        {failure.label}
                      </Link>{" "}
                      — {failure.detail} ({failure.evaluation})
                    </li>
                  ))}
                  {openIncidents.slice(0, 3).map((incident) => (
                    <li key={incident.id} className="break-words">
                      Open {incident.severity} incident: {incident.title}
                    </li>
                  ))}
                  {rejected.slice(0, 3).map((candidate) => (
                    <li key={candidate.id} className="break-words">
                      Rejected proposal: {candidate.title}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className={cardClass}>
              <h3 className="text-sm font-bold uppercase tracking-wide text-muted">
                Remaining prerequisites
              </h3>
              <ul className="mt-2 grid gap-2 text-sm text-muted">
                {evaluations.length === 0 ? (
                  <li>
                    Link an existing capability evaluation to an experiment in this workspace so a
                    claim has a version and a dataset.
                  </li>
                ) : null}
                {heldOutTrials === 0 ? (
                  <li>Record held-out runs; without them no result can speak to generalization.</li>
                ) : null}
                {reviewedVersions === 0 ? (
                  <li>
                    No capability version has a recorded independent review, so no measured
                    capability reaches the demonstrated column. Proposal reviews are counted
                    separately and never stand in for a capability review.
                  </li>
                ) : null}
                {measuredPromotions === 0 ? (
                  <li>
                    No promoted proposal with a measured better-or-equal verdict exists in this
                    workspace.
                  </li>
                ) : null}
                <li>
                  Deployment and external publication remain separate human approvals; neither is
                  implied by a result on this page.
                </li>
              </ul>
            </div>
            <div className={cardClass}>
              <h3 className="text-sm font-bold uppercase tracking-wide text-muted">
                Recommended next bounded experiment
              </h3>
              <p className="mt-2 text-sm font-semibold">{nextExperiment.title}</p>
              <p className="mt-1 text-sm text-muted">{nextExperiment.rationale}</p>
              <p className="mt-2 text-xs text-muted">Bounded by: {nextExperiment.boundedBy}</p>
              <p className="mt-2">
                <span className={chipClass}>{EVIDENCE_LABEL_INFO[nextExperiment.label].label}</span>
              </p>
            </div>
          </div>
        </section>

        <section aria-labelledby="claims-heading" className="mt-10">
          <h2 id="claims-heading" className="text-xl font-bold">
            Traceable capability claims
          </h2>
          <p className="mt-1 text-sm text-muted">
            A claim appears only when it carries all four links. Missing evidence hides the claim
            instead of weakening the rule.
          </p>
          {claims.length === 0 ? (
            <div className={`${cardClass} mt-3`}>
              <p className="text-sm text-muted">
                No traceable capability claim is recorded. Connect an evaluation or promote a
                proposal to create one.
              </p>
            </div>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[64rem] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                    <th className="py-2 pr-3">Claim</th>
                    <th className="py-2 pr-3">Label</th>
                    <th className="py-2 pr-3">System version</th>
                    <th className="py-2 pr-3">Experiment / evaluation</th>
                    <th className="py-2 pr-3">Evidence</th>
                    <th className="py-2">Human release decision</th>
                  </tr>
                </thead>
                <tbody>
                  {claims.map((claim) => (
                    <tr key={claim.id} className="border-b border-line align-top">
                      <td className="max-w-[20rem] py-3 pr-3">{claim.statement}</td>
                      <td className="py-3 pr-3">
                        <span className="whitespace-nowrap rounded-full border border-line px-2 py-0.5 text-xs">
                          {EVIDENCE_LABEL_INFO[claim.label].label}
                        </span>
                      </td>
                      <td className="py-3 pr-3">
                        <Link href={claim.version.href} className="underline">
                          {claim.version.label}
                        </Link>
                      </td>
                      <td className="py-3 pr-3">
                        <Link href={claim.evaluation.href} className="underline">
                          {claim.evaluation.label}
                        </Link>
                        {claim.experiment ? (
                          <>
                            {" · "}
                            <Link href={claim.experiment.href} className="underline">
                              experiment
                            </Link>
                          </>
                        ) : null}
                      </td>
                      <td className="py-3 pr-3">
                        <Link href={claim.evidence.href} className="underline">
                          {claim.evidence.label}
                        </Link>
                      </td>
                      <td className="py-3">
                        {claim.releaseDecision ? (
                          <Link href={claim.releaseDecision.href} className="underline">
                            {claim.releaseDecision.label}
                          </Link>
                        ) : (
                          <span className="text-muted">None recorded</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="capability-heading" className="mt-10">
          <h2 id="capability-heading" className="text-xl font-bold">
            Capability results across versions
          </h2>
          <p className="mt-1 text-sm text-muted">
            Reported per evaluation, version, domain and split. There is no combined score and
            evaluations are never pooled.
          </p>
          {evaluations.length === 0 ? (
            <div className={`${cardClass} mt-3`}>
              <p className="text-sm text-muted">
                No capability evaluation is linked to an experiment in this workspace.
              </p>
              <Link href="/capability-eval" className={`${secondaryButton} mt-3`}>
                Open capability evaluations
              </Link>
            </div>
          ) : (
            <div className="mt-3 grid gap-4">
              {evaluations.map((evaluation) => {
                const versions = evaluation.versions.map((version) => {
                  const runs = evaluation.runs.filter((run) => run.version_id === version.id);
                  const verified = runs.filter((run) => run.verified_success).length;
                  const contaminated = runs.filter((run) => run.contaminated).length;
                  const label = capabilityEvidenceLabel({
                    runs: runs.length,
                    verified,
                    contaminated,
                    reviewed: evaluation.reviews.some(
                      (row) => row.versionId === version.id && row.reviewedAt !== null,
                    ),
                  });
                  return { version, runs, verified, contaminated, label };
                });
                const generalization = generalizationSummary(evaluation.runs);
                const { strengths, failures } = domainStrengthsAndFailures(
                  domainStats(evaluation.runs),
                );
                const changes = costLatencyChanges(evaluation.versions, evaluation.runs);
                const human = humanInterventionRows(evaluation.versions, evaluation.runs);
                return (
                  <div key={evaluation.id} className={cardClass}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-lg font-bold">{evaluation.name}</h3>
                      <Link
                        href={`/capability-eval/${evaluation.id}`}
                        className="text-sm underline"
                      >
                        Evaluation record
                      </Link>
                    </div>
                    <p className="mt-1 text-sm text-muted">
                      Dataset {evaluation.datasetVersion} · linked experiment:{" "}
                      {evaluation.experimentQuestion}
                    </p>

                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
                        <thead>
                          <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                            <th className="py-2 pr-3">Version</th>
                            <th className="py-2 pr-3">Runs</th>
                            <th className="py-2 pr-3">Verified</th>
                            <th className="py-2 pr-3">Contaminated</th>
                            <th className="py-2 pr-3">Mean cost</th>
                            <th className="py-2 pr-3">Mean latency</th>
                            <th className="py-2 pr-3">Evidence label</th>
                            <th className="py-2">Independent review</th>
                          </tr>
                        </thead>
                        <tbody>
                          {versions.map(({ version, runs, verified, contaminated, label }) => {
                            const review = evaluation.reviews.find(
                              (row) =>
                                row.versionId === version.id && row.reviewedAt !== null,
                            );
                            return (
                            <tr key={version.id} className="border-b border-line">
                              <td className="py-2 pr-3">
                                {version.label} · v{version.version}
                              </td>
                              <td className="py-2 pr-3">{runs.length}</td>
                              <td className="py-2 pr-3">
                                {verified} / {runs.length}
                              </td>
                              <td className="py-2 pr-3">{contaminated}</td>
                              <td className="py-2 pr-3">
                                {runs.length === 0
                                  ? "—"
                                  : MONEY(
                                      runs.reduce((sum, run) => sum + run.cost_cents, 0) /
                                        runs.length,
                                    )}
                              </td>
                              <td className="py-2 pr-3">
                                {runs.length === 0
                                  ? "—"
                                  : LATENCY(
                                      runs.reduce((sum, run) => sum + run.latency_ms, 0) /
                                        runs.length,
                                    )}
                              </td>
                              <td className="py-2 pr-3">{EVIDENCE_LABEL_INFO[label].label}</td>
                              <td className="py-2">
                                {review
                                  ? `Reviewed ${DATE(review.reviewedAt)}`
                                  : "Not reviewed"}
                              </td>
                            </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <div>
                        <h4 className="text-sm font-bold">Strengths recorded</h4>
                        {strengths.length === 0 ? (
                          <p className="mt-1 text-sm text-muted">No verified success is recorded.</p>
                        ) : (
                          <ul className="mt-1 grid gap-1 text-sm">
                            {strengths.map((stat) => (
                              <li key={stat.domain}>
                                {stat.label}: {stat.verified} of {stat.trials} verified (
                                {PERCENT(stat.verifiedRate)})
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div>
                        <h4 className="text-sm font-bold">Failures recorded</h4>
                        {failures.length === 0 ? (
                          <p className="mt-1 text-sm text-muted">No failed task is recorded.</p>
                        ) : (
                          <ul className="mt-1 grid gap-1 text-sm">
                            {failures.map((stat) => (
                              <li key={stat.domain}>
                                {stat.label}: {stat.trials - stat.verified} not verified
                                {stat.topFailure ? ` · ${stat.topFailure}` : ""}
                                {stat.permissionViolations > 0
                                  ? ` · ${COUNT(stat.permissionViolations, "permission violation")}`
                                  : ""}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>

                    <div className="mt-4">
                      <h4 className="text-sm font-bold">Generalization</h4>
                      <div className="mt-1 flex flex-wrap gap-2 text-xs">
                        {generalization.rows.map((row) => (
                          <span key={row.split} className={chipClass}>
                            {row.label}: {row.verified}/{row.trials} verified (
                            {PERCENT(row.verifiedRate)}) · {row.contaminated} contaminated
                          </span>
                        ))}
                      </div>
                      <p className="mt-2 text-sm text-muted">{generalization.note}</p>
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <div>
                        <h4 className="text-sm font-bold">Human intervention</h4>
                        {human.length === 0 ? (
                          <p className="mt-1 text-sm text-muted">No version is recorded.</p>
                        ) : (
                          <ul className="mt-1 grid gap-1 text-sm">
                            {human.map((row) => (
                              <li key={row.versionLabel}>
                                {row.versionLabel}: {COUNT(row.interventions, "intervention")} over{" "}
                                {COUNT(row.runs, "run")} · assistance {row.assistance} ·
                                permission {row.permission}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div>
                        <h4 className="text-sm font-bold">Cost and latency change</h4>
                        {changes.length === 0 ? (
                          <p className="mt-1 text-sm text-muted">
                            Two measured versions of one configuration are needed to compare cost
                            and latency.
                          </p>
                        ) : (
                          <ul className="mt-1 grid gap-2 text-sm">
                            {changes.map((change) => (
                              <li key={`${change.baselineKind}-${change.toLabel}`}>
                                {change.fromLabel} → {change.toLabel}: cost{" "}
                                {DELTA(change.costDeltaPct)}, latency{" "}
                                {DELTA(change.latencyDeltaPct)}
                                <span className="block text-xs text-muted">{change.note}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>

                    {evaluation.reviews.filter((review) => review.reviewedAt !== null).length > 0 ? (
                      <div className="mt-4 rounded-xl border border-line bg-paper p-3">
                        <h4 className="text-sm font-bold">Independent review evidence</h4>
                        <ul className="mt-1 grid gap-2 text-sm">
                          {evaluation.reviews
                            .filter((review) => review.reviewedAt !== null)
                            .map((review) => (
                              <li key={review.id}>
                                <span className="font-semibold">
                                  {evaluation.versions.find(
                                    (version) => version.id === review.versionId,
                                  )?.label ?? "Version"}
                                  :
                                </span>{" "}
                                {review.findings}
                                <span className="block text-xs text-muted">
                                  Limitations: {review.limitations} ·{" "}
                                  <Link
                                    href={`/capability-eval/reviews/${review.id}`}
                                    className="underline"
                                  >
                                    review record
                                  </Link>
                                </span>
                              </li>
                            ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section aria-labelledby="proposals-heading" className="mt-10">
          <h2 id="proposals-heading" className="text-xl font-bold">
            Improvement proposals and outcomes
          </h2>
          {candidates.length === 0 ? (
            <div className={`${cardClass} mt-3`}>
              <p className="text-sm text-muted">No improvement proposal is recorded.</p>
              <Link href={`/workspace/${workspaceId}/improvements`} className={`${secondaryButton} mt-3`}>
                Open improvement proposals
              </Link>
            </div>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[48rem] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                    <th className="py-2 pr-3">Proposal</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Measured verdict</th>
                    <th className="py-2 pr-3">Evidence label</th>
                    <th className="py-2">Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((candidate) => {
                    const label = candidateEvidenceLabel(candidate.status, candidate.verdict);
                    return (
                      <tr key={candidate.id} className="border-b border-line align-top">
                        <td className="max-w-[18rem] py-2 pr-3">{candidate.title}</td>
                        <td className="py-2 pr-3">{candidate.status}</td>
                        <td className="py-2 pr-3">{candidate.verdict ?? "Not recorded"}</td>
                        <td className="py-2 pr-3">{EVIDENCE_LABEL_INFO[label].label}</td>
                        <td className="py-2">
                          <Link
                            href={`/workspace/${workspaceId}/improvements`}
                            className="underline"
                          >
                            Proposal and evaluation
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className={`${cardClass} mt-4`}>
            <h3 className="text-sm font-bold">Refused authority requests</h3>
            <p className="mt-1 text-sm text-muted">
              Every attempt to widen authority through a proposal is recorded and refused, whatever
              its measured result.
            </p>
            {blocks.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No refused request is recorded.</p>
            ) : (
              <ul className="mt-2 grid gap-1 text-sm">
                {blocks.slice(0, 8).map((block) => (
                  <li key={block.id}>
                    {block.attempted_action} — {block.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section aria-labelledby="incidents-heading" className="mt-10">
          <h2 id="incidents-heading" className="text-xl font-bold">
            Permission and safety incidents
          </h2>
          {data.incidents.length === 0 ? (
            <div className={`${cardClass} mt-3`}>
              <p className="text-sm text-muted">
                No release incident is recorded for the projects linked to this workspace.
              </p>
            </div>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[48rem] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                    <th className="py-2 pr-3">Incident</th>
                    <th className="py-2 pr-3">Severity</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Recovery</th>
                    <th className="py-2 pr-3">Opened</th>
                    <th className="py-2">Evidence label</th>
                  </tr>
                </thead>
                <tbody>
                  {data.incidents.map((incident) => (
                    <tr key={incident.id} className="border-b border-line align-top">
                      <td className="max-w-[18rem] py-2 pr-3">{incident.title}</td>
                      <td className="py-2 pr-3">{incident.severity}</td>
                      <td className="py-2 pr-3">{incident.status}</td>
                      <td className="py-2 pr-3">{incident.recoveryKind ?? "None prepared"}</td>
                      <td className="py-2 pr-3">{DATE(incident.createdAt)}</td>
                      <td className="py-2">
                        {EVIDENCE_LABEL_INFO[
                          incidentEvidenceLabel(incident.status, incident.rootCauseConfirmed)
                        ].label}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-muted">
            A hypothesis is not a root cause. An incident stays open until it is resolved or
            dismissed, and a recovery needs its own approval.
          </p>
        </section>

        <section aria-labelledby="deployments-heading" className="mt-10">
          <h2 id="deployments-heading" className="text-xl font-bold">
            Deployment history
          </h2>
          {data.deployments.length === 0 ? (
            <div className={`${cardClass} mt-3`}>
              <p className="text-sm text-muted">
                No deployment is recorded for the projects linked to this workspace.
              </p>
            </div>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                    <th className="py-2 pr-3">Target</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Approved</th>
                    <th className="py-2 pr-3">Created</th>
                    <th className="py-2 pr-3">Source</th>
                    <th className="py-2">Evidence label</th>
                  </tr>
                </thead>
                <tbody>
                  {data.deployments.map((deployment) => (
                    <tr key={deployment.id} className="border-b border-line align-top">
                      <td className="py-2 pr-3">{deployment.target}</td>
                      <td className="py-2 pr-3">{deployment.status}</td>
                      <td className="py-2 pr-3">{DATE(deployment.approvalAt)}</td>
                      <td className="py-2 pr-3">{DATE(deployment.createdAt)}</td>
                      <td className="py-2 pr-3">
                        <Link href={`/build/${deployment.projectId}/deploy`} className="underline">
                          Deployment record
                        </Link>
                      </td>
                      <td className="py-2">
                        {EVIDENCE_LABEL_INFO[deploymentEvidenceLabel(deployment.status)].label}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="rollback-heading" className="mt-10">
          <h2 id="rollback-heading" className="text-xl font-bold">
            Rollback history
          </h2>
          {data.releases.length === 0 ? (
            <div className={`${cardClass} mt-3`}>
              <p className="text-sm text-muted">
                No release record is stored, so no rollback limitation is recorded either.
              </p>
            </div>
          ) : (
            <div className={`${cardClass} mt-3`}>
              <ul className="grid gap-2 text-sm">
                {data.releases.map((release) => (
                  <li key={release.id} className="flex flex-wrap justify-between gap-2">
                    <span>
                      Release v{release.version} · {release.status} ·{" "}
                      {release.reviewedAt
                        ? `reviewed ${DATE(release.reviewedAt)}`
                        : "no human review recorded"}
                    </span>
                    <Link
                      href={`/build/${release.projectId}/releases`}
                      className="underline"
                    >
                      Release and rollback limitations
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted">
                A code rollback does not reverse a database migration, and a configuration
                rollback does not undo code. Every rollback needs a separate approval.
              </p>
            </div>
          )}
        </section>

        <section aria-labelledby="research-heading" className="mt-10">
          <h2 id="research-heading" className="text-xl font-bold">
            Open research questions
          </h2>
          {openQuestions.length === 0 && openHypotheses.length === 0 ? (
            <div className={`${cardClass} mt-3`}>
              <p className="text-sm text-muted">
                No open research mission or unresolved hypothesis is recorded.
              </p>
              <Link href={`/workspace/${workspaceId}/research`} className={`${secondaryButton} mt-3`}>
                Open research missions
              </Link>
            </div>
          ) : (
            <div className="mt-3 grid gap-3">
              {openQuestions.map((mission) => (
                <div key={mission.id} className={cardClass}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-sm font-bold">{mission.question}</h3>
                    <span className={chipClass}>{mission.status}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted">{mission.scope}</p>
                  <p className="mt-2 text-xs text-muted">
                    Human checkpoints: {mission.checkpoints.join("; ")}
                  </p>
                  <Link
                    href={`/workspace/${workspaceId}/research/${mission.id}`}
                    className="mt-2 inline-block text-sm underline"
                  >
                    Mission and evidence
                  </Link>
                  {openHypotheses.filter((hypothesis) => hypothesis.missionId === mission.id)
                    .length > 0 ? (
                    <ul className="mt-2 grid gap-1 text-sm">
                      {openHypotheses
                        .filter((hypothesis) => hypothesis.missionId === mission.id)
                        .map((hypothesis) => (
                          <li key={hypothesis.id}>
                            {hypothesis.role === "leading" ? "Leading" : "Competing"}:{" "}
                            {hypothesis.statement} ({hypothesis.status})
                          </li>
                        ))}
                    </ul>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="programs-heading" className="mt-10">
          <h2 id="programs-heading" className="text-xl font-bold">
            Controlled comparisons
          </h2>
          {programs.length === 0 ? (
            <div className={`${cardClass} mt-3`}>
              <p className="text-sm text-muted">No Phase 41 comparison is registered.</p>
            </div>
          ) : (
            <div className={`${cardClass} mt-3 overflow-x-auto`}>
              <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                    <th className="py-2 pr-3">Comparison</th>
                    <th className="py-2 pr-3">Scope</th>
                    <th className="py-2 pr-3">Claim</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Trials</th>
                    <th className="py-2">Record</th>
                  </tr>
                </thead>
                <tbody>
                  {programs.map((program) => (
                    <tr key={program.id} className="border-b border-line align-top">
                      <td className="max-w-[16rem] py-2 pr-3">{program.title}</td>
                      <td className="py-2 pr-3">
                        {program.scope === "all_families"
                          ? `Every installed family (${program.familyKeys.length})`
                          : "One family"}
                      </td>
                      <td className="py-2 pr-3">{program.claimText}</td>
                      <td className="py-2 pr-3">{program.status}</td>
                      <td className="py-2 pr-3">
                        {program.trialRows}/{program.expectedRows}
                      </td>
                      <td className="py-2">
                        <Link
                          href={`/workspace/${workspaceId}/performance/${program.id}`}
                          className="underline"
                        >
                          Comparison record
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="authority-heading" className="mt-10">
          <h2 id="authority-heading" className="text-xl font-bold">
            No automatic authority expansion
          </h2>
          <div className={`${cardClass} mt-3`}>
            <p className="text-sm leading-relaxed">{NO_AUTOMATIC_AUTHORITY_NOTE}</p>
            <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              {AUTHORITY_AREAS.map((area) => (
                <li key={area.id} className="rounded-xl border border-line bg-paper px-3 py-2">
                  <span className="font-semibold">{area.label}</span>
                  <span className="block text-xs text-muted">
                    Needs a separate written human approval. Never granted by a score.
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="review-heading" className="mt-10">
          <h2 id="review-heading" className="text-xl font-bold">
            Release review, Phases 36–42
          </h2>
          <p className="mt-1 text-sm text-muted">
            A design-level review, not an external audit. {reviewCounts.holds} areas hold,{" "}
            {reviewCounts.limits} hold with stated limits, {reviewCounts.open} remain open.
          </p>
          <div className="mt-3 grid gap-3">
            {RELEASE_REVIEW_AREAS.map((area) => (
              <div key={area.id} className={cardClass}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-bold">{area.label}</h3>
                  <span className={chipClass}>
                    {area.state === "holds"
                      ? "Holds"
                      : area.state === "holds_with_limits"
                        ? "Holds with limits"
                        : "Open"}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted">{area.requirement}</p>
                <p className="mt-1 text-sm">{area.basis}</p>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="legend-heading" className="mt-10">
          <h2 id="legend-heading" className="text-xl font-bold">
            Evidence labels
          </h2>
          <p className="mt-1 text-sm text-muted">
            {EVIDENCE_LABELS.length} labels. A record shows the strongest stage it has actually
            reached.
          </p>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            {EVIDENCE_LABELS.map((label) => (
              <div key={label} className="rounded-xl border border-line bg-card px-3 py-2">
                <dt className="text-sm font-semibold">{EVIDENCE_LABEL_INFO[label].label}</dt>
                <dd className="text-xs text-muted">{EVIDENCE_LABEL_INFO[label].meaning}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>
    </div>
  );
}
