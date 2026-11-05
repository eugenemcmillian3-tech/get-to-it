"use server";

import { revalidatePath } from "next/cache";
import type { BuildState } from "@/lib/action-state";
import { DEFAULT_AI_MODEL } from "@/lib/ai/models";
import { chatWithOllama, ollamaErrorMessage } from "@/lib/ai/ollama";
import { finishAiRequest, reserveAiRequest } from "@/lib/ai/limits";
import { getSession } from "@/lib/auth";
import { BUILD_REPAIR_CREDITS } from "@/lib/credits/pricing";
import {
  PREVIEW_LIMITS,
  PreviewError,
  applyRepairPatch,
  buildRepairMessages,
  checkSummary,
  createRunnerWorkspace,
  diffFiles,
  firstFailure,
  getPreviewConfig,
  parseRepairPatch,
  previewUrl,
  runRunnerChecks,
  startRunnerPreview,
  stopRunnerWorkspace,
  updateRunnerWorkspace,
  type CheckResult,
  type PreviewConfig,
} from "@/lib/preview-workspace";
import type { AppWorkspace, AppWorkspaceRun } from "@/lib/types";
import { isUuid, readText } from "@/lib/validation";

/**
 * Phase 22 actions.
 *
 * Generation still writes files only. A workspace is a separate, explicitly
 * started runner with its own directory, timeouts and cleanup. Every action is
 * owner-scoped and records what happened; failures are returned, never hidden.
 */

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That app project isn't available to you.";
const RUNNER_MISSING =
  "The preview runner isn't configured on this server. Add PREVIEW_RUNNER_URL, PREVIEW_RUNNER_TOKEN, PREVIEW_SIGNING_SECRET and PREVIEW_PUBLIC_ORIGIN.";

function fail(message: string, remaining?: number): BuildState {
  return { status: "error", message, remaining, nonce: Date.now() };
}

function done(message: string, link?: string, remaining?: number): BuildState {
  return { status: "success", message, link, remaining, nonce: Date.now() };
}

function refresh(projectId: string): void {
  revalidatePath("/build");
  revalidatePath(`/build/${projectId}`);
  revalidatePath(`/build/${projectId}/workspace`);
}

async function ownerProject(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  projectId: string,
) {
  if (!isUuid(projectId)) return null;
  const { data } = await session.supabase
    .from("app_projects")
    .select("*")
    .eq("id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  return data;
}

async function projectFiles(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  projectId: string,
): Promise<{ path: string; content: string }[]> {
  const { data } = await session.supabase
    .from("app_files")
    .select("path, content")
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .order("path", { ascending: true });
  return (data ?? []) as { path: string; content: string }[];
}

async function workspaceFor(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  projectId: string,
): Promise<AppWorkspace | null> {
  const { data } = await session.supabase
    .from("app_workspaces")
    .select("*")
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  return (data as AppWorkspace | null) ?? null;
}

function requireRunner(): PreviewConfig | BuildState {
  const config = getPreviewConfig();
  return config ?? fail(RUNNER_MISSING);
}

function isState(value: PreviewConfig | BuildState): value is BuildState {
  return "status" in value;
}

async function recordRun(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  input: {
    workspaceId: string;
    projectId: string;
    kind: AppWorkspaceRun["kind"];
    status: AppWorkspaceRun["status"];
    iteration?: number;
    checks?: CheckResult["checks"];
    log?: string;
    changedFiles?: string[];
    diff?: string;
    aiRequests?: number;
    error?: string | null;
  },
): Promise<void> {
  const { error } = await session.supabase.from("app_workspace_runs").insert({
    workspace_id: input.workspaceId,
    project_id: input.projectId,
    user_id: session.user.id,
    kind: input.kind,
    status: input.status,
    iteration: input.iteration ?? 0,
    checks: input.checks ?? [],
    log: (input.log ?? "").slice(0, PREVIEW_LIMITS.maxLogChars),
    changed_files: input.changedFiles ?? [],
    diff: (input.diff ?? "").slice(0, PREVIEW_LIMITS.maxLogChars),
    ai_requests: input.aiRequests ?? 0,
    error: input.error?.slice(0, 1000) ?? null,
  });
  if (error) console.error("recordRun failed:", error.message);
}

export async function startWorkspaceAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  const project = await ownerProject(session, projectId);
  if (!project) return fail(NOT_AVAILABLE);

  const config = requireRunner();
  if (isState(config)) return config;

  const files = await projectFiles(session, projectId);
  if (files.length === 0) return fail("Generate the project before starting a preview workspace.");

  let runnerKey: string | null = null;
  try {
    const created = await createRunnerWorkspace(config, {
      projectId,
      userId: session.user.id,
      files,
    });
    runnerKey = created.key;

    const { data: workspace, error } = await session.supabase
      .from("app_workspaces")
      .upsert(
        {
          project_id: projectId,
          user_id: session.user.id,
          runner_key: created.key,
          status: "checking",
          started_at: new Date().toISOString(),
          expires_at: null,
          last_error: null,
          iterations: 0,
          ai_requests: 0,
          credit_budget: 6,
          credits_spent: 0,
        },
        { onConflict: "project_id" },
      )
      .select("id")
      .single();

    if (error || !workspace) throw new PreviewError("The workspace could not be saved.");

    const checks = await runRunnerChecks(config, created.key);
    const failed = checks.status !== "passed";
    const message = failed
      ? `Checks failed: ${checkSummary(checks.checks)}. Nothing is hidden; inspect the log and repair or fix the source.`
      : `Checks passed: ${checkSummary(checks.checks)}. You can start the isolated preview.`;

    await session.supabase
      .from("app_workspaces")
      .update({
        status: failed ? "checks_failed" : "checks_passed",
        last_error: failed ? message.slice(0, 500) : null,
      })
      .eq("id", workspace.id)
      .eq("user_id", session.user.id);

    await recordRun(session, {
      workspaceId: workspace.id,
      projectId,
      kind: "checks",
      status: checks.status,
      checks: checks.checks,
      log: checks.log,
      error: failed ? message : null,
    });

    refresh(projectId);
    return failed ? fail(message) : done(message);
  } catch (error) {
    if (runnerKey) {
      try {
        await stopRunnerWorkspace(config, runnerKey);
      } catch {
        /* best effort: the runner expires idle workspaces itself */
      }
    }
    const message = error instanceof PreviewError ? error.message : "The preview workspace could not start.";
    return fail(message);
  }
}

export async function runWorkspaceChecksAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  const project = await ownerProject(session, projectId);
  if (!project) return fail(NOT_AVAILABLE);

  const config = requireRunner();
  if (isState(config)) return config;

  const workspace = await workspaceFor(session, projectId);
  if (!workspace?.runner_key) return fail("Start a preview workspace before running checks.");

  try {
    const files = await projectFiles(session, projectId);
    await updateRunnerWorkspace(config, workspace.runner_key, { projectId, files });
    const checks = await runRunnerChecks(config, workspace.runner_key);
    const failed = checks.status !== "passed";

    await session.supabase
      .from("app_workspaces")
      .update({
        status: failed ? "checks_failed" : "checks_passed",
        expires_at: null,
        last_error: failed ? "One or more checks failed." : null,
      })
      .eq("id", workspace.id)
      .eq("user_id", session.user.id);

    await recordRun(session, {
      workspaceId: workspace.id,
      projectId,
      kind: "checks",
      status: checks.status,
      checks: checks.checks,
      log: checks.log,
      error: failed ? "One or more checks failed." : null,
    });

    refresh(projectId);
    return failed
      ? fail(`Checks failed: ${checkSummary(checks.checks)}. The full log is below.`)
      : done(`Checks passed: ${checkSummary(checks.checks)}.`);
  } catch (error) {
    return fail(error instanceof PreviewError ? error.message : "The checks could not run.");
  }
}

export async function previewWorkspaceAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  const project = await ownerProject(session, projectId);
  if (!project) return fail(NOT_AVAILABLE);

  const config = requireRunner();
  if (isState(config)) return config;

  const workspace = await workspaceFor(session, projectId);
  if (!workspace?.runner_key) return fail("Start a preview workspace and run checks first.");

  try {
    const started = await startRunnerPreview(config, workspace.runner_key);
    const link = previewUrl(config, {
      key: workspace.runner_key,
      projectId,
      userId: session.user.id,
    });

    await session.supabase
      .from("app_workspaces")
      .update({
        status: "preview",
        expires_at: new Date(Math.min(started.expiresAt, Date.now() + PREVIEW_LIMITS.maxRuntimeMs)).toISOString(),
        last_error: null,
      })
      .eq("id", workspace.id)
      .eq("user_id", session.user.id);

    await recordRun(session, {
      workspaceId: workspace.id,
      projectId,
      kind: "preview",
      status: "passed",
      log: `Preview started on its own origin (${started.host}). The link expires; no platform cookie is sent to it.`,
    });

    refresh(projectId);
    return done("Preview is running on a separate origin. Open it in a new tab; the signed link expires.", link);
  } catch (error) {
    return fail(error instanceof PreviewError ? error.message : "The preview could not start.");
  }
}

export async function stopWorkspaceAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  const project = await ownerProject(session, projectId);
  if (!project) return fail(NOT_AVAILABLE);

  const config = requireRunner();
  if (isState(config)) return config;

  const workspace = await workspaceFor(session, projectId);
  if (!workspace) return fail("There is no workspace to stop.");

  try {
    if (workspace.runner_key) await stopRunnerWorkspace(config, workspace.runner_key);
    await session.supabase
      .from("app_workspaces")
      .update({ status: "stopped", expires_at: null, last_error: null })
      .eq("id", workspace.id)
      .eq("user_id", session.user.id);

    await recordRun(session, {
      workspaceId: workspace.id,
      projectId,
      kind: "stop",
      status: "passed",
      log: "Workspace stopped. Its directory and preview process were removed.",
    });

    refresh(projectId);
    return done("Workspace stopped. Its files and preview process were removed from the runner.");
  } catch (error) {
    return fail(error instanceof PreviewError ? error.message : "The workspace could not be stopped.");
  }
}

export async function repairWorkspaceAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  const project = await ownerProject(session, projectId);
  if (!project) return fail(NOT_AVAILABLE);

  const config = requireRunner();
  if (isState(config)) return config;

  const workspace = await workspaceFor(session, projectId);
  if (!workspace?.runner_key) return fail("Start a preview workspace before repairing it.");
  if (workspace.iterations >= PREVIEW_LIMITS.maxRepairIterations) {
    return fail("This workspace has used its three repair attempts. Fix the source yourself, or start a new workspace after the limit resets.");
  }
  if (workspace.credits_spent + BUILD_REPAIR_CREDITS > workspace.credit_budget) {
    return fail(
      `This workspace has used its ${workspace.credit_budget}-credit AI budget. A repair costs ${BUILD_REPAIR_CREDITS} credits, so no further AI repair was started.`,
    );
  }
  if (Date.now() - new Date(workspace.started_at).getTime() > PREVIEW_LIMITS.maxRuntimeMs) {
    return fail("This workspace is past its runtime budget. Stop it, then start a new one.");
  }

  const { data: lastChecks } = await session.supabase
    .from("app_workspace_runs")
    .select("*")
    .eq("workspace_id", workspace.id)
    .eq("kind", "checks")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const checks = (lastChecks as AppWorkspaceRun | null)?.checks ?? [];
  const failure = firstFailure(checks);
  if (!failure) return fail("There is no failing check to repair. Run checks first; if they pass, start the preview.");

  const reservation = await reserveAiRequest(session, "app_repair", DEFAULT_AI_MODEL, {
    kind: "build",
    id: workspace.id,
  });
  if (!reservation.ok) return fail(reservation.message);

  const files = await projectFiles(session, projectId);
  let requestId: string = reservation.reservation.id;
  const remaining = reservation.reservation.remaining;

  try {
    let reply;
    try {
      reply = await chatWithOllama({
        model: DEFAULT_AI_MODEL,
        messages: buildRepairMessages(files, failure, workspace.iterations),
        format: "json",
        temperature: 0,
        timeoutMs: 60_000,
      });
    } catch (error) {
      await finishAiRequest(session, requestId, "failed", "repair-proposal");
      await recordRun(session, {
        workspaceId: workspace.id,
        projectId,
        kind: "repair",
        status: "failed",
        iteration: workspace.iterations + 1,
        aiRequests: 1,
        error: ollamaErrorMessage(error).slice(0, 1000),
      });
      refresh(projectId);
      return fail(ollamaErrorMessage(error), remaining);
    }

    await finishAiRequest(session, requestId, "succeeded", undefined, reply.tokens);
    requestId = "";

    const patch = parseRepairPatch(reply.content);
    const applied = applyRepairPatch(files, patch);
    if (applied.changed.length === 0) {
      return fail("The model returned no change to an editable source file. Nothing was applied.", remaining);
    }

    const diff = diffFiles(files, applied.files);
    const { error: replaceError } = await session.supabase.rpc("replace_app_files", {
      p_project_id: projectId,
      p_files: applied.files,
      p_summary: `Repair iteration ${workspace.iterations + 1}: ${patch.summary}`.slice(0, 500),
      p_note: `AI repair proposal for ${failure.label}. ${patch.summary}`.slice(0, 500),
    });

    if (replaceError) {
      console.error("repairWorkspaceAction replace failed:", replaceError.message);
      return fail("The patch could not be saved, so the previous version is unchanged.", remaining);
    }

    await updateRunnerWorkspace(config, workspace.runner_key, { projectId, files: applied.files });
    const rerun = await runRunnerChecks(config, workspace.runner_key);
    const failed = rerun.status !== "passed";

    await session.supabase
      .from("app_workspaces")
      .update({
        status: failed ? "checks_failed" : "checks_passed",
        iterations: workspace.iterations + 1,
        ai_requests: workspace.ai_requests + 1,
        expires_at: null,
        last_error: failed ? "The repair did not make all checks pass." : null,
      })
      .eq("id", workspace.id)
      .eq("user_id", session.user.id);

    await recordRun(session, {
      workspaceId: workspace.id,
      projectId,
      kind: "repair",
      status: rerun.status,
      iteration: workspace.iterations + 1,
      checks: rerun.checks,
      log: rerun.log,
      changedFiles: applied.changed,
      diff: diff.diff,
      aiRequests: 1,
      error: failed ? "One or more checks still fail." : null,
    });

    refresh(projectId);
    if (failed) {
      return fail(
        `Repair ${workspace.iterations + 1} applied to ${applied.changed.join(", ")}, but checks still fail: ${checkSummary(rerun.checks)}. The failure is recorded; nothing was hidden.`,
        remaining,
      );
    }
    return done(
      `Repair ${workspace.iterations + 1} passed all checks. Changed: ${applied.changed.join(", ")}. Inspect the diff before previewing.`,
      undefined,
      remaining,
    );
  } catch (error) {
    if (requestId) await finishAiRequest(session, requestId, "failed", "repair-error");
    const message =
      error instanceof PreviewError
        ? error.message
        : error instanceof Error
          ? error.message
          : "The repair could not be applied.";
    await recordRun(session, {
      workspaceId: workspace.id,
      projectId,
      kind: "repair",
      status: "error",
      iteration: workspace.iterations + 1,
      aiRequests: 1,
      error: message.slice(0, 1000),
    });
    refresh(projectId);
    return fail(message, remaining);
  }
}
