import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  HumanReferenceForm,
  ReviewTrialForm,
  RunProgramForm,
} from "@/components/performance-program-forms";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import {
  listInstalledFamilies,
  listReviewableTrials,
  readPerformanceReport,
  type PerformanceFamilyResult,
  type PerformanceTrialStat,
} from "@/lib/data/performance-program";
import { getIdentity } from "@/lib/identity";
import {
  CLAIM_LABELS,
  CLAIM_UNITS,
  PERFORMANCE_STATUS_LABELS,
  REFUSED_CLAIM_NOTE,
  VERDICT_LABELS,
  familyLabel,
  formatCents,
  formatLatency,
  formatPercent,
  formatScore,
} from "@/lib/performance-program";
import { cardClass, chipClass } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Registered comparison — GET TO IT" };

function StatRow({ label, baseline, candidate }: { label: string; baseline: string; candidate: string }) {
  return (
    <tr className="border-t border-line">
      <th scope="row" className="py-1.5 pr-3 text-left font-medium">
        {label}
      </th>
      <td className="py-1.5 pr-3 text-muted">{baseline}</td>
      <td className="py-1.5 text-muted">{candidate}</td>
    </tr>
  );
}

function statCells(stat: PerformanceTrialStat) {
  return {
    rows: `${stat.rows} rows · ${stat.tasks} tasks`,
    outcome: `${stat.passes} pass · ${stat.partials} partial · ${stat.fails} fail`,
    mean: formatScore(stat.meanScore),
    cost: `${formatCents(stat.meanCostCents)} · ${stat.meanCostUnits} authored units`,
    latency: formatLatency(stat.medianDurationMs),
    assistance: `${stat.humanAssisted} trials`,
  };
}

function FamilyNumbers({
  entry,
  minimumEffect,
  claimUnit,
}: {
  entry: PerformanceFamilyResult;
  minimumEffect: number;
  claimUnit: string;
}) {
  const baseline = statCells(entry.baseline);
  const candidate = statCells(entry.candidate);
  return (
    <div className="rounded-2xl border border-line p-4">
      <h3 className="text-base font-bold">{familyLabel(entry.key)}</h3>
      <p className="mt-0.5 text-xs text-muted">
        {entry.key} {entry.version} · {entry.tasks} tasks · digest {entry.suiteDigest.slice(0, 16)}…
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[32rem] text-sm">
          <caption className="sr-only">
            Baseline and candidate results for {familyLabel(entry.key)}
          </caption>
          <thead>
            <tr className="text-left">
              <th scope="col" className="pb-1 pr-3 font-semibold">Measure</th>
              <th scope="col" className="pb-1 pr-3 font-semibold">Baseline</th>
              <th scope="col" className="pb-1 font-semibold">Candidate</th>
            </tr>
          </thead>
          <tbody>
            <StatRow label="Trials" baseline={baseline.rows} candidate={candidate.rows} />
            <StatRow label="Outcomes" baseline={baseline.outcome} candidate={candidate.outcome} />
            <StatRow label="Mean score" baseline={baseline.mean} candidate={candidate.mean} />
            <StatRow label="Mean cost" baseline={baseline.cost} candidate={candidate.cost} />
            <StatRow label="Median latency" baseline={baseline.latency} candidate={candidate.latency} />
            <StatRow label="Human-assisted" baseline={baseline.assistance} candidate={candidate.assistance} />
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-sm">
        <strong>{VERDICT_LABELS[entry.claim.verdict] ?? entry.claim.verdict}</strong> — {entry.claim.supported ? "this family supports the registered claim." : "this family does not support the registered claim."}
      </p>
      {entry.claim.reasons.length > 0 ? (
        <ul className="mt-1 grid gap-1 text-sm text-muted">
          {entry.claim.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-muted">
          Score difference {formatScore(entry.effect.scoreGain)} points against a minimum effect of{" "}
          {minimumEffect} {claimUnit}; cost {formatPercent(entry.effect.costReductionPct)} lower;
          latency {formatPercent(entry.effect.latencyReductionPct)} lower; within non-inferiority{" "}
          {entry.effect.withinNoninferiority ? "yes" : "no"}; assistance matched{" "}
          {entry.effect.assistanceMatched ? "yes" : "no"}; within limits{" "}
          {entry.effect.withinLimits ? "yes" : "no"}.
        </p>
      )}
    </div>
  );
}

export default async function PerformanceProgramDetailPage({
  params,
}: {
  params: Promise<{ workspaceId: string; programId: string }>;
}) {
  const { workspaceId, programId } = await params;
  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const session = await requireSession();
  const [identity, report, installed] = await Promise.all([
    getIdentity(session),
    readPerformanceReport(session, programId),
    listInstalledFamilies(session),
  ]);
  if (!report) notFound();
  if (report.program.workspaceId !== workspaceId) notFound();

  const reviewable = await listReviewableTrials(session, report);
  const baseline = statCells(report.baseline);
  const candidate = statCells(report.candidate);
  const complete = report.claims.complete;
  const allFamilies = report.program.scope === "all_families";
  const registeredFamilyKeys = new Set(report.families.map((entry) => entry.key));
  const laterFamilies = installed.filter((entry) => !registeredFamilyKeys.has(entry.key));
  const distributionRows: [string, string][] = allFamilies
    ? report.families.flatMap((entry) => [
        [
          `Task distribution — ${familyLabel(entry.key)}`,
          `${entry.key} ${entry.version}, ${entry.tasks} authored cases, digest ${entry.suiteDigest.slice(0, 16)}…`,
        ],
        [`Tasks — ${familyLabel(entry.key)}`, entry.taskKeys.join(", ")],
      ])
    : [
        [
          "Task distribution",
          `${familyLabel(report.family.key)} (${report.family.key} ${report.family.version}), ${report.plan.tasks} authored cases, digest ${report.family.suiteDigest.slice(0, 16)}…`,
        ],
        ["Tasks", report.family.taskKeys.join(", ")],
      ];

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-4xl px-5 pb-16 pt-6">
        <Link href={`/workspace/${workspaceId}/performance`} className="text-sm text-muted underline">
          Back to the performance program
        </Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-2">
          <h1 className="text-3xl font-black tracking-tight">{report.program.title}</h1>
          <span className={chipClass}>{PERFORMANCE_STATUS_LABELS[report.program.status]}</span>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-muted">{report.program.question}</p>
        <p className="mt-1 text-xs text-muted">
          {allFamilies
            ? `Task families: ${report.families.map((entry) => familyLabel(entry.key)).join(", ")}`
            : `Task family: ${familyLabel(report.program.taskFamily)}`}{" "}
          · {report.plan.tasks} tasks × {report.plan.trials}{" "}
          {report.plan.trials === 1 ? "trial" : "trials"}
        </p>

        <section
          aria-labelledby="verdict-heading"
          className={`${cardClass} mt-6 ${
            report.claims.supported
              ? "border-emerald-300"
              : report.claims.verdict === "awaiting_evidence"
                ? ""
                : "border-amber-300"
          }`}
        >
          <h2 id="verdict-heading" className="text-xl font-bold">
            Claim verdict
          </h2>
          <p className="mt-1 text-sm">
            Registered claim: <strong>{CLAIM_LABELS[report.claims.registered]}</strong> —{" "}
            {report.program.claimText}
          </p>
          <p className="mt-2 text-sm font-semibold">
            {VERDICT_LABELS[report.claims.verdict] ?? report.claims.verdict}
          </p>
          {allFamilies ? (
            <ul className="mt-2 grid gap-1 text-sm">
              {report.families.map((entry) => (
                <li key={entry.key}>
                  <strong>{familyLabel(entry.key)}:</strong>{" "}
                  {VERDICT_LABELS[entry.claim.verdict] ?? entry.claim.verdict}
                </li>
              ))}
            </ul>
          ) : null}
          {report.claims.reasons.length > 0 ? (
            <ul className="mt-2 grid gap-1 text-sm text-muted">
              {report.claims.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
          <p className="mt-2 text-xs text-muted">
            {allFamilies
              ? "Across every family, the claim is supported only when each family supports it on its own rows. No pooled score is computed or shown."
              : complete
                ? "Every planned trial is recorded. The verdict is recomputed from the rows below each time this page or the report is read."
                : `${report.baseline.rows} baseline and ${report.candidate.rows} candidate rows are recorded of ${report.plan.expectedRows} planned each.`}
          </p>

          <h3 className="mt-4 text-sm font-semibold">Claims this does not support</h3>
          <ul className="mt-1 grid gap-1 text-sm text-muted">
            {report.claims.refused.map((row) => (
              <li key={`${row.claim}-${row.reason}`}>
                <strong>{row.claim.replaceAll("_", " ")}:</strong> {row.reason}
              </li>
            ))}
            <li>{REFUSED_CLAIM_NOTE}</li>
          </ul>
        </section>

        <RunProgramForm
          workspaceId={workspaceId}
          programId={programId}
          status={report.program.status}
          hasTrials={report.baseline.rows + report.candidate.rows > 0}
        />

        <section aria-labelledby="numbers-heading" className="mt-8">
          <h2 id="numbers-heading" className="text-xl font-bold">
            Recorded numbers
          </h2>
          {allFamilies ? (
            <>
              <p className="mt-1 text-sm text-muted">
                Each family is reported on its own rows below. There is no combined score: one
                number across different task families would hide which family actually moved.
              </p>
              <div className="mt-4 grid gap-4">
                {report.families.map((entry) => (
                  <FamilyNumbers
                    key={entry.key}
                    entry={entry}
                    minimumEffect={report.program.minimumEffect}
                    claimUnit={CLAIM_UNITS[report.claims.registered]}
                  />
                ))}
              </div>
            </>
          ) : (
            <>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <caption className="sr-only">
                Baseline and candidate results for the registered comparison
              </caption>
              <thead>
                <tr className="text-left">
                  <th scope="col" className="pb-1 pr-3 font-semibold">
                    Measure
                  </th>
                  <th scope="col" className="pb-1 pr-3 font-semibold">
                    {report.program.baselineLabel}
                  </th>
                  <th scope="col" className="pb-1 font-semibold">
                    {report.program.candidateLabel}
                  </th>
                </tr>
              </thead>
              <tbody>
                <StatRow label="Trials" baseline={baseline.rows} candidate={candidate.rows} />
                <StatRow label="Outcomes" baseline={baseline.outcome} candidate={candidate.outcome} />
                <StatRow label="Mean score" baseline={baseline.mean} candidate={candidate.mean} />
                <StatRow label="Mean cost" baseline={baseline.cost} candidate={candidate.cost} />
                <StatRow label="Median latency" baseline={baseline.latency} candidate={candidate.latency} />
                <StatRow label="Human-assisted" baseline={baseline.assistance} candidate={candidate.assistance} />
              </tbody>
            </table>
          </div>
          <dl className="mt-3 grid gap-2 text-sm">
            <div>
              <dt className="font-semibold">Score difference</dt>
              <dd className="text-muted">
                {formatScore(report.effect.scoreGain)} points (minimum effect{" "}
                {report.program.minimumEffect} {CLAIM_UNITS[report.claims.registered]})
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Cost and latency difference</dt>
              <dd className="text-muted">
                {formatPercent(report.effect.costReductionPct)} lower mean cost ·{" "}
                {formatPercent(report.effect.latencyReductionPct)} lower median latency
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Conditions checked</dt>
              <dd className="text-muted">
                within non-inferiority: {report.effect.withinNoninferiority ? "yes" : "no"} ·
                assistance matched: {report.effect.assistanceMatched ? "yes" : "no"} · within
                registered limits: {report.effect.withinLimits ? "yes" : "no"}
              </dd>
            </div>
          </dl>
            </>
          )}
        </section>


        {allFamilies ? (
          <section aria-labelledby="family-set-heading" className={`${cardClass} mt-8`}>
            <h2 id="family-set-heading" className="text-xl font-bold">
              Families in this comparison
            </h2>
            <p className="mt-1 text-sm text-muted">
              Registered with {report.families.length} families and frozen: this comparison runs
              and reports only those, whatever is installed later.
            </p>
            <ul className="mt-2 grid gap-1 text-sm">
              {report.families.map((entry) => (
                <li key={entry.key}>
                  <strong>{familyLabel(entry.key)}</strong> — {entry.key} {entry.version} (
                  {entry.tasks} tasks)
                </li>
              ))}
            </ul>
            <h3 className="mt-4 text-sm font-semibold">
              {laterFamilies.length > 0
                ? "Installed after registration"
                : "Nothing installed since registration"}
            </h3>
            {laterFamilies.length > 0 ? (
              <>
                <p className="mt-1 text-sm text-muted">
                  These families exist now but are not part of this comparison: it records no
                  trials for them and its claim says nothing about them. Register a new comparison
                  to cover them.
                </p>
                <ul className="mt-2 grid gap-1 text-sm">
                  {laterFamilies.map((entry) => (
                    <li key={entry.key}>
                      <strong>{familyLabel(entry.key)}</strong> — {entry.key} {entry.version} (
                      {entry.tasks} tasks, installed {entry.installedAt.slice(0, 10)})
                    </li>
                  ))}
                </ul>
                <Link
                  href={`/workspace/${workspaceId}/performance?scope=all_families&claim=${report.claims.registered}&from=${programId}#register-program`}
                  className="mt-2 inline-block text-sm underline"
                >
                  Register a comparison across every installed family
                </Link>
              </>
            ) : (
              <p className="mt-1 text-sm text-muted">
                Every installed family was part of this comparison when it was registered.
              </p>
            )}
          </section>
        ) : null}

        <section aria-labelledby="protocol-heading" className={`${cardClass} mt-8`}>
          <h2 id="protocol-heading" className="text-xl font-bold">
            What was registered
          </h2>
          <dl className="mt-2 grid gap-2 text-sm">
            {[
              ...distributionRows,
              ["Inclusion rules", report.program.inclusionRules],
              ["Exclusion rules", report.program.exclusionRules],
              ["Scoring method", report.program.scoringMethod],
              ["Baseline", `${report.program.baselineLabel} (${report.program.baselinePolicy})`],
              ["Candidate", `${report.program.candidateLabel} (${report.program.candidatePolicy})`],
              ["Permitted tools", report.program.permittedTools.join(", ")],
              ["Time limit", `${report.program.timeLimitSeconds} seconds per trial`],
              ["Cost limit", `${formatCents(report.program.costLimitCents)} per trial`],
              ["Trials", `${report.program.trials} per task, ${report.plan.expectedRows} rows per configuration`],
              ["Human assistance", report.program.humanAssistancePolicy],
              ["Failure criteria", report.program.failureCriteria],
              ["Fingerprint", report.program.fingerprint ?? "not recorded"],
              ["Registered", report.program.registeredAt ?? "not registered"],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="font-semibold">{label}</dt>
                <dd className="break-words text-muted">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-muted">
            The suite digest is the hash of the twelve authored cases. The migration that installs
            this family stores the same digest, and a trial is refused when the two differ.
          </p>
          <Link
            href={`/workspace/${workspaceId}/performance/${programId}/report`}
            className="mt-3 inline-block text-sm underline"
          >
            Read the reproducible report
          </Link>
        </section>

        <section aria-labelledby="review-heading" className={cardClass + " mt-8"}>
          <h2 id="review-heading" className="text-xl font-bold">
            Independent review
          </h2>
          <p className="mt-1 text-sm text-muted">
            {report.reviews.reviewed} review {report.reviews.reviewed === 1 ? "mark" : "marks"} ·{" "}
            {report.reviews.disagreements} disagree · allowance {report.reviews.maxDisagreements}.
            The person who recorded a trial cannot review it, and the person who registered the
            comparison cannot review any of its trials.
          </p>
          <ReviewTrialForm workspaceId={workspaceId} programId={programId} trials={reviewable} />
        </section>

        <section aria-labelledby="human-heading" className={`${cardClass} mt-8`}>
          <h2 id="human-heading" className="text-xl font-bold">
            Human references
          </h2>
          <p className="mt-1 text-sm text-muted">
            {report.humanReferences.count} documented{" "}
            {report.humanReferences.count === 1 ? "reference" : "references"} covering{" "}
            {report.humanReferences.participants}{" "}
            {report.humanReferences.participants === 1 ? "participant" : "participants"}. These are
            labelled references collected under their own protocol, never a synthesised expert
            baseline, and they are not merged into the machine numbers.
          </p>
          <HumanReferenceForm
            workspaceId={workspaceId}
            programId={programId}
            status={report.program.status}
          />
        </section>
      </main>
    </div>
  );
}
