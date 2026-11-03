/**
 * Fixtures for the planning parser tests.
 *
 * These are shaped like real model replies: valid JSON, fenced JSON, JSON with
 * chatter around it, and several kinds of plausible-but-unusable output.
 */

export const planTaskFixture = (title: string) => ({
  title,
  instructions:
    "Open the draft and write the first two sentences without editing yourself.",
  first_action: "Open the draft.",
  expected_deliverable: "Two sentences saved in the draft.",
  estimated_minutes: 15,
});

export const validPlanObject = {
  tasks: [
    "Outline the case study",
    "Draft the hero copy",
    "Pick three screenshots",
    "Publish the page",
  ].map(planTaskFixture),
};

export const validPlanResponse = JSON.stringify(validPlanObject);

export const fencedPlanResponse = [
  "```json",
  JSON.stringify(validPlanObject, null, 2),
  "```",
].join("\n");

export const proseWrappedPlanResponse = [
  "Sure — here is a plan:",
  JSON.stringify(validPlanObject),
  "Hope that helps.",
].join("\n");

export const clarifyResponse = JSON.stringify({
  questions: [
    "What does the site need to do for you?",
    "Who is it for?",
  ],
});

export const emptyQuestionsResponse = JSON.stringify({ questions: [] });

export const ambiguousResponse = JSON.stringify({
  questions: ["What is it for?"],
  tasks: validPlanObject.tasks,
});

export const tooFewTasksResponse = JSON.stringify({
  tasks: validPlanObject.tasks.slice(0, 2),
});

export const tooManyTasksResponse = JSON.stringify({
  tasks: [
    ...validPlanObject.tasks,
    [
      "Write the about page",
      "Add contact details",
      "Check mobile layout",
      "Ask two people for feedback",
    ].map(planTaskFixture),
  ].flat(),
});

export const missingFieldResponse = JSON.stringify({
  tasks: validPlanObject.tasks.map((task) => ({
    title: task.title,
    instructions: task.instructions,
    expected_deliverable: task.expected_deliverable,
    estimated_minutes: task.estimated_minutes,
  })),
});

export const duplicateTitlesResponse = JSON.stringify({
  tasks: ["Draft the intro", "draft the intro", "DRAFT THE INTRO"].map(
    planTaskFixture,
  ),
});

export const badMinutesResponse = JSON.stringify({
  tasks: validPlanObject.tasks.map((task, index) =>
    index === 0 ? { ...task, estimated_minutes: 1 } : task,
  ),
});

export const nonJsonResponse = "I'm not able to help with that.";
