import { describe, expect, it } from "vitest";
import {
  LEARNING_HELP_INTENTS,
  NOT_QUALIFICATION_NOTE,
  buildLearningHelpMessages,
  buildLearningPathMessages,
  confidenceLabel,
  learningEvidence,
  learningHelpRequestSchema,
  learningPlanInputSchema,
  learningProgress,
  parseLearningPath,
  parseLearningReply,
  recordSummary,
  resumeStep,
} from "@/lib/learning";
import { DISABLED_PREFERENCES, FULL_PREFERENCES } from "./fixtures/preferences";
import {
  LEARNING_RECORD,
  LEARNING_STEPS,
  badKindPathResponse,
  badMinutesPathResponse,
  duplicateTitlesPathResponse,
  fencedPathResponse,
  learningPlanInput,
  missingStepsResponse,
  noCheckpointPathResponse,
  noPracticePathResponse,
  nonJsonResponse,
  prosePathResponse,
  tooFewPathResponse,
  tooManyPathResponse,
  validPathResponse,
} from "./fixtures/learning";

function promptText(messages: { content: string }[]): string {
  return messages.map((message) => message.content).join("\n");
}

describe("parseLearningPath", () => {
  it("accepts a valid path with every step intact", () => {
    const parsed = parseLearningPath(validPathResponse);
    expect(parsed.kind).toBe("path");
    if (parsed.kind !== "path") return;
    expect(parsed.steps).toHaveLength(4);
    expect(parsed.steps[0]).toMatchObject({
      kind: "explanation",
      title: "How grid lines and tracks work",
      estimated_minutes: 10,
    });
    expect(parsed.steps[3].kind).toBe("checkpoint");
  });

  it("accepts fenced JSON and JSON wrapped in prose", () => {
    expect(parseLearningPath(fencedPathResponse).kind).toBe("path");
    expect(parseLearningPath(prosePathResponse).kind).toBe("path");
  });

  it("rejects a path with fewer than three steps", () => {
    expect(parseLearningPath(tooFewPathResponse)).toEqual({
      kind: "invalid",
      reason: "too-few-steps",
    });
  });

  it("rejects a path with more than eight steps", () => {
    expect(parseLearningPath(tooManyPathResponse)).toEqual({
      kind: "invalid",
      reason: "too-many-steps",
    });
  });

  it("rejects a path with nothing to practise", () => {
    expect(parseLearningPath(noPracticePathResponse)).toEqual({
      kind: "invalid",
      reason: "no-practice",
    });
  });

  it("rejects a path with no checkpoint for the person to approve", () => {
    expect(parseLearningPath(noCheckpointPathResponse)).toEqual({
      kind: "invalid",
      reason: "no-checkpoint",
    });
  });

  it("rejects duplicate titles", () => {
    expect(parseLearningPath(duplicateTitlesPathResponse)).toEqual({
      kind: "invalid",
      reason: "duplicate-titles",
    });
  });

  it("rejects an unknown step kind", () => {
    expect(parseLearningPath(badKindPathResponse)).toEqual({
      kind: "invalid",
      reason: "bad-step",
    });
  });

  it("rejects an estimate below five minutes", () => {
    expect(parseLearningPath(badMinutesPathResponse)).toEqual({
      kind: "invalid",
      reason: "bad-step",
    });
  });

  it("rejects a reply with no steps array", () => {
    expect(parseLearningPath(missingStepsResponse)).toEqual({
      kind: "invalid",
      reason: "missing-steps",
    });
  });

  it("rejects prose with no JSON", () => {
    expect(parseLearningPath(nonJsonResponse)).toEqual({
      kind: "invalid",
      reason: "unreadable-json",
    });
  });
});

describe("learningPlanInputSchema", () => {
  it("accepts a complete setup form", () => {
    expect(learningPlanInputSchema.safeParse(learningPlanInput).success).toBe(true);
  });

  it("rejects a blank topic, a short outcome and an unknown experience", () => {
    expect(
      learningPlanInputSchema.safeParse({ ...learningPlanInput, what_to_learn: "  " })
        .success,
    ).toBe(false);
    expect(
      learningPlanInputSchema.safeParse({ ...learningPlanInput, outcome: "ok" })
        .success,
    ).toBe(false);
    expect(
      learningPlanInputSchema.safeParse({
        ...learningPlanInput,
        experience: "expert",
      }).success,
    ).toBe(false);
  });

  it("rejects less than 15 minutes or more than 40 hours a week", () => {
    expect(
      learningPlanInputSchema.safeParse({ ...learningPlanInput, minutes_per_week: 10 })
        .success,
    ).toBe(false);
    expect(
      learningPlanInputSchema.safeParse({ ...learningPlanInput, minutes_per_week: 3000 })
        .success,
    ).toBe(false);
  });
});

describe("learningHelpRequestSchema", () => {
  const stepId = LEARNING_STEPS[0].id;

  it("rejects a review with no answer to review", () => {
    const parsed = learningHelpRequestSchema.safeParse({
      step_id: stepId,
      intent: "review-answer",
      answer: "   ",
      model: "",
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.message).toBe(
      "Write an answer before asking for a review.",
    );
  });

  it("allows a hint before any answer exists", () => {
    expect(
      learningHelpRequestSchema.safeParse({
        step_id: stepId,
        intent: "hint",
        answer: "",
        model: "",
      }).success,
    ).toBe(true);
  });

  it("accepts a review once there is an answer", () => {
    expect(
      learningHelpRequestSchema.safeParse({
        step_id: stepId,
        intent: "review-answer",
        answer: "A real attempt.",
        model: "",
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown intent and a malformed step id", () => {
    expect(
      learningHelpRequestSchema.safeParse({
        step_id: stepId,
        intent: "grade-me",
        answer: "",
        model: "",
      }).success,
    ).toBe(false);
    expect(
      learningHelpRequestSchema.safeParse({
        step_id: "not-a-uuid",
        intent: "hint",
        answer: "",
        model: "",
      }).success,
    ).toBe(false);
  });
});

describe("learning prompts", () => {
  it("asks for JSON and carries the person's own details", () => {
    const text = promptText(buildLearningPathMessages(learningPlanInput));

    expect(text).toContain("CSS grid layout");
    expect(text).toContain("two-column page layout");
    expect(text).toContain("2 hr per week");
    expect(text).toContain("Reply with JSON only");
  });

  it("forbids invented sources, mastery promises and qualifications", () => {
    const text = promptText(buildLearningPathMessages(learningPlanInput));

    expect(text).toContain("Never invent sources, citations, links");
    expect(text).toContain("Never promise mastery");
    expect(text).toContain("qualification");
  });

  it("includes preferences only when personalisation is on", () => {
    const withPreferences = promptText(
      buildLearningPathMessages(learningPlanInput, FULL_PREFERENCES),
    );
    expect(withPreferences).toContain("15 minutes per work session");

    const withoutPreferences = promptText(
      buildLearningPathMessages(learningPlanInput, DISABLED_PREFERENCES),
    );
    expect(withoutPreferences).not.toContain("15 minutes per work session");
  });

  it("makes a hint request refuse the full answer", () => {
    const text = promptText(
      buildLearningHelpMessages(
        {
          plan: learningPlanInput,
          step: LEARNING_STEPS[0],
          answer: "",
        },
        "hint",
      ),
    );

    expect(text).toContain("one hint only");
    expect(text).toContain("Do not reveal the full answer");
    expect(text).toContain("do not give the working");
  });

  it("keeps explanation, practice and review requests distinct", () => {
    const context = {
      plan: learningPlanInput,
      step: LEARNING_STEPS[1],
      answer: "My answer about named areas.",
    };

    const explain = promptText(
      buildLearningHelpMessages(context, "explain-concept"),
    );
    expect(explain).toContain("simpler words");
    expect(explain).toContain("everyday analogy");

    const practice = promptText(
      buildLearningHelpMessages(context, "practice-exercise"),
    );
    expect(practice).toContain("Do not include the answer");

    const review = promptText(
      buildLearningHelpMessages(context, "review-answer"),
    );
    expect(review).toContain("My answer about named areas.");
    expect(review).toContain("Do not give a mark or grade");
    expect(review).toContain("do not claim this proves mastery");
  });

  it("tells the model to acknowledge uncertainty and cite nothing", () => {
    const text = promptText(
      buildLearningHelpMessages(
        { plan: learningPlanInput, step: LEARNING_STEPS[0], answer: "" },
        "explain-concept",
      ),
    );

    expect(text).toContain("When you are unsure, say so plainly");
    expect(text).toContain("Never invent citations");
  });

  it("adds preference context to step help only when enabled", () => {
    const context = {
      plan: learningPlanInput,
      step: LEARNING_STEPS[0],
      answer: "",
    };

    expect(
      promptText(buildLearningHelpMessages(context, "hint", FULL_PREFERENCES)),
    ).toContain("Preferences they saved");
    expect(
      promptText(buildLearningHelpMessages(context, "hint", DISABLED_PREFERENCES)),
    ).not.toContain("Preferences they saved");
  });
});

describe("parseLearningReply", () => {
  it("strips markup from a usable reply", () => {
    const parsed = parseLearningReply("## Hint\n\nLook at the *gaps* first.");
    expect(parsed).toEqual({
      kind: "ok",
      text: "Hint\n\nLook at the gaps first.",
    });
  });

  it("rejects an empty or wordless reply", () => {
    expect(parseLearningReply("   ").kind).toBe("invalid");
    expect(parseLearningReply("<div></div>").kind).toBe("invalid");
  });
});

describe("learning evidence", () => {
  it("keeps feedback, confidence and completion separate", () => {
    const evidence = learningEvidence(LEARNING_RECORD);
    expect(evidence.aiFeedback).toContain("structure is clear");
    expect(evidence.confidence).toBe(3);
    expect(evidence.confidenceLabel).toBe("Getting there");
    expect(evidence.completed).toBe(true);
    expect(evidence.revisit).toBe(true);
  });

  it("does not invent feedback or confidence from a completed exercise", () => {
    const evidence = learningEvidence({
      ...LEARNING_RECORD,
      feedback: null,
      confidence: null,
    });
    expect(evidence.aiFeedback).toBeNull();
    expect(evidence.confidence).toBeNull();
    expect(evidence.confidenceLabel).toBe("Not recorded");
    expect(evidence.completed).toBe(true);
  });

  it("treats a missing record as no evidence at all", () => {
    expect(learningEvidence(null)).toEqual({
      aiFeedback: null,
      confidence: null,
      confidenceLabel: "Not recorded",
      completed: false,
      revisit: false,
    });
  });

  it("names confidence without judging it", () => {
    expect(confidenceLabel(1)).toBe("Not yet");
    expect(confidenceLabel(5)).toBe("Confident");
    expect(confidenceLabel(null)).toBe("Not recorded");
  });

  it("labels AI feedback as an opinion, not a qualification", () => {
    expect(NOT_QUALIFICATION_NOTE).toContain("not a grade, certificate or qualification");
  });
});

describe("learning path progress", () => {
  it("counts checkpoints and only counts approvals that exist", () => {
    const steps = [
      ...LEARNING_STEPS,
      {
        ...LEARNING_STEPS[2],
        id: "a1000000-0000-4000-8000-000000000004",
        position: 4,
        approved_at: "2026-11-02T11:00:00.000Z",
      },
      {
        ...LEARNING_STEPS[1],
        id: "a1000000-0000-4000-8000-000000000005",
        position: 5,
        status: "skipped" as const,
      },
    ];

    expect(learningProgress(steps)).toEqual({
      total: 5,
      skipped: 1,
      checkpoints: 2,
      approvedCheckpoints: 1,
    });
  });

  it("resumes at the first active unfinished step and skips skipped ones", () => {
    const steps = [
      { ...LEARNING_STEPS[0], status: "skipped" as const },
      LEARNING_STEPS[1],
      LEARNING_STEPS[2],
    ];
    const records = [{ ...LEARNING_RECORD, step_id: LEARNING_STEPS[2].id }];

    expect(resumeStep(steps, records)?.id).toBe(LEARNING_STEPS[1].id);
  });

  it("falls back to the first active step when everything is started", () => {
    const records = LEARNING_STEPS.map((step) => ({
      ...LEARNING_RECORD,
      id: `${step.id}-record`,
      step_id: step.id,
    }));
    expect(resumeStep(LEARNING_STEPS, records)?.id).toBe(LEARNING_STEPS[0].id);
  });

  it("returns nothing when every step is skipped", () => {
    const steps = LEARNING_STEPS.map((step) => ({
      ...step,
      status: "skipped" as const,
    }));
    expect(resumeStep(steps, [])).toBeNull();
  });

  it("summarises a record with each kind of evidence named", () => {
    const summary = recordSummary(LEARNING_RECORD);
    expect(summary).toContain("Answer saved");
    expect(summary).toContain("AI feedback saved");
    expect(summary).toContain("Confidence: Getting there");
    expect(summary).toContain("Marked finished");
  });
});

describe("usage limits", () => {
  it("offers exactly the five step-level actions", () => {
    expect(LEARNING_HELP_INTENTS).toEqual([
      "explain-concept",
      "worked-example",
      "practice-exercise",
      "hint",
      "review-answer",
    ]);
  });
});
