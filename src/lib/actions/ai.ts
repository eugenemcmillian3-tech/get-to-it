"use server";

import type { AiHelpState } from "@/lib/action-state";
import { aiModelLabel, DEFAULT_AI_MODEL, isAiModel } from "@/lib/ai/models";
import { finishAiRequest, reserveAiRequest } from "@/lib/ai/limits";
import {
  chatWithOllama,
  OllamaError,
  ollamaErrorMessage,
  type ChatMessage,
} from "@/lib/ai/ollama";
import { getSession } from "@/lib/auth";
import { getGoalDetail } from "@/lib/data/goals";
import { getPreferences } from "@/lib/data/preferences";
import { formatDeadline, formatMinutes } from "@/lib/format";
import { preferenceContextLines } from "@/lib/preferences";
import { isUuid, readText } from "@/lib/validation";
import type { Goal, Task, UserPreferences } from "@/lib/types";

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That goal isn't available. Go back to your dashboard.";

const SYSTEM_PROMPT = [
  "You help a person get unstuck on a goal they set for themselves.",
  "They decide what to do with your suggestion, so offer options, never orders.",
  "Reply in plain text with no headings and no markdown formatting.",
  "Start with one sentence naming the smallest real first step, then give two or",
  "three short, concrete options that fit the time they have today.",
  "Keep the whole reply under 120 words. Be warm and specific.",
  "Never diagnose, treat or give medical, legal or financial advice.",
].join(" ");

function buildMessages(
  goal: Goal,
  tasks: Task[],
  preferences: UserPreferences,
): ChatMessage[] {
  const open = tasks.filter((task) => task.status !== "completed");
  const done = tasks.filter((task) => task.status === "completed");

  const lines = [
    `Goal: ${goal.title}`,
    `What done looks like: ${goal.desired_outcome}`,
    `Time available today: ${formatMinutes(goal.time_available_minutes)}`,
    goal.deadline ? `Deadline: ${formatDeadline(goal.deadline)}` : "No deadline.",
    goal.blocker ? `What has been in the way: ${goal.blocker}` : "",
    open.length > 0
      ? `Open tasks:\n${open
          .map(
            (task) =>
              `- ${task.title} (${task.status === "in_progress" ? "in progress" : "to do"})`,
          )
          .join("\n")}`
      : "There are no tasks yet.",
    done.length > 0
      ? `Already done: ${done.map((task) => task.title).join("; ")}`
      : "",
    ...preferenceContextLines(preferences),
    "I feel stuck on this. What is the smallest step I could actually do today?",
  ];

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: lines.filter(Boolean).join("\n") },
  ];
}

export async function getUnstuckAction(
  _previous: AiHelpState,
  formData: FormData,
): Promise<AiHelpState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const goalId = readText(formData, "goal_id");
  if (!isUuid(goalId)) return { status: "error", message: NOT_AVAILABLE };

  const requested = readText(formData, "model");
  const model = isAiModel(requested) ? requested : DEFAULT_AI_MODEL;

  // Ownership is enforced here and by row level security.
  const [detail, preferences] = await Promise.all([
    getGoalDetail(session, goalId),
    getPreferences(session),
  ]);
  if (!detail) return { status: "error", message: NOT_AVAILABLE };

  // Same database-enforced allowance as every other AI entry point.
  const reserved = await reserveAiRequest(session, "unstuck", model);
  if (!reserved.ok) {
    return { status: "error", message: reserved.message, nonce: Date.now() };
  }

  const { id: requestId, remaining } = reserved.reservation;

  try {
    const reply = await chatWithOllama({
      model,
      messages: buildMessages(detail.goal, detail.tasks, preferences),
      temperature: 0.6,
    });

    await finishAiRequest(session, requestId, "succeeded", undefined, reply.tokens);

    return {
      status: "success",
      message: `Suggestion from ${aiModelLabel(model)}.`,
      answer: reply.content,
      model: reply.model,
      remaining,
      nonce: Date.now(),
    };
  } catch (error) {
    const code = error instanceof OllamaError ? error.code : "unexpected";
    await finishAiRequest(session, requestId, "failed", code);
    console.error("getUnstuckAction failed:", (error as Error)?.message);
    return {
      status: "error",
      message: ollamaErrorMessage(error),
      remaining,
      nonce: Date.now(),
    };
  }
}
