/**
 * Phase 42 — the research observatory.
 *
 * Pure logic only. It reads the records that earlier phases already keep
 * (capability runs, improvement proposals, deployments, incidents, research
 * missions) and describes them without creating a new source of truth, a
 * combined score, or any authority. Nothing here deploys, spends, publishes or
 * widens a permission.
 */

import {
  CAPABILITY_DOMAINS,
  CAPABILITY_DOMAIN_LABELS,
  CAPABILITY_SPLIT_LABELS,
  type CapabilityDomain,
  type CapabilityRunRecord,
  type CapabilitySplit,
  type CapabilityVersionRecord,
} from "@/lib/capability-eval";
import type { CandidateStatus, Verdict } from "@/lib/improvement-candidates";
import { bannedClaimPhrase } from "@/lib/performance-program";

/* -------------------------------------------------------------------------- */
/* Evidence labels                                                            */
/* -------------------------------------------------------------------------- */

export const EVIDENCE_LABELS = [
  "proposed",
  "implemented",
  "tested",
  "independently_reviewed",
  "released",
  "inconclusive",
  "failed",
  "superseded",
] as const;

export type EvidenceLabel = (typeof EVIDENCE_LABELS)[number];

export const EVIDENCE_LABEL_INFO: Record<
  EvidenceLabel,
  { label: string; meaning: string }
> = {
  proposed: {
    label: "Proposed",
    meaning: "A written proposal or hypothesis exists. Nothing has been run against it yet.",
  },
  implemented: {
    label: "Implemented",
    meaning: "A change exists in a branch, sandbox or candidate record. It has no measured result yet.",
  },
  tested: {
    label: "Tested",
    meaning: "A measured run exists and its numbers are recorded, but no independent review has signed it off.",
  },
  independently_reviewed: {
    label: "Independently reviewed",
    meaning: "A person other than the author reviewed the measured evidence and recorded the review.",
  },
  released: {
    label: "Released",
    meaning: "A named person approved the release and the promoted change or deployment is recorded as live.",
  },
  inconclusive: {
    label: "Inconclusive",
    meaning: "Evidence exists but cannot support a verdict: contaminated held-out runs, an inconclusive comparison, or a recovery with no confirmed cause.",
  },
  failed: {
    label: "Failed",
    meaning: "The measurement or the change failed, was rejected, or an incident is still open.",
  },
  superseded: {
    label: "Superseded",
    meaning: "A later version, release or decision replaced this one. The older record stays readable.",
  },
};

/* -------------------------------------------------------------------------- */
/* Claim tracing                                                              */
/* -------------------------------------------------------------------------- */

export const CLAIM_CLASSIFICATIONS = [
  "demonstrated",
  "experimental",
  "unsupported",
] as const;
export type ClaimClassification = (typeof CLAIM_CLASSIFICATIONS)[number];

export type EvidenceRefKind =
  | "system_version"
  | "experiment"
  | "evaluation"
  | "evidence"
  | "release_decision";

export type EvidenceRef = {
  kind: EvidenceRefKind;
  label: string;
  /** An in-app path. Empty when the record genuinely has no destination. */
  href: string;
};

export type CapabilityClaim = {
  id: string;
  statement: string;
  label: EvidenceLabel;
  classification: ClaimClassification;
  version: EvidenceRef;
  experiment: EvidenceRef | null;
  evaluation: EvidenceRef;
  evidence: EvidenceRef;
  releaseDecision: EvidenceRef | null;
};

export function classificationFor(label: EvidenceLabel): ClaimClassification {
  switch (label) {
    case "released":
    case "independently_reviewed":
      return "demonstrated";
    case "tested":
    case "implemented":
    case "proposed":
    case "inconclusive":
      return "experimental";
    case "failed":
    case "superseded":
      return "unsupported";
  }
}

/**
 * A displayed claim must be traceable to the exact version, the experiment or
 * evaluation, the evidence underneath, and the human release decision. The page
 * renders only claims with no problems, so a missing link hides the claim.
 */
export function claimTraceProblems(claim: CapabilityClaim): string[] {
  const problems: string[] = [];

  if (claim.statement.trim().length < 12) {
    problems.push("The claim statement is too short to be checkable.");
  }
  if (bannedClaimPhrase(claim.statement) || /singularity/i.test(claim.statement)) {
    problems.push(
      "A capability claim cannot use a general-intelligence or singularity phrase.",
    );
  }
  if (claim.version.kind !== "system_version" || !claim.version.href) {
    problems.push("Missing a link to the exact system version.");
  }
  if (claim.evaluation.kind !== "evaluation" || !claim.evaluation.href) {
    problems.push("Missing a link to the experiment or evaluation.");
  }
  if (claim.evidence.kind !== "evidence" || !claim.evidence.href) {
    problems.push("Missing a link to the underlying evidence.");
  }
  if (claim.releaseDecision && claim.releaseDecision.kind !== "release_decision") {
    problems.push("The release decision is linked with the wrong record kind.");
  }
  if (claim.label === "released" && !claim.releaseDecision?.href) {
    problems.push("A released claim needs a recorded human release decision.");
  }
  if (claim.classification !== classificationFor(claim.label)) {
    problems.push("The claim classification does not match its evidence label.");
  }

  return problems;
}

/** Only traceable claims reach the page. */
export function renderableClaims(claims: CapabilityClaim[]): CapabilityClaim[] {
  return claims.filter((claim) => claimTraceProblems(claim).length === 0);
}

export type CapabilityClaimSource = {
  id: string;
  name: string;
  datasetVersion: string;
  linkedExperimentId: string;
  experimentQuestion: string;
  versions: CapabilityVersionRecord[];
  runs: CapabilityRunRecord[];
  reviews: { versionId: string; reviewedAt: string | null }[];
};

/**
 * One claim per measured version. A version carries the independently-reviewed
 * label only when a completed review exists for that exact version; a review of
 * another version, or a proposal review, never counts.
 */
export function buildCapabilityClaims(
  source: CapabilityClaimSource,
  workspaceId: string,
): CapabilityClaim[] {
  const reviewed = new Set(
    source.reviews
      .filter((review) => review.reviewedAt !== null)
      .map((review) => review.versionId),
  );
  const claims: CapabilityClaim[] = [];
  for (const version of source.versions) {
    const runs = source.runs.filter((run) => run.version_id === version.id);
    if (runs.length === 0) continue;
    const verified = runs.filter((run) => run.verified_success).length;
    const contaminated = runs.filter((run) => run.contaminated).length;
    const domains = new Set(runs.map((run) => run.domain)).size;
    const label = capabilityEvidenceLabel({
      runs: runs.length,
      verified,
      contaminated,
      reviewed: reviewed.has(version.id),
    });
    claims.push({
      id: `${source.id}:${version.id}`,
      statement: `${version.label} verified ${verified} of ${runs.length} recorded tasks across ${domains} ${
        domains === 1 ? "domain" : "domains"
      } in ${source.datasetVersion}.`,
      label,
      classification: classificationFor(label),
      version: {
        kind: "system_version",
        label: `${version.label} · model ${version.model_version} · prompt ${version.prompt_version}`,
        href: `/capability-eval/${source.id}`,
      },
      experiment: {
        kind: "experiment",
        label: source.experimentQuestion,
        href: `/workspace/${workspaceId}/experiments/${source.linkedExperimentId}`,
      },
      evaluation: {
        kind: "evaluation",
        label: source.name,
        href: `/capability-eval/${source.id}`,
      },
      evidence: {
        kind: "evidence",
        label: `${runs.length} recorded ${runs.length === 1 ? "run" : "runs"}, ${contaminated} contaminated`,
        href: `/capability-eval/${source.id}`,
      },
      releaseDecision: null,
    });
  }
  return claims;
}

/* -------------------------------------------------------------------------- */
/* Evidence labels for existing records                                       */
/* -------------------------------------------------------------------------- */

export function candidateEvidenceLabel(
  status: CandidateStatus,
  verdict: Verdict | null,
): EvidenceLabel {
  switch (status) {
    case "draft":
      return "proposed";
    case "evaluating":
      return "implemented";
    case "evaluated":
      if (verdict === null) return "tested";
      return verdict === "inconclusive" ? "inconclusive" : "tested";
    case "approved":
      return verdict === "inconclusive" ? "inconclusive" : "independently_reviewed";
    case "promoted":
      return "released";
    case "rejected":
    case "blocked":
      return "failed";
    case "cancelled":
      return "superseded";
  }
}

export function deploymentEvidenceLabel(status: string): EvidenceLabel {
  switch (status) {
    case "succeeded":
      return "released";
    case "failed":
    case "partial_failure":
      return "failed";
    case "draft":
    case "checks_ready":
    case "approved":
      return "proposed";
    default:
      return "implemented";
  }
}

export function incidentEvidenceLabel(status: string, rootCauseConfirmed: boolean): EvidenceLabel {
  if (status === "resolved") return rootCauseConfirmed ? "tested" : "inconclusive";
  if (status === "dismissed") return "superseded";
  return "failed";
}

export function capabilityEvidenceLabel(input: {
  runs: number;
  verified: number;
  contaminated: number;
  reviewed: boolean;
}): EvidenceLabel {
  if (input.runs === 0) return "proposed";
  if (input.verified === 0) return "failed";
  if (input.contaminated > 0) return "inconclusive";
  return input.reviewed ? "independently_reviewed" : "tested";
}

/* -------------------------------------------------------------------------- */
/* Domain results, generalization, cost and human involvement                 */
/* -------------------------------------------------------------------------- */

export type DomainStat = {
  domain: CapabilityDomain;
  label: string;
  trials: number;
  verified: number;
  partial: number;
  failed: number;
  errored: number;
  verifiedRate: number;
  unsupportedClaims: number;
  permissionViolations: number;
  humanInterventions: number;
  averageCostCents: number;
  averageLatencyMs: number;
  contaminated: number;
  topFailure: string | null;
};

export function domainStats(runs: CapabilityRunRecord[]): DomainStat[] {
  return CAPABILITY_DOMAINS.map(({ id, label }) => {
    const domainRuns = runs.filter((run) => run.domain === id);
    const verified = domainRuns.filter((run) => run.verified_success).length;
    const failures = new Map<string, number>();
    for (const run of domainRuns) {
      if (run.verified_success || !run.failure_category) continue;
      failures.set(run.failure_category, (failures.get(run.failure_category) ?? 0) + 1);
    }
    const topFailure =
      [...failures.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return {
      domain: id,
      label,
      trials: domainRuns.length,
      verified,
      partial: domainRuns.filter((run) => run.outcome === "partial_success").length,
      failed: domainRuns.filter((run) => run.outcome === "failed").length,
      errored: domainRuns.filter((run) => run.outcome === "errored").length,
      verifiedRate: domainRuns.length === 0 ? 0 : verified / domainRuns.length,
      unsupportedClaims: domainRuns.reduce((sum, run) => sum + run.unsupported_claims, 0),
      permissionViolations: domainRuns.reduce(
        (sum, run) => sum + run.permission_violations,
        0,
      ),
      humanInterventions: domainRuns.reduce((sum, run) => sum + run.human_interventions, 0),
      averageCostCents:
        domainRuns.length === 0
          ? 0
          : domainRuns.reduce((sum, run) => sum + run.cost_cents, 0) / domainRuns.length,
      averageLatencyMs:
        domainRuns.length === 0
          ? 0
          : domainRuns.reduce((sum, run) => sum + run.latency_ms, 0) / domainRuns.length,
      contaminated: domainRuns.filter((run) => run.contaminated).length,
      topFailure,
    };
  }).filter((stat) => stat.trials > 0);
}

export function domainStrengthsAndFailures(stats: DomainStat[]): {
  strengths: DomainStat[];
  failures: DomainStat[];
} {
  const measured = stats.filter((stat) => stat.trials > 0);
  const strengths = [...measured]
    .filter((stat) => stat.verified > 0)
    .sort((a, b) => b.verifiedRate - a.verifiedRate || b.trials - a.trials)
    .slice(0, 3);
  const failures = [...measured]
    .filter((stat) => stat.verified < stat.trials)
    .sort((a, b) => a.verifiedRate - b.verifiedRate || b.trials - a.trials)
    .slice(0, 3);
  return { strengths, failures };
}

export type SplitStat = {
  split: CapabilitySplit;
  label: string;
  trials: number;
  verified: number;
  verifiedRate: number;
  contaminated: number;
};

export type GeneralizationSummary = {
  rows: SplitStat[];
  heldOutTrials: number;
  heldOutContaminated: number;
  status: "measured" | "contaminated" | "no_held_out_evidence";
  note: string;
};

export function generalizationSummary(runs: CapabilityRunRecord[]): GeneralizationSummary {
  const rows = (["development", "validation", "held_out"] as const).map((split) => {
    const splitRuns = runs.filter((run) => run.split === split);
    const verified = splitRuns.filter((run) => run.verified_success).length;
    return {
      split,
      label: CAPABILITY_SPLIT_LABELS[split],
      trials: splitRuns.length,
      verified,
      verifiedRate: splitRuns.length === 0 ? 0 : verified / splitRuns.length,
      contaminated: splitRuns.filter((run) => run.contaminated).length,
    };
  });
  const heldOut = rows.find((row) => row.split === "held_out")!;
  const status: GeneralizationSummary["status"] =
    heldOut.trials === 0
      ? "no_held_out_evidence"
      : heldOut.contaminated > 0
        ? "contaminated"
        : "measured";
  const note =
    status === "no_held_out_evidence"
      ? "No held-out runs are recorded, so this evidence cannot say how a result generalizes."
      : status === "contaminated"
        ? "At least one held-out task was exposed to the same configuration more than once; contaminated runs are reported separately and cannot support a generalization claim."
        : "Held-out runs are uncontaminated. They still describe only the authored tasks in this dataset version.";
  return {
    rows,
    heldOutTrials: heldOut.trials,
    heldOutContaminated: heldOut.contaminated,
    status,
    note,
  };
}

export type VersionRunStat = {
  versionId: string;
  label: string;
  version: number;
  baselineKind: string;
  runs: number;
  averageCostCents: number;
  averageLatencyMs: number;
};

export function versionRunStats(
  versions: CapabilityVersionRecord[],
  runs: CapabilityRunRecord[],
): VersionRunStat[] {
  return versions
    .map((version) => {
      const versionRuns = runs.filter((run) => run.version_id === version.id);
      return {
        versionId: version.id,
        label: version.label,
        version: version.version,
        baselineKind: version.baseline_kind,
        runs: versionRuns.length,
        averageCostCents:
          versionRuns.length === 0
            ? 0
            : versionRuns.reduce((sum, run) => sum + run.cost_cents, 0) / versionRuns.length,
        averageLatencyMs:
          versionRuns.length === 0
            ? 0
            : versionRuns.reduce((sum, run) => sum + run.latency_ms, 0) / versionRuns.length,
      };
    })
    .sort((a, b) => a.version - b.version);
}

export type CostLatencyChange = {
  baselineKind: string;
  fromLabel: string;
  toLabel: string;
  fromRuns: number;
  toRuns: number;
  costDeltaPct: number | null;
  latencyDeltaPct: number | null;
  note: string;
};

function percentChange(from: number, to: number): number | null {
  if (from <= 0) return null;
  return ((to - from) / from) * 100;
}

export function costLatencyChanges(
  versions: CapabilityVersionRecord[],
  runs: CapabilityRunRecord[],
): CostLatencyChange[] {
  const stats = versionRunStats(versions, runs);
  const kinds = [...new Set(stats.map((stat) => stat.baselineKind))];
  const changes: CostLatencyChange[] = [];
  for (const kind of kinds) {
    const measured = stats.filter((stat) => stat.baselineKind === kind && stat.runs > 0);
    if (measured.length < 2) continue;
    const from = measured[measured.length - 2];
    const to = measured[measured.length - 1];
    changes.push({
      baselineKind: kind,
      fromLabel: from.label,
      toLabel: to.label,
      fromRuns: from.runs,
      toRuns: to.runs,
      costDeltaPct: percentChange(from.averageCostCents, to.averageCostCents),
      latencyDeltaPct: percentChange(from.averageLatencyMs, to.averageLatencyMs),
      note:
        "Averages over recorded runs only. A change here describes this dataset and these runs; it does not price future work or widen a spend limit.",
    });
  }
  return changes;
}

export type HumanInterventionRow = {
  versionLabel: string;
  assistance: string;
  permission: string;
  runs: number;
  runsWithIntervention: number;
  interventions: number;
};

export function humanInterventionRows(
  versions: CapabilityVersionRecord[],
  runs: CapabilityRunRecord[],
): HumanInterventionRow[] {
  return versions.map((version) => {
    const versionRuns = runs.filter((run) => run.version_id === version.id);
    const interventions = versionRuns.reduce((sum, run) => sum + run.human_interventions, 0);
    return {
      versionLabel: version.label,
      assistance: version.human_assistance,
      runs: versionRuns.length,
      runsWithIntervention: versionRuns.filter((run) => run.human_interventions > 0).length,
      interventions,
      permission: version.autonomy_permission,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Authority                                                                  */
/* -------------------------------------------------------------------------- */

export const AUTHORITY_AREAS = [
  { id: "spending", label: "Spending limits" },
  { id: "tools", label: "Tool access" },
  { id: "data", label: "Data access" },
  { id: "deployment", label: "Production deployment" },
  { id: "publication", label: "External publication" },
  { id: "oversight", label: "Human oversight" },
] as const;

export type AuthorityArea = (typeof AUTHORITY_AREAS)[number]["id"];

export const NO_AUTOMATIC_AUTHORITY_NOTE =
  "A better score changes only what the recorded evidence supports. It never changes what the system is allowed to do. Spending, tool access, data access, production deployment, external publication and the level of human oversight each need their own written approval by a person, and none of them is derived from a capability result.";

/**
 * The guard the review checks for: there is no code path from a measurement to
 * an authority. This always returns false and exists so a test can pin it.
 */
export function authorityExpandsFromScore(): false {
  return false;
}

/* -------------------------------------------------------------------------- */
/* Research area naming                                                       */
/* -------------------------------------------------------------------------- */

export const RESEARCH_AREA = {
  name: "Singularity research",
  scope:
    "A clearly labelled research area. The label names a question this work studies: whether long-run, self-improving capability change is measurable and governable. It is not a description of what the platform has done.",
  disclaimer:
    "This observatory does not claim that a technological singularity has occurred, is occurring, or was caused or achieved by this platform. No record here is evidence of one, and no result here grants the platform more autonomy.",
} as const;

/* -------------------------------------------------------------------------- */
/* Release review                                                             */
/* -------------------------------------------------------------------------- */

export type ReleaseReviewState = "holds" | "holds_with_limits" | "open";

export type ReleaseReviewArea = {
  id: string;
  label: string;
  requirement: string;
  basis: string;
  state: ReleaseReviewState;
};

export const RELEASE_REVIEW_AREAS: ReleaseReviewArea[] = [
  {
    id: "tenant_isolation",
    label: "Tenant isolation",
    requirement:
      "A workspace member sees only the records their workspace membership and row policies allow.",
    basis:
      "Every observatory read is workspace-scoped, and capability evaluations stay owner-scoped under their existing policies. The page adds no query that selects across workspaces.",
    state: "holds",
  },
  {
    id: "consent_enforcement",
    label: "Consent enforcement",
    requirement:
      "Connector and integration actions still require the consent that was recorded for them.",
    basis:
      "The observatory is read-only and performs no external action, so it neither needs nor grants a new consent. Connector consent remains enforced by the existing integration records.",
    state: "holds_with_limits",
  },
  {
    id: "approval_binding",
    label: "Approval binding",
    requirement:
      "An approval names the exact contract, candidate or deployment it covers.",
    basis:
      "Orchestration contract approvals bind a fingerprint, promotion requires a measured evaluation and a different reviewer, and a deployment carries its own approval time.",
    state: "holds",
  },
  {
    id: "budget_enforcement",
    label: "Budget enforcement",
    requirement:
      "Work cannot exceed the spend, time or retry limits recorded for it.",
    basis:
      "Orchestration reserves credits per task, capability versions carry runtime and spend limits, and research missions carry a spend ceiling. The observatory reads those limits and cannot change them.",
    state: "holds",
  },
  {
    id: "credit_accounting",
    label: "Credit accounting",
    requirement: "Reserved credits settle against what was actually used.",
    basis:
      "Reservations and settlements are recorded in the existing credit ledger; the observatory displays no balance of its own and moves no credits.",
    state: "holds",
  },
  {
    id: "evidence_provenance",
    label: "Evidence provenance",
    requirement:
      "Every displayed result points at the record that produced it, not at a summary.",
    basis:
      "Claims require a version, evaluation and evidence link; capability runs are append-only; research findings carry source provenance.",
    state: "holds",
  },
  {
    id: "evaluation_integrity",
    label: "Evaluation integrity",
    requirement:
      "Held-out keys stay server-side, verdicts are re-derived from numbers, and repeated exposure is disclosed.",
    basis:
      "Answer keys have no client policy, promotion verdicts are computed in SQL, and repeated held-out exposure is flagged as contamination.",
    state: "holds",
  },
  {
    id: "cancellation",
    label: "Cancellation behavior",
    requirement: "Cancelled work stops and does not continue downstream.",
    basis:
      "Orchestration cancellation propagates through recorded dependencies. Phase 42 adds no execution surface of its own, so it has nothing separate to cancel.",
    state: "holds_with_limits",
  },
  {
    id: "auditability",
    label: "Auditability",
    requirement:
      "Material actions leave an append-only record a reviewer can follow.",
    basis:
      "Improvement events, orchestration events, deployment events and incident events are append-only; refusals are recorded as boundary blocks.",
    state: "holds",
  },
  {
    id: "rollback_readiness",
    label: "Rollback readiness",
    requirement:
      "A release records what a rollback can and cannot reverse, and a rollback needs its own approval.",
    basis:
      "Releases record rollback limitations, recovery requires a human approval, and automatic rollback is off by default. Rollback is not automatic here either.",
    state: "holds_with_limits",
  },
  {
    id: "claim_accuracy",
    label: "Accuracy of customer-facing claims",
    requirement:
      "No page claims a capability the evidence does not support, and no page claims general intelligence.",
    basis:
      "Results stay per domain, split and version; there is no single score; general-intelligence phrases are refused; every displayed claim is traceable or hidden.",
    state: "holds",
  },
];

/* -------------------------------------------------------------------------- */
/* Deliverables                                                               */
/* -------------------------------------------------------------------------- */

export type NextExperiment = {
  title: string;
  rationale: string;
  boundedBy: string;
  label: EvidenceLabel;
};

export function recommendNextExperiment(input: {
  linkedEvaluations: number;
  heldOutTrials: number;
  contaminatedHeldOut: number;
  independentlyReviewed: number;
  measuredPromotions: number;
  openQuestions: number;
}): NextExperiment {
  if (input.linkedEvaluations === 0) {
    return {
      title: "Link one capability evaluation to an experiment in this workspace",
      rationale:
        "The observatory has no capability evidence it can trace inside this workspace yet. A linked evaluation supplies a version, a dataset and runs.",
      boundedBy:
        "One existing evaluation and one experiment. No new model call, spend or permission.",
      label: "proposed",
    };
  }
  if (input.contaminatedHeldOut > 0) {
    return {
      title: "Repeat the held-out comparison on a dataset version the configuration has not seen",
      rationale:
        "At least one held-out task was exposed more than once to the same configuration. Contaminated runs cannot support a generalization claim.",
      boundedBy:
        "One fresh dataset version, the recorded runtime and spend limits, and the same protocol.",
      label: "proposed",
    };
  }
  if (input.independentlyReviewed === 0) {
    return {
      title: "Have a second person independently review the latest measured version",
      rationale:
        "The runs exist, but no reviewer other than the author has signed off on them.",
      boundedBy: "One review of existing evidence. No new runs and no release.",
      label: "proposed",
    };
  }
  if (input.measuredPromotions === 0) {
    return {
      title: "Evaluate one bounded improvement candidate against its recorded baseline",
      rationale:
        "No promoted change has a measured better-or-equal verdict in this workspace yet.",
      boundedBy:
        "One candidate, its frozen evaluation criteria, and the existing spend and runtime limits.",
      label: "proposed",
    };
  }
  if (input.openQuestions > 0) {
    return {
      title: "Turn the strongest open research question into one bounded experiment",
      rationale:
        "A recorded question with no experiment leaves the evidence incomplete.",
      boundedBy:
        "One mission question, one experiment record and its declared budget.",
      label: "proposed",
    };
  }
  return {
    title: "Repeat the strongest comparison against a fresh held-out split",
    rationale:
      "The current evidence is reviewed and promoted; the next useful step is checking it still holds on unseen tasks.",
    boundedBy:
      "One new dataset version and the existing limits. No change to authority.",
    label: "proposed",
  };
}

export const OBSERVATORY_LIMITS = {
  maxEvaluations: 8,
  maxVersionsPerEvaluation: 8,
  maxRunsPerEvaluation: 120,
  maxMissions: 20,
  maxDeployments: 30,
  maxIncidents: 30,
  maxReleases: 20,
} as const;

export function domainLabel(domain: string): string {
  return CAPABILITY_DOMAIN_LABELS[domain as CapabilityDomain] ?? domain;
}
