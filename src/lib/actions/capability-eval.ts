"use server";

import { revalidatePath } from "next/cache";
import type { BuildState } from "@/lib/action-state";
import { finishAiRequest, reserveAiRequest } from "@/lib/ai/limits";
import { aiModelLabel, isAiModel } from "@/lib/ai/models";
import { chatWithOllama, hasOllamaKey, OllamaError, ollamaErrorMessage } from "@/lib/ai/ollama";
import { getSession } from "@/lib/auth";
import {
  CAPABILITY_LIMITS,
  fixtureSubmission,
  humanBaselineDraft,
  planCapabilityRuns,
  seedCapabilityTasks,
  seedCapabilityVersions,
  type CapabilityDomain,
  type CapabilityEvalRecord,
  type CapabilityTaskRecord,
  type CapabilityVersionRecord,
} from "@/lib/capability-eval";
import {
  AUTHORED_TASK_MODE,
  AUTHORED_TASKS,
  answerKind,
  LIVE_TRIAL_COST_CENTS,
  LIVE_TRIAL_CREDIT_COST,
  LIVE_TRIAL_KIND,
  LIVE_TRIAL_LIMITS,
  liveTrialMessages,
  liveTrialReadiness,
  liveTrialTimeoutMs,
  parseLiveAnswer,
} from "@/lib/capability-eval-live";
import { isUuid, readText } from "@/lib/validation";

/**
 * Phase 38 actions.
 *
 * They write evaluation evidence only. Nothing here calls a provider, spends
 * credits, deploys, or changes a permission. Scoring happens in the database
 * against a held-out key the application never reads.
 */

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That capability evaluation isn't available to you.";

type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

function fail(message: string): BuildState {
  return { status: "error", message, nonce: Date.now() };
}

function done(message: string): BuildState {
  return { status: "success", message, nonce: Date.now() };
}

function refresh(evalId?: string): void {
  revalidatePath("/capability-eval");
  if (evalId) revalidatePath(`/capability-eval/${evalId}`);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

async function ownerEval(
  session: Session,
  evalId: string,
): Promise<CapabilityEvalRecord | null> {
  if (!isUuid(evalId)) return null;
  const { data, error } = await session.supabase
    .from("capability_evals")
    .select("*")
    .eq("id", evalId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (error) {
    console.error("ownerEval failed:", error.message);
    return null;
  }
  return (data as CapabilityEvalRecord | null) ?? null;
}

export async function createCapabilityEvalAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const name = readText(formData, "name").trim();
  const description = readText(formData, "description").trim();
  const datasetVersion = readText(formData, "dataset_version").trim() || "dataset-v1";

  if (name.length < 3) return fail("Give the evaluation a name with at least 3 characters.");
  if (description.length > 1000) return fail("Keep the description under 1000 characters.");
  if (datasetVersion.length > 80) return fail("Keep the dataset version under 80 characters.");

  const { data: evaluation, error } = await session.supabase
    .from("capability_evals")
    .insert({
      user_id: session.user.id,
      name,
      description,
      dataset_version: datasetVersion,
      status: "draft",
    })
    .select("*")
    .single();

  if (error || !evaluation) {
    console.error("createCapabilityEvalAction evaluation failed:", error?.message);
    return fail("We couldn't create the capability evaluation. Nothing was saved.");
  }

  const record = evaluation as CapabilityEvalRecord;
  const tasks = seedCapabilityTasks().map((task) => ({
    eval_id: record.id,
    user_id: session.user.id,
    domain: task.domain,
    difficulty: task.difficulty,
    split: task.split,
    title: task.title,
    task_spec: task.task_spec,
    dataset_version: datasetVersion,
    permitted_tools: task.permitted_tools,
    runtime_seconds: task.runtime_seconds,
    spend_limit_cents: task.spend_limit_cents,
    scoring_rubric: task.scoring_rubric,
  }));
  const versions = seedCapabilityVersions().map((version) => ({
    eval_id: record.id,
    user_id: session.user.id,
    ...version,
    dataset_version: datasetVersion,
  }));

  const [tasksResult, versionsResult] = await Promise.all([
    session.supabase.from("capability_eval_tasks").insert(tasks),
    session.supabase.from("capability_eval_versions").insert(versions),
  ]);

  if (tasksResult.error || versionsResult.error) {
    console.error(
      "createCapabilityEvalAction seed failed:",
      tasksResult.error?.message,
      versionsResult.error?.message,
    );
    refresh();
    return fail(
      "The tasks or versions couldn't be seeded. The evaluation was left in draft and cannot run; create a new one.",
    );
  }

  const { error: keyError } = await session.supabase.rpc("capability_eval_seed_keys", {
    p_eval_id: record.id,
  });
  if (keyError) {
    console.error("createCapabilityEvalAction keys failed:", keyError.message);
    refresh();
    return fail(
      "The held-out answer keys couldn't be stored, so nothing can be scored. The evaluation was left in draft.",
    );
  }

  const { error: activateError } = await session.supabase
    .from("capability_evals")
    .update({ status: "active" })
    .eq("id", record.id)
    .eq("user_id", session.user.id);

  if (activateError) {
    console.error("createCapabilityEvalAction activate failed:", activateError.message);
    refresh();
    return fail("The evaluation was created but could not be activated. It cannot run.");
  }

  refresh();
  return {
    ...done(
      `Capability evaluation created with ${tasks.length} tasks across eight domains and ${versions.length} versioned configurations. Answer keys are stored where the application cannot read them.`,
    ),
    link: `/capability-eval/${record.id}`,
  };
}

export async function runCapabilityEvalAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const evalId = readText(formData, "eval_id");
  const evaluation = await ownerEval(session, evalId);
  if (!evaluation) return fail(NOT_AVAILABLE);
  if (evaluation.status !== "active") {
    return fail("This evaluation is incomplete and cannot run. Create a new one.");
  }

  const trials = clamp(Number(readText(formData, "trials")), 1, CAPABILITY_LIMITS.maxTrials);
  const includeHeldOut = readText(formData, "include_held_out") === "on";

  const [versionsResult, tasksResult, runsResult] = await Promise.all([
    session.supabase
      .from("capability_eval_versions")
      .select("*")
      .eq("eval_id", evalId)
      .eq("user_id", session.user.id)
      .eq("status", "active"),
    session.supabase
      .from("capability_eval_tasks")
      .select("*")
      .eq("eval_id", evalId)
      .eq("user_id", session.user.id),
    session.supabase
      .from("capability_eval_runs")
      .select("task_id, version_id, trial")
      .eq("eval_id", evalId)
      .eq("user_id", session.user.id),
  ]);

  for (const result of [versionsResult, tasksResult, runsResult]) {
    if (result.error) {
      console.error("runCapabilityEvalAction read failed:", result.error.message);
      return fail("We couldn't load the evaluation plan.");
    }
  }

  const versions = (versionsResult.data ?? []) as CapabilityVersionRecord[];
  const tasks = (tasksResult.data ?? []) as CapabilityTaskRecord[];
  const existing = (runsResult.data ?? []) as {
    task_id: string;
    version_id: string;
    trial: number;
  }[];

  const plan = planCapabilityRuns({
    tasks: tasks.map((task) => ({ id: task.id, split: task.split })),
    versions: versions.map((version) => ({ id: version.id, baseline_kind: version.baseline_kind })),
    trials,
    existingRuns: existing,
    includeHeldOut,
  });
  if (!plan.ok) return fail(plan.reason);

  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const versionById = new Map(versions.map((version) => [version.id, version]));
  const evidence: Record<string, unknown>[] = [];

  for (const item of plan.planned) {
    const task = taskById.get(item.task_id);
    const version = versionById.get(item.version_id);
    if (!task || !version) return fail("The evaluation plan lost a task or version. Nothing was recorded.");

    const submission = fixtureSubmission({
      domain: task.domain as CapabilityDomain,
      difficulty: task.difficulty,
      split: task.split,
      baseline: version.baseline_kind,
      trial: item.trial,
      humanAssistance: version.human_assistance,
    });

    const { data: scored, error: scoreError } = await session.supabase.rpc(
      "capability_eval_score_task",
      { p_task_id: task.id, p_submission: submission },
    );
    if (scoreError || !scored) {
      console.error("runCapabilityEvalAction score failed:", scoreError?.message);
      return fail("A task could not be scored against its key. Nothing was recorded.");
    }

    const result = scored as {
      outcome: "verified_success" | "partial_success" | "failed" | "errored";
      verified_success: boolean;
      unsupported_claims: number;
      failure_category: string | null;
      scoring_detail: Record<string, unknown>;
    };

    evidence.push({
      eval_id: evalId,
      version_id: version.id,
      task_id: task.id,
      user_id: session.user.id,
      domain: task.domain,
      difficulty: task.difficulty,
      split: task.split,
      trial: item.trial,
      outcome: result.outcome,
      verified_success: result.verified_success,
      unsupported_claims: result.unsupported_claims,
      permission_violations: submission.permission_attempts,
      human_interventions: version.human_assistance === "none" ? 0 : 1,
      recovery_attempts: submission.recovery?.attempted ? 1 : 0,
      recovery_succeeded: submission.recovery?.succeeded ?? null,
      cost_cents: submission.cost_cents,
      latency_ms: submission.latency_ms,
      failure_category: result.failure_category,
      scoring_detail: result.scoring_detail,
    });
  }

  const { error: insertError } = await session.supabase
    .from("capability_eval_runs")
    .insert(evidence);
  if (insertError) {
    console.error("runCapabilityEvalAction insert failed:", insertError.message);
    return fail("The runs couldn't be recorded. Nothing was saved.");
  }

  const failures = evidence.filter((run) => run.outcome !== "verified_success").length;
  const contaminated = evidence.filter((run) => run.split === "held_out").length;
  refresh(evalId);
  return done(
    `Recorded ${evidence.length} trial(s). ${failures} were partial or failed and remain visible. ${contaminated} held-out trial(s) are reported separately from development results.`,
  );
}

export async function recordHumanBaselineAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const evalId = readText(formData, "eval_id");
  const evaluation = await ownerEval(session, evalId);
  if (!evaluation) return fail(NOT_AVAILABLE);

  let results: unknown = {};
  const rawResults = readText(formData, "results").trim();
  if (rawResults.length > 0) {
    try {
      results = JSON.parse(rawResults);
    } catch {
      return fail("Record the results as valid JSON, for example {\"verified_rate\": 0.6}.");
    }
  }

  const parsed = humanBaselineDraft({
    domain: readText(formData, "domain"),
    protocol_document: readText(formData, "protocol_document"),
    collected_by: readText(formData, "collected_by"),
    sample_size: Number(readText(formData, "sample_size")),
    results,
  });
  if (!parsed.ok) return fail(parsed.reason);

  const { error } = await session.supabase.from("capability_eval_human_baselines").insert({
    eval_id: evalId,
    user_id: session.user.id,
    ...parsed.draft,
  });

  if (error) {
    console.error("recordHumanBaselineAction failed:", error.message);
    return fail("We couldn't record the human baseline. Nothing was saved.");
  }

  refresh(evalId);
  return done(
    "Human baseline recorded with its collection protocol. It is immutable; retract it and record a new one if it changes.",
  );
}

const AUTHORED_RUBRIC = {
  pass: "The computed answer matches the recorded expected value.",
  partial: "Not used: an exact answer is either right or wrong.",
  fail: "The answer is missing, unreadable or wrong.",
};

/**
 * Adds the machine-checkable task set and a paid configuration.
 *
 * Nothing is charged here. The expected answers are written straight into the
 * answer key through a definer function: they never appear in the task prompt,
 * in the task row, or in this action's response.
 */
export async function prepareLiveCapabilityAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const evalId = readText(formData, "eval_id");
  const evaluation = await ownerEval(session, evalId);
  if (!evaluation) return fail(NOT_AVAILABLE);
  if (evaluation.status !== "active") {
    return fail("This evaluation is incomplete and cannot run. Create a new one.");
  }

  const model = readText(formData, "model").trim();
  if (!isAiModel(model)) return fail("Choose one of the available models.");

  const spendLimit = clamp(
    Number(readText(formData, "spend_limit_cents")),
    0,
    LIVE_TRIAL_LIMITS.maxSpendCents,
  );
  if (spendLimit < LIVE_TRIAL_LIMITS.minSpendCents) {
    return fail(
      `A live trial costs ${LIVE_TRIAL_COST_CENTS} cents (${LIVE_TRIAL_CREDIT_COST} credits). Set a spend ceiling of at least ${LIVE_TRIAL_LIMITS.minSpendCents} cents, or the database will refuse to record the run.`,
    );
  }
  const runtimeSeconds = clamp(
    Number(readText(formData, "runtime_seconds")),
    LIVE_TRIAL_LIMITS.minRuntimeSeconds,
    LIVE_TRIAL_LIMITS.maxRuntimeSeconds,
  );

  const [tasksResult, versionsResult] = await Promise.all([
    session.supabase
      .from("capability_eval_tasks")
      .select("id, task_spec")
      .eq("eval_id", evalId)
      .eq("user_id", session.user.id),
    session.supabase
      .from("capability_eval_versions")
      .select("version")
      .eq("eval_id", evalId)
      .eq("user_id", session.user.id),
  ]);
  if (tasksResult.error || versionsResult.error) {
    console.error(
      "prepareLiveCapabilityAction read failed:",
      tasksResult.error?.message,
      versionsResult.error?.message,
    );
    return fail("We couldn't read the evaluation before changing it. Nothing was added.");
  }

  const existing = (tasksResult.data ?? []) as { id: string; task_spec: { mode?: string } | null }[];
  if (existing.some((task) => task.task_spec?.mode === AUTHORED_TASK_MODE)) {
    return fail("This evaluation already has a machine-checkable task set and a live configuration.");
  }

  const nextVersion =
    Math.max(0, ...((versionsResult.data ?? []) as { version: number }[]).map((row) => row.version)) + 1;

  const { data: insertedTasks, error: taskError } = await session.supabase
    .from("capability_eval_tasks")
    .insert(
      AUTHORED_TASKS.map((task) => ({
        eval_id: evalId,
        user_id: session.user.id,
        domain: task.domain,
        difficulty: task.difficulty,
        split: task.split,
        title: task.title,
        task_spec: {
          mode: AUTHORED_TASK_MODE,
          answer_kind: answerKind(task),
          prompt: task.problem,
          required_elements: 0,
          permitted_tools: [],
        },
        dataset_version: evaluation.dataset_version,
        permitted_tools: [],
        runtime_seconds: runtimeSeconds,
        spend_limit_cents: spendLimit,
        scoring_rubric: AUTHORED_RUBRIC,
      })),
    )
    .select("id, title");

  if (taskError || !insertedTasks?.length) {
    console.error("prepareLiveCapabilityAction tasks failed:", taskError?.message);
    return fail("The machine-checkable tasks couldn't be created. Nothing was added.");
  }

  for (const [index, authored] of AUTHORED_TASKS.entries()) {
    const created = (insertedTasks as { id: string; title: string }[])[index];
    const { error: keyError } = await session.supabase.rpc("capability_eval_seed_authored_key", {
      p_task_id: created.id,
      p_expected: authored.expected ?? null,
      p_expected_text: authored.expectedText ?? null,
      p_tolerance: authored.tolerance,
    });
    if (keyError) {
      console.error("prepareLiveCapabilityAction key failed:", keyError.message);
      refresh(evalId);
      return fail(
        "A task was created but its expected answer could not be stored, so it cannot be scored. Delete that task and add the set again.",
      );
    }
  }

  const { error: versionError } = await session.supabase.from("capability_eval_versions").insert({
    eval_id: evalId,
    user_id: session.user.id,
    label: `Live single-model — ${aiModelLabel(model)}`,
    version: nextVersion,
    baseline_kind: "single_model_baseline",
    model_version: model,
    orchestration_version: "none",
    prompt_version: "live-prompt-v1",
    dataset_version: evaluation.dataset_version,
    scoring_rubric: { weighted: false, weights: {} },
    permitted_tools: [],
    runtime_limit_seconds: runtimeSeconds,
    spend_limit_cents: spendLimit,
    human_assistance: "none",
    autonomy_permission: "none",
    status: "active",
  });

  if (versionError) {
    console.error("prepareLiveCapabilityAction version failed:", versionError.message);
    refresh(evalId);
    return fail(
      "The tasks and their answer keys were created, but the live configuration was not. Add the configuration before running a paid trial.",
    );
  }

  refresh(evalId);
  return done(
    `Added ${AUTHORED_TASKS.length} machine-checkable task(s) and live configuration v${nextVersion} with a ${spendLimit}-cent ceiling and a ${runtimeSeconds}-second limit. The expected answers are stored where this page cannot read them. Nothing has been charged.`,
  );
}

/**
 * One paid model call, graded on an answer the model never sees.
 *
 * The ceiling is checked before the call so nobody is charged for a run that
 * cannot be recorded, and the database checks it again on insert.
 */
export async function runLiveCapabilityTrialAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const evalId = readText(formData, "eval_id");
  const evaluation = await ownerEval(session, evalId);
  if (!evaluation) return fail(NOT_AVAILABLE);
  if (evaluation.status !== "active") {
    return fail("This evaluation is incomplete and cannot run. Create a new one.");
  }

  const taskId = readText(formData, "task_id");
  const versionId = readText(formData, "version_id");
  if (!isUuid(taskId) || !isUuid(versionId)) {
    return fail("Choose one of the machine-checkable tasks and its live configuration.");
  }

  const [taskResult, versionResult, runResult] = await Promise.all([
    session.supabase
      .from("capability_eval_tasks")
      .select("*")
      .eq("id", taskId)
      .eq("eval_id", evalId)
      .eq("user_id", session.user.id)
      .maybeSingle(),
    session.supabase
      .from("capability_eval_versions")
      .select("*")
      .eq("id", versionId)
      .eq("eval_id", evalId)
      .eq("user_id", session.user.id)
      .maybeSingle(),
    session.supabase
      .from("capability_eval_runs")
      .select("trial, cost_cents")
      .eq("eval_id", evalId)
      .eq("version_id", versionId)
      .eq("task_id", taskId),
  ]);

  if (taskResult.error || versionResult.error || runResult.error) {
    console.error(
      "runLiveCapabilityTrialAction read failed:",
      taskResult.error?.message,
      versionResult.error?.message,
      runResult.error?.message,
    );
    return fail("We couldn't load that task and configuration. Nothing was called.");
  }
  if (!taskResult.data || !versionResult.data) return fail(NOT_AVAILABLE);

  const task = taskResult.data as CapabilityTaskRecord;
  const version = versionResult.data as CapabilityVersionRecord;
  if (task.task_spec?.mode !== AUTHORED_TASK_MODE) {
    return fail(
      "That task is graded by matching named elements, which a model can repeat from its own prompt. Add a machine-checkable task before running a live trial.",
    );
  }

  const priorRuns = (runResult.data ?? []) as { trial: number; cost_cents: number }[];
  const spentCents = priorRuns.reduce((total, run) => total + Math.max(0, run.cost_cents), 0);
  const trial = Math.max(0, ...priorRuns.map((run) => run.trial)) + 1;

  const readiness = liveTrialReadiness({
    hasModelKey: hasOllamaKey(),
    version,
    task,
    spentCents,
  });
  if (!readiness.ok) return fail(readiness.reason);

  const kind = task.task_spec?.answer_kind === "text" ? "text" : "number";
  const model = version.model_version;
  const reserved = await reserveAiRequest(session, LIVE_TRIAL_KIND, model);
  if (!reserved.ok) return fail(reserved.message);
  const requestId = reserved.reservation.id;

  const startedAt = Date.now();
  try {
    const reply = await chatWithOllama({
      model,
      messages: liveTrialMessages(task, kind),
      temperature: 0,
      format: "json",
      timeoutMs: liveTrialTimeoutMs(readiness.runtimeLimitSeconds),
    });
    const latencyMs = Date.now() - startedAt;

    const parsed = parseLiveAnswer(reply.content, kind);
    if (!parsed.ok) {
      await finishAiRequest(session, requestId, "failed", "unreadable-answer");
      return fail(
        `${parsed.reason} Nothing was recorded as a trial, but this attempt still used ${LIVE_TRIAL_CREDIT_COST} credits.`,
      );
    }

    const { data: scored, error: scoreError } = await session.supabase.rpc(
      "capability_eval_score_answer",
      { p_task_id: task.id, p_answer: { answer: parsed.answer } },
    );
    if (scoreError || !scored) {
      await finishAiRequest(session, requestId, "failed", "scoring-failed");
      console.error("runLiveCapabilityTrialAction score failed:", scoreError?.message);
      return fail(
        "The answer could not be graded against its key, so nothing was recorded as a trial.",
      );
    }

    const result = scored as {
      outcome: "verified_success" | "partial_success" | "failed" | "errored";
      verified_success: boolean;
      unsupported_claims: number;
      failure_category: string | null;
      scoring_detail: Record<string, unknown>;
    };

    const { error: insertError } = await session.supabase.from("capability_eval_runs").insert({
      eval_id: evalId,
      version_id: version.id,
      task_id: task.id,
      user_id: session.user.id,
      domain: task.domain,
      difficulty: task.difficulty,
      split: task.split,
      trial,
      outcome: result.outcome,
      verified_success: result.verified_success,
      unsupported_claims: result.unsupported_claims,
      permission_violations: 0,
      human_interventions: 0,
      recovery_attempts: 0,
      recovery_succeeded: null,
      cost_cents: readiness.chargeCents,
      latency_ms: latencyMs,
      failure_category: result.failure_category,
      scoring_detail: result.scoring_detail,
    });

    await finishAiRequest(session, requestId, "succeeded", undefined, reply.tokens);

    if (insertError) {
      console.error("runLiveCapabilityTrialAction insert failed:", insertError.message);
      refresh(evalId);
      return fail(
        `The call finished in ${Math.round(latencyMs / 1000)}s against a ${readiness.runtimeLimitSeconds}s recorded limit, so the run could not be recorded. ${LIVE_TRIAL_CREDIT_COST} credits were spent and no trial was saved.`,
      );
    }

    refresh(evalId);
    return done(
      `Live trial ${trial} recorded: ${
        result.verified_success ? "the answer was correct" : "the answer was not correct"
      }. ${LIVE_TRIAL_CREDIT_COST} credits (${readiness.chargeCents} cents) were charged and the run records that cost. One trial is a single data point, not a capability claim.`,
    );
  } catch (error) {
    const code = error instanceof OllamaError ? error.code : "unexpected";
    await finishAiRequest(session, requestId, "failed", code);
    console.error("runLiveCapabilityTrialAction failed:", (error as Error)?.message);
    return fail(`${ollamaErrorMessage(error)} No trial was recorded.`);
  }
}
