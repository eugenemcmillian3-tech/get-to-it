"use server";

import { revalidatePath } from "next/cache";
import type { BuildState } from "@/lib/action-state";
import {
  TEAM_DEFAULT_MODEL_CALLS,
  TEAM_DEFAULT_MODEL_CREDITS,
  TEAM_LIMITS,
  TEAM_MAX_CREDITS,
  TEAM_MODEL_CREDITS,
  TEAM_ROLES,
  TEAM_ROLE_MODELS,
  attributionSummary,
  buildTeamPlan,
  limitReason,
  mergeTeamBranches,
  roleDefinition,
  runFixtureTask,
  selectRunnableTasks,
  taskCanWritePath,
  type TeamCheck,
  type TeamRole,
  type TeamRunRecord,
  type TeamTaskRecord,
} from "@/lib/agent-team";
import { finishAiRequest, reserveAiRequest } from "@/lib/ai/limits";
import { DEFAULT_AI_MODEL, isAiModel } from "@/lib/ai/models";
import { hasOllamaKey, ollamaErrorMessage } from "@/lib/ai/ollama";
import { AgentReplyError, runModelAgentTask } from "@/lib/agent-worker";
import { getSession } from "@/lib/auth";
import {
  createRunnerWorkspace,
  getPreviewConfig,
  runRunnerChecks,
  stopRunnerWorkspace,
} from "@/lib/preview-workspace";
import { isUuid, readText } from "@/lib/validation";

/**
 * Phase 23 actions.
 *
 * The queue is durable in Supabase, but execution is deliberately
 * request-scoped: one click advances at most the configured number of fixture
 * workers. There is no background loop or recursive spawning, and a malformed
 * model reply is retried at most once before the task is marked failed.
 * A human can pause, reassign, reject, approve, resolve a claim conflict or
 * cancel. Only the explicit integration action writes project files.
 */

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That app project isn't available to you.";

type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

function fail(message: string): BuildState {
  return { status: "error", message, nonce: Date.now() };
}

function done(message: string): BuildState {
  return { status: "success", message, nonce: Date.now() };
}

function refresh(projectId: string): void {
  revalidatePath("/build");
  revalidatePath(`/build/${projectId}`);
  revalidatePath(`/build/${projectId}/team`);
  revalidatePath(`/build/${projectId}/workspace`);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

async function ownerProject(session: Session, projectId: string) {
  if (!isUuid(projectId)) return null;
  const { data } = await session.supabase
    .from("app_projects")
    .select("id, name, current_version")
    .eq("id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  return data;
}

async function ownerRun(session: Session, projectId: string): Promise<TeamRunRecord | null> {
  const { data } = await session.supabase
    .from("app_team_runs")
    .select("*")
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  return (data as TeamRunRecord | null) ?? null;
}

async function runTasks(session: Session, runId: string): Promise<TeamTaskRecord[]> {
  const { data } = await session.supabase
    .from("app_team_tasks")
    .select("*")
    .eq("run_id", runId)
    .eq("user_id", session.user.id)
    .order("position", { ascending: true });
  return (data ?? []) as TeamTaskRecord[];
}

async function latestIntegration(session: Session, runId: string) {
  const { data } = await session.supabase
    .from("app_team_integrations")
    .select("*")
    .eq("run_id", runId)
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

async function event(
  session: Session,
  runId: string,
  kind: string,
  detail: string,
  taskId: string | null = null,
  actor: "owner" | "system" | "coordinator" = "owner",
): Promise<void> {
  const { error } = await session.supabase.from("app_team_events").insert({
    run_id: runId,
    task_id: taskId,
    user_id: session.user.id,
    actor,
    kind: kind.slice(0, 80),
    detail: detail.slice(0, 1000),
  });
  if (error) console.error("record team event failed:", error.message);
}

async function settleRun(
  session: Session,
  run: TeamRunRecord,
  tasks: TeamTaskRecord[],
): Promise<void> {
  if (run.status === "paused" || run.status === "cancelled" || run.status === "failed") return;

  const failed = tasks.some((task) => task.status === "failed");
  const allTerminal = tasks.every(
    (task) =>
      task.status === "completed" ||
      task.status === "cancelled" ||
      task.status === "failed",
  );
  const awaiting = tasks.some((task) => task.status === "awaiting_review");
  const status = failed
    ? "failed"
    : allTerminal && run.integration_status === "merged"
      ? "completed"
      : awaiting
        ? "awaiting_review"
        : "running";

  await session.supabase
    .from("app_team_runs")
    .update({
      status,
      active_count: 0,
      runtime_seconds: Math.max(0, Math.floor((Date.now() - Date.parse(run.started_at)) / 1000)),
      finished_at: status === "completed" || status === "failed" ? new Date().toISOString() : null,
      last_error: failed
        ? "One or more agent tasks failed. Review the task error before starting another run."
        : run.last_error,
    })
    .eq("id", run.id)
    .eq("user_id", session.user.id);
}

async function failAtLimit(session: Session, run: TeamRunRecord, reason: string): Promise<void> {
  await session.supabase
    .from("app_team_tasks")
    .update({ status: "cancelled", error: reason, finished_at: new Date().toISOString() })
    .eq("run_id", run.id)
    .eq("user_id", session.user.id)
    .in("status", ["queued", "running", "blocked", "awaiting_review"]);
  await session.supabase
    .from("app_team_runs")
    .update({
      status: "failed",
      active_count: 0,
      last_error: reason,
      finished_at: new Date().toISOString(),
    })
    .eq("id", run.id)
    .eq("user_id", session.user.id);
  await event(session, run.id, "run.limit", reason, null, "system");
}

export async function startTeamAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  const project = await ownerProject(session, projectId);
  if (!project) return fail(NOT_AVAILABLE);

  const { data: approved, error: specError } = await session.supabase
    .from("app_specs")
    .select("version, spec")
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .not("approved_at", "is", null)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (specError) {
    console.error("startTeamAction spec failed:", specError.message);
    return fail("We couldn't load the approved specification.");
  }
  if (!approved) return fail("Approve a specification before starting an agent team.");

  const { count } = await session.supabase
    .from("app_files")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("user_id", session.user.id);
  if (!count) return fail("Generate the project before starting an agent team.");

  const existing = await ownerRun(session, projectId);
  if (
    existing &&
    (existing.status === "running" ||
      existing.status === "paused" ||
      existing.status === "awaiting_review")
  ) {
    return fail("Pause or cancel the current team run before starting a new one.");
  }

  const maxAgents = clamp(Number(readText(formData, "max_agents")), 1, TEAM_LIMITS.maxAgents);
  const maxRuntime = clamp(
    Number(readText(formData, "max_runtime_seconds")),
    TEAM_LIMITS.minRuntimeSeconds,
    TEAM_LIMITS.maxRuntimeSeconds,
  );
  const conflictFixture = readText(formData, "conflict_fixture") === "on";
  const mode = readText(formData, "mode") === "model" ? "model" : "fixture";
  if (mode === "model" && !hasOllamaKey()) {
    return fail("OLLAMA_API_KEY is not configured, so model-backed agent teams are unavailable.");
  }

  const requestedCalls = Number(readText(formData, "max_calls"));
  const maxCalls = mode === "model"
    ? clamp(
        Number.isFinite(requestedCalls) && requestedCalls > 0
          ? requestedCalls
          : TEAM_DEFAULT_MODEL_CALLS,
        1,
        TEAM_LIMITS.maxCalls,
      )
    : 0;

  let plan;
  try {
    plan = buildTeamPlan(approved.spec as TeamRunRecord["spec"], project.name, { conflictFixture });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "The team plan could not be built.");
  }

  const minimumCredits = plan.length * TEAM_MODEL_CREDITS;
  if (minimumCredits > TEAM_MAX_CREDITS) {
    return fail(`This queue needs ${minimumCredits} credits, above the ${TEAM_MAX_CREDITS}-credit cap.`);
  }

  const requestedBudget = Number(readText(formData, "credit_budget"));
  const creditBudget = mode === "model"
    ? clamp(
        Number.isFinite(requestedBudget) && requestedBudget > 0
          ? requestedBudget
          : Math.max(TEAM_DEFAULT_MODEL_CREDITS, minimumCredits),
        TEAM_MODEL_CREDITS,
        TEAM_MAX_CREDITS,
      )
    : 0;
  if (mode === "model" && creditBudget < minimumCredits) {
    return fail(`The credit budget must cover at least ${minimumCredits} credits for this queue.`);
  }
  const modelByRole = mode === "model" ? TEAM_ROLE_MODELS : ({} as Record<TeamRole, string>);

  const { data: run, error } = await session.supabase
    .from("app_team_runs")
    .upsert(
      {
        project_id: projectId,
        user_id: session.user.id,
        spec_version: approved.version,
        spec: approved.spec,
        status: "running",
        mode,
        model_by_role: modelByRole,
        max_agents: maxAgents,
        max_calls: maxCalls,
        max_runtime_seconds: maxRuntime,
        calls_used: 0,
        credit_budget: creditBudget,
        credits_spent: 0,
        runtime_seconds: 0,
        active_count: 0,
        integration_status: "pending",
        last_error: null,
        started_at: new Date().toISOString(),
        finished_at: null,
      },
      { onConflict: "project_id" },
    )
    .select("*")
    .single();

  if (error || !run) {
    console.error("startTeamAction run failed:", error?.message);
    return fail("We couldn't start a team run. Nothing was queued.");
  }

  await Promise.all([
    session.supabase.from("app_team_tasks").delete().eq("run_id", run.id).eq("user_id", session.user.id),
    session.supabase.from("app_team_integrations").delete().eq("run_id", run.id).eq("user_id", session.user.id),
    session.supabase.from("app_team_events").delete().eq("run_id", run.id).eq("user_id", session.user.id),
  ]);

  const { error: tasksError } = await session.supabase.from("app_team_tasks").insert(
    plan.map((task, position) => ({
      run_id: run.id,
      project_id: projectId,
      user_id: session.user.id,
      position,
      role: task.role,
      objective: task.objective,
      inputs: task.inputs,
      allowed_tools: task.allowed_tools,
      expected_artifacts: task.expected_artifacts,
      acceptance_checks: task.acceptance_checks,
      file_claims: task.file_claims,
      status: "queued",
      model: mode === "model" ? modelByRole[task.role] : null,
      budget_seconds: task.budget_seconds,
      budget_calls: task.budget_calls,
      calls_used: 0,
      attempts: 0,
      branch_files: [],
      changed_files: [],
    })),
  );

  if (tasksError) {
    console.error("startTeamAction tasks failed:", tasksError.message);
    await session.supabase
      .from("app_team_runs")
      .update({ status: "failed", last_error: "The task queue could not be written." })
      .eq("id", run.id)
      .eq("user_id", session.user.id);
    return fail("The task queue couldn't be written. The run was stopped.");
  }

  await event(
    session,
    run.id,
    "run.started",
    mode === "model"
      ? `Model-backed team run started with ${plan.length} bounded tasks and a ${creditBudget}-credit budget.`
      : `Fixture team run started with ${plan.length} bounded tasks.`,
    null,
    "system",
  );
  refresh(projectId);
  return done(
    mode === "model"
      ? `Model-backed team run started: ${plan.length} tasks, ${maxCalls} AI calls, ${creditBudget} credits available for ${minimumCredits} required. Each task uses its role's model.`
      : `Team run started: ${plan.length} tasks, at most ${maxAgents} at a time, ${maxRuntime}s. No paid model calls are made in fixture mode.`,
  );
}

export async function advanceTeamAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  const project = await ownerProject(session, projectId);
  if (!project) return fail(NOT_AVAILABLE);
  const run = await ownerRun(session, projectId);
  if (!run) return fail("Start a team run first.");
  if (run.status !== "running") {
    return fail(
      run.status === "paused"
        ? "This run is paused. Resume it before advancing."
        : "This run is no longer accepting work.",
    );
  }

  if (run.mode === "model" && !hasOllamaKey()) {
    return fail("OLLAMA_API_KEY is not configured, so model-backed agent teams are unavailable.");
  }

  const reason = limitReason(run);
  if (reason) {
    await failAtLimit(session, run, reason);
    refresh(projectId);
    return fail(reason);
  }

  let tasks = await runTasks(session, run.id);
  const integration = await latestIntegration(session, run.id);
  const selection = selectRunnableTasks(tasks, run.max_agents, run.integration_status);

  for (const blocked of selection.blocked) {
    const names = blocked.conflicts.map((conflict) => conflict.path).join(", ");
    await session.supabase
      .from("app_team_tasks")
      .update({
        status: "blocked",
        blocker: `File ownership conflict with an earlier task: ${names}`,
      })
      .eq("id", blocked.task.id)
      .eq("user_id", session.user.id);
    await event(
      session,
      run.id,
      "task.blocked",
      `Overlapping claim on ${names}; no file was overwritten.`,
      blocked.task.id,
      "system",
    );
  }

  if (selection.runnable.length === 0) {
    refresh(projectId);
    if (selection.blocked.length > 0) {
      return fail("A file ownership conflict is blocking the queue. Resolve the later task explicitly.");
    }
    return fail("No queued task can run yet. Complete the current reviews or integration step first.");
  }

  const { data: currentFiles } = await session.supabase
    .from("app_files")
    .select("path, content")
    .eq("project_id", projectId)
    .eq("user_id", session.user.id);

  const context = {
    spec: run.spec,
    projectName: project.name,
    integrationStatus: run.integration_status,
    integrationChecks: (integration?.checks ?? []) as TeamCheck[],
    currentFiles: (currentFiles ?? []) as { path: string; content: string }[],
  };

  let callsUsed = run.calls_used;
  for (const task of selection.runnable) {
    const model = task.model ?? run.model_by_role?.[task.role] ?? DEFAULT_AI_MODEL;
    if (run.mode === "model" && !isAiModel(model)) {
      const message = "This role does not have a valid Ollama model.";
      await session.supabase
        .from("app_team_tasks")
        .update({ status: "failed", error: message, finished_at: new Date().toISOString() })
        .eq("id", task.id)
        .eq("user_id", session.user.id);
      await event(session, run.id, "task.failed", `${task.role}: ${message}`, task.id, "system");
      continue;
    }

    await session.supabase
      .from("app_team_tasks")
      .update({
        status: "running",
        model: run.mode === "model" ? model : null,
        attempts: task.attempts + 1,
        started_at: new Date().toISOString(),
      })
      .eq("id", task.id)
      .eq("user_id", session.user.id);

    let result;
    let callsThisTask = 0;
    let retriesThisTask = 0;
    let retryReason: string | null = null;
    if (run.mode === "fixture") {
      result = runFixtureTask(task, context);
    } else {
      const reserved = await reserveAiRequest(session, "team_task", model, {
        kind: "swarm",
        id: run.id,
      });
      if (!reserved.ok) {
        await session.supabase
          .from("app_team_tasks")
          .update({
            status: "failed",
            error: reserved.message,
            finished_at: new Date().toISOString(),
          })
          .eq("id", task.id)
          .eq("user_id", session.user.id);
        await event(session, run.id, "task.failed", `${task.role}: ${reserved.message}`, task.id, "system");
        continue;
      }

      try {
        const modelResult = await runModelAgentTask(task, context, model);
        await finishAiRequest(session, reserved.reservation.id, "succeeded", undefined, modelResult.tokens);
        result = modelResult;
        // A retried reply still spends the run's call budget, so the limit
        // reflects provider calls rather than tasks.
        callsThisTask = modelResult.attempts;
        callsUsed += modelResult.attempts;
        retriesThisTask = Math.max(0, modelResult.attempts - 1);
        retryReason = modelResult.retry_reason;
      } catch (error) {
        await finishAiRequest(session, reserved.reservation.id, "failed", "agent-task-failed");
        const message =
          error instanceof Error && error.name === "AgentReplyError"
            ? error.message
            : ollamaErrorMessage(error);
        callsThisTask = error instanceof AgentReplyError ? error.attempts : 1;
        callsUsed += callsThisTask;
        retriesThisTask = error instanceof AgentReplyError ? Math.max(0, error.attempts - 1) : 0;
        retryReason = retriesThisTask > 0 ? message.slice(0, 400) : null;
        result = {
          status: "failed" as const,
          output: { summary: "The model-backed task failed." },
          branch_files: [],
          error: message,
        };
      }
    }

    await session.supabase
      .from("app_team_tasks")
      .update({
        status: result.status,
        branch_files: result.branch_files,
        changed_files: result.branch_files.map((file) => file.path),
        output: result.output,
        calls_used: callsThisTask,
        retries: retriesThisTask,
        retry_reason: retryReason,
        blocker: "blocker" in result ? result.blocker ?? null : null,
        error: "error" in result ? result.error ?? null : null,
        finished_at: new Date().toISOString(),
      })
      .eq("id", task.id)
      .eq("user_id", session.user.id);

    await event(
      session,
      run.id,
      `task.${result.status}`,
      `${task.role}: ${result.output.summary}`,
      task.id,
      "system",
    );

    // A retry is absorbed silently by design, but the owner should still see
    // it: a rising retry count is how a model regression shows up first.
    if (retriesThisTask > 0) {
      await event(
        session,
        run.id,
        "task.retried",
        `${task.role}: ${retriesThisTask === 1 ? "one reply was rejected and retried" : `${retriesThisTask} replies were rejected`}${retryReason ? ` — ${retryReason}` : ""}`,
        task.id,
        "system",
      );
    }
  }

  if (callsUsed !== run.calls_used) {
    await session.supabase
      .from("app_team_runs")
      .update({ calls_used: callsUsed })
      .eq("id", run.id)
      .eq("user_id", session.user.id);
  }

  tasks = await runTasks(session, run.id);
  await settleRun(session, run, tasks);
  refresh(projectId);

  const blockedCount = tasks.filter((task) => task.status === "blocked").length;
  const awaitingCount = tasks.filter((task) => task.status === "awaiting_review").length;
  return done(
    `Advanced ${selection.runnable.length} task(s).${blockedCount ? ` ${blockedCount} blocked.` : ""}${awaitingCount ? ` ${awaitingCount} awaiting review.` : ""}`,
  );
}

export async function approveTeamTaskAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  const taskId = readText(formData, "task_id");
  const run = await ownerRun(session, projectId);
  if (!run || !isUuid(taskId)) return fail(NOT_AVAILABLE);

  const { data: task } = await session.supabase
    .from("app_team_tasks")
    .select("*")
    .eq("id", taskId)
    .eq("run_id", run.id)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (!task) return fail(NOT_AVAILABLE);
  if (task.status !== "awaiting_review") return fail("That task is not awaiting review.");

  await session.supabase
    .from("app_team_tasks")
    .update({ status: "completed", finished_at: new Date().toISOString() })
    .eq("id", taskId)
    .eq("user_id", session.user.id);
  await event(session, run.id, "task.approved", "Owner approved the task output.", taskId);
  await settleRun(session, run, await runTasks(session, run.id));
  refresh(projectId);
  return done("Task approved.");
}

export async function rejectTeamTaskAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  const taskId = readText(formData, "task_id");
  const run = await ownerRun(session, projectId);
  if (!run || !isUuid(taskId)) return fail(NOT_AVAILABLE);

  const { data: task } = await session.supabase
    .from("app_team_tasks")
    .select("*")
    .eq("id", taskId)
    .eq("run_id", run.id)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (!task) return fail(NOT_AVAILABLE);
  if (!["blocked", "awaiting_review", "completed"].includes(task.status)) {
    return fail("That task cannot be rejected in its current state.");
  }
  if (run.integration_status === "merged") {
    return fail("Integration has already applied files. Restore a version instead of rejecting a branch.");
  }

  await session.supabase
    .from("app_team_tasks")
    .update({
      status: "cancelled",
      blocker: "Rejected by the owner.",
      error: "Rejected by the owner.",
      finished_at: new Date().toISOString(),
    })
    .eq("id", taskId)
    .eq("user_id", session.user.id);
  await event(session, run.id, "task.rejected", "Owner rejected this task; its branch was not applied.", taskId);
  await settleRun(session, run, await runTasks(session, run.id));
  refresh(projectId);
  return done("Task rejected. Its branch will not be integrated.");
}

export async function reassignTeamTaskAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  const taskId = readText(formData, "task_id");
  const role = readText(formData, "role") as TeamRole;
  const run = await ownerRun(session, projectId);
  if (!run || !isUuid(taskId)) return fail(NOT_AVAILABLE);
  if (!TEAM_ROLES.includes(role)) return fail("Choose a valid role.");

  const { data: task } = await session.supabase
    .from("app_team_tasks")
    .select("*")
    .eq("id", taskId)
    .eq("run_id", run.id)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (!task) return fail(NOT_AVAILABLE);
  if (!["queued", "blocked"].includes(task.status)) {
    return fail("Only a queued or blocked task can be reassigned.");
  }

  const claims = (task.file_claims ?? []) as string[];
  const definition = roleDefinition(role);
  const invalid = claims.filter((path) => !taskCanWritePath({ role }, path));
  if (invalid.length > 0) {
    return fail(`${definition.label} cannot own: ${invalid.join(", ")}. Reject the task instead.`);
  }

  await session.supabase
    .from("app_team_tasks")
    .update({
      role,
      allowed_tools: definition.tools,
      model: run.mode === "model" ? run.model_by_role?.[role] ?? DEFAULT_AI_MODEL : null,
      status: "queued",
      blocker: null,
      error: null,
    })
    .eq("id", taskId)
    .eq("user_id", session.user.id);
  await event(session, run.id, "task.reassigned", `Owner reassigned the task to ${definition.label}.`, taskId);
  await settleRun(session, run, await runTasks(session, run.id));
  refresh(projectId);
  return done(`Task reassigned to ${definition.label}.`);
}

export async function resolveTeamClaimAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  const taskId = readText(formData, "task_id");
  const run = await ownerRun(session, projectId);
  if (!run || !isUuid(taskId)) return fail(NOT_AVAILABLE);

  const { data: task } = await session.supabase
    .from("app_team_tasks")
    .select("*")
    .eq("id", taskId)
    .eq("run_id", run.id)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (!task) return fail(NOT_AVAILABLE);
  if (task.status !== "blocked") return fail("That task is not blocked.");
  if (run.integration_status === "merged") return fail("Integration has already run.");

  await session.supabase
    .from("app_team_tasks")
    .update({
      status: "cancelled",
      blocker: "Owner resolved the overlapping file claim by cancelling this branch.",
      error: "Cancelled to resolve a file ownership conflict.",
      finished_at: new Date().toISOString(),
    })
    .eq("id", taskId)
    .eq("user_id", session.user.id);
  await event(session, run.id, "task.claim_resolved", "Owner cancelled the later branch so the earlier owner keeps the file.", taskId);
  await settleRun(session, run, await runTasks(session, run.id));
  refresh(projectId);
  return done("Conflict resolved: the later branch was cancelled; no file was overwritten.");
}

export async function pauseTeamAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const run = await ownerRun(session, projectId);
  if (!run) return fail(NOT_AVAILABLE);
  if (run.status !== "running" && run.status !== "awaiting_review") {
    return fail("This run cannot be paused now.");
  }

  await session.supabase
    .from("app_team_runs")
    .update({ status: "paused", active_count: 0 })
    .eq("id", run.id)
    .eq("user_id", session.user.id);
  await event(session, run.id, "run.paused", "Owner paused the queue. No new task will start.", null, "owner");
  refresh(projectId);
  return done("Run paused.");
}

export async function resumeTeamAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const run = await ownerRun(session, projectId);
  if (!run) return fail(NOT_AVAILABLE);
  if (run.status !== "paused") return fail("This run is not paused.");

  const reason = limitReason(run);
  if (reason) {
    await failAtLimit(session, run, reason);
    refresh(projectId);
    return fail(reason);
  }

  await session.supabase
    .from("app_team_runs")
    .update({ status: "running" })
    .eq("id", run.id)
    .eq("user_id", session.user.id);
  await event(session, run.id, "run.resumed", "Owner resumed the queue.", null, "owner");
  await settleRun(session, run, await runTasks(session, run.id));
  refresh(projectId);
  return done("Run resumed.");
}

export async function cancelTeamAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const run = await ownerRun(session, projectId);
  if (!run) return fail(NOT_AVAILABLE);
  if (run.status === "completed" || run.status === "cancelled") {
    return fail("This run has already finished.");
  }

  await session.supabase
    .from("app_team_tasks")
    .update({ status: "cancelled", error: "Run cancelled by the owner.", finished_at: new Date().toISOString() })
    .eq("run_id", run.id)
    .eq("user_id", session.user.id)
    .in("status", ["queued", "running", "blocked", "awaiting_review"]);
  await session.supabase
    .from("app_team_runs")
    .update({
      status: "cancelled",
      active_count: 0,
      last_error: "Cancelled by the owner.",
      finished_at: new Date().toISOString(),
    })
    .eq("id", run.id)
    .eq("user_id", session.user.id);
  await event(session, run.id, "run.cancelled", "Owner cancelled the run; all active and queued tasks were cancelled.", null, "owner");
  refresh(projectId);
  return done("Run cancelled. No further task will run and no branch was integrated.");
}

export async function integrateTeamAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const project = await ownerProject(session, projectId);
  if (!project) return fail(NOT_AVAILABLE);
  const run = await ownerRun(session, projectId);
  if (!run) return fail("Start a team run first.");
  if (run.integration_status === "merged") return fail("This run has already been integrated.");
  if (run.status === "cancelled" || run.status === "failed") return fail("This run is no longer active.");

  const tasks = await runTasks(session, run.id);
  const codeTasks = tasks.filter((task) => ["frontend", "backend", "data"].includes(task.role));
  const unfinished = codeTasks.filter((task) => task.status !== "completed" && task.status !== "cancelled");
  if (unfinished.length > 0) {
    return fail("Every code task must be completed or rejected before integration.");
  }
  if (tasks.some((task) => task.status === "blocked")) {
    return fail("Resolve the blocked task before integrating.");
  }

  const { data: files } = await session.supabase
    .from("app_files")
    .select("path, content")
    .eq("project_id", projectId)
    .eq("user_id", session.user.id);
  const current = (files ?? []) as { path: string; content: string }[];
  const result = mergeTeamBranches(tasks, current);

  if (!result.ok) {
    const detail = result.conflicts.slice(0, 12).join(" ");
    await session.supabase.from("app_team_integrations").insert({
      run_id: run.id,
      project_id: projectId,
      user_id: session.user.id,
      status: "conflict",
      contributors: result.contributors,
      conflict_files: result.conflicts.map((item) => item.split(":")[0]).slice(0, 60),
      checks: [],
      log: detail.slice(0, 200000),
      error: "Integration stopped before writing any file.",
    });
    await session.supabase
      .from("app_team_runs")
      .update({ integration_status: "conflict", last_error: `Integration conflict: ${detail}`.slice(0, 1000) })
      .eq("id", run.id)
      .eq("user_id", session.user.id);
    await event(session, run.id, "integration.conflict", detail, null, "system");
    refresh(projectId);
    return fail(`Integration conflict: ${detail} No files were written.`);
  }

  const config = getPreviewConfig();
  if (!config) {
    return fail(
      "The preview runner is not configured, so integration would be unverified. Add PREVIEW_RUNNER_URL, PREVIEW_RUNNER_TOKEN, PREVIEW_SIGNING_SECRET and PREVIEW_PUBLIC_ORIGIN.",
    );
  }

  const summary = attributionSummary(tasks, result.contributors, run.mode);
  const { data: version, error } = await session.supabase.rpc("replace_app_files", {
    p_project_id: projectId,
    p_files: result.files,
    p_summary: summary,
    p_note: `Controlled agent-team integration from ${run.mode}-mode branches.`,
  });
  if (error) {
    console.error("integrateTeamAction replace failed:", error.message);
    return fail("The merged files were refused; the current project is unchanged.");
  }

  let checks: TeamCheck[] = [];
  let log = "";
  let checksFailed = false;
  let runnerKey: string | null = null;
  try {
    const created = await createRunnerWorkspace(config, {
      projectId,
      userId: session.user.id,
      files: result.files,
    });
    runnerKey = created.key;
    const checkResult = await runRunnerChecks(config, created.key);
    checks = checkResult.checks;
    log = checkResult.log;
    checksFailed = checkResult.status !== "passed";
  } catch (checkError) {
    checksFailed = true;
    log = checkError instanceof Error ? checkError.message : "The runner check could not complete.";
  } finally {
    if (runnerKey) {
      try {
        await stopRunnerWorkspace(config, runnerKey);
      } catch {
        /* the runner expires its own workspaces */
      }
    }
  }

  const status = checksFailed ? "checks_failed" : "merged";
  await session.supabase.from("app_team_integrations").insert({
    run_id: run.id,
    project_id: projectId,
    user_id: session.user.id,
    status,
    contributors: result.contributors,
    conflict_files: [],
    checks,
    log: log.slice(0, 200000),
    version,
    error: checksFailed ? "One or more integration checks failed." : null,
  });
  await session.supabase
    .from("app_team_runs")
    .update({
      integration_status: status,
      status: checksFailed ? "failed" : "running",
      last_error: checksFailed ? "Integration was written, but checks failed. Restore a version if needed." : null,
      finished_at: checksFailed ? new Date().toISOString() : null,
    })
    .eq("id", run.id)
    .eq("user_id", session.user.id);
  await event(
    session,
    run.id,
    checksFailed ? "integration.checks_failed" : "integration.merged",
    checksFailed
      ? "Files were integrated but checks failed; nothing was hidden."
      : `Files integrated as version ${version} with passing checks.`,
    null,
    "system",
  );
  refresh(projectId);

  if (checksFailed) {
    return fail(
      `Integration wrote version ${version}, but one or more checks failed. Inspect the evidence; restore version ${project.current_version} if needed.`,
    );
  }
  return done(`Integrated as version ${version}. ${summary} Checks passed; QA can now review the evidence.`);
}
