/**
 * Fixtures for learning mode: shaped like real model replies, plus saved rows.
 * No live calls are ever made by these tests.
 */

import type { LearningPlan, LearningRecord, LearningStep } from "@/lib/types";

export const learningPlanInput = {
  what_to_learn: "CSS grid layout",
  experience: "some" as const,
  outcome: "Build a two-column page layout without copying a tutorial",
  minutes_per_week: 120,
};

const step = (
  kind: "explanation" | "practice" | "project" | "checkpoint",
  title: string,
  estimated_minutes = 15,
) => ({
  kind,
  title,
  body: "A short explanation of the idea, followed by one thing to try in your own words.",
  estimated_minutes,
});

export const validPathObject = {
  steps: [
    step("explanation", "How grid lines and tracks work", 10),
    step("practice", "Place three boxes in named areas", 20),
    step("project", "Build a two-column layout", 45),
    step("checkpoint", "Explain when grid beats flexbox", 10),
  ],
};

export const validPathResponse = JSON.stringify(validPathObject);

export const fencedPathResponse = [
  "```json",
  JSON.stringify(validPathObject, null, 2),
  "```",
].join("\n");

export const prosePathResponse = [
  "Here is a path you could follow:",
  JSON.stringify(validPathObject),
  "Adjust it as you go.",
].join("\n");

export const tooFewPathResponse = JSON.stringify({
  steps: validPathObject.steps.slice(0, 2),
});

export const tooManyPathResponse = JSON.stringify({
  steps: [
    ...validPathObject.steps,
    step("practice", "Extra practice one"),
    step("practice", "Extra practice two"),
    step("practice", "Extra practice three"),
    step("practice", "Extra practice four"),
    step("practice", "Extra practice five"),
  ],
});

export const noPracticePathResponse = JSON.stringify({
  steps: [
    step("explanation", "One idea"),
    step("explanation", "Another idea"),
    step("checkpoint", "Say it back"),
  ],
});

export const noCheckpointPathResponse = JSON.stringify({
  steps: [
    step("explanation", "One idea"),
    step("practice", "Try it"),
    step("project", "Build it"),
  ],
});

export const duplicateTitlesPathResponse = JSON.stringify({
  steps: [
    step("explanation", "Same title"),
    step("practice", "Same title"),
    step("checkpoint", "Different title"),
  ],
});

export const badKindPathResponse = JSON.stringify({
  steps: [
    step("explanation", "One idea"),
    {
      kind: "lecture",
      title: "Not a real kind",
      body: "A short explanation of the idea, followed by one thing to try.",
      estimated_minutes: 15,
    },
    step("checkpoint", "Say it back"),
  ],
});

export const badMinutesPathResponse = JSON.stringify({
  steps: [
    step("explanation", "One idea", 3),
    step("practice", "Try it"),
    step("checkpoint", "Say it back"),
  ],
});

export const missingStepsResponse = JSON.stringify({ plan: [] });

export const nonJsonResponse = "I would start with the basics and practise.";

const PLAN_ID = "a1000000-0000-4000-8000-000000000001";
const GOAL_ID = "a1000000-0000-4000-8000-000000000002";
export const LEARNING_PLAN: LearningPlan = {
  id: PLAN_ID,
  goal_id: GOAL_ID,
  what_to_learn: "CSS grid layout",
  experience: "some",
  outcome: "Build a two-column page layout",
  minutes_per_week: 120,
  model: "glm-5.3-flash",
  created_at: "2026-11-02T09:00:00.000Z",
  updated_at: "2026-11-02T09:00:00.000Z",
};

export function makeStep(
  position: number,
  kind: LearningStep["kind"],
  overrides: Partial<LearningStep> = {},
): LearningStep {
  return {
    id: `a1000000-0000-4000-8000-00000000001${position}`,
    plan_id: PLAN_ID,
    position,
    kind,
    title: `Step ${position}`,
    body: "Some learning material for this step.",
    estimated_minutes: 15,
    status: "active",
    approved_at: null,
    created_at: "2026-11-02T09:00:00.000Z",
    updated_at: "2026-11-02T09:00:00.000Z",
    ...overrides,
  };
}

export const LEARNING_STEPS: LearningStep[] = [
  makeStep(1, "explanation"),
  makeStep(2, "practice"),
  makeStep(3, "checkpoint"),
];

export const LEARNING_RECORD: LearningRecord = {
  id: "a1000000-0000-4000-8000-000000000009",
  step_id: LEARNING_STEPS[1].id,
  goal_id: GOAL_ID,
  prompt: null,
  answer: "A first answer, in my own words.",
  feedback: "The structure is clear; the last sentence is doing two jobs.",
  confidence: 3,
  revisit: true,
  completed_at: "2026-11-02T10:00:00.000Z",
  created_at: "2026-11-02T09:30:00.000Z",
  updated_at: "2026-11-02T10:00:00.000Z",
};
