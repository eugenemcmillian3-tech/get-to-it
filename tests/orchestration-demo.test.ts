import { describe, expect, it } from "vitest";
import {
  approvalCoversContract,
  budgetSnapshot,
  criterionStates,
  creditsToMicros,
  defaultPlan,
  evidenceProblem,
  formatCredits,
  formatMicrosUsd,
  outcomeReviewProblem,
  outcomeSummary,
  planProblems,
  reservationProblem,
  retryProblem,
  settleReservation,
  transitionProblem,
  type ContractContent,
  type EvidenceRecord,
  type TaskState,
} from "@/lib/orchestration";

/**
 * A synthetic, in-memory walkthrough of the Phase 36 flow.
 *
 * This exercises the orchestration rules from a linked experiment through plan,
 * reservation, a failed acceptance check, a bounded repair, verification, cost
 * accounting and a human outcome decision. It is not a live database test and
 * not evidence of market demand: the migration is not applied to production in
 * this change, and no real prototype was built, deployed or observed.
 */

const MICRO = 1_000_000;

function demoContract(): ContractContent {
  return {
    goal: "Let a volunteer find and confirm the next shift",
    origin_kind: "experiment",
    origin_id: "11111111-1111-4111-8111-111111111111",
    stakeholders: "Volunteers who have attended once",
    scope: "One three-page prototype in the sandbox, reviewed before deployment.",
    exclusions: ["No real outreach", "No public launch", "No payment"],
    evidence_available: "Two volunteers said they forgot the time.",
    assumptions: "Volunteers can stop at any point.",
    unresolved_questions: "Whether a reminder is welcome.",
    deliverables: [
      {
        key: "prototype",
        statement: "A three-page prototype that runs in the sandbox",
        kind: "deliverable",
      },
      {
        key: "completion",
        statement: "Whether a volunteer can finish the flow unaided",
        kind: "observation",
      },
    ],
    acceptance_criteria: [
      {
        key: "build-passes",
        criterion: "The generated project builds and its tests pass",
        verification: "automated_test",
      },
      {
        key: "flow-completes",
        criterion: "A volunteer can finish the flow without help",
        verification: "direct_observation",
      },
    ],
    allowed_tools: ["workspace_read", "app_builder_generate", "sandbox_run_tests"],
    execution_environments: ["sandbox"],
    required_human_decisions: ["Approve any deployment"],
    max_credits: 10,
    time_limit_minutes: 240,
    resource_limits: "One person, no paid ads",
    privacy_constraints: "No personal data leaves the workspace.",
    consent_constraints: "Ask before recording anything.",
    stop_conditions: "Stop if someone cannot find the way to stop.",
    review_at: "2026-11-24",
  };
}

function evidence(
  overrides: Partial<EvidenceRecord> & Pick<EvidenceRecord, "id" | "criterion_key">,
): EvidenceRecord {
  return {
    kind: "automated_test",
    source_ref: "sandbox/build.log",
    artifact_version: "v1",
    method: "npm test in the existing sandbox",
    result: "pass",
    limitations: "",
    verifier: "automated test runner",
    observed_at: "2026-11-10T10:00:00.000Z",
    ...overrides,
  };
}

describe("Phase 36 synthetic walkthrough", () => {
  it("carries a linked experiment to an evidenced, costed human decision", () => {
    // 1–2. An existing-style experiment supplies the origin contract.
    const contract = demoContract();
    expect(contract.origin_kind).toBe("experiment");

    // 3. A bounded plan is generated from that contract and validated.
    const plan = defaultPlan(contract);
    const check = planProblems({ contract, tasks: plan });
    expect(check.ok).toBe(true);
    expect(plan.map((task) => task.task_key)).toEqual([
      "build-prototype",
      "observe-completion",
      "verify",
    ]);
    expect(plan[2].covers.sort()).toEqual(["build-passes", "flow-completes"]);

    // 4. Each task reserves atomically inside the authorized maximum.
    let budget = budgetSnapshot({
      authorizedMicros: creditsToMicros(contract.max_credits),
      reservedMicros: 0,
      consumedMicros: 0,
    });
    for (const task of plan) {
      expect(reservationProblem({ snapshot: budget, amountMicros: task.credits_micros }).ok).toBe(
        true,
      );
      budget = budgetSnapshot({
        authorizedMicros: budget.authorized,
        reservedMicros: budget.reserved + task.credits_micros,
        consumedMicros: budget.consumed,
      });
    }
    expect(budget.reserved).toBe(budget.authorized);

    // 5. The build produces an artifact; unused reservation is released.
    const buildTask = plan[0];
    const buildSettle = settleReservation({
      reservedMicros: buildTask.credits_micros,
      actualMicros: creditsToMicros(1.2),
      succeeded: true,
    });
    budget = budgetSnapshot({
      authorizedMicros: budget.authorized,
      reservedMicros: budget.reserved - buildTask.credits_micros,
      consumedMicros: budget.consumed + buildSettle.consumedMicros,
    });
    expect(formatCredits(buildSettle.consumedMicros)).toBe("1.200 credits");
    expect(buildSettle.releasedMicros).toBe(creditsToMicros(2.8));

    // 6. The build check passes; the first acceptance check fails.
    const buildEvidence = evidence({
      id: "e-build",
      criterion_key: "build-passes",
      result: "pass",
    });
    const firstFlowCheck = evidence({
      id: "e-flow-1",
      criterion_key: "flow-completes",
      kind: "direct_observation",
      source_ref: "session-note-1.md",
      method: "Facilitator watched one volunteer attempt the flow",
      result: "fail",
      limitations: "One participant, one attempt.",
      verifier: "Facilitator",
    });
    expect(evidenceProblem(buildEvidence).ok).toBe(true);
    expect(evidenceProblem(firstFlowCheck).ok).toBe(true);

    let criteria = criterionStates({
      criteria: contract.acceptance_criteria,
      evidence: [buildEvidence, firstFlowCheck],
    });
    expect(criteria.find((entry) => entry.key === "flow-completes")?.state).toBe(
      "failed",
    );

    // Sending a failed check straight to review is refused.
    expect(
      transitionProblem({
        from: "verifying",
        to: "awaiting_review",
        role: "owner",
        contractApproved: true,
        approvedVersionMatches: true,
        tasksComplete: true,
        criteriaVerified: criteria.every((entry) => entry.state === "verified"),
        reviewAccepted: false,
        stopCondition: false,
        cancellationRequested: false,
      }).code,
    ).toBe("verification-incomplete");

    // 7. A bounded repair: one more attempt on the same task, within its limit.
    const flowState: TaskState = {
      task_key: "observe-completion",
      depends_on: [buildTask.task_key],
      status: "produced",
      attempts: 1,
      retry_limit: 1,
    };
    expect(retryProblem(flowState).ok).toBe(true);
    const repairSettle = settleReservation({
      reservedMicros: creditsToMicros(1),
      actualMicros: creditsToMicros(0.5),
      succeeded: true,
    });
    budget = budgetSnapshot({
      authorizedMicros: budget.authorized,
      reservedMicros: budget.reserved,
      consumedMicros: budget.consumed + repairSettle.consumedMicros,
    });

    // 8. Verification is rerun with the missing stop control fixed.
    const repairedFlowCheck = evidence({
      id: "e-flow-2",
      criterion_key: "flow-completes",
      kind: "direct_observation",
      source_ref: "session-note-2.md",
      artifact_version: "v2",
      method: "Facilitator watched one volunteer finish the repaired flow",
      result: "pass",
      limitations: "One participant, one attempt; not proof of demand.",
      verifier: "Facilitator",
    });
    criteria = criterionStates({
      criteria: contract.acceptance_criteria,
      evidence: [buildEvidence, firstFlowCheck, repairedFlowCheck],
    });
    expect(criteria.every((entry) => entry.state === "verified")).toBe(true);

    // A proposal cannot stand in for that verification.
    expect(
      criterionStates({
        criteria: contract.acceptance_criteria,
        evidence: [
          evidence({
            id: "e-proposal",
            criterion_key: "flow-completes",
            kind: "ai_proposal",
          }),
        ],
      }).find((entry) => entry.key === "flow-completes")?.state,
    ).toBe("unverified");

    // 9. Evidence and actual accounting are presented together.
    const summary = outcomeSummary({
      contract,
      approvedVersion: 1,
      tasks: [
        { ...flowState, status: "verified", external_action_kind: null },
        {
          task_key: "verify",
          depends_on: ["build-prototype", "observe-completion"],
          status: "verified",
          attempts: 1,
          retry_limit: 0,
          external_action_kind: null,
        },
      ],
      criteria,
      budget,
    });
    expect(summary.approved_version).toBe(1);
    expect(summary.verified.sort()).toEqual(["build-passes", "flow-completes"]);
    expect(summary.spent_micros).toBe(creditsToMicros(1.7));
    expect(formatMicrosUsd(summary.spent_micros)).toBe("$0.17");
    expect(summary.note).toContain("deployment is not proof of benefit");

    // The contract version that would run is the one that was approved.
    expect(
      approvalCoversContract({
        contract: {
          id: "contract-1",
          version: 1,
          fingerprint: "f".repeat(64),
          status: "approved",
          content: contract,
        },
        approval: {
          version: 1,
          fingerprint: "f".repeat(64),
          status: "approved",
          approved_by: "owner-1",
          approved_at: "2026-11-10T09:00:00.000Z",
        },
      }).ok,
    ).toBe(true);

    // 10. A human records the outcome decision; an agent cannot.
    const review = {
      decision: "accept" as const,
      built: "Three-page prototype, version 2",
      verified: "Build tests pass and one volunteer finished the flow",
      failed: "The first version hid the stop control",
      unknown: "Whether volunteers return over time; one participant is not demand",
      deviations: "",
      next_steps: "Run a separate experiment before any deployment decision",
      decided_by_kind: "human" as const,
    };
    expect(
      outcomeReviewProblem({ review, criteria, actorRole: "owner" }).ok,
    ).toBe(true);
    expect(
      outcomeReviewProblem({
        review: { ...review, decided_by_kind: "agent" },
        criteria,
        actorRole: "owner",
      }).code,
    ).toBe("agent-decision");
    expect(MICRO).toBe(1_000_000);
  });
});
