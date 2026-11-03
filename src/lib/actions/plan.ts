"use server";

import { revalidatePath } from "next/cache";
import type { PlanState } from "@/lib/action-state";
import { finishAiRequest, reserveAiRequest } from "@/lib/ai/limits";
import { DEFAULT_AI_MODEL, isAiModel } from "@/lib/ai/models";
import { chatWithOllama, OllamaError, ollamaErrorMessage } from "@/lib/ai/ollama";
import {
  buildPlanMessages,
  computePlanSnapshot,
  isPlanSnapshotStale,
  parsePlanResponse,
  planAnswersSchema,
  planSaveSchema,
  type PlanAnswer,
  type PlanContext,
} from "@/lib/ai/plan";
import { getSession } from "@/lib/auth";
import { getGoalDetail } from "@/lib/data/goals";
import { getPreferences } from "@/lib/data/preferences";
import { firstErrorMessage, isUuid, readText } from "@/lib/validation";

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That goal isn't available. Go back to your dashboard.";

const UNUSABLE_REPLY =
  "The model's reply wasn't a usable plan, so nothing changed. Try again, or write the tasks yourself.";
const ASKED_AGAIN =
  "The model asked for more detail again instead of planning. Nothing changed — try again, or write the tasks yourself.";
const STALE_PREVIEW =
  "This goal changed since you previewed that plan — something was added, completed or edited in the meantime. Nothing was overwritten. Generate a fresh plan to see the current state.";
const ALREADY_SAVED = "That plan was already saved. Refresh the page to see the tasks.";
const PLAN_TIMEOUT_MS = 60_000;

/**
 * "Help me plan this goal."
 *
 * Two calls at most: `start` either returns questions or a plan, and `answer`
 * turns answers into a plan. Nothing here writes to the tasks table — the
 * preview lives in the browser until the person approves it.
 */
export async function planGoalAction(
  _previous: PlanState,
  formData: FormData,
): Promise<PlanState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const goalId = readText(formData, "goal_id");
  if (!isUuid(goalId)) return { status: "error", message: NOT_AVAILABLE };

  const mode = readText(formData, "mode") === "answer" ? "answer" : "start";
  const requestedModel = readText(formData, "model");
  const model = isAiModel(requestedModel) ? requestedModel : DEFAULT_AI_MODEL;

  let answers: PlanAnswer[] = [];
  if (mode === "answer") {
    const collected: PlanAnswer[] = [];
    for (let index = 0; index < 3; index += 1) {
      const question = readText(formData, `question-${index}`);
      const answer = readText(formData, `answer-${index}`);
      if (question === "" || answer === "") continue;
      collected.push({ question, answer });
    }

    const parsedAnswers = planAnswersSchema.safeParse({ answers: collected });
    if (!parsedAnswers.success) {
      return {
        status: "error",
        message:
          "Answer at least one question, or start over without them.",
        nonce: Date.now(),
      };
    }

    answers = parsedAnswers.data.answers;
  }

  // Ownership is checked here and again by row level security.
  const [detail, preferences] = await Promise.all([
    getGoalDetail(session, goalId),
    getPreferences(session),
  ]);
  if (!detail) return { status: "error", message: NOT_AVAILABLE };

  const context: PlanContext = {
    title: detail.goal.title,
    desiredOutcome: detail.goal.desired_outcome,
    deadline: detail.goal.deadline,
    timeAvailableMinutes: detail.goal.time_available_minutes,
    blocker: detail.goal.blocker,
    openTasks: detail.tasks
      .filter((task) => task.status !== "completed")
      .map((task) => task.title),
    completedTasks: detail.tasks
      .filter((task) => task.status === "completed")
      .map((task) => task.title),
  };

  // Fingerprint now, before the model is called: if the goal moves while the
  // request is running, the eventual save is rejected as stale.
  const snapshot = computePlanSnapshot(detail.goal, detail.tasks);

  const reserved = await reserveAiRequest(session, "plan", model);
  if (!reserved.ok) {
    return { status: "error", message: reserved.message, nonce: Date.now() };
  }

  const { id: requestId, remaining } = reserved.reservation;

  try {
    const reply = await chatWithOllama({
      model,
      messages: buildPlanMessages(
        context,
        mode === "answer" ? answers : undefined,
        preferences,
      ),
      temperature: 0.4,
      timeoutMs: PLAN_TIMEOUT_MS,
      format: "json",
    });

    const parsed = parsePlanResponse(reply.content);

    if (parsed.kind === "invalid") {
      await finishAiRequest(session, requestId, "failed", parsed.reason);
      console.error("planGoalAction rejected model output:", parsed.reason);
      return { status: "error", message: UNUSABLE_REPLY, remaining, nonce: Date.now() };
    }

    if (parsed.kind === "questions") {
      if (mode === "answer") {
        await finishAiRequest(session, requestId, "failed", "asked-again");
        return { status: "error", message: ASKED_AGAIN, remaining, nonce: Date.now() };
      }

      await finishAiRequest(session, requestId, "succeeded", undefined, reply.tokens);
      return {
        status: "clarify",
        questions: parsed.questions,
        snapshot,
        model: reply.model,
        remaining,
        nonce: Date.now(),
      };
    }

    await finishAiRequest(session, requestId, "succeeded", undefined, reply.tokens);
    return {
      status: "preview",
      tasks: parsed.tasks,
      snapshot,
      planId: crypto.randomUUID(),
      model: reply.model,
      remaining,
      nonce: Date.now(),
    };
  } catch (error) {
    const code = error instanceof OllamaError ? error.code : "unexpected";
    await finishAiRequest(session, requestId, "failed", code);
    console.error("planGoalAction failed:", (error as Error)?.message);
    return {
      status: "error",
      message: ollamaErrorMessage(error),
      remaining,
      nonce: Date.now(),
    };
  }
}

/**
 * Saves an approved preview by appending tasks. Existing tasks — completed
 * ones, in-progress ones and anything with saved work — are never touched.
 */
export async function savePlanAction(
  _previous: PlanState,
  formData: FormData,
): Promise<PlanState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  let rawTasks: unknown = null;
  try {
    rawTasks = JSON.parse(readText(formData, "tasks_json"));
  } catch {
    rawTasks = null;
  }

  const parsed = planSaveSchema.safeParse({
    goal_id: readText(formData, "goal_id"),
    snapshot: readText(formData, "snapshot"),
    tasks: rawTasks,
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: firstErrorMessage(parsed.error),
      nonce: Date.now(),
    };
  }

  const goalId = parsed.data.goal_id;
  const planId = readText(formData, "plan_id");
  if (!isUuid(goalId) || !isUuid(planId)) {
    return { status: "error", message: NOT_AVAILABLE, nonce: Date.now() };
  }

  const detail = await getGoalDetail(session, goalId);
  if (!detail) return { status: "error", message: NOT_AVAILABLE };

  const currentSnapshot = computePlanSnapshot(detail.goal, detail.tasks);
  if (isPlanSnapshotStale(parsed.data.snapshot, currentSnapshot)) {
    return { status: "error", message: STALE_PREVIEW, nonce: Date.now() };
  }

  const requestedModel = readText(formData, "model");
  const model = isAiModel(requestedModel) ? requestedModel : DEFAULT_AI_MODEL;

  // The plan id doubles as an idempotency key: a double click loses the race
  // in the primary key instead of adding the tasks twice.
  const { error: planError } = await session.supabase.from("ai_plans").insert({
    id: planId,
    goal_id: goalId,
    user_id: session.user.id,
    model,
    task_count: parsed.data.tasks.length,
  });

  if (planError) {
    console.error("savePlanAction plan insert failed:", planError.message);
    if (planError.code === "23505") {
      return { status: "error", message: ALREADY_SAVED, nonce: Date.now() };
    }
    return {
      status: "error",
      message: "We couldn't save that plan. Nothing was changed — try again.",
      nonce: Date.now(),
    };
  }

  const baseOrder = detail.tasks.reduce(
    (highest, task) => Math.max(highest, task.sort_order ?? 0),
    0,
  );

  const rows = parsed.data.tasks.map((task, index) => ({
    goal_id: goalId,
    user_id: session.user.id,
    title: task.title,
    instructions: task.instructions === "" ? null : task.instructions,
    first_action: task.first_action === "" ? null : task.first_action,
    expected_deliverable:
      task.expected_deliverable === "" ? null : task.expected_deliverable,
    estimated_minutes: task.estimated_minutes,
    origin: "ai_plan" as const,
    sort_order: baseOrder + index + 1,
    plan_id: planId,
  }));

  const { error: tasksError } = await session.supabase.from("tasks").insert(rows);

  if (tasksError) {
    console.error("savePlanAction task insert failed:", tasksError.message);
    // Drop the empty plan record so a retry isn't mistaken for a duplicate.
    await session.supabase
      .from("ai_plans")
      .delete()
      .eq("id", planId)
      .eq("user_id", session.user.id);

    return {
      status: "error",
      message: "We couldn't save the tasks. Nothing was changed — try again.",
      nonce: Date.now(),
    };
  }

  revalidatePath(`/goals/${goalId}`);
  revalidatePath("/dashboard");

  return {
    status: "saved",
    message: `${rows.length} ${rows.length === 1 ? "task" : "tasks"} added to this goal.`,
    savedCount: rows.length,
    model,
    nonce: Date.now(),
  };
}
