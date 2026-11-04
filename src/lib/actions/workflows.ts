"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/lib/action-state";
import { finishAiRequest, reserveAiRequest } from "@/lib/ai/limits";
import { aiModelLabel, DEFAULT_AI_MODEL, isAiModel } from "@/lib/ai/models";
import { chatWithOllama, OllamaError, ollamaErrorMessage } from "@/lib/ai/ollama";
import { getSession, type Session } from "@/lib/auth";
import { executorFor, getConnector } from "@/lib/connectors";
import { getWorkflowRun } from "@/lib/data/workflows";
import { getPersonalTemplate } from "@/lib/data/templates";
import { firstErrorMessage, isUuid, readText } from "@/lib/validation";
import {
  MAX_DRAFT_LENGTH,
  MAX_INPUT_NOTES,
  actionIdempotencyKey,
  approvalCoversAction,
  buildDraftMessages,
  canApproveAction,
  canExecuteAction,
  canRetryStep,
  cleanSelectedTasks,
  contentHash,
  isDraftUsable,
  normalizeDraft,
  parseRunContext,
  runStatusForStepKind,
  selectedWorkLines,
  stepStatusForStepKind,
  stepsFromTemplate,
  workflowErrorMessage,
  workflowInputSchema,
} from "@/lib/workflows";
import type {
  ActionRecord,
  WorkflowRun,
  WorkflowRunStep,
  WorkflowStepKind,
} from "@/lib/types";

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That workflow isn't available to you.";
const DRAFT_TIMEOUT_MS = 60_000;

function refresh(runId?: string): void {
  revalidatePath("/workflows");
  if (runId) revalidatePath(`/workflows/runs/${runId}`);
}

function runPath(runId: string): string {
  return `/workflows/runs/${runId}`;
}

/** Builds steps from parallel form arrays, so the editor stays a plain form. */
function readSteps(formData: FormData): unknown[] {
  const kinds = formData.getAll("step_kind").map(String);
  const titles = formData.getAll("step_title").map(String);
  const instructions = formData.getAll("step_instructions").map(String);
  const retries = formData.getAll("step_retry").map(String);
  const connectors = formData.getAll("step_connector").map(String);
  const destinations = formData.getAll("step_destination").map(String);

  return kinds.map((kind, index) => ({
    kind,
    title: titles[index] ?? "",
    instructions: instructions[index] ?? "",
    retry_policy: retries[index] === "none" ? "none" : "manual",
    config: {
      connector: connectors[index] || undefined,
      destination: destinations[index] || undefined,
    },
  }));
}

async function loadRun(
  session: Session,
  runId: string,
): Promise<Awaited<ReturnType<typeof getWorkflowRun>>> {
  if (!isUuid(runId)) return null;
  return getWorkflowRun(session, runId);
}

function stepOf(steps: WorkflowRunStep[], kind: WorkflowStepKind): WorkflowRunStep | null {
  return (
    steps.find((step) => step.kind === kind && step.status !== "succeeded") ??
    null
  );
}

/**
 * Moves to the next pending step. If there is none, the run is done — but only a
 * checkpoint can be the last step, and it is the person who confirms it.
 */
async function advanceRun(
  session: Session,
  run: WorkflowRun,
  steps: WorkflowRunStep[],
  justFinished: number,
): Promise<{ ok: boolean }> {
  const next = steps
    .filter((step) => step.position > justFinished && step.status === "pending")
    .sort((a, b) => a.position - b.position)[0];

  const now = new Date().toISOString();

  if (!next) {
    const { error } = await session.supabase
      .from("workflow_runs")
      .update({ status: "succeeded", finished_at: now, error_code: null })
      .eq("id", run.id);
    return { ok: !error };
  }

  const [stepUpdate, runUpdate] = await Promise.all([
    session.supabase
      .from("workflow_run_steps")
      .update({
        status: stepStatusForStepKind(next.kind),
        started_at: now,
      })
      .eq("id", next.id),
    session.supabase
      .from("workflow_runs")
      .update({
        status: runStatusForStepKind(next.kind),
        current_position: next.position,
        error_code: null,
      })
      .eq("id", run.id),
  ]);

  return { ok: !stepUpdate.error && !runUpdate.error };
}

async function failStep(
  session: Session,
  run: WorkflowRun,
  step: WorkflowRunStep,
  code: string,
): Promise<void> {
  const now = new Date().toISOString();
  await Promise.all([
    session.supabase
      .from("workflow_run_steps")
      .update({ status: "failed", error_code: code, finished_at: now })
      .eq("id", step.id),
    session.supabase
      .from("workflow_runs")
      .update({ status: "failed", error_code: code, finished_at: now })
      .eq("id", run.id),
  ]);
}

// ---------------------------------------------------------------------------
// Workflow editor
// ---------------------------------------------------------------------------

export async function createWorkflowAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const templateId = readText(formData, "template_id");
  let steps = readSteps(formData);

  if (templateId) {
    if (!isUuid(templateId)) {
      return { status: "error", message: "That template isn't available." };
    }
    const template = await getPersonalTemplate(session, templateId);
    if (!template) {
      return { status: "error", message: "That template isn't one of yours." };
    }
    steps = stepsFromTemplate(template.steps);
  }

  const parsed = workflowInputSchema.safeParse({
    name: readText(formData, "name"),
    description: readText(formData, "description"),
    goal_id: readText(formData, "goal_id"),
    steps,
  });

  if (!parsed.success) {
    return { status: "error", message: firstErrorMessage(parsed.error) };
  }

  const { data: workflow, error } = await session.supabase
    .from("workflows")
    .insert({
      user_id: session.user.id,
      name: parsed.data.name,
      description: parsed.data.description === "" ? null : parsed.data.description,
      goal_id: parsed.data.goal_id === "" ? null : parsed.data.goal_id,
      current_version: 1,
    })
    .select("id")
    .single();

  if (error || !workflow) {
    console.error("createWorkflowAction failed:", error?.message);
    return { status: "error", message: "We couldn't create that workflow. Try again." };
  }

  const workflowId = workflow.id as string;

  const { error: versionError } = await session.supabase
    .from("workflow_versions")
    .insert({
      workflow_id: workflowId,
      version: 1,
      name: parsed.data.name,
      description: parsed.data.description === "" ? null : parsed.data.description,
      goal_id: parsed.data.goal_id === "" ? null : parsed.data.goal_id,
      steps: parsed.data.steps,
    });

  if (versionError) {
    console.error("createWorkflowAction version failed:", versionError.message);
    await session.supabase.from("workflows").delete().eq("id", workflowId);
    return {
      status: "error",
      message: "We couldn't save the steps, so nothing was created. Try again.",
    };
  }

  refresh();
  redirect(`/workflows/${workflowId}`);
}

export async function updateWorkflowAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const workflowId = readText(formData, "workflow_id");
  if (!isUuid(workflowId)) return { status: "error", message: NOT_AVAILABLE };

  const parsed = workflowInputSchema.safeParse({
    name: readText(formData, "name"),
    description: readText(formData, "description"),
    goal_id: readText(formData, "goal_id"),
    steps: readSteps(formData),
  });

  if (!parsed.success) {
    return { status: "error", message: firstErrorMessage(parsed.error) };
  }

  const { data: current, error: readError } = await session.supabase
    .from("workflows")
    .select("current_version")
    .eq("id", workflowId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (readError || !current) {
    return { status: "error", message: NOT_AVAILABLE };
  }

  const nextVersion = ((current as { current_version: number }).current_version ?? 1) + 1;

  const { error: versionError } = await session.supabase
    .from("workflow_versions")
    .insert({
      workflow_id: workflowId,
      version: nextVersion,
      name: parsed.data.name,
      description: parsed.data.description === "" ? null : parsed.data.description,
      goal_id: parsed.data.goal_id === "" ? null : parsed.data.goal_id,
      steps: parsed.data.steps,
    });

  if (versionError) {
    console.error("updateWorkflowAction failed:", versionError.message);
    return { status: "error", message: "We couldn't save a new version. Nothing changed." };
  }

  // The workflow row moves to the new version; active runs keep their own
  // snapshot and are not touched.
  const { error: updateError } = await session.supabase
    .from("workflows")
    .update({
      name: parsed.data.name,
      description: parsed.data.description === "" ? null : parsed.data.description,
      goal_id: parsed.data.goal_id === "" ? null : parsed.data.goal_id,
      current_version: nextVersion,
    })
    .eq("id", workflowId)
    .eq("user_id", session.user.id);

  if (updateError) {
    console.error("updateWorkflowAction header failed:", updateError.message);
    return {
      status: "error",
      message: "The new version was saved but the workflow didn't move to it. Refresh and try again.",
    };
  }

  refresh();
  return {
    status: "success",
    message: `Saved as version ${nextVersion}. Runs already in progress keep their original steps.`,
    nonce: Date.now(),
  };
}

export async function deleteWorkflowAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const workflowId = readText(formData, "workflow_id");
  if (!isUuid(workflowId)) return { status: "error", message: NOT_AVAILABLE };

  const { error } = await session.supabase
    .from("workflows")
    .delete()
    .eq("id", workflowId)
    .eq("user_id", session.user.id);

  if (error) {
    console.error("deleteWorkflowAction failed:", error.message);
    return {
      status: "error",
      message: "We couldn't delete that workflow. Any runs are unchanged.",
    };
  }

  revalidatePath("/workflows");
  redirect("/workflows");
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export async function startWorkflowRunAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const workflowId = readText(formData, "workflow_id");
  if (!isUuid(workflowId)) return { status: "error", message: NOT_AVAILABLE };

  const { data, error } = await session.supabase.rpc("start_workflow_run", {
    p_workflow_id: workflowId,
  });

  if (error) {
    console.error("startWorkflowRunAction failed:", error.message);
    return { status: "error", message: "We couldn't start that run. Try again." };
  }

  const payload = (data ?? {}) as { ok?: boolean; code?: string; run_id?: string };
  if (payload.ok !== true || !payload.run_id) {
    return { status: "error", message: workflowErrorMessage(payload.code) };
  }

  refresh(payload.run_id);
  redirect(runPath(payload.run_id));
}

export async function saveWorkflowInputAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const runId = readText(formData, "run_id");
  const detail = await loadRun(session, runId);
  if (!detail) return { status: "error", message: NOT_AVAILABLE };

  const step = stepOf(detail.steps, "user_input");
  if (!step || step.kind !== "user_input" || step.status !== "waiting_for_input") {
    return {
      status: "error",
      message: step ? workflowErrorMessage("already-succeeded") : workflowErrorMessage("not-current"),
    };
  }

  const notes = readText(formData, "notes").slice(0, MAX_INPUT_NOTES);

  const selectedIds = cleanSelectedTasks(
    formData.getAll("task_id").map(String),
    detail.work.completed.map((task) => ({ id: task.id, status: "completed" })),
  );

  if (notes === "" && selectedIds.length === 0) {
    return {
      status: "error",
      message: "Write what the update should include, or tick at least one completed task.",
    };
  }
  const taskTitles = detail.work.completed
    .filter((task) => selectedIds.includes(task.id))
    .map((task) => task.title);

  const now = new Date().toISOString();

  const { error: stepError } = await session.supabase
    .from("workflow_run_steps")
    .update({
      status: "succeeded",
      finished_at: now,
      output: { notes, selected_task_ids: selectedIds, task_titles: taskTitles },
    })
    .eq("id", step.id)
    .eq("status", "waiting_for_input");

  if (stepError) {
    console.error("saveWorkflowInputAction step failed:", stepError.message);
    return { status: "error", message: "We couldn't save that input. Try again." };
  }

  const context = {
    ...(parseRunContext(detail.run.context) as Record<string, unknown>),
    inputs: notes,
    selectedTaskIds: selectedIds,
    taskTitles,
  };

  const { error: runError } = await session.supabase
    .from("workflow_runs")
    .update({ context })
    .eq("id", detail.run.id);

  if (runError) {
    console.error("saveWorkflowInputAction context failed:", runError.message);
    return { status: "error", message: "Input saved, but the run couldn't move on. Refresh." };
  }

  const advanced = await advanceRun(
    session,
    { ...detail.run, context },
    detail.steps,
    step.position,
  );

  refresh(runId);
  return advanced.ok
    ? { status: "success", message: "Input saved. The run moved to the next step.", nonce: Date.now() }
    : { status: "error", message: "Input saved, but the next step didn't start. Refresh the page." };
}

export async function generateWorkflowDraftAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const runId = readText(formData, "run_id");
  const detail = await loadRun(session, runId);
  if (!detail) return { status: "error", message: NOT_AVAILABLE };

  const step = stepOf(detail.steps, "ai_draft");
  if (!step) return { status: "error", message: workflowErrorMessage("not-current") };
  if (step.status === "failed" && step.retry_policy === "none") {
    return { status: "error", message: workflowErrorMessage("retry-blocked") };
  }
  if (step.status !== "running" && step.status !== "failed") {
    return { status: "error", message: workflowErrorMessage("not-current") };
  }

  const requestedModel = readText(formData, "model");
  const model = isAiModel(requestedModel) ? requestedModel : DEFAULT_AI_MODEL;

  const reserved = await reserveAiRequest(session, "workflow_draft", model);
  if (!reserved.ok) {
    return { status: "error", message: reserved.message };
  }

  const { id: requestId, remaining } = reserved.reservation;

  await Promise.all([
    session.supabase
      .from("workflow_run_steps")
      .update({ status: "running", attempt: step.attempt + 1, started_at: new Date().toISOString(), error_code: null })
      .eq("id", step.id),
    session.supabase
      .from("workflow_runs")
      .update({ status: "running", error_code: null })
      .eq("id", detail.run.id),
  ]);

  const context = parseRunContext(detail.run.context);
  const selected = detail.work.completed.filter((task) =>
    (context.selectedTaskIds ?? []).includes(task.id),
  );
  const goalTitle = detail.work.goalTitle;

  try {
    const reply = await chatWithOllama({
      model,
      messages: buildDraftMessages({
        goalTitle,
        instructions: step.instructions ?? "",
        notes: context.inputs ?? "",
        selectedWork: selectedWorkLines(
          selected.map((task) => ({
            taskId: task.id,
            title: task.title,
            status: "completed",
          })),
          selected.map((task) => ({ task_id: task.id, content: task.content })),
        ),
        taskTitles: selected.map((task) => task.title),
      }),
      temperature: 0.3,
      timeoutMs: DRAFT_TIMEOUT_MS,
    });

    const text = normalizeDraft(reply.content);
    if (!isDraftUsable(text)) {
      await finishAiRequest(session, requestId, "failed", "unusable-reply");
      await failStep(session, detail.run, step, "unusable-draft");
      return {
        status: "error",
        message:
          "The model's reply wasn't usable as a draft, so nothing was kept. You can retry this step.",
        remaining,
      };
    }

    await finishAiRequest(session, requestId, "succeeded", undefined, reply.tokens);

    const trimmed = text.slice(0, MAX_DRAFT_LENGTH);
    const now = new Date().toISOString();

    await session.supabase
      .from("workflow_run_steps")
      .update({
        status: "succeeded",
        output: { text: trimmed, model: reply.model, draft: true },
        finished_at: now,
      })
      .eq("id", step.id);

    await session.supabase
      .from("workflow_runs")
      .update({ context: { ...(context as Record<string, unknown>), draft: trimmed } })
      .eq("id", detail.run.id);

    const advanced = await advanceRun(
      session,
      { ...detail.run, context: { ...context, draft: trimmed } },
      detail.steps,
      step.position,
    );

    refresh(runId);
    return advanced.ok
      ? {
          status: "success",
          message: `Draft ready for your review. ${aiModelLabel(reply.model)} wrote it; nothing has been sent.`,
          remaining,
          nonce: Date.now(),
        }
      : { status: "error", message: "Draft saved, but the review step didn't open. Refresh." };
  } catch (error) {
    await finishAiRequest(session, requestId, "failed", "model-call-failed");
    await failStep(session, detail.run, step, "model-call-failed");
    console.error("generateWorkflowDraftAction failed:", error instanceof Error ? error.message : error);
    refresh(runId);
    return {
      status: "error",
      message:
        error instanceof OllamaError
          ? ollamaErrorMessage(error)
          : "The draft couldn't be generated. Your inputs are saved; you can retry this step.",
      remaining,
    };
  }
}

export async function approveWorkflowDraftAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const runId = readText(formData, "run_id");
  const detail = await loadRun(session, runId);
  if (!detail) return { status: "error", message: NOT_AVAILABLE };

  const step = stepOf(detail.steps, "user_review");
  if (!step || step.status !== "waiting_for_approval") {
    return { status: "error", message: workflowErrorMessage("not-current") };
  }

  const draft = readText(formData, "draft");
  if (draft.trim().length < 1) {
    return { status: "error", message: "Write the text you want to approve." };
  }
  if (draft.length > MAX_DRAFT_LENGTH) {
    return { status: "error", message: "Keep the approved text under 8000 characters." };
  }

  const now = new Date().toISOString();

  const { error } = await session.supabase
    .from("workflow_run_steps")
    .update({
      status: "succeeded",
      output: { text: draft, approved: true },
      finished_at: now,
    })
    .eq("id", step.id)
    .eq("status", "waiting_for_approval");

  if (error) {
    console.error("approveWorkflowDraftAction failed:", error.message);
    return { status: "error", message: "We couldn't save that approval. Try again." };
  }

  const context = { ...(parseRunContext(detail.run.context) as Record<string, unknown>), reviewed: draft };
  await session.supabase
    .from("workflow_runs")
    .update({ context })
    .eq("id", detail.run.id);

  const advanced = await advanceRun(session, { ...detail.run, context }, detail.steps, step.position);
  refresh(runId);

  return advanced.ok
    ? {
        status: "success",
        message:
          "Text approved. A connector action, if this workflow has one, still needs its own approval for exactly this content.",
        nonce: Date.now(),
      }
    : { status: "error", message: "Approval saved, but the next step didn't start. Refresh." };
}

// ---------------------------------------------------------------------------
// Connector actions
// ---------------------------------------------------------------------------

export async function requestWorkflowActionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const runId = readText(formData, "run_id");
  const detail = await loadRun(session, runId);
  if (!detail) return { status: "error", message: NOT_AVAILABLE };

  const step = stepOf(detail.steps, "connector_action");
  if (!step || step.status !== "waiting_for_approval") {
    return { status: "error", message: workflowErrorMessage("not-current") };
  }

  const live = detail.actions.find(
    (action) =>
      action.run_step_id === step.id &&
      ["pending_approval", "approved", "executing", "succeeded"].includes(action.status),
  );
  if (live) {
    refresh(runId);
    return {
      status: "success",
      message: "An action for this step already exists, so nothing new was created.",
      nonce: Date.now(),
    };
  }

  const connector = step.config?.connector ?? "demo_notes";
  if (!getConnector(connector)) {
    return { status: "error", message: workflowErrorMessage("no-connector") };
  }

  const destination = (step.config?.destination ?? "").trim();
  if (destination === "") {
    return {
      status: "error",
      message: "This step has no destination, so there is nothing to approve. Edit the workflow.",
    };
  }

  const reviewed = parseRunContext(detail.run.context).reviewed;
  const content = reviewed?.trim() ?? "";
  if (content === "") {
    return {
      status: "error",
      message: "Approve a draft first: a connector action needs exact content to send.",
    };
  }

  const hash = contentHash(content);
  const attempt = detail.actions.filter((action) => action.run_step_id === step.id).length + 1;

  const { error } = await session.supabase.from("action_records").insert({
    user_id: session.user.id,
    run_id: detail.run.id,
    run_step_id: step.id,
    connector,
    action_kind: "save_document",
    destination,
    content,
    content_hash: hash,
    status: "pending_approval",
    idempotency_key: actionIdempotencyKey(detail.run.id, step.position, hash, attempt),
    simulated: true,
  });

  if (error) {
    console.error("requestWorkflowActionAction failed:", error.message);
    // A duplicate key means another request created it first: that is a safe no-op.
    const duplicate = error.code === "23505";
    return {
      status: duplicate ? "success" : "error",
      message: duplicate
        ? "That action already existed, so nothing was duplicated."
        : "We couldn't prepare that action. Try again.",
      nonce: Date.now(),
    };
  }

  refresh(runId);
  return {
    status: "success",
    message: "Action prepared. It cannot run until you approve this exact content.",
    nonce: Date.now(),
  };
}

export async function approveWorkflowActionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const runId = readText(formData, "run_id");
  const actionId = readText(formData, "action_id");
  if (!isUuid(actionId)) return { status: "error", message: NOT_AVAILABLE };

  const { data: actionRow, error: actionError } = await session.supabase
    .from("action_records")
    .select("*")
    .eq("id", actionId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (actionError || !actionRow) return { status: "error", message: NOT_AVAILABLE };

  const action = actionRow as ActionRecord;
  if (!canApproveAction(action.status)) {
    return { status: "error", message: workflowErrorMessage("already-executing") };
  }

  const { data: existing } = await session.supabase
    .from("action_approvals")
    .select("id")
    .eq("action_id", action.id)
    .maybeSingle();

  if (existing) {
    refresh(runId);
    return { status: "success", message: "This action is already approved.", nonce: Date.now() };
  }

  const { error: approvalError } = await session.supabase.from("action_approvals").insert({
    action_id: action.id,
    user_id: session.user.id,
    connector: action.connector,
    destination: action.destination,
    approved_content: action.content,
    approved_hash: action.content_hash,
  });

  if (approvalError) {
    console.error("approveWorkflowActionAction failed:", approvalError.message);
    return { status: "error", message: "We couldn't record that approval. Try again." };
  }

  const { error: statusError } = await session.supabase
    .from("action_records")
    .update({ status: "approved" })
    .eq("id", action.id)
    .eq("status", "pending_approval");

  if (statusError) {
    console.error("approveWorkflowActionAction status failed:", statusError.message);
    return { status: "error", message: "Approval saved, but the action didn't move on. Refresh." };
  }

  refresh(runId);
  return {
    status: "success",
    message:
      "Approved for exactly this content, destination and connector. Running it consumes this approval once.",
    nonce: Date.now(),
  };
}

/**
 * Runs one action.
 *
 * Three things make a duplicate send impossible:
 *   1. only one live action per step (a partial unique index),
 *   2. one idempotency key per attempt,
 *   3. a conditional status update, so only one request can move the action from
 *      approved to executing.
 * A connector that might have been reached is marked uncertain, never retried.
 */
export async function executeWorkflowActionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const runId = readText(formData, "run_id");
  const actionId = readText(formData, "action_id");
  if (!isUuid(actionId)) return { status: "error", message: NOT_AVAILABLE };

  const [actionResult, approvalResult] = await Promise.all([
    session.supabase
      .from("action_records")
      .select("*")
      .eq("id", actionId)
      .eq("user_id", session.user.id)
      .maybeSingle(),
    session.supabase
      .from("action_approvals")
      .select("*")
      .eq("action_id", actionId)
      .maybeSingle(),
  ]);

  if (actionResult.error || !actionResult.data) {
    return { status: "error", message: NOT_AVAILABLE };
  }

  const action = actionResult.data as ActionRecord;
  const approval = (approvalResult.data ?? null) as {
    id: string;
    connector: string;
    destination: string;
    approved_content: string;
    approved_hash: string;
    consumed_at: string | null;
  } | null;

  if (action.status === "succeeded") {
    refresh(runId);
    return { status: "success", message: workflowErrorMessage("already-succeeded"), nonce: Date.now() };
  }
  if (action.status === "executing") {
    return { status: "error", message: workflowErrorMessage("already-executing") };
  }
  if (
    !approval ||
    !approvalCoversAction(approval, action) ||
    !canExecuteAction(action.status, true)
  ) {
    return { status: "error", message: workflowErrorMessage("approval-mismatch") };
  }

  const executor = executorFor(action.connector);
  if (!executor) {
    return { status: "error", message: workflowErrorMessage("no-connector") };
  }

  // Claim the action atomically. A second click finds it already 'executing'.
  const { data: claimed, error: claimError } = await session.supabase
    .from("action_records")
    .update({ status: "executing", attempts: action.attempts + 1 })
    .eq("id", action.id)
    .eq("status", "approved")
    .select("id")
    .maybeSingle();

  if (claimError || !claimed) {
    refresh(runId);
    return { status: "error", message: workflowErrorMessage("already-executing") };
  }

  await session.supabase
    .from("action_approvals")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", approval.id)
    .is("consumed_at", null);

  const result = await executor.execute({
    connector: "demo_notes",
    destination: action.destination,
    content: action.content,
    idempotencyKey: action.idempotency_key,
  });

  const now = new Date().toISOString();
  const detail = await loadRun(session, runId);
  const step = detail?.steps.find((entry) => entry.id === action.run_step_id) ?? null;

  const { error: finishError } = await session.supabase
    .from("action_records")
    .update({
      status: result.status,
      external_ref: result.externalRef ?? null,
      last_error: result.status === "succeeded" ? null : result.message,
    })
    .eq("id", action.id)
    .eq("status", "executing");

  if (finishError) {
    console.error("executeWorkflowActionAction finish failed:", finishError.message);
  }

  if (result.status === "succeeded") {
    if (step && detail) {
      await session.supabase
        .from("workflow_run_steps")
        .update({
          status: "succeeded",
          finished_at: now,
          output: {
            external_ref: result.externalRef ?? null,
            simulated: true,
            message: result.message,
          },
        })
        .eq("id", step.id);

      await advanceRun(session, detail.run, detail.steps, step.position);
    }

    refresh(runId);
    return {
      status: "success",
      message: `${result.message} Approval was consumed.`,
      nonce: Date.now(),
    };
  }

  if (step && detail) {
    const uncertain = result.status === "outcome_uncertain";
    await Promise.all([
      session.supabase
        .from("workflow_run_steps")
        .update({
          status: uncertain ? "outcome_uncertain" : "failed",
          error_code: uncertain ? "outcome-uncertain" : "connector-failed",
          finished_at: now,
        })
        .eq("id", step.id),
      session.supabase
        .from("workflow_runs")
        .update({
          status: uncertain ? "outcome_uncertain" : "failed",
          error_code: uncertain ? "outcome-uncertain" : "connector-failed",
          finished_at: now,
        })
        .eq("id", detail.run.id),
    ]);
  }

  refresh(runId);
  return {
    status: "error",
    message:
      result.status === "outcome_uncertain"
        ? "The connector may have received this action, so it is marked outcome uncertain and will not be retried automatically. Check the destination before starting a new run."
        : `The action did not complete: ${result.message} The approval was consumed; retry creates a new, separately approved attempt.`,
    nonce: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Checkpoint, retry, cancel
// ---------------------------------------------------------------------------

export async function completeCheckpointAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const runId = readText(formData, "run_id");
  const detail = await loadRun(session, runId);
  if (!detail) return { status: "error", message: NOT_AVAILABLE };

  const step = stepOf(detail.steps, "checkpoint");
  if (!step || step.status !== "waiting_for_input") {
    return { status: "error", message: workflowErrorMessage("not-current") };
  }

  const { error } = await session.supabase
    .from("workflow_run_steps")
    .update({
      status: "succeeded",
      finished_at: new Date().toISOString(),
      output: { confirmed: true },
    })
    .eq("id", step.id)
    .eq("status", "waiting_for_input");

  if (error) {
    console.error("completeCheckpointAction failed:", error.message);
    return { status: "error", message: "We couldn't mark that checkpoint. Try again." };
  }

  const advanced = await advanceRun(session, detail.run, detail.steps, step.position);
  refresh(runId);
  return advanced.ok
    ? {
        status: "success",
        message: "Checkpoint confirmed. Finishing is always your call, and it is recorded.",
        nonce: Date.now(),
      }
    : { status: "error", message: "Checkpoint saved, but the run didn't finish. Refresh." };
}

export async function retryWorkflowStepAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const runId = readText(formData, "run_id");
  const detail = await loadRun(session, runId);
  if (!detail) return { status: "error", message: NOT_AVAILABLE };

  const failed = detail.steps.find((step) => step.status === "failed");
  if (!failed) return { status: "error", message: workflowErrorMessage("not-current") };

  const actions = detail.actions.filter((action) => action.run_step_id === failed.id);
  if (!canRetryStep(failed, actions)) {
    return {
      status: "error",
      message:
        failed.retry_policy === "none"
          ? "This step cannot be retried. Start a new run if you want to try again."
          : workflowErrorMessage("retry-blocked"),
    };
  }

  const nextStatus =
    failed.kind === "ai_draft" ? "running" : stepStatusForStepKind(failed.kind);

  const { error } = await session.supabase
    .from("workflow_run_steps")
    .update({ status: nextStatus, error_code: null, finished_at: null })
    .eq("id", failed.id)
    .eq("status", "failed");

  if (error) {
    console.error("retryWorkflowStepAction failed:", error.message);
    return { status: "error", message: "We couldn't restart that step. Try again." };
  }

  await session.supabase
    .from("workflow_runs")
    .update({
      status: runStatusForStepKind(failed.kind),
      current_position: failed.position,
      error_code: null,
      finished_at: null,
    })
    .eq("id", detail.run.id);

  refresh(runId);
  return {
    status: "success",
    message:
      failed.kind === "connector_action"
        ? "Step reopened. A new attempt needs its own exact-content approval; the failed attempt stays in the record."
        : "Step reopened. Nothing that succeeded is repeated.",
    nonce: Date.now(),
  };
}

export async function cancelWorkflowRunAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const runId = readText(formData, "run_id");
  const detail = await loadRun(session, runId);
  if (!detail) return { status: "error", message: NOT_AVAILABLE };

  if (["succeeded", "failed", "cancelled", "outcome_uncertain"].includes(detail.run.status)) {
    return { status: "error", message: "This run has already finished." };
  }

  const now = new Date().toISOString();

  const { error } = await session.supabase
    .from("workflow_runs")
    .update({ status: "cancelled", cancelled_at: now, finished_at: now })
    .eq("id", detail.run.id);

  if (error) {
    console.error("cancelWorkflowRunAction failed:", error.message);
    return { status: "error", message: "We couldn't cancel that run. Try again." };
  }

  // Remaining steps stop; anything already succeeded or waiting for approval on a
  // previous step keeps its record.
  await session.supabase
    .from("workflow_run_steps")
    .update({ status: "cancelled", finished_at: now })
    .eq("run_id", detail.run.id)
    .in("status", ["pending", "waiting_for_input", "running", "waiting_for_approval"]);

  await session.supabase
    .from("action_records")
    .update({ status: "cancelled" })
    .eq("run_id", detail.run.id)
    .in("status", ["pending_approval", "approved"]);

  refresh(runId);
  revalidatePath("/workflows");
  return {
    status: "success",
    message: "Remaining steps cancelled. Steps that already succeeded and their outputs are kept.",
    nonce: Date.now(),
  };
}
