import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type {
  CapabilityRunRecord,
  CapabilityVersionRecord,
} from "@/lib/capability-eval";
import {
  AUTHORITY_AREAS,
  EVIDENCE_LABELS,
  NO_AUTOMATIC_AUTHORITY_NOTE,
  RELEASE_REVIEW_AREAS,
  RESEARCH_AREA,
  authorityExpandsFromScore,
  candidateEvidenceLabel,
  capabilityEvidenceLabel,
  claimTraceProblems,
  classificationFor,
  costLatencyChanges,
  deploymentEvidenceLabel,
  domainStats,
  domainStrengthsAndFailures,
  generalizationSummary,
  humanInterventionRows,
  incidentEvidenceLabel,
  recommendNextExperiment,
  renderableClaims,
  type CapabilityClaim,
} from "@/lib/observatory";

const version = (
  overrides: Partial<CapabilityVersionRecord> = {},
): CapabilityVersionRecord => ({
  id: "version-1",
  eval_id: "eval-1",
  user_id: "user-1",
  label: "Orchestrated v1",
  version: 1,
  baseline_kind: "orchestrated_system",
  model_version: "model-a",
  orchestration_version: "orch-a",
  prompt_version: "prompt-a",
  dataset_version: "dataset-v1",
  scoring_rubric: { weighted: false, weights: {} },
  permitted_tools: [],
  runtime_limit_seconds: 120,
  spend_limit_cents: 50,
  human_assistance: "none",
  autonomy_permission: "none",
  status: "active",
  created_at: "2026-11-01T00:00:00.000Z",
  ...overrides,
});

const run = (overrides: Partial<CapabilityRunRecord> = {}): CapabilityRunRecord => ({
  id: "run-1",
  eval_id: "eval-1",
  version_id: "version-1",
  task_id: "task-1",
  domain: "tool_selection_execution",
  difficulty: "medium",
  split: "validation",
  trial: 1,
  outcome: "verified_success",
  verified_success: true,
  unsupported_claims: 0,
  permission_violations: 0,
  human_interventions: 0,
  recovery_attempts: 0,
  recovery_succeeded: null,
  cost_cents: 10,
  latency_ms: 100,
  failure_category: null,
  scoring_detail: {},
  exposure_count: 1,
  contaminated: false,
  created_at: "2026-11-02T00:00:00.000Z",
  ...overrides,
});

const claim = (overrides: Partial<CapabilityClaim> = {}): CapabilityClaim => ({
  id: "claim-1",
  statement: "Orchestrated v1 verified 3 of 4 recorded tool-selection tasks.",
  label: "tested",
  classification: classificationFor("tested"),
  version: {
    kind: "system_version",
    label: "Orchestrated v1 · model-a",
    href: "/capability-eval/eval-1",
  },
  experiment: {
    kind: "experiment",
    label: "Does the orchestrated system select tools better?",
    href: "/workspace/w/experiments/e1",
  },
  evaluation: { kind: "evaluation", label: "Tool evaluation", href: "/capability-eval/eval-1" },
  evidence: { kind: "evidence", label: "4 recorded runs", href: "/capability-eval/eval-1" },
  releaseDecision: null,
  ...overrides,
});

describe("observatory evidence labels", () => {
  it("uses exactly the eight required labels", () => {
    expect([...EVIDENCE_LABELS].sort()).toEqual(
      [
        "failed",
        "implemented",
        "inconclusive",
        "independently_reviewed",
        "proposed",
        "released",
        "superseded",
        "tested",
      ].sort(),
    );
  });

  it("maps proposal status and verdict to the strongest stage reached", () => {
    expect(candidateEvidenceLabel("draft", null)).toBe("proposed");
    expect(candidateEvidenceLabel("evaluating", null)).toBe("implemented");
    expect(candidateEvidenceLabel("evaluated", "better")).toBe("tested");
    expect(candidateEvidenceLabel("evaluated", "inconclusive")).toBe("inconclusive");
    expect(candidateEvidenceLabel("approved", "better")).toBe("independently_reviewed");
    expect(candidateEvidenceLabel("approved", "inconclusive")).toBe("inconclusive");
    expect(candidateEvidenceLabel("promoted", "better")).toBe("released");
    expect(candidateEvidenceLabel("rejected", "worse")).toBe("failed");
    expect(candidateEvidenceLabel("blocked", null)).toBe("failed");
    expect(candidateEvidenceLabel("cancelled", null)).toBe("superseded");
  });

  it("maps deployment and incident states without inflating them", () => {
    expect(deploymentEvidenceLabel("succeeded")).toBe("released");
    expect(deploymentEvidenceLabel("failed")).toBe("failed");
    expect(deploymentEvidenceLabel("partial_failure")).toBe("failed");
    expect(deploymentEvidenceLabel("deploying")).toBe("implemented");
    expect(deploymentEvidenceLabel("draft")).toBe("proposed");

    expect(incidentEvidenceLabel("diagnosed", false)).toBe("failed");
    expect(incidentEvidenceLabel("resolved", true)).toBe("tested");
    expect(incidentEvidenceLabel("resolved", false)).toBe("inconclusive");
    expect(incidentEvidenceLabel("dismissed", false)).toBe("superseded");
  });

  it("labels capability runs by what they can actually support", () => {
    expect(capabilityEvidenceLabel({ runs: 0, verified: 0, contaminated: 0, reviewed: false })).toBe(
      "proposed",
    );
    expect(capabilityEvidenceLabel({ runs: 3, verified: 0, contaminated: 0, reviewed: false })).toBe(
      "failed",
    );
    expect(capabilityEvidenceLabel({ runs: 3, verified: 2, contaminated: 1, reviewed: false })).toBe(
      "inconclusive",
    );
    expect(capabilityEvidenceLabel({ runs: 3, verified: 2, contaminated: 0, reviewed: true })).toBe(
      "independently_reviewed",
    );
    expect(capabilityEvidenceLabel({ runs: 3, verified: 2, contaminated: 0, reviewed: false })).toBe(
      "tested",
    );
  });
});

describe("observatory claim tracing", () => {
  it("accepts a claim with all required links", () => {
    expect(claimTraceProblems(claim())).toEqual([]);
    expect(renderableClaims([claim()])).toHaveLength(1);
  });

  it("rejects a claim that cannot reach its version, evaluation or evidence", () => {
    expect(
      claimTraceProblems(claim({ version: { ...claim().version, href: "" } })),
    ).toContain("Missing a link to the exact system version.");
    expect(
      claimTraceProblems(claim({ evaluation: { ...claim().evaluation, href: "" } })),
    ).toContain("Missing a link to the experiment or evaluation.");
    expect(
      claimTraceProblems(claim({ evidence: { ...claim().evidence, href: "" } })),
    ).toContain("Missing a link to the underlying evidence.");
    expect(renderableClaims([claim({ evaluation: { ...claim().evaluation, href: "" } })])).toEqual(
      [],
    );
  });

  it("refuses a released claim without a human release decision", () => {
    const released = claim({
      label: "released",
      classification: classificationFor("released"),
    });
    expect(claimTraceProblems(released)).toContain(
      "A released claim needs a recorded human release decision.",
    );
    expect(
      claimTraceProblems({
        ...released,
        releaseDecision: {
          kind: "release_decision",
          label: "Deployment approved 12 Nov 2026",
          href: "/build/p/deploy",
        },
      }),
    ).toEqual([]);
  });

  it("refuses a general-intelligence or singularity phrase in a capability claim", () => {
    expect(
      claimTraceProblems(
        claim({ statement: "The orchestrated system achieved AGI on this dataset." }),
      ),
    ).toContain("A capability claim cannot use a general-intelligence or singularity phrase.");
    expect(
      claimTraceProblems(
        claim({ statement: "This run is evidence of a technological singularity." }),
      ),
    ).toContain("A capability claim cannot use a general-intelligence or singularity phrase.");
  });

  it("keeps classification tied to the evidence label", () => {
    expect(
      claimTraceProblems(claim({ label: "tested", classification: "demonstrated" })),
    ).toContain("The claim classification does not match its evidence label.");
    expect(classificationFor("released")).toBe("demonstrated");
    expect(classificationFor("independently_reviewed")).toBe("demonstrated");
    expect(classificationFor("tested")).toBe("experimental");
    expect(classificationFor("inconclusive")).toBe("experimental");
    expect(classificationFor("failed")).toBe("unsupported");
  });
});

describe("observatory results", () => {
  it("summarises each domain separately and names its most common failure", () => {
    const runs = [
      run({ id: "1", domain: "tool_selection_execution" }),
      run({ id: "2", domain: "tool_selection_execution", verified_success: false, outcome: "failed", failure_category: "wrong_tool" }),
      run({ id: "3", domain: "tool_selection_execution", verified_success: false, outcome: "failed", failure_category: "wrong_tool" }),
      run({ id: "4", domain: "error_recovery" }),
      run({ id: "5", domain: "error_recovery" }),
      run({ id: "6", domain: "error_recovery", verified_success: false, outcome: "errored", cost_cents: 30, latency_ms: 300 }),
    ];

    const stats = domainStats(runs);
    expect(stats).toHaveLength(2);
    const tool = stats.find((stat) => stat.domain === "tool_selection_execution")!;
    expect(tool.trials).toBe(3);
    expect(tool.verified).toBe(1);
    expect(tool.verifiedRate).toBeCloseTo(1 / 3);
    expect(tool.topFailure).toBe("wrong_tool");

    const recovery = stats.find((stat) => stat.domain === "error_recovery")!;
    expect(recovery.verified).toBe(2);
    expect(recovery.errored).toBe(1);
    expect(recovery.averageCostCents).toBeCloseTo((10 + 10 + 30) / 3);
    expect(recovery.averageLatencyMs).toBeCloseTo((100 + 100 + 300) / 3);

    const { strengths, failures } = domainStrengthsAndFailures(stats);
    expect(strengths[0].domain).toBe("error_recovery");
    expect(failures[0].domain).toBe("tool_selection_execution");
  });

  it("separates splits and refuses a generalization claim on held-out evidence that does not exist", () => {
    const none = generalizationSummary([run({ split: "validation" }), run({ split: "development" })]);
    expect(none.status).toBe("no_held_out_evidence");
    expect(none.heldOutTrials).toBe(0);
    expect(none.note).toContain("cannot say how a result generalizes");

    const contaminated = generalizationSummary([
      run({ split: "held_out", contaminated: true }),
      run({ split: "held_out" }),
    ]);
    expect(contaminated.status).toBe("contaminated");
    expect(contaminated.heldOutContaminated).toBe(1);
    expect(contaminated.note).toContain("cannot support a generalization claim");

    const measured = generalizationSummary([
      run({ split: "held_out" }),
      run({ split: "held_out", verified_success: false, outcome: "failed" }),
      run({ split: "held_out" }),
      run({ split: "held_out" }),
    ]);
    expect(measured.status).toBe("measured");
    expect(measured.rows.find((row) => row.split === "held_out")!.verifiedRate).toBe(0.75);
  });

  it("compares cost and latency only between measured versions of the same configuration", () => {
    const versions = [
      version(),
      version({ id: "version-2", version: 2, label: "Orchestrated v2" }),
      version({ id: "baseline-1", version: 1, label: "Baseline v1", baseline_kind: "single_model_baseline" }),
    ];
    const runs = [
      run({ id: "a", version_id: "version-1", cost_cents: 10, latency_ms: 100 }),
      run({ id: "b", version_id: "version-1", cost_cents: 20, latency_ms: 200 }),
      run({ id: "c", version_id: "version-2", cost_cents: 30, latency_ms: 300 }),
      run({ id: "d", version_id: "version-2", cost_cents: 30, latency_ms: 300 }),
      run({ id: "e", version_id: "baseline-1", cost_cents: 99, latency_ms: 999 }),
    ];

    const changes = costLatencyChanges(versions, runs);
    expect(changes).toHaveLength(1);
    expect(changes[0].baselineKind).toBe("orchestrated_system");
    expect(changes[0].fromLabel).toBe("Orchestrated v1");
    expect(changes[0].toLabel).toBe("Orchestrated v2");
    expect(changes[0].costDeltaPct).toBeCloseTo(100);
    expect(changes[0].latencyDeltaPct).toBeCloseTo(100);
    expect(changes[0].note).toContain("does not price future work");
  });

  it("shows where a person had to intervene", () => {
    const rows = humanInterventionRows(
      [version({ human_assistance: "hints" }), version({ id: "version-2", label: "No help" })],
      [
        run({ human_interventions: 2 }),
        run({ id: "run-2", human_interventions: 1 }),
        run({ id: "run-3", version_id: "version-2" }),
      ],
    );
    expect(rows[0]).toMatchObject({
      versionLabel: "Orchestrated v1",
      assistance: "hints",
      runs: 2,
      runsWithIntervention: 2,
      interventions: 3,
    });
    expect(rows[1]).toMatchObject({ versionLabel: "No help", runs: 1, interventions: 0 });
  });
});

describe("observatory boundaries", () => {
  it("lists every authority a score cannot widen", () => {
    expect(AUTHORITY_AREAS.map((area) => area.id)).toEqual([
      "spending",
      "tools",
      "data",
      "deployment",
      "publication",
      "oversight",
    ]);
    for (const phrase of [
      "spending",
      "tool access",
      "data access",
      "production deployment",
      "external publication",
      "human oversight",
    ]) {
      expect(NO_AUTOMATIC_AUTHORITY_NOTE.toLowerCase()).toContain(phrase);
    }
    expect(authorityExpandsFromScore()).toBe(false);
  });

  it("labels the singularity area as research and denies having achieved it", () => {
    expect(RESEARCH_AREA.name).toBe("Singularity research");
    expect(RESEARCH_AREA.scope).toContain("clearly labelled research area");
    expect(RESEARCH_AREA.disclaimer).toContain(
      "does not claim that a technological singularity has occurred",
    );
    expect(RESEARCH_AREA.disclaimer).toContain("caused or achieved by this platform");
  });

  it("reviews all eleven release areas with a stated basis", () => {
    expect(RELEASE_REVIEW_AREAS.map((area) => area.id)).toEqual([
      "tenant_isolation",
      "consent_enforcement",
      "approval_binding",
      "budget_enforcement",
      "credit_accounting",
      "evidence_provenance",
      "evaluation_integrity",
      "cancellation",
      "auditability",
      "rollback_readiness",
      "claim_accuracy",
    ]);
    for (const area of RELEASE_REVIEW_AREAS) {
      expect(area.requirement.length).toBeGreaterThan(20);
      expect(area.basis.length).toBeGreaterThan(20);
      expect(["holds", "holds_with_limits", "open"]).toContain(area.state);
    }
  });

  it("recommends the smallest next experiment the evidence needs", () => {
    const base = {
      linkedEvaluations: 1,
      heldOutTrials: 4,
      contaminatedHeldOut: 0,
      independentlyReviewed: 1,
      measuredPromotions: 1,
      openQuestions: 0,
    };
    expect(
      recommendNextExperiment({ ...base, linkedEvaluations: 0 }).title,
    ).toContain("Link one capability evaluation");
    expect(
      recommendNextExperiment({ ...base, contaminatedHeldOut: 2 }).title,
    ).toContain("dataset version the configuration has not seen");
    expect(
      recommendNextExperiment({ ...base, independentlyReviewed: 0 }).title,
    ).toContain("independently review");
    expect(
      recommendNextExperiment({ ...base, measuredPromotions: 0 }).title,
    ).toContain("improvement candidate");
    expect(
      recommendNextExperiment({ ...base, openQuestions: 2 }).title,
    ).toContain("open research question");
    expect(recommendNextExperiment(base).title).toContain("fresh held-out split");
    expect(recommendNextExperiment(base).label).toBe("proposed");
  });

  it("keeps the page and its loader read-only", () => {
    const page = readFileSync(
      path.join(
        process.cwd(),
        "src/app/workspace/[workspaceId]/observatory/page.tsx",
      ),
      "utf8",
    );
    const loader = readFileSync(
      path.join(process.cwd(), "src/lib/data/observatory.ts"),
      "utf8",
    );

    expect(page).toContain("renderableClaims(");
    expect(page).toContain("claim.releaseDecision");
    expect(page).toContain("claim.version.href");
    expect(page).not.toContain("<form");
    expect(page).not.toContain("action=");
    expect(loader).not.toContain(".insert(");
    expect(loader).not.toContain(".update(");
    expect(loader).not.toContain(".delete(");
    expect(loader).not.toContain(".rpc(");
  });
});
