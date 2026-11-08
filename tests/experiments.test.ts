import { describe, expect, it } from "vitest";
import { intakeSchema } from "@/lib/app-builder";
import {
  HIGH_STAKES_REFUSAL,
  approvalProblem,
  compareApproaches,
  decisionLabel,
  experimentInputSchema,
  experimentReadiness,
  highStakesProblem,
  interviewQuestions,
  nextExperimentSuggestion,
  prototypeApprovalProblem,
  prototypeIntake,
  smallestPrototype,
  summarizeFeedback,
  type Experiment,
  type ExperimentApproval,
  type ExperimentFeedback,
  type ExperimentReview,
} from "@/lib/experiments";

function experiment(overrides: Partial<Experiment> = {}): Experiment {
  return {
    id: "experiment-1",
    workspace_id: "workspace-1",
    mission_id: null,
    future_path_id: null,
    radar_signal_id: null,
    learning_goal_id: null,
    outcome_review_id: null,
    prototype_project_id: null,
    created_by: "owner-1",
    question: "Could a short reminder help volunteers return?",
    hypothesis: "A single consented reminder will help some volunteers return.",
    target_users: "Volunteers who have already attended once",
    evidence_available: "Two people said they forgot the time.",
    assumptions: "People can choose to stop the reminder.",
    proposed_prototype: "One reminder workflow with a visible stop control.",
    success_criteria: "At least two people complete the workflow and say it was clear.",
    failure_criteria: "People cannot find the stop control, or no one completes it.",
    time_limit_minutes: 120,
    resource_limit: "One facilitator, no paid ads",
    privacy_requirements: "Do not store names or contact details in the prototype.",
    consent_requirements: "Explain the test and ask before recording any feedback.",
    stop_conditions: "Stop if anyone is confused about consent or cannot stop.",
    ai_disclosure: "Tell participants which parts are AI-assisted and which are written by a person.",
    high_stakes: false,
    status: "ready",
    review_at: "2026-11-22",
    prototype_approved_by: null,
    prototype_approved_at: null,
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

function feedback(overrides: Partial<ExperimentFeedback> = {}): ExperimentFeedback {
  return {
    id: "feedback-1",
    experiment_id: "experiment-1",
    workspace_id: "workspace-1",
    author_id: "owner-1",
    kind: "opinion",
    participant_reference: "Participant 1",
    text: "The reminder was easy to understand.",
    identifiable: false,
    consent_confirmed: true,
    consent_note: "They agreed to a short anonymous note.",
    permission_to_quote: false,
    created_at: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

function approval(overrides: Partial<ExperimentApproval> = {}): ExperimentApproval {
  return {
    id: "approval-1",
    experiment_id: "experiment-1",
    workspace_id: "workspace-1",
    kind: "outreach",
    summary: "Ask three volunteers for an interview",
    scope: "Send one invitation and do not follow up more than once.",
    requested_by: "requester-1",
    requested_by_kind: "human",
    status: "pending",
    decided_by: null,
    decided_at: null,
    note: "",
    created_at: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

function review(overrides: Partial<ExperimentReview> = {}): ExperimentReview {
  return {
    id: "review-1",
    experiment_id: "experiment-1",
    workspace_id: "workspace-1",
    built: "A one-screen reminder workflow.",
    observed: "Two people completed it; one stopped.",
    failed: "The first label was unclear.",
    unknown: "Whether it helps over time.",
    decision: "revise",
    decision_note: "Change the label and run one more short test.",
    decided_by: "owner-1",
    decided_at: "2026-11-22T00:00:00.000Z",
    created_at: "2026-11-22T00:00:00.000Z",
    updated_at: "2026-11-22T00:00:00.000Z",
    ...overrides,
  };
}

describe("bounded experiment readiness", () => {
  it("names missing evidence, assumptions, consent, stop conditions and a review date", () => {
    const readiness = experimentReadiness(
      experiment({
        evidence_available: "",
        assumptions: "",
        consent_requirements: "",
        stop_conditions: "",
        review_at: "",
      }),
    );

    expect(readiness.ready).toBe(false);
    expect(readiness.missing.join(" ")).toContain("evidence");
    expect(readiness.missing.join(" ")).toContain("assumptions");
    expect(readiness.missing.join(" ")).toContain("consent");
    expect(readiness.missing.join(" ")).toContain("stop conditions");
    expect(readiness.missing.join(" ")).toContain("review date");
  });

  it("does not call a complete record proof of the hypothesis", () => {
    const readiness = experimentReadiness(experiment());
    expect(readiness.ready).toBe(true);
    expect(readiness.notes.join(" ")).toContain("not a result");
    expect(readiness.notes.join(" ")).toContain("not proof of social benefit");
  });

  it("refuses high-stakes human-subject research", () => {
    expect(highStakesProblem(true)).toBe(HIGH_STAKES_REFUSAL);
    expect(highStakesProblem(false)).toBeNull();
  });
});

describe("planning assistant", () => {
  it("compares more than one approach without promising an answer", () => {
    const options = compareApproaches(experiment());
    expect(options).toHaveLength(4);
    expect(options.map((option) => option.title).join(" ")).toContain("Talk or observe");
    expect(options.map((option) => option.risk).join(" ")).toContain("not proof");
  });

  it("proposes a smallest prototype with exclusions and a stop control", () => {
    const prototype = smallestPrototype(experiment());
    expect(prototype.scope).toContain("One workflow");
    expect(prototype.pages.join(" ")).toContain("stop");
    expect(prototype.exclusions.join(" ")).toContain("No real outreach");
    expect(prototype.checks).toContain(experiment().success_criteria);
  });

  it("turns the record into a valid normal app-builder intake", () => {
    const intake = prototypeIntake(experiment());
    const parsed = intakeSchema.safeParse(intake);
    expect(parsed.success).toBe(true);
    expect(intake.definition_of_done).toBe(experiment().success_criteria);
    expect(intake.auth_requirements).toBe("none");
    expect(intake.workflows).toContain("visible stop control");
  });

  it("prepares interview questions that make stopping explicit", () => {
    const questions = interviewQuestions(experiment());
    expect(questions[0]).toContain("You can skip any question or stop");
    expect(questions.join(" ")).not.toContain("testimonial");
    expect(questions.length).toBeGreaterThan(5);
  });

  it("summarises only consented feedback and keeps opinions separate", () => {
    const summary = summarizeFeedback([
      feedback(),
      feedback({ id: "feedback-2", kind: "measured", text: "Two of three completed." }),
      feedback({ id: "feedback-3", consent_confirmed: false, text: "Invented result" }),
    ]);

    expect(summary.consentedCount).toBe(2);
    expect(summary.excludedCount).toBe(1);
    expect(summary.opinions).toEqual(["The reminder was easy to understand."]);
    expect(summary.measured).toEqual(["Two of three completed."]);
    expect(summary.opinions.join(" ")).not.toContain("Invented result");
  });

  it("does not fill an empty feedback record with a participant quote", () => {
    const summary = summarizeFeedback([]);
    expect(summary.opinions).toEqual([]);
    expect(summary.measured).toEqual([]);
    expect(summary.summary).toContain("Do not describe a participant reaction");
  });

  it("suggests stopping when the human decision was stop", () => {
    const suggestion = nextExperimentSuggestion({
      experiment: experiment(),
      review: review({ decision: "stop" }),
    });
    expect(suggestion).toContain("Stop here");
    expect(suggestion).toContain(experiment().hypothesis);
  });
});

describe("approval rules", () => {
  it("refuses members and self-approval", () => {
    expect(
      approvalProblem({ approval: approval(), actorId: "other", actorRole: "member" }).code,
    ).toBe("forbidden");
    expect(
      approvalProblem({ approval: approval(), actorId: "requester-1", actorRole: "owner" }).code,
    ).toBe("self-approval");
    expect(
      approvalProblem({
        approval: approval({ requested_by: null, requested_by_kind: "agent" }),
        actorId: "owner-1",
        actorRole: "owner",
      }).code,
    ).toBe("agent-approval");
  });

  it("allows a separate owner to decide a pending request", () => {
    const problem = approvalProblem({
      approval: approval(),
      actorId: "owner-1",
      actorRole: "owner",
    });
    expect(problem.ok).toBe(true);
  });

  it("refuses prototype approval for members, repeat approval and high-stakes work", () => {
    expect(
      prototypeApprovalProblem({ experiment: experiment(), role: "member", hasProject: true }).code,
    ).toBe("forbidden");
    expect(
      prototypeApprovalProblem({
        experiment: experiment({ prototype_project_id: "project-1" }),
        role: "owner",
        hasProject: true,
      }).code,
    ).toBe("already-approved");
    expect(
      prototypeApprovalProblem({
        experiment: experiment({ high_stakes: true }),
        role: "owner",
        hasProject: true,
      }).code,
    ).toBe("high-stakes");
  });

  it("labels a human decision without implying a guaranteed result", () => {
    expect(decisionLabel("continue")).toBe("Continue");
    expect(decisionLabel("revise")).toBe("Revise");
    expect(decisionLabel("stop")).toBe("Stop");
  });
});

describe("experiment input", () => {
  it("requires a bounded time limit and a review date", () => {
    const base = {
      workspace_id: "11111111-1111-4111-8111-111111111111",
      question: experiment().question,
      hypothesis: experiment().hypothesis,
      target_users: experiment().target_users,
      evidence_available: experiment().evidence_available,
      assumptions: experiment().assumptions,
      proposed_prototype: experiment().proposed_prototype,
      success_criteria: experiment().success_criteria,
      failure_criteria: experiment().failure_criteria,
      resource_limit: "",
      privacy_requirements: experiment().privacy_requirements,
      consent_requirements: experiment().consent_requirements,
      stop_conditions: experiment().stop_conditions,
      ai_disclosure: experiment().ai_disclosure,
      high_stakes: false,
    };

    expect(
      experimentInputSchema.safeParse({ ...base, time_limit_minutes: "10", review_at: "2026-11-22" })
        .success,
    ).toBe(false);
    expect(
      experimentInputSchema.safeParse({ ...base, time_limit_minutes: "120", review_at: "" })
        .success,
    ).toBe(false);
    expect(
      experimentInputSchema.safeParse({
        ...base,
        time_limit_minutes: "120",
        review_at: "2026-11-22",
      }).success,
    ).toBe(true);
  });
});
