"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FuturePathState } from "@/lib/action-state";
import { finishAiRequest, reserveAiRequest } from "@/lib/ai/limits";
import { DEFAULT_AI_MODEL, isAiModel } from "@/lib/ai/models";
import { chatWithOllama, ollamaErrorMessage } from "@/lib/ai/ollama";
import { getSession } from "@/lib/auth";
import { getFuturePathDetail } from "@/lib/data/futures";
import {
  buildScenarioMessages,
  actionTaskInstructions,
  actionTaskTitle,
  allowedSourceUrls,
  futurePathErrorMessage,
  futurePathInputSchema,
  parseScenarioReply,
  rationaleSchema,
  relabelEditedLines,
  SCENARIO_KINDS,
  SCENARIO_LIST_FIELDS,
  LIST_FIELD_LABELS,
  type EvidenceItem,
  type ScenarioKind,
  type ScenarioDraft,
} from "@/lib/futures";
import { firstErrorMessage, isUuid, readText } from "@/lib/validation";

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That future path isn't available to you.";
const UNUSABLE =
  "The reply wasn't a usable set of three scenarios, so nothing was saved. Try again.";
const GENERATE_TIMEOUT_MS = 60_000;

function fail(message: string, remaining?: number): FuturePathState {
  return { status: "error", message, remaining, nonce: Date.now() };
}

function refresh(pathId?: string): void {
  revalidatePath("/futures");
  if (pathId) revalidatePath(`/futures/${pathId}`);
}

function kindOf(value: string): ScenarioKind | null {
  return (SCENARIO_KINDS as readonly string[]).includes(value)
    ? (value as ScenarioKind)
    : null;
}

/**
 * Generates one future path: three scenarios in a single validated reply.
 *
 * Nothing is written until the whole reply parses, every list survives cleanup
 * and all three kinds are present. If the scenario insert fails, the path row is
 * removed rather than left behind as an empty shell.
 */
export async function createFuturePathAction(
  _previous: FuturePathState,
  formData: FormData,
): Promise<FuturePathState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = futurePathInputSchema.safeParse({
    goal_id: readText(formData, "goal_id"),
    decision: readText(formData, "decision"),
    horizon: readText(formData, "horizon"),
    resources: readText(formData, "resources"),
    constraints: readText(formData, "constraints"),
    success_definition: readText(formData, "success_definition"),
    uncertainties: readText(formData, "uncertainties"),
  });

  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const input = parsed.data;

  if (input.goal_id !== "") {
    const { data: goal, error } = await session.supabase
      .from("goals")
      .select("id")
      .eq("id", input.goal_id)
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (error || !goal) return fail("That goal isn't one of yours.");
  }

  const requestedModel = readText(formData, "model");
  const model = isAiModel(requestedModel) ? requestedModel : DEFAULT_AI_MODEL;

  const reserved = await reserveAiRequest(session, "future_paths", model);
  if (!reserved.ok) return fail(reserved.message);

  const { id: requestId, remaining } = reserved.reservation;

  let scenarios: ScenarioDraft[];

  try {
    const reply = await chatWithOllama({
      model,
      messages: buildScenarioMessages(input),
      temperature: 0.6,
      timeoutMs: GENERATE_TIMEOUT_MS,
      format: "json",
    });

    const result = parseScenarioReply(reply.content, allowedSourceUrls(input));

    if (result.kind === "invalid") {
      await finishAiRequest(session, requestId, "failed", result.reason);
      console.error("createFuturePathAction rejected model output:", result.reason);
      return fail(UNUSABLE, remaining);
    }

    scenarios = result.scenarios;
    await finishAiRequest(session, requestId, "succeeded", undefined, reply.tokens);
  } catch (error) {
    await finishAiRequest(session, requestId, "failed", "provider-error");
    console.error("createFuturePathAction model call failed");
    return fail(ollamaErrorMessage(error), remaining);
  }

  const { data: path, error: pathError } = await session.supabase
    .from("future_paths")
    .insert({
      user_id: session.user.id,
      goal_id: input.goal_id === "" ? null : input.goal_id,
      decision: input.decision,
      horizon: input.horizon,
      resources: input.resources,
      constraints: input.constraints,
      success_definition: input.success_definition,
      uncertainties: input.uncertainties,
      model,
    })
    .select("id")
    .single();

  if (pathError || !path) {
    console.error("createFuturePathAction path insert failed:", pathError?.message);
    return fail("We couldn't save that future path. Try again.", remaining);
  }

  const pathId = path.id as string;

  const { error: scenarioError } = await session.supabase.from("future_scenarios").insert(
    scenarios.map((scenario) => ({
      path_id: pathId,
      user_id: session.user.id,
      kind: scenario.kind,
      title: scenario.title,
      assumptions: scenario.assumptions,
      developments: scenario.developments,
      opportunities: scenario.opportunities,
      risks: scenario.risks,
      signals: scenario.signals,
      actions: scenario.actions,
      first_steps: scenario.first_steps,
      change_conditions: scenario.change_conditions,
    })),
  );

  if (scenarioError) {
    console.error("createFuturePathAction scenario insert failed:", scenarioError.message);
    await session.supabase.from("future_paths").delete().eq("id", pathId);
    return fail("We couldn't save the scenarios, so nothing was kept. Try again.", remaining);
  }

  refresh(pathId);
  redirect(`/futures/${pathId}`);
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

/**
 * Saves one edited scenario. A rewritten line becomes the person's own statement
 * (label `user`); untouched lines keep their label and source, so opening the
 * editor never quietly turns a retrieved fact or an assumption into a claim of
 * the person's.
 */
export async function updateScenarioAction(
  _previous: FuturePathState,
  formData: FormData,
): Promise<FuturePathState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const pathId = readText(formData, "path_id");
  const scenarioId = readText(formData, "scenario_id");
  if (!isUuid(pathId) || !isUuid(scenarioId)) return fail(NOT_AVAILABLE);

  const { data: scenario, error } = await session.supabase
    .from("future_scenarios")
    .select("*")
    .eq("id", scenarioId)
    .eq("path_id", pathId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error || !scenario) return fail(NOT_AVAILABLE);

  const row = scenario as Record<string, unknown>;
  const update: Record<string, unknown> = {};

  for (const field of SCENARIO_LIST_FIELDS) {
    const previous = Array.isArray(row[field]) ? (row[field] as EvidenceItem[]) : [];
    const next = relabelEditedLines(previous, readText(formData, field).split("\n"));

    if (next.length === 0) {
      return fail(
        `Keep at least one line under “${LIST_FIELD_LABELS[field]}”, or delete the path.`,
      );
    }

    update[field] = next;
  }

  const { error: updateError } = await session.supabase
    .from("future_scenarios")
    .update(update)
    .eq("id", scenarioId)
    .eq("user_id", session.user.id);

  if (updateError) {
    console.error("updateScenarioAction failed:", updateError.message);
    return fail("We couldn't save those edits. Nothing changed.");
  }

  refresh(pathId);
  return {
    status: "success",
    message: "Scenario saved. Lines you rewrote are now labelled as yours.",
    nonce: Date.now(),
  };
}

/**
 * Saves the decision rationale, the chosen scenario and a review date. All three
 * are optional and can be cleared again. No task, goal or deadline is touched.
 */
export async function saveRationaleAction(
  _previous: FuturePathState,
  formData: FormData,
): Promise<FuturePathState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const pathId = readText(formData, "path_id");
  if (!isUuid(pathId)) return fail(NOT_AVAILABLE);

  const parsed = rationaleSchema.safeParse({
    chosen_kind: readText(formData, "chosen_kind"),
    rationale: readText(formData, "rationale"),
    review_at: readText(formData, "review_at"),
  });

  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const rationale = parsed.data.rationale.trim();

  const { error } = await session.supabase
    .from("future_paths")
    .update({
      chosen_kind: parsed.data.chosen_kind === "" ? null : parsed.data.chosen_kind,
      rationale: rationale === "" ? null : rationale,
      rationale_saved_at: rationale === "" ? null : new Date().toISOString(),
      review_at: parsed.data.review_at === "" ? null : parsed.data.review_at,
    })
    .eq("id", pathId)
    .eq("user_id", session.user.id);

  if (error) {
    console.error("saveRationaleAction failed:", error.message);
    return fail("We couldn't save that. Nothing changed.");
  }

  refresh(pathId);
  return {
    status: "success",
    message: "Decision notes saved. You can change or clear them at any time.",
    nonce: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Converting one action into an ordinary task
// ---------------------------------------------------------------------------

/**
 * Turns one action into an ordinary task in the path's goal.
 *
 * The task is created first, then the link row. A unique index on the path,
 * scenario and index makes a second click a no-op instead of a duplicate task;
 * if the link loses that race, the just-created task is removed again. The task
 * is never marked done, and no deadline or plan is changed.
 */
export async function convertActionAction(
  _previous: FuturePathState,
  formData: FormData,
): Promise<FuturePathState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const pathId = readText(formData, "path_id");
  const kind = kindOf(readText(formData, "scenario_kind"));
  const index = Number(readText(formData, "action_index"));

  if (!isUuid(pathId) || !kind) return fail(NOT_AVAILABLE);
  if (!Number.isInteger(index) || index < 0 || index > 11) {
    return fail(futurePathErrorMessage("no-action"));
  }

  const detail = await getFuturePathDetail(session, pathId);
  if (!detail) return fail(futurePathErrorMessage("no-path"));

  const scenario = detail.scenarios.find((entry) => entry.kind === kind);
  const action = scenario?.actions[index];

  if (!action) return fail(futurePathErrorMessage("no-action"));

  if (
    detail.actions.some(
      (link) => link.scenario_kind === kind && link.action_index === index,
    )
  ) {
    return {
      status: "success",
      message: "That action is already one of your tasks.",
      nonce: Date.now(),
    };
  }

  if (!detail.path.goal_id) return fail(futurePathErrorMessage("no-goal"));

  const { data: task, error: taskError } = await session.supabase
    .from("tasks")
    .insert({
      user_id: session.user.id,
      goal_id: detail.path.goal_id,
      title: actionTaskTitle(action.text),
      instructions: actionTaskInstructions(detail.path.decision, kind),
      origin: "manual",
    })
    .select("id")
    .single();

  if (taskError || !task) {
    console.error("convertActionAction task insert failed:", taskError?.message);
    return fail("We couldn't add that task. Nothing changed.");
  }

  const taskId = task.id as string;

  const { error: linkError } = await session.supabase.from("future_actions").insert({
    path_id: pathId,
    user_id: session.user.id,
    scenario_kind: kind,
    action_index: index,
    action_text: actionTaskTitle(action.text),
    task_id: taskId,
  });

  if (linkError) {
    await session.supabase.from("tasks").delete().eq("id", taskId);
    if (linkError.code === "23505") {
      return {
        status: "success",
        message: "That action is already one of your tasks.",
        nonce: Date.now(),
      };
    }
    console.error("convertActionAction link insert failed:", linkError.message);
    return fail("We couldn't link that task, so it was removed again.");
  }

  revalidatePath(`/futures/${pathId}`);
  revalidatePath(`/goals/${detail.path.goal_id}`);
  return {
    status: "success",
    message: "Added as a task in your goal. Edit or delete it like any other task.",
    nonce: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Deleting a path
// ---------------------------------------------------------------------------

export async function deleteFuturePathAction(
  _previous: FuturePathState,
  formData: FormData,
): Promise<FuturePathState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const pathId = readText(formData, "path_id");
  if (!isUuid(pathId)) return fail(NOT_AVAILABLE);

  const { data: path } = await session.supabase
    .from("future_paths")
    .select("goal_id")
    .eq("id", pathId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  const { error } = await session.supabase
    .from("future_paths")
    .delete()
    .eq("id", pathId)
    .eq("user_id", session.user.id);

  if (error) {
    console.error("deleteFuturePathAction failed:", error.message);
    return fail("We couldn't delete that future path. Nothing changed.");
  }

  if (path?.goal_id) revalidatePath(`/goals/${path.goal_id}`);
  revalidatePath("/futures");
  redirect("/futures");
}
