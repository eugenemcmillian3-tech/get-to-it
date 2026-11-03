"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type {
  FormState,
  LearningHelpState,
  LearningPlanState,
} from "@/lib/action-state";
import { finishAiRequest, reserveAiRequest } from "@/lib/ai/limits";
import { aiModelLabel, DEFAULT_AI_MODEL, isAiModel } from "@/lib/ai/models";
import { chatWithOllama, OllamaError, ollamaErrorMessage } from "@/lib/ai/ollama";
import {
  MAX_LEARNING_ANSWER,
  MAX_LEARNING_FEEDBACK,
  buildLearningHelpMessages,
  buildLearningPathMessages,
  learningHelpRequestSchema,
  learningPlanInputSchema,
  parseLearningPath,
  parseLearningReply,
} from "@/lib/learning";
import { getSession } from "@/lib/auth";
import { getGoalDetail } from "@/lib/data/goals";
import { getLearningPlan, getLearningStep } from "@/lib/data/learning";
import { getPreferences } from "@/lib/data/preferences";
import { firstErrorMessage, isUuid, readText } from "@/lib/validation";

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That learning material isn't available. Go back to the goal.";
const PATH_UNUSABLE =
  "The model's reply wasn't a usable learning path, so nothing was saved. Try again, or edit the goal and retry.";
const PATH_TIMEOUT_MS = 60_000;

function fail(message: string): FormState {
  return { status: "error", message };
}

/**
 * Generates a learning path for one goal.
 *
 * A plan is only written after the whole reply validates, and the steps are
 * inserted with it: a half-saved path is removed rather than left behind. The
 * checkpoint steps start unapproved, so nothing is "passed" automatically.
 */
export async function createLearningPlanAction(
  _previous: LearningPlanState,
  formData: FormData,
): Promise<LearningPlanState> {
  const session = await getSession();
  if (!session) {
    return { status: "error", message: SESSION_EXPIRED, nonce: Date.now() };
  }

  const goalId = readText(formData, "goal_id");
  if (!isUuid(goalId)) {
    return { status: "error", message: NOT_AVAILABLE, nonce: Date.now() };
  }

  const parsed = learningPlanInputSchema.safeParse({
    what_to_learn: readText(formData, "what_to_learn"),
    experience: readText(formData, "experience"),
    outcome: readText(formData, "outcome"),
    minutes_per_week: readText(formData, "minutes_per_week"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: firstErrorMessage(parsed.error),
      nonce: Date.now(),
    };
  }

  const detail = await getGoalDetail(session, goalId);
  if (!detail) {
    return { status: "error", message: NOT_AVAILABLE, nonce: Date.now() };
  }

  const existing = await getLearningPlan(session, goalId);
  if (existing) {
    return {
      status: "error",
      message: "This goal already has a learning path. Open it to edit or skip steps.",
      nonce: Date.now(),
    };
  }

  const requestedModel = readText(formData, "model");
  const model = isAiModel(requestedModel) ? requestedModel : DEFAULT_AI_MODEL;

  const reserved = await reserveAiRequest(session, "learning", model);
  if (!reserved.ok) {
    return { status: "error", message: reserved.message, nonce: Date.now() };
  }

  const { id: requestId, remaining } = reserved.reservation;

  try {
    const preferences = await getPreferences(session);
    const reply = await chatWithOllama({
      model,
      messages: buildLearningPathMessages(parsed.data, preferences),
      temperature: 0.4,
      timeoutMs: PATH_TIMEOUT_MS,
      format: "json",
    });

    const path = parseLearningPath(reply.content);
    if (path.kind === "invalid") {
      await finishAiRequest(session, requestId, "failed", path.reason);
      console.error("createLearningPlanAction rejected model output:", path.reason);
      return {
        status: "error",
        message: PATH_UNUSABLE,
        remaining,
        nonce: Date.now(),
      };
    }

    const { data: plan, error: planError } = await session.supabase
      .from("learning_plans")
      .insert({
        user_id: session.user.id,
        goal_id: goalId,
        what_to_learn: parsed.data.what_to_learn,
        experience: parsed.data.experience,
        outcome: parsed.data.outcome,
        minutes_per_week: parsed.data.minutes_per_week,
        model,
      })
      .select("id")
      .single();

    if (planError || !plan) {
      console.error("createLearningPlanAction plan insert failed:", planError?.message);
      await finishAiRequest(session, requestId, "failed", "save-failed");
      return {
        status: "error",
        message:
          planError?.code === "23505"
            ? "This goal already has a learning path. Reload the page to open it."
            : "We couldn't save that learning path. Nothing was kept — try again.",
        remaining,
        nonce: Date.now(),
      };
    }

    const planId = plan.id as string;
    const rows = path.steps.map((step, index) => ({
      plan_id: planId,
      user_id: session.user.id,
      position: index + 1,
      kind: step.kind,
      title: step.title,
      body: step.body,
      estimated_minutes: step.estimated_minutes,
    }));

    const { error: stepsError } = await session.supabase
      .from("learning_steps")
      .insert(rows);

    if (stepsError) {
      console.error("createLearningPlanAction steps failed:", stepsError.message);
      await session.supabase
        .from("learning_plans")
        .delete()
        .eq("id", planId)
        .eq("user_id", session.user.id);
      await finishAiRequest(session, requestId, "failed", "save-failed");
      return {
        status: "error",
        message: "We couldn't save the learning steps. Nothing was kept — try again.",
        remaining,
        nonce: Date.now(),
      };
    }

    await finishAiRequest(session, requestId, "succeeded", undefined, reply.tokens);

    revalidatePath(`/goals/${goalId}`);
    revalidatePath(`/goals/${goalId}/learn`);

    return {
      status: "saved",
      message: `Learning path saved with ${rows.length} steps. Every step can be edited or skipped, and checkpoints wait for your approval.`,
      planId,
      remaining,
      nonce: Date.now(),
    };
  } catch (error) {
    const code = error instanceof OllamaError ? error.code : "unexpected";
    await finishAiRequest(session, requestId, "failed", code);
    console.error("createLearningPlanAction failed:", (error as Error)?.message);
    return {
      status: "error",
      message: ollamaErrorMessage(error),
      remaining,
      nonce: Date.now(),
    };
  }
}

const stepEditSchema = z.object({
  goal_id: z.string().trim().max(64),
  step_id: z.string().trim().max(64),
  title: z.string().trim().min(2, "Give the step a name.").max(200, "Keep the name under 200 characters."),
  body: z.string().trim().min(10, "Keep at least a sentence of material.").max(4000, "Keep this under 4000 characters."),
  estimated_minutes: z.coerce
    .number()
    .int()
    .min(5, "Estimates start at 5 minutes.")
    .max(120, "Keep estimates at 120 minutes or less."),
});

/** Edits the wording of one step. Ownership is checked before the update. */
export async function updateLearningStepAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const parsed = stepEditSchema.safeParse({
    goal_id: readText(formData, "goal_id"),
    step_id: readText(formData, "step_id"),
    title: readText(formData, "title"),
    body: readText(formData, "body"),
    estimated_minutes: readText(formData, "estimated_minutes"),
  });

  if (!parsed.success) {
    console.error("updateLearningStepAction rejected input:", firstErrorMessage(parsed.error));
    return;
  }

  if (!isUuid(parsed.data.goal_id) || !isUuid(parsed.data.step_id)) return;

  const plan = await getLearningPlan(session, parsed.data.goal_id);
  if (!plan || !plan.steps.some((step) => step.id === parsed.data.step_id)) {
    return;
  }

  const { error } = await session.supabase
    .from("learning_steps")
    .update({
      title: parsed.data.title,
      body: parsed.data.body,
      estimated_minutes: parsed.data.estimated_minutes,
    })
    .eq("id", parsed.data.step_id)
    .eq("plan_id", plan.plan.id)
    .eq("user_id", session.user.id);

  if (error) {
    console.error("updateLearningStepAction failed:", error.message);
    return;
  }

  revalidatePath(`/goals/${parsed.data.goal_id}/learn`);
  revalidatePath(`/goals/${parsed.data.goal_id}/learn/${parsed.data.step_id}`);
}

/** Sets a step aside, or brings it back. Nothing is deleted. */
export async function setLearningStepStatusAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const goalId = readText(formData, "goal_id");
  const stepId = readText(formData, "step_id");
  const status = readText(formData, "status") === "skipped" ? "skipped" : "active";
  if (!isUuid(goalId) || !isUuid(stepId)) return;

  const plan = await getLearningPlan(session, goalId);
  if (!plan) return;

  const { error } = await session.supabase
    .from("learning_steps")
    .update({ status })
    .eq("id", stepId)
    .eq("plan_id", plan.plan.id)
    .eq("user_id", session.user.id);

  if (error) {
    console.error("setLearningStepStatusAction failed:", error.message);
    return;
  }

  revalidatePath(`/goals/${goalId}/learn`);
  revalidatePath(`/goals/${goalId}/learn/${stepId}`);
}

/** Approves or withdraws a checkpoint. Only the owner can do it, and only a checkpoint. */
export async function approveLearningCheckpointAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const goalId = readText(formData, "goal_id");
  const stepId = readText(formData, "step_id");
  const intent = readText(formData, "intent");
  if (!isUuid(goalId) || !isUuid(stepId)) return;

  const detail = await getLearningStep(session, goalId, stepId);
  if (!detail || detail.step.kind !== "checkpoint") return;

  const { error } = await session.supabase
    .from("learning_steps")
    .update({ approved_at: intent === "withdraw" ? null : new Date().toISOString() })
    .eq("id", stepId)
    .eq("user_id", session.user.id);

  if (error) {
    console.error("approveLearningCheckpointAction failed:", error.message);
    return;
  }

  revalidatePath(`/goals/${goalId}/learn`);
  revalidatePath(`/goals/${goalId}/learn/${stepId}`);
}

/** Removes the whole learning path, its steps and its saved records. */
export async function deleteLearningPlanAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const goalId = readText(formData, "goal_id");
  if (!isUuid(goalId)) return;
  const plan = await getLearningPlan(session, goalId);
  if (!plan) return;

  const { error } = await session.supabase
    .from("learning_plans")
    .delete()
    .eq("id", plan.plan.id)
    .eq("user_id", session.user.id);

  if (error) {
    console.error("deleteLearningPlanAction failed:", error.message);
    return;
  }

  revalidatePath(`/goals/${goalId}/learn`);
  revalidatePath(`/goals/${goalId}`);
}

const answerSchema = z.object({
  goal_id: z.string().trim().max(64),
  step_id: z.string().trim().max(64),
  answer: z.string().max(MAX_LEARNING_ANSWER, "Keep answers under 4000 characters."),
  prompt: z.string().max(2000),
  confidence: z.number().int().min(1).max(5).nullable(),
  revisit: z.boolean(),
  completed: z.boolean(),
});

/**
 * Saves one exercise answer.
 *
 * Answer, confidence and completion are written as separate fields. Feedback
 * already saved is left alone: a new answer does not silently keep an old
 * opinion attached to it, but it does not erase it either — the person can
 * review again or clear the record.
 */
export async function saveLearningAnswerAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const confidenceRaw = readText(formData, "confidence");

  const parsed = answerSchema.safeParse({
    goal_id: readText(formData, "goal_id"),
    step_id: readText(formData, "step_id"),
    answer: readText(formData, "answer"),
    prompt: readText(formData, "prompt"),
    confidence: confidenceRaw === "" ? null : Number(confidenceRaw),
    revisit: readText(formData, "revisit") === "true",
    completed: readText(formData, "completed") === "true",
  });

  if (!parsed.success) {
    return fail(firstErrorMessage(parsed.error));
  }

  if (!isUuid(parsed.data.goal_id) || !isUuid(parsed.data.step_id)) {
    return fail(NOT_AVAILABLE);
  }

  const detail = await getLearningStep(session, parsed.data.goal_id, parsed.data.step_id);
  if (!detail) return fail(NOT_AVAILABLE);

  const { error } = await session.supabase.from("learning_records").upsert(
    {
      step_id: parsed.data.step_id,
      user_id: session.user.id,
      goal_id: parsed.data.goal_id,
      prompt: parsed.data.prompt === "" ? null : parsed.data.prompt,
      answer: parsed.data.answer,
      confidence: parsed.data.confidence,
      revisit: parsed.data.revisit,
      completed_at: parsed.data.completed ? new Date().toISOString() : null,
    },
    { onConflict: "step_id" },
  );

  if (error) {
    console.error("saveLearningAnswerAction failed:", error.message);
    return fail("We couldn't save your answer. Nothing was lost — try again.");
  }

  revalidatePath(`/goals/${parsed.data.goal_id}/learn`);
  revalidatePath(`/goals/${parsed.data.goal_id}/learn/${parsed.data.step_id}`);

  return {
    status: "success",
    message: parsed.data.completed
      ? "Answer saved. Your confidence and the AI feedback stay separate from this."
      : "Answer saved. You can come back to it.",
    nonce: Date.now(),
  };
}

/** Stores AI feedback only after the person chooses to keep it. */
export async function saveLearningFeedbackAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const goalId = readText(formData, "goal_id");
  const stepId = readText(formData, "step_id");
  const feedback = readText(formData, "feedback");

  if (!isUuid(goalId) || !isUuid(stepId)) return fail(NOT_AVAILABLE);
  if (feedback.length < 2) return fail("There is no feedback to save yet.");
  if (feedback.length > MAX_LEARNING_FEEDBACK) {
    return fail("That feedback is too long to save.");
  }

  const detail = await getLearningStep(session, goalId, stepId);
  if (!detail) return fail(NOT_AVAILABLE);

  const { error } = await session.supabase.from("learning_records").upsert(
    {
      step_id: stepId,
      user_id: session.user.id,
      goal_id: goalId,
      feedback,
    },
    { onConflict: "step_id" },
  );

  if (error) {
    console.error("saveLearningFeedbackAction failed:", error.message);
    return fail("We couldn't save that feedback. Try again.");
  }

  revalidatePath(`/goals/${goalId}/learn/${stepId}`);

  return {
    status: "success",
    message: "Feedback saved with this exercise. It's an opinion, not a grade.",
    nonce: Date.now(),
  };
}

/** Deletes one saved record. The step and its material stay. */
export async function deleteLearningRecordAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const goalId = readText(formData, "goal_id");
  const stepId = readText(formData, "step_id");
  if (!isUuid(goalId) || !isUuid(stepId)) return;

  const { error } = await session.supabase
    .from("learning_records")
    .delete()
    .eq("step_id", stepId)
    .eq("goal_id", goalId)
    .eq("user_id", session.user.id);

  if (error) {
    console.error("deleteLearningRecordAction failed:", error.message);
    return;
  }

  revalidatePath(`/goals/${goalId}/learn`);
  revalidatePath(`/goals/${goalId}/learn/${stepId}`);
}

/**
 * One step-level AI answer.
 *
 * It saves nothing: the text comes back as a suggestion. Saving the answer,
 * keeping the feedback and marking the exercise finished are three separate,
 * person-driven actions.
 */
export async function learningHelpAction(
  _previous: LearningHelpState,
  formData: FormData,
): Promise<LearningHelpState> {
  const session = await getSession();
  if (!session) {
    return { status: "error", message: SESSION_EXPIRED, nonce: Date.now() };
  }

  const goalId = readText(formData, "goal_id");
  if (!isUuid(goalId)) {
    return { status: "error", message: NOT_AVAILABLE, nonce: Date.now() };
  }

  const parsed = learningHelpRequestSchema.safeParse({
    step_id: readText(formData, "step_id"),
    intent: readText(formData, "intent"),
    answer: readText(formData, "answer"),
    model: readText(formData, "model"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: firstErrorMessage(parsed.error),
      nonce: Date.now(),
    };
  }

  const detail = await getLearningStep(session, goalId, parsed.data.step_id);
  if (!detail) {
    return { status: "error", message: NOT_AVAILABLE, nonce: Date.now() };
  }

  const model = isAiModel(parsed.data.model) ? parsed.data.model : DEFAULT_AI_MODEL;

  const reserved = await reserveAiRequest(session, "learning_help", model);
  if (!reserved.ok) {
    return { status: "error", message: reserved.message, nonce: Date.now() };
  }

  const { id: requestId, remaining } = reserved.reservation;

  try {
    const preferences = await getPreferences(session);
    const reply = await chatWithOllama({
      model,
      messages: buildLearningHelpMessages(
        {
          plan: detail.plan,
          step: detail.step,
          answer: parsed.data.answer,
        },
        parsed.data.intent,
        preferences,
      ),
      temperature: 0.5,
      timeoutMs: 45_000,
    });

    const result = parseLearningReply(reply.content);
    if (result.kind === "invalid") {
      await finishAiRequest(session, requestId, "failed", result.reason);
      console.error("learningHelpAction rejected model output:", result.reason);
      return {
        status: "error",
        message:
          "The model's reply wasn't usable, so nothing changed. Your answer is exactly as it was.",
        remaining,
        nonce: Date.now(),
      };
    }

    await finishAiRequest(session, requestId, "succeeded", undefined, reply.tokens);

    return {
      status: "suggestion",
      text: result.text,
      intent: parsed.data.intent,
      model: reply.model,
      remaining,
      message: `Suggestion from ${aiModelLabel(model)}. Nothing has been saved.`,
      nonce: Date.now(),
    };
  } catch (error) {
    const code = error instanceof OllamaError ? error.code : "unexpected";
    await finishAiRequest(session, requestId, "failed", code);
    console.error("learningHelpAction failed:", (error as Error)?.message);
    return {
      status: "error",
      message: ollamaErrorMessage(error),
      remaining,
      nonce: Date.now(),
    };
  }
}
