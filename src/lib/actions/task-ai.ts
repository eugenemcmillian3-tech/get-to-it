"use server";

import type { TaskAiState } from "@/lib/action-state";
import { finishAiRequest, reserveAiRequest } from "@/lib/ai/limits";
import { aiModelLabel, DEFAULT_AI_MODEL, isAiModel } from "@/lib/ai/models";
import {
  chatWithOllama,
  OllamaError,
  ollamaErrorMessage,
} from "@/lib/ai/ollama";
import {
  buildTaskHelpMessages,
  parseTaskHelpReply,
  taskHelpRequestSchema,
} from "@/lib/ai/task-help";
import { getSession } from "@/lib/auth";
import { getTaskWorkspace } from "@/lib/data/goals";
import { getPreferences } from "@/lib/data/preferences";
import { firstErrorMessage, readText } from "@/lib/validation";

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE =
  "That task isn't available. Go back to your goal and open it again.";
const UNUSABLE_REPLY =
  "The model's reply wasn't usable, so nothing changed. Your notes are exactly as they were.";
const TASK_HELP_TIMEOUT_MS = 45_000;

/**
 * One task-workspace AI request.
 *
 * Reads nothing but the active task, its goal and the notes for that task, and
 * writes nothing at all: the answer comes back as text for the person to edit,
 * accept or discard. Saving and completing stay separate, person-driven actions.
 */
export async function taskAiAction(
  _previous: TaskAiState,
  formData: FormData,
): Promise<TaskAiState> {
  const session = await getSession();
  if (!session) {
    return { status: "error", message: SESSION_EXPIRED, nonce: Date.now() };
  }

  const parsed = taskHelpRequestSchema.safeParse({
    goal_id: readText(formData, "goal_id"),
    task_id: readText(formData, "task_id"),
    intent: readText(formData, "intent"),
    content: readText(formData, "content"),
    model: readText(formData, "model"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: firstErrorMessage(parsed.error),
      nonce: Date.now(),
    };
  }

  const { goal_id: goalId, task_id: taskId, intent, content } = parsed.data;
  const requestedModel = parsed.data.model;
  const model = isAiModel(requestedModel) ? requestedModel : DEFAULT_AI_MODEL;

  // Ownership is enforced here and by row level security; a task that isn't
  // yours resolves to the same message as one that doesn't exist.
  const [workspace, preferences] = await Promise.all([
    getTaskWorkspace(session, goalId, taskId),
    getPreferences(session),
  ]);
  if (!workspace) {
    return { status: "error", message: NOT_AVAILABLE, nonce: Date.now() };
  }

  // The editor may hold unsaved typing, which is what reviews should see.
  const savedWork = content.trim() !== "" ? content : (workspace.result?.content ?? "");

  // Same database-enforced allowance as every other AI entry point.
  const reserved = await reserveAiRequest(session, "task_help", model);
  if (!reserved.ok) {
    return { status: "error", message: reserved.message, nonce: Date.now() };
  }

  const { id: requestId, remaining } = reserved.reservation;

  try {
    const reply = await chatWithOllama({
      model,
      messages: buildTaskHelpMessages(
        { goal: workspace.goal, task: workspace.task, savedWork },
        intent,
        preferences,
      ),
      temperature: 0.5,
      timeoutMs: TASK_HELP_TIMEOUT_MS,
    });

    const result = parseTaskHelpReply(reply.content);

    if (result.kind === "invalid") {
      await finishAiRequest(session, requestId, "failed", result.reason);
      console.error("taskAiAction rejected model output:", result.reason);
      return {
        status: "error",
        message: UNUSABLE_REPLY,
        remaining,
        nonce: Date.now(),
      };
    }

    await finishAiRequest(session, requestId, "succeeded", undefined, reply.tokens);

    return {
      status: "suggestion",
      text: result.text,
      intent,
      model: reply.model,
      remaining,
      message: `Suggestion from ${aiModelLabel(model)}. Nothing has been saved or completed.`,
      nonce: Date.now(),
    };
  } catch (error) {
    const code = error instanceof OllamaError ? error.code : "unexpected";
    await finishAiRequest(session, requestId, "failed", code);
    console.error("taskAiAction failed:", (error as Error)?.message);
    return {
      status: "error",
      message: ollamaErrorMessage(error),
      remaining,
      nonce: Date.now(),
    };
  }
}
