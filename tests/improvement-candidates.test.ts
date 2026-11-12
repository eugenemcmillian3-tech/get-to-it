import { describe, expect, it } from "vitest";
import {
  CANDIDATE_KINDS,
  PROTECTED_AUTHORITIES,
  authorityProblem,
  candidateProblems,
  compareEvaluation,
  criteriaHash,
  promotionProblems,
  requestedAuthorityProblems,
  type CandidateDraft,
} from "@/lib/improvement-candidates";
import { incidentAge, promotionState } from "@/lib/promotion-state";
import {
  BASELINE_POLICY,
  CHANNEL_LOOKUP_POLICY,
  EVAL_CASES,
  SAFE_TOOLS,
  WIDENED_TOOLSET_POLICY,
  chooseTool,
  evaluateCandidate,
  policyDigest,
  runPolicy,
  suiteDigest,
} from "@/lib/improvement-eval";

const draft: CandidateDraft = {
  kind: "tool_policy",
  title: "Resolve a channel name before posting",
  problem: "A named channel is handed straight to the send tool and refused late.",
  evidence: "Three of twelve authored cases never reach the listing tool.",
  proposedChange: "Add one listing rule ahead of the send rule and change nothing else.",
  expectedBenefit: "Three more intents reach the right tool.",
  possibleRegressions: "A trailing word could be read as a channel name.",
  affectedComponents: ["connector tool policy"],
  evaluationPlan: "Run all twelve cases against baseline and candidate with no security finding.",
  costImpact: "One extra listing call on three intents.",
  securityImplications: "Only an already-granted, read-only tool is called.",
  rollbackPlan: "Remove the added rule; the send path is untouched.",
  requestedAuthorities: [],
  sandboxKind: "sandbox",
  baseRef: "main@policy-shipped-2026-11",
  candidateRef: "sandbox/channel-lookup",
};

describe("proposal records", () => {
  it("covers all seven proposal kinds", () => {
    expect([...CANDIDATE_KINDS].sort()).toEqual([
      "code_patch",
      "evaluation_case",
      "model_routing",
      "procedure",
      "prompt_revision",
      "tool_policy",
      "workflow_change",
    ]);
  });

  it("accepts a complete record", () => {
    expect(candidateProblems(draft)).toEqual([]);
  });

  it("names every missing field", () => {
    const problems = candidateProblems({ ...draft, problem: "too short", rollbackPlan: "", affectedComponents: [] });
    expect(problems.join(" ")).toContain("Problem needs at least 20 characters");
    expect(problems.join(" ")).toContain("Rollback plan needs at least 20 characters");
    expect(problems.join(" ")).toContain("Name at least one affected component");
  });

  it("refuses a candidate that borrows the baseline ref", () => {
    expect(candidateProblems({ ...draft, candidateRef: draft.baseRef }).join(" ")).toContain(
      "needs its own branch or sandbox",
    );
  });

  it("refuses every protected authority by name", () => {
    expect(PROTECTED_AUTHORITIES).toHaveLength(9);
    for (const authority of PROTECTED_AUTHORITIES) {
      expect(authorityProblem(authority)).toContain("Refused:");
    }
    expect(authorityProblem("read_docs")).toBeNull();
    expect(requestedAuthorityProblems(["grant_permissions", "deploy_own_change"])).toHaveLength(2);
  });

  it("hashes the success criteria", () => {
    const base = { evaluationPlan: draft.evaluationPlan, expectedBenefit: draft.expectedBenefit, suiteName: "tool-selection", suiteVersion: "1" };
    expect(criteriaHash(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(criteriaHash({ ...base, evaluationPlan: `${base.evaluationPlan} and something easier` })).not.toBe(
      criteriaHash(base),
    );
  });
});

describe("comparison arithmetic", () => {
  const base = { totalCases: 12, baselinePassed: 9, candidatePassed: 12, securityFindings: 0, regressions: 0, baselineCostUnits: 18, candidateCostUnits: 21 };

  it("calls a strict improvement with no findings better", () => {
    expect(compareEvaluation(base).verdict).toBe("better");
  });

  it("refuses to call a security finding an improvement", () => {
    const result = compareEvaluation({ ...base, securityFindings: 1 });
    expect(result.verdict).toBe("worse");
    expect(result.reasons.join(" ")).toContain("security finding");
  });

  it("treats a changed guarded behaviour as worse", () => {
    expect(compareEvaluation({ ...base, regressions: 1 }).verdict).toBe("worse");
  });

  it("rejects a cost blowout", () => {
    expect(compareEvaluation({ ...base, candidateCostUnits: 30 }).verdict).toBe("worse");
  });

  it("is equal only when nothing moved", () => {
    expect(compareEvaluation({ ...base, candidatePassed: 9, candidateCostUnits: 18 }).verdict).toBe("equal");
  });

  it("is inconclusive without cases", () => {
    expect(compareEvaluation({ ...base, totalCases: 0 }).verdict).toBe("inconclusive");
  });
});

describe("the evaluation suite", () => {
  it("pins a stable digest", () => {
    expect(suiteDigest()).toMatch(/^[0-9a-f]{64}$/);
    expect(suiteDigest()).toBe(suiteDigest(EVAL_CASES));
    expect(suiteDigest([EVAL_CASES[0]])).not.toBe(suiteDigest());
  });

  it("has a fair baseline and only granted tools", () => {
    const baseline = runPolicy(EVAL_CASES, BASELINE_POLICY);
    expect(baseline.passed).toBe(9);
    expect(baseline.securityFindings).toBe(0);
    expect(SAFE_TOOLS).not.toContain("SLACK_DELETE_A_MESSAGE");
  });

  it("scores the channel-lookup candidate as a real improvement", () => {
    const result = evaluateCandidate({ policy: CHANNEL_LOOKUP_POLICY });
    expect(result.numbers).toMatchObject({
      totalCases: 12,
      baselinePassed: 9,
      candidatePassed: 12,
      securityFindings: 0,
      regressions: 0,
    });
    expect(result.comparison.verdict).toBe("better");
    expect(result.comparison.costDeltaRatio).toBeLessThan(0.25);
    expect(result.suiteIntegrity).toBe("verified");
  });

  it("rejects the widened toolset on security and regression", () => {
    const result = evaluateCandidate({ policy: WIDENED_TOOLSET_POLICY });
    expect(result.numbers.securityFindings).toBe(2);
    expect(result.numbers.regressions).toBe(2);
    expect(result.comparison.verdict).toBe("worse");
  });

  it("notices a suite that does not match the frozen digest", () => {
    const result = evaluateCandidate({ policy: CHANNEL_LOOKUP_POLICY, expectedSuiteDigest: "f".repeat(64) });
    expect(result.suiteIntegrity).toBe("mismatch");
  });

  it("routes by rule order, not by name", () => {
    expect(chooseTool(BASELINE_POLICY, "Delete the message we just posted")).toBe("NO_TOOL_REFUSED");
    expect(chooseTool(CHANNEL_LOOKUP_POLICY, "Send it to general please")).toBe("SLACK_LIST_ALL_CHANNELS");
    expect(policyDigest(CHANNEL_LOOKUP_POLICY)).not.toBe(policyDigest(BASELINE_POLICY));
  });
});

describe("promotion review", () => {
  const review = {
    status: "approved" as const,
    verdict: "better" as const,
    integrity: "verified" as const,
    securityFindings: 0,
    regressions: 0,
    costDeltaRatio: 0.17,
    reviewNote: "Read the diff, the twelve-case run and the rollback; the extra cost is acceptable.",
    reviewedBy: "reviewer-1",
    authorId: "author-1",
    sandboxRef: "sandbox/channel-lookup",
    deploymentApproved: true,
    deploymentProjectMatches: true,
  };

  it("accepts a reviewed, measured candidate", () => {
    expect(promotionProblems(review)).toEqual([]);
  });

  it("refuses an unreviewed or self-approved promotion", () => {
    expect(promotionProblems({ ...review, reviewNote: "ok" }).join(" ")).toContain("Record the review decision");
    expect(promotionProblems({ ...review, reviewedBy: "author-1" }).join(" ")).toContain("cannot approve their own");
    expect(promotionProblems({ ...review, verdict: "worse" }).join(" ")).toContain("not better than or equal");
    expect(promotionProblems({ ...review, integrity: "mismatch" }).join(" ")).toContain("did not match the frozen suite");
    expect(promotionProblems({ ...review, status: "draft" }).join(" ")).toContain("Only an approved candidate");
  });

  it("refuses a promotion that no approved deployment can ship", () => {
    expect(promotionProblems({ ...review, deploymentApproved: false }).join(" ")).toContain(
      "Name a deployment that has already been approved",
    );
    expect(promotionProblems({ ...review, deploymentProjectMatches: false }).join(" ")).toContain(
      "same project as the candidate",
    );
  });
});

describe("promotion liveness", () => {
  const shipped = {
    id: "d1",
    target: "production",
    status: "succeeded",
    created_at: "2026-11-10T09:00:00.000Z",
  };

  it("calls a succeeded deployment with no rollback live", () => {
    const state = promotionState({ deployment: shipped });
    expect(state.state).toBe("live");
    expect(state.label).toBe("Live");
    expect(state.detail).toContain("no rollback is recorded");
  });

  it("prefers a resolved rollback over the deployment status", () => {
    const state = promotionState({
      deployment: shipped,
      rollback: {
        title: "Errors spiked after the policy shipped",
        recovery_kind: "code_rollback",
        resolved_at: "2026-11-11T12:30:00.000Z",
      },
    });
    expect(state.state).toBe("rolled_back");
    expect(state.detail).toContain("code rollback recorded 2026-11-11 12:30");
    expect(state.detail).toContain("Errors spiked after the policy shipped");
  });

  it("names a later successful deployment to the same target as superseding", () => {
    const state = promotionState({
      deployment: shipped,
      laterDeployment: {
        id: "d2",
        target: "production",
        created_at: "2026-11-12T08:00:00.000Z",
      },
    });
    expect(state.state).toBe("superseded");
    expect(state.detail).toContain("2026-11-12 08:00");
    expect(state.detail).toContain("no longer the newest one shipped");
  });

  it("says a change has not shipped while the deployment waits for approval", () => {
    expect(promotionState({ deployment: { ...shipped, status: "checks_ready" } }).state).toBe(
      "not_deployed",
    );
    expect(promotionState({ deployment: { ...shipped, status: "approved" } }).state).toBe(
      "not_deployed",
    );
  });

  it("reports a failed deployment as failed, not live", () => {
    const state = promotionState({ deployment: { ...shipped, status: "partial_failure" } });
    expect(state.state).toBe("failed");
    expect(state.detail).toContain("partial failure");
  });

  it("does not call an unshipped change superseded by a later ship", () => {
    const state = promotionState({
      deployment: { ...shipped, status: "approved" },
      laterDeployment: { id: "d2", target: "preview", created_at: "2026-11-12T08:00:00.000Z" },
    });
    expect(state.state).toBe("not_deployed");
  });

  it("refuses to guess when the deployment record is gone", () => {
    const state = promotionState({ deployment: null });
    expect(state.state).toBe("unknown");
    expect(state.detail).toContain("cannot be confirmed");
  });
});

describe("incident age", () => {
  const now = new Date("2026-11-12T12:00:00.000Z");

  it("says nothing when the incident is minutes old", () => {
    expect(incidentAge("2026-11-12T11:45:00.000Z", now)).toMatchObject({
      hours: 0,
      label: "under an hour",
      stale: false,
    });
  });

  it("counts whole hours within the first day", () => {
    expect(incidentAge("2026-11-12T05:30:00.000Z", now)).toMatchObject({
      hours: 6,
      label: "6 h",
      stale: false,
    });
    expect(incidentAge("2026-11-11T13:00:00.000Z", now).stale).toBe(false);
  });

  it("flags an incident open for a full day", () => {
    expect(incidentAge("2026-11-11T12:00:00.000Z", now)).toMatchObject({
      label: "1 day",
      stale: true,
    });
    expect(incidentAge("2026-11-09T12:00:00.000Z", now)).toMatchObject({
      label: "3 days",
      stale: true,
    });
  });

  it("never reports a negative age for a clock that disagrees", () => {
    expect(incidentAge("2026-11-13T12:00:00.000Z", now)).toMatchObject({
      hours: 0,
      stale: false,
    });
    expect(incidentAge("not a date", now).label).toBe("under an hour");
  });
});
