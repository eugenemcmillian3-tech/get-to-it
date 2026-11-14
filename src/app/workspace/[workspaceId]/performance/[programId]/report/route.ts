import { getSession } from "@/lib/auth";
import {
  listInstalledFamilies,
  readPerformanceReport,
  type PerformanceReport,
} from "@/lib/data/performance-program";
import {
  CLAIM_LABELS,
  CLAIM_UNITS,
  REFUSED_CLAIM_NOTE,
  VERDICT_LABELS,
  familyLabel,
  formatCents,
  formatLatency,
  formatPercent,
  formatScore,
} from "@/lib/performance-program";

/**
 * The reproducible report. Everything in it comes from the registered protocol
 * and the recorded rows, read at request time; nothing is summarised by hand and
 * nothing is stored, so the report cannot say more than the evidence supports.
 */

function line(label: string, value: string): string {
  return `- **${label}:** ${value}`;
}

function statTable(
  baseline: PerformanceReport["baseline"],
  candidate: PerformanceReport["candidate"],
  baselineLabel: string,
  candidateLabel: string,
): string {
  const rows = [
    ["Trials recorded", String(baseline.rows), String(candidate.rows)],
    [
      "Outcomes",
      `${baseline.passes} pass, ${baseline.partials} partial, ${baseline.fails} fail`,
      `${candidate.passes} pass, ${candidate.partials} partial, ${candidate.fails} fail`,
    ],
    ["Mean score", formatScore(baseline.meanScore), formatScore(candidate.meanScore)],
    [
      "Mean cost",
      `${formatCents(baseline.meanCostCents)} (${baseline.meanCostUnits} authored units)`,
      `${formatCents(candidate.meanCostCents)} (${candidate.meanCostUnits} authored units)`,
    ],
    [
      "Median latency",
      formatLatency(baseline.medianDurationMs),
      formatLatency(candidate.medianDurationMs),
    ],
    ["Human-assisted trials", String(baseline.humanAssisted), String(candidate.humanAssisted)],
  ];

  return [
    `| Measure | ${baselineLabel} | ${candidateLabel} |`,
    "| --- | --- | --- |",
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function familyResults(report: PerformanceReport): string {
  return report.families
    .map((entry) => {
      const reasons =
        entry.claim.reasons.length > 0
          ? entry.claim.reasons.map((reason) => `- ${reason}`).join("\n")
          : "- Every registered condition was met for this family.";
      return [
        `### ${familyLabel(entry.key)}`,
        "",
        line("Family", `${entry.key} ${entry.version}`),
        line("Tasks", `${entry.tasks} authored cases: ${entry.taskKeys.join(", ")}`),
        line("Suite digest", entry.suiteDigest),
        "",
        statTable(entry.baseline, entry.candidate, "Family baseline", "Family candidate"),
        "",
        `Score difference: ${formatScore(entry.effect.scoreGain)} points. Cost difference: ${formatPercent(entry.effect.costReductionPct)} lower mean cost. Latency difference: ${formatPercent(entry.effect.latencyReductionPct)} lower median latency.`,
        "",
        `Conditions: within non-inferiority ${entry.effect.withinNoninferiority ? "yes" : "no"}; assistance matched ${entry.effect.assistanceMatched ? "yes" : "no"}; within registered limits ${entry.effect.withinLimits ? "yes" : "no"}.`,
        "",
        `**${VERDICT_LABELS[entry.claim.verdict] ?? entry.claim.verdict}** (${entry.claim.supported ? "supported" : "not supported"} for this family).`,
        "",
        reasons,
      ].join("\n");
    })
    .join("\n\n");
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string; programId: string }> },
) {
  const session = await getSession();
  if (!session) {
    return new Response("Sign in to read this report.", { status: 401 });
  }

  const { workspaceId, programId } = await params;
  const report = await readPerformanceReport(session, programId);
  if (!report || report.program.workspaceId !== workspaceId) {
    return new Response("Not found.", { status: 404 });
  }

  const allFamilies = report.program.scope === "all_families" && report.families.length > 0;
  const installed = await listInstalledFamilies(session);
  const registeredFamilyKeys = new Set(report.families.map((entry) => entry.key));
  const laterFamilies = installed.filter((entry) => !registeredFamilyKeys.has(entry.key));
  const results = allFamilies
    ? `Each family below is reported on its own rows. No pooled score is computed.\n\n${familyResults(report)}`
    : `${statTable(report.baseline, report.candidate, report.program.baselineLabel, report.program.candidateLabel)}\n\nScore difference: ${formatScore(report.effect.scoreGain)} points. Cost difference: ${formatPercent(report.effect.costReductionPct)} lower mean cost. Latency difference: ${formatPercent(report.effect.latencyReductionPct)} lower median latency.\n\nConditions: within non-inferiority ${report.effect.withinNoninferiority ? "yes" : "no"}; assistance matched ${report.effect.assistanceMatched ? "yes" : "no"}; within registered limits ${report.effect.withinLimits ? "yes" : "no"}.`;

  const body = `# ${report.program.title}

Performance program report for workspace \`${workspaceId}\`, generated from the recorded rows at ${new Date().toISOString()}.

## Question

${report.program.question}

## Registered claim

${CLAIM_LABELS[report.claims.registered]}: ${report.program.claimText}

Minimum effect: ${report.program.minimumEffect} ${CLAIM_UNITS[report.claims.registered]}; non-inferiority margin: ${report.program.noninferiorityMargin}. These were fixed at registration, before any trial existed.

## Registered protocol

${allFamilies ? line("Task families", report.families.map((entry) => `${entry.key} ${entry.version}`).join(", ")) : line("Task family", `${report.family.key} ${report.family.version}`)}
${allFamilies ? report.families.map((entry) => line(`Distribution — ${familyLabel(entry.key)}`, `${entry.tasks} authored cases: ${entry.taskKeys.join(", ")}; digest ${entry.suiteDigest}`)).join("\n") : `${line("Family description", report.family.description)}\n${line("Task distribution", `${report.family.taskKeys.length} authored cases: ${report.family.taskKeys.join(", ")}`)}`}
${line("Suite digest", report.family.suiteDigest)}
${line("Inclusion rules", report.program.inclusionRules)}
${line("Exclusion rules", report.program.exclusionRules)}
${line("Scoring method", report.program.scoringMethod)}
${line("Baseline", `${report.program.baselineLabel} (${report.program.baselinePolicy})`)}
${line("Candidate", `${report.program.candidateLabel} (${report.program.candidatePolicy})`)}
${line("Permitted tools", report.program.permittedTools.join(", "))}
${line("Time limit", `${report.program.timeLimitSeconds} seconds per trial`)}
${line("Cost limit", `${formatCents(report.program.costLimitCents)} per trial`)}
${line("Trials", `${report.program.trials} per task; ${report.plan.expectedRows} rows expected per configuration`)}
${line("Human assistance policy", report.program.humanAssistancePolicy)}
${line("Failure criteria", report.program.failureCriteria)}
${allFamilies ? line("Installed after registration", laterFamilies.length > 0 ? laterFamilies.map((entry) => `${entry.key} ${entry.version}`).join(", ") : "none - every installed family is part of this comparison") : ""}
${line("Protocol fingerprint", report.program.fingerprint ?? "not recorded")}
${line("Registered at", report.program.registeredAt ?? "not registered")}
${line("Status", report.program.status)}

## Results

${results}

## Claim verdict

**${VERDICT_LABELS[report.claims.verdict] ?? report.claims.verdict}** (${report.claims.supported ? "supported" : "not supported"}).

${allFamilies ? `${report.families.map((entry) => `- **${familyLabel(entry.key)}:** ${VERDICT_LABELS[entry.claim.verdict] ?? entry.claim.verdict} — ${entry.claim.supported ? "supports" : "does not support"} the claim on its own rows.`).join("\n")}\n\n` : ""}${report.claims.reasons.length > 0 ? report.claims.reasons.map((reason) => `- ${reason}`).join("\n") : "- Every registered condition was met."}

## Claims this report does not support

${report.claims.refused.map((row) => `- **${row.claim.replaceAll("_", " ")}:** ${row.reason}`).join("\n")}
${REFUSED_CLAIM_NOTE}

## Human references

${report.humanReferences.count} documented reference(s) covering ${report.humanReferences.participants} participant(s). Only legitimately collected results with recorded expertise, tool access, working conditions and consent basis are stored; this report never substitutes an invented expert comparison.

## Independent review

${report.reviews.reviewed} review mark(s), ${report.reviews.disagreements} disagreeing, against an allowance of ${report.reviews.maxDisagreements}. The recorder of a trial and the registrar of the protocol cannot mark their own work.

## Limitations

- The family is twelve authored cases over one connector tool policy. It is an authored benchmark, not a sample of a real-world task distribution.
- The suite is deterministic and offline: no model was called, so a repeated trial measures the harness, not run-to-run model variance.
- Measured money cost is zero on both sides because no paid call was made; authored cost units are not a price.
- Latency is not recorded. Any speed comparison is therefore refused rather than estimated.
- Human assistance is recorded per trial; if the candidate needed more help than the baseline, the claim is blocked as confounded.
- These results do not transfer to other task families, other policies, or broader general capability. Nothing here supports an AGI, superintelligence or singularity claim, and this report must not be published as one.

## Reproducing this report

The suite digest is the SHA-256 of the authored case lines \`id:{"tool":...}\` (or \`id:{"refuse":true}\`) joined with newlines, computed by \`suiteDigest()\` in \`src/lib/improvement-eval.ts\`. The migration that installs the family stores the same value, and the runner in \`src/lib/actions/performance-program.ts\` refuses to record a trial when the installed suite and the registered digest differ. Recompute the digest, replay the same cases, then read this page again: every number above is derived from the recorded rows at request time.
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="performance-report-${programId.slice(0, 8)}.md"`,
      "Cache-Control": "private, no-store",
    },
  });
}
