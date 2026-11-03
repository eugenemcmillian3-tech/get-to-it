import { describe, expect, it } from "vitest";
import {
  ASSESSMENT_ANSWERS,
  CAUSATION_NOTE,
  EVALUATION_DIMENSIONS,
  FORECAST_METHOD_NOTE,
  HISTORICAL_INTEGRITY_NOTE,
  IMPROVEMENT_AREAS,
  NO_AGGREGATE_SCORE_NOTE,
  NO_AUTONOMY_NOTE,
  OPTIONAL_PARTICIPATION_NOTE,
  REVIEW_QUESTIONS,
  USER_BENEFIT_MEASURES,
  activeVersion,
  assumptionVerdictLabel,
  brierScore,
  buildExpectationSnapshot,
  forecastSchema,
  improvementBlockers,
  improvementSchema,
  isReviewComplete,
  nextVersionNumber,
  observationSchema,
  rollbackPlan,
  scoreForecasts,
  snapshotLines,
  versionStatusLabel,
} from "@/lib/outcomes";

const CAPTURED = "2026-11-02T09:00:00.000Z";

function goalSnapshot() {
  return buildExpectationSnapshot(
    {
      kind: "goal",
      goal: {
        title: "Open a repair café",
        desired_outcome: "Twelve repairs a month by December.",
        deadline: "2026-12-01",
        created_at: "2026-08-01T10:00:00.000Z",
      },
    },
    CAPTURED,
  );
}

describe("captured expectations", () => {
  it("captures a goal exactly as it was", () => {
    const snapshot = goalSnapshot();
    expect(snapshot.source).toBe("goal");
    expect(snapshot.title).toBe("Open a repair café");
    expect(snapshot.captured_at).toBe(CAPTURED);
    expect(snapshotLines(snapshot).map((line) => line.label)).toEqual([
      "Desired outcome",
      "Deadline",
      "Goal created",
    ]);
  });

  it("captures a future path together with the chosen scenario", () => {
    const snapshot = buildExpectationSnapshot(
      {
        kind: "future_path",
        path: {
          decision: "Take the six-month contract",
          chosen_kind: "expected",
          rationale: "Predictable income while hiring",
          review_at: "2026-12-15",
          created_at: "2026-09-01T10:00:00.000Z",
        },
        scenario: {
          title: "Steady work, slow hiring",
          assumptions: ["The client renews twice"],
        },
      },
      CAPTURED,
    );

    expect(snapshot.summary).toBe("Steady work, slow hiring");
    const lines = snapshotLines(snapshot);
    expect(lines.map((line) => line.text).join(" ")).toContain("The client renews twice");
    expect(lines.map((line) => line.text).join(" ")).toContain("Predictable income");
  });

  it("captures a saved human decision and whether a recommendation was rejected", () => {
    const snapshot = buildExpectationSnapshot(
      {
        kind: "review",
        review: {
          question: "Should I take the contract?",
          chosen_option: "Take it with a trial month",
          decision: "I will take it for three months.",
          rejected_recommendation: true,
          created_at: "2026-10-01T10:00:00.000Z",
        },
      },
      CAPTURED,
    );

    const lines = snapshotLines(snapshot);
    const text = lines.map((line) => line.text).join(" ");
    const labels = lines.map((line) => line.label).join(" ");
    expect(text).toContain("I will take it for three months.");
    expect(labels).toContain("Recommendation rejected");
    expect(text).toContain("Yes");
  });

  it("states that the snapshot cannot be rewritten", () => {
    expect(HISTORICAL_INTEGRITY_NOTE).toContain("cannot be edited");
    expect(HISTORICAL_INTEGRITY_NOTE).toContain("appended");
  });
});

describe("the six review questions", () => {
  it("asks each question once, in order", () => {
    expect(REVIEW_QUESTIONS.map((question) => question.key)).toEqual([
      "observation",
      "assumption",
      "surprise",
      "evidence",
      "lesson",
      "next_action",
    ]);
    expect(REVIEW_QUESTIONS.map((question) => question.question)).toContain(
      "Which assumptions held?",
    );
  });

  it("keeps a verdict on an assumption note", () => {
    const base = {
      review_id: "0b7f5a4e-3c2d-4f10-9a11-1d2c3b4a5e6f",
      text: "The landlord agreed to the ramp.",
      causation_note: "",
    };

    expect(
      observationSchema.safeParse({ ...base, kind: "assumption", verdict: "" }).success,
    ).toBe(false);
    expect(
      observationSchema.safeParse({ ...base, kind: "assumption", verdict: "held" })
        .success,
    ).toBe(true);
    expect(
      observationSchema.safeParse({ ...base, kind: "observation", verdict: "" }).success,
    ).toBe(true);
    expect(assumptionVerdictLabel("failed")).toBe("Failed");
  });

  it("keeps participation optional and says so", () => {
    expect(OPTIONAL_PARTICIPATION_NOTE).toContain("optional");
    expect(OPTIONAL_PARTICIPATION_NOTE).toContain("Nothing is created automatically");
  });
});

describe("four separate evaluation answers", () => {
  it("asks four distinct questions", () => {
    expect(EVALUATION_DIMENSIONS.map((dimension) => dimension.key)).toEqual([
      "action_completed",
      "desired_result",
      "expectation_accuracy",
      "external_conditions",
    ]);
    expect(new Set(EVALUATION_DIMENSIONS.map((dimension) => dimension.note)).size).toBe(4);
    expect(ASSESSMENT_ANSWERS.map((answer) => answer.slug)).toEqual([
      "yes",
      "partly",
      "no",
      "unknown",
    ]);
  });

  it("only calls a review complete when all four are answered", () => {
    const base = {
      action_completed: "yes",
      desired_result: "no",
      expectation_accuracy: "partly",
      external_conditions: "changed",
    };
    expect(isReviewComplete(base)).toBe(true);
    expect(isReviewComplete({ ...base, external_conditions: null })).toBe(false);
  });

  it("warns that before and after is not causation", () => {
    expect(CAUSATION_NOTE).toContain("not proof");
    expect(CAUSATION_NOTE).toContain("say what else could explain");
  });
});

describe("forecasts and scoring", () => {
  it("scores a stated probability with the Brier score", () => {
    expect(brierScore(80, "occurred")).toBe(0.04);
    expect(brierScore(80, "did_not_occur")).toBe(0.64);
    expect(brierScore(50, "occurred")).toBe(0.25);
    expect(brierScore(80, "pending")).toBeNull();
  });

  it("averages only this review's resolved forecasts and explains the method", () => {
    const summary = scoreForecasts([
      { id: "1", statement: "It rains", probability: 80, resolution: "occurred" },
      { id: "2", statement: "It snows", probability: 20, resolution: "did_not_occur" },
      { id: "3", statement: "Hiring happens", probability: 60, resolution: "pending" },
    ]);

    expect(summary.resolvedCount).toBe(2);
    // 80% and it occurred = 0.04; 20% and it did not = 0.04.
    expect(summary.mean).toBe(0.04);
    expect(summary.explanation).toContain("Brier score");
    expect(summary.explanation).toContain("not comparable");
    expect(FORECAST_METHOD_NOTE).toContain("(your stated probability − outcome)²");
  });

  it("does not score unresolved forecasts", () => {
    const summary = scoreForecasts([
      { id: "1", statement: "Something happens", probability: 70, resolution: "pending" },
    ]);
    expect(summary.mean).toBeNull();
    expect(summary.explanation).toContain("No forecast has resolved");
  });

  it("accepts only whole-number probabilities between 1 and 99", () => {
    const base = { review_id: "0b7f5a4e-3c2d-4f10-9a11-1d2c3b4a5e6f", statement: "It rains" };
    expect(forecastSchema.safeParse({ ...base, probability: "70" }).success).toBe(true);
    expect(forecastSchema.safeParse({ ...base, probability: "0" }).success).toBe(false);
    expect(forecastSchema.safeParse({ ...base, probability: "100" }).success).toBe(false);
    expect(forecastSchema.safeParse({ ...base, probability: "70.5" }).success).toBe(false);
  });

  it("refuses any combined intelligence score", () => {
    expect(NO_AGGREGATE_SCORE_NOTE).toContain("no combined intelligence");
    expect(NO_AGGREGATE_SCORE_NOTE).toContain("never folded into one number");
  });
});

describe("controlled improvement", () => {
  it("covers the four named areas", () => {
    expect(IMPROVEMENT_AREAS.map((area) => area.slug)).toEqual([
      "planning_prompt",
      "template_structure",
      "clarification_questions",
      "review_timing",
    ]);
  });

  it("requires explicit consent and a scoped test set", () => {
    expect(
      improvementBlockers({ consentConfirmed: false, testScope: "My last five plans" })
        .join(" "),
    ).toContain("consent");
    expect(
      improvementBlockers({ consentConfirmed: true, testScope: "short" }).join(" "),
    ).toContain("at least 10 characters");
    expect(
      improvementBlockers({
        consentConfirmed: true,
        testScope: "My own last five planning requests only",
      }),
    ).toEqual([]);
  });

  it("validates a proposal without pretending it is applied", () => {
    const input = {
      area: "review_timing",
      title: "Ask for a review after two weeks",
      rationale: "A month is too late to remember what was expected.",
      change_text: "Suggest a review fourteen days after a decision is saved.",
      consent_confirmed: true,
      test_scope: "My own next three decisions",
    };
    expect(improvementSchema.safeParse(input).success).toBe(true);
    expect(improvementSchema.safeParse({ ...input, area: "safety_rules" }).success).toBe(
      false,
    );
    expect(improvementSchema.safeParse({ ...input, title: "Ok" }).success).toBe(false);
  });

  it("versions per area and rolls back to the previous version", () => {
    const versions = [
      { id: "v1", area: "planning_prompt" as const, version: 1, status: "superseded" as const },
      { id: "v2", area: "planning_prompt" as const, version: 2, status: "active" as const },
      { id: "x1", area: "review_timing" as const, version: 1, status: "active" as const },
    ];

    expect(nextVersionNumber(versions, "planning_prompt")).toBe(3);
    expect(activeVersion(versions, "planning_prompt")?.id).toBe("v2");

    const plan = rollbackPlan(versions, "planning_prompt");
    expect(plan).toEqual({
      rollbackId: "v2",
      rollbackVersion: 2,
      restoreId: "v1",
      restoreVersion: 1,
    });

    expect(rollbackPlan([], "planning_prompt")).toBeNull();
    expect(
      rollbackPlan(
        [{ id: "only", area: "review_timing", version: 1, status: "active" }],
        "review_timing",
      ),
    ).toEqual({
      rollbackId: "only",
      rollbackVersion: 1,
      restoreId: null,
      restoreVersion: null,
    });
  });

  it("labels version states without implying a shipped prompt changed", () => {
    expect(versionStatusLabel("active")).toBe("Active record");
    expect(versionStatusLabel("rolled_back")).toBe("Rolled back");
    expect(NO_AUTONOMY_NOTE).toContain("never modifies production prompts");
    expect(NO_AUTONOMY_NOTE).toContain("permissions or safety rules");
    expect(NO_AUTONOMY_NOTE).toContain("never claims consciousness or AGI");
  });

  it("prefers benefit measures over engagement", () => {
    expect(USER_BENEFIT_MEASURES).toEqual([
      "Useful work saved",
      "User-confirmed progress",
      "Fewer unwanted suggestions",
      "Better identification of uncertainty",
    ]);
    expect(USER_BENEFIT_MEASURES.join(" ")).not.toContain("time spent");
  });
});
