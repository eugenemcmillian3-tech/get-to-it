"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { OrchestrationState } from "@/lib/action-state";
import {
  AppBuildError,
  buildProjectFiles,
  buildSpecDraft,
  intakeProblems,
  type AppIntakeInput,
} from "@/lib/app-builder";
import { getSession, type Session } from "@/lib/auth";
import type { ContractRow, OrchestrationRecord, TaskRow } from "@/lib/data/orchestration";
import {
  EVIDENCE_INPUT_NOTE,
  contractFingerprint,
  contractFormSchema,
  defaultPlan,
  evidenceProblem,
  microsToCredits,
  parseContractForm,
  planProblems,
  type ContractContent,
  type EvidenceKind,
  type OrchestrationStatus,
} from "@/lib/orchestration";
import { firstErrorMessage, isUuid, readText } from "@/lib/validation";
import type { WorkspaceRole } from "@/lib/types";

/**
 * Phase 36 actions.
 *
 * Every write is scoped to workspace membership and repeated by RLS and the
 * security-definer functions. These actions do not send outreach, publish,
 * charge a card, run generated code or deploy. Deploying a linked prototype
 * still uses the existing deployment approvals.
 */

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That orchestration isn't available to you.";
const NO_PERMISSION =
  "Your role in this workspace doesn't allow that. Nothing was changed.";

function fail(message: string): OrchestrationState {
  return { status: "error", message, nonce: Date.now() };
}

function done(message: string): OrchestrationState {
  return { status: "success", message, nonce: Date.now() };
}

function refresh(workspaceId: string, orchestrationId?: string): void {
  revalidatePath(`/workspace/${workspaceId}/orchestrations`);
  if (orchestrationId) {
    revalidatePath(`/workspace/${workspaceId}/orchestrations/${orchestrationId}`);
  }
}

async function roleIn(
  session: Session,
  workspaceId: string,
): Promise<WorkspaceRole | null> {
  const { data, error } = await session.supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", session.user.id)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    console.error("orchestration roleIn failed:", error.message);
    return null;
  }
  return (data as { role: WorkspaceRole } | null)?.role ?? null;
}

async function orchestrationIn(
  session: Session,
  workspaceId: string,
  orchestrationId: string,
): Promise<OrchestrationRecord | null> {
  const { data, error } = await session.supabase
    .from("orchestrations")
    .select("*")
    .eq("id", orchestrationId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    console.error("orchestration lookup failed:", error.message);
    return null;
  }
  return (data as OrchestrationRecord | null) ?? null;
}

async function taskIn(
  session: Session,
  workspaceId: string,
  taskId: string,
): Promise<TaskRow | null> {
  const { data, error } = await session.supabase
    .from("orchestration_tasks")
    .select("*")
    .eq("id", taskId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    console.error("orchestration task lookup failed:", error.message);
    return null;
  }
  return (data as TaskRow | null) ?? null;
}

async function currentContract(
  session: Session,
  orchestration: OrchestrationRecord,
): Promise<ContractRow | null> {
  if (!orchestration.current_contract_id) return null;
  const { data, error } = await session.supabase
    .from("orchestration_contracts")
    .select("*")
    .eq("id", orchestration.current_contract_id)
    .eq("workspace_id", orchestration.workspace_id)
    .maybeSingle();
  if (error) {
    console.error("orchestration contract read failed:", error.message);
    return null;
  }
  return (data as ContractRow | null) ?? null;
}

async function appendEvent(
  session: Session,
  orchestration: Pick<OrchestrationRecord, "id" | "workspace_id">,
  kind: string,
  detail: string,
): Promise<void> {
  const { error } = await session.supabase.from("orchestration_events").insert({
    orchestration_id: orchestration.id,
    workspace_id: orchestration.workspace_id,
    actor_id: session.user.id,
    kind,
    detail: detail.slice(0, 1000),
  });
  if (error) console.error("append orchestration event failed:", error.message);
}

type RpcResult = { ok?: boolean; code?: string; status?: string } | null;

const RPC_MESSAGES: Record<string, string> = {
  unauthenticated: SESSION_EXPIRED,
  forbidden: NO_PERMISSION,
  "not-found": NOT_AVAILABLE,
  "invalid-transition":
    "That lifecycle move is not allowed from the current state. Nothing was changed.",
  "contract-not-approved":
    "This contract version has no recorded approval. Approve the exact version first.",
  "contract-stale":
    "The approved version does not match the current contract. Approve the current version.",
  "not-awaiting-approval":
    "This contract is not waiting for approval. Nothing was changed.",
  "already-decided": "That decision was already recorded.",
  "tasks-incomplete":
    "Some tasks are unfinished or failed. Resolve them, or stop the orchestration.",
  "verification-incomplete":
    "Some acceptance criteria have no passing evidence. Work stays unverified until it does.",
  "review-missing": "A person has not recorded the outcome decision yet.",
  "stop-condition":
    "A stop condition is recorded as reached. Record the decision before running more work.",
  "dependency-unmet":
    "A dependency is not verified yet. A report is not verification.",
  "not-pending": "That task is not waiting to run.",
  "not-running": "That task is not running.",
  "retry-limit": "That task used its allowed retries.",
  "budget-exhausted":
    "The authorized maximum cannot cover this reservation. Approve a new contract version or stop.",
  "action-approval-required":
    "This external action needs its own approval from a different owner or admin first.",
  "no-verifying-evidence":
    "No passing, verifiable evidence is attached. An AI proposal or an opinion cannot verify this.",
  "self-approval": "A different owner or admin must decide this request.",
  "not-pending-decision": "That decision was already made.",
  "already-linked": "A prototype project is already linked.",
  "project-not-owned": "That project cannot be linked here.",
  unverified: "Not every acceptance criterion is verified, so it cannot be accepted.",
  "failure-unresolved": "An acceptance criterion failed. Accept is not available.",
  "missing-verified": "Say what was actually verified.",
  "missing-unknowns": "Record what remains unknown, even if that is 'nothing yet'.",
};

function rpcFailure(data: RpcResult): string | null {
  if (!data || data.ok !== false) return null;
  return (
    RPC_MESSAGES[data.code ?? ""] ??
    "That change could not be recorded. Nothing was changed."
  );
}

async function rpc(
  session: Session,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ data: RpcResult; error: string | null }> {
  const { data, error } = await session.supabase.rpc(fn, args);
  if (error) {
    console.error(`orchestration rpc ${fn} failed:`, error.message);
    return { data: null, error: "That change could not be recorded. Nothing changed." };
  }
  return { data: data as RpcResult, error: null };
}

// ---------------------------------------------------------------------------
// Create: contract draft v1 from an existing record (or a new goal → mission)
// ---------------------------------------------------------------------------

export async function createOrchestrationAction(
  _previous: OrchestrationState,
  formData: FormData,
): Promise<OrchestrationState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = contractFormSchema.safeParse({
    goal: readText(formData, "goal"),
    origin_kind: readText(formData, "origin_kind"),
    origin_id: readText(formData, "origin_id"),
    stakeholders: readText(formData, "stakeholders"),
    scope: readText(formData, "scope"),
    exclusions: readText(formData, "exclusions"),
    evidence_available: readText(formData, "evidence_available"),
    assumptions: readText(formData, "assumptions"),
    unresolved_questions: readText(formData, "unresolved_questions"),
    deliverable_lines: readText(formData, "deliverable_lines"),
    observation_lines: readText(formData, "observation_lines"),
    external_effect_lines: readText(formData, "external_effect_lines"),
    criteria_lines: readText(formData, "criteria_lines"),
    allowed_tools: formData.getAll("allowed_tools").map(String),
    execution_environments: formData.getAll("execution_environments").map(String),
    required_human_decisions: readText(formData, "required_human_decisions"),
    max_credits: readText(formData, "max_credits"),
    time_limit_minutes: readText(formData, "time_limit_minutes"),
    resource_limits: readText(formData, "resource_limits"),
    privacy_constraints: readText(formData, "privacy_constraints"),
    consent_constraints: readText(formData, "consent_constraints"),
    stop_conditions: readText(formData, "stop_conditions"),
    review_at: readText(formData, "review_at"),
  });
  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const workspaceId = readText(formData, "workspace_id");
  if (!isUuid(workspaceId)) return fail(NOT_AVAILABLE);
  const role = await roleIn(session, workspaceId);
  if (!role) return fail(NO_PERMISSION);

  const contract = parseContractForm(parsed.data);
  if (!contract.ok) return fail(contract.message);
  const content = contract.content;

  // The originating record must already be readable by this person. A link
  // grants no access, so the record is checked before anything is created.
  let missionId: string | null = null;
  let experimentId: string | null = null;
  let learningGoalId: string | null = null;
  let radarSignalId: string | null = null;
  let futurePathId: string | null = null;
  let outcomeReviewId: string | null = null;

  if (content.origin_kind === "mission" || content.origin_kind === "experiment") {
    const table = content.origin_kind === "mission" ? "missions" : "experiments";
    const { data } = await session.supabase
      .from(table)
      .select("id")
      .eq("id", content.origin_id ?? "")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!data) {
      return fail(`That ${content.origin_kind} isn't in this workspace. Nothing was created.`);
    }
    if (content.origin_kind === "mission") missionId = content.origin_id;
    else experimentId = content.origin_id;
  } else if (content.origin_kind === "new_goal") {
    // A new goal becomes an existing-style mission, not a parallel goal store.
    const { data: mission, error } = await session.supabase
      .from("missions")
      .insert({
        workspace_id: workspaceId,
        created_by: session.user.id,
        title: content.goal.slice(0, 160),
        category: "other",
        problem: `Goal captured for orchestration: ${content.goal}`.slice(0, 3000),
        stakeholders: content.stakeholders.slice(0, 2000),
        desired_outcome: content.goal.slice(0, 2000),
        constraints: content.scope.slice(0, 2000),
        status: "draft",
        review_at: content.review_at,
      })
      .select("id")
      .single();
    if (error || !mission) {
      console.error("createOrchestrationAction mission failed:", error?.message);
      return fail("We couldn't create the mission this goal needs. Nothing was created.");
    }
    missionId = mission.id as string;
  } else {
    const table =
      content.origin_kind === "learning_goal"
        ? "goals"
        : content.origin_kind === "radar_signal"
          ? "radar_signals"
          : content.origin_kind === "future_path"
            ? "future_paths"
            : "outcome_reviews";
    const { data } = await session.supabase
      .from(table)
      .select("id")
      .eq("id", content.origin_id ?? "")
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (!data) {
      return fail("That record isn't one of your records. Nothing was created.");
    }
    if (content.origin_kind === "learning_goal") learningGoalId = content.origin_id;
    if (content.origin_kind === "radar_signal") radarSignalId = content.origin_id;
    if (content.origin_kind === "future_path") futurePathId = content.origin_id;
    if (content.origin_kind === "outcome_review") outcomeReviewId = content.origin_id;
  }

  const { data: created, error } = await session.supabase
    .from("orchestrations")
    .insert({
      workspace_id: workspaceId,
      created_by: session.user.id,
      origin_kind: content.origin_kind,
      mission_id: missionId,
      experiment_id: experimentId,
      learning_goal_id: learningGoalId,
      radar_signal_id: radarSignalId,
      future_path_id: futurePathId,
      outcome_review_id: outcomeReviewId,
      goal: content.goal,
      status: "draft",
      review_at: content.review_at,
      authorized_micros: 0,
    })
    .select("id")
    .single();

  if (error || !created) {
    console.error("createOrchestrationAction failed:", error?.message);
    return fail("We couldn't save that orchestration. Nothing was created.");
  }

  const orchestrationId = created.id as string;
  const fingerprint = contractFingerprint(content);

  const { data: contractRow, error: contractError } = await session.supabase
    .from("orchestration_contracts")
    .insert({
      orchestration_id: orchestrationId,
      workspace_id: workspaceId,
      version: 1,
      content,
      fingerprint,
      max_credits: content.max_credits,
      status: "draft",
      created_by: session.user.id,
    })
    .select("id")
    .single();

  if (contractError || !contractRow) {
    await rpc(session, "orchestration_discard_draft", { p_id: orchestrationId });
    console.error("createOrchestrationAction contract failed:", contractError?.message);
    return fail("The contract could not be saved, so the orchestration was removed.");
  }

  const attach = await rpc(session, "orchestration_attach_contract", {
    p_id: orchestrationId,
    p_contract_id: contractRow.id as string,
  });
  if (attach.error || rpcFailure(attach.data)) {
    await rpc(session, "orchestration_discard_draft", { p_id: orchestrationId });
    return fail("The contract could not be attached, so the orchestration was removed.");
  }

  await appendEvent(
    session,
    { id: orchestrationId, workspace_id: workspaceId },
    "created",
    `Contract version 1 drafted. Nothing runs until a person approves this exact version. ${EVIDENCE_INPUT_NOTE}`,
  );

  refresh(workspaceId, orchestrationId);
  redirect(`/workspace/${workspaceId}/orchestrations/${orchestrationId}`);
}

// ---------------------------------------------------------------------------
// Contract: submit, approve, plan
// ---------------------------------------------------------------------------

export async function submitContractAction(
  _previous: OrchestrationState,
  formData: FormData,
): Promise<OrchestrationState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const orchestrationId = readText(formData, "orchestration_id");
  if (!isUuid(workspaceId) || !isUuid(orchestrationId)) return fail(NOT_AVAILABLE);
  if (!(await roleIn(session, workspaceId))) return fail(NO_PERMISSION);

  const result = await rpc(session, "orchestration_transition", {
    p_id: orchestrationId,
    p_to: "awaiting_approval",
    p_note: "Contract submitted for human approval.",
  });
  if (result.error) return fail(result.error);
  const refusal = rpcFailure(result.data);
  if (refusal) return fail(refusal);

  refresh(workspaceId, orchestrationId);
  return done(
    "Submitted for approval. An owner or admin reviews this exact contract version; nothing runs yet.",
  );
}

export async function approveContractAction(
  _previous: OrchestrationState,
  formData: FormData,
): Promise<OrchestrationState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const orchestrationId = readText(formData, "orchestration_id");
  const contractId = readText(formData, "contract_id");
  const note = readText(formData, "note");
  if (!isUuid(workspaceId) || !isUuid(orchestrationId) || !isUuid(contractId)) {
    return fail(NOT_AVAILABLE);
  }

  const result = await rpc(session, "orchestration_approve_contract", {
    p_contract_id: contractId,
    p_note: note,
  });
  if (result.error) return fail(result.error);
  const refusal = rpcFailure(result.data);
  if (refusal) return fail(refusal);

  refresh(workspaceId, orchestrationId);
  return done(
    "Contract approved. The approval is bound to this version and fingerprint; a material change needs a new approval, and each external action still needs its own.",
  );
}

export async function generatePlanAction(
  _previous: OrchestrationState,
  formData: FormData,
): Promise<OrchestrationState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const orchestrationId = readText(formData, "orchestration_id");
  if (!isUuid(workspaceId) || !isUuid(orchestrationId)) return fail(NOT_AVAILABLE);
  if (!(await roleIn(session, workspaceId))) return fail(NO_PERMISSION);

  const orchestration = await orchestrationIn(session, workspaceId, orchestrationId);
  if (!orchestration) return fail(NOT_AVAILABLE);

  const { data: existing } = await session.supabase
    .from("orchestration_tasks")
    .select("id")
    .eq("orchestration_id", orchestrationId)
    .limit(1);
  if ((existing ?? []).length > 0) {
    return fail("A plan already exists. A new plan needs a new contract version.");
  }

  const contract = await currentContract(session, orchestration);
  if (!contract) return fail("This orchestration has no contract version.");

  const tasks = defaultPlan(contract.content);
  const check = planProblems({ contract: contract.content, tasks });
  if (!check.ok) return fail(check.problems[0]?.message ?? "That plan is not bounded.");

  const rows = tasks.map((task, index) => ({
    orchestration_id: orchestrationId,
    workspace_id: workspaceId,
    task_key: task.task_key,
    position: index,
    title: task.title,
    purpose: task.purpose,
    capability: task.capability,
    depends_on: task.depends_on,
    covers: task.covers,
    input_refs: task.input_refs,
    expected_output: task.expected_output,
    verification_method: task.verification_method,
    credits_micros: task.credits_micros,
    permissions: task.permissions,
    retry_limit: task.retry_limit,
    external_action_kind: task.external_action_kind,
  }));

  const { error } = await session.supabase.from("orchestration_tasks").insert(rows);
  if (error) {
    console.error("generatePlanAction failed:", error.message);
    return fail("We couldn't save that plan. Nothing changed.");
  }

  await appendEvent(
    session,
    orchestration,
    "plan_drafted",
    `${rows.length} bounded task${rows.length === 1 ? "" : "s"} drafted, reserving ${microsToCredits(check.costMicros)} credits. Nothing has run.`,
  );

  refresh(workspaceId, orchestrationId);
  return done(
    "Plan drafted inside the approved maximum. Review it, then approve the contract version if you have not already.",
  );
}

// ---------------------------------------------------------------------------
// Execution: reserve, settle, evidence, verify
// ---------------------------------------------------------------------------

export async function reserveTaskAction(
  _previous: OrchestrationState,
  formData: FormData,
): Promise<OrchestrationState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const orchestrationId = readText(formData, "orchestration_id");
  const taskId = readText(formData, "task_id");
  if (!isUuid(workspaceId) || !isUuid(orchestrationId) || !isUuid(taskId)) {
    return fail(NOT_AVAILABLE);
  }
  if (!(await roleIn(session, workspaceId))) return fail(NO_PERMISSION);
  if (!(await taskIn(session, workspaceId, taskId))) return fail(NOT_AVAILABLE);

  const result = await rpc(session, "orchestration_reserve_task", {
    p_task_id: taskId,
  });
  if (result.error) return fail(result.error);
  const refusal = rpcFailure(result.data);
  if (refusal) return fail(refusal);

  refresh(workspaceId, orchestrationId);
  return done(
    "Task started and its credits reserved atomically. The existing capability performs the work; this layer records and verifies it.",
  );
}

export async function settleTaskAction(
  _previous: OrchestrationState,
  formData: FormData,
): Promise<OrchestrationState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const orchestrationId = readText(formData, "orchestration_id");
  const taskId = readText(formData, "task_id");
  const ok = readText(formData, "outcome") === "produced";
  const actualCredits = Number(readText(formData, "actual_credits") || "0");
  const error = readText(formData, "error");
  if (!isUuid(workspaceId) || !isUuid(orchestrationId) || !isUuid(taskId)) {
    return fail(NOT_AVAILABLE);
  }
  if (!(await roleIn(session, workspaceId))) return fail(NO_PERMISSION);

  if (!ok && error.trim().length < 5) {
    return fail("Record what failed in at least 5 characters. A failure is information.");
  }
  if (ok && (!Number.isFinite(actualCredits) || actualCredits < 0)) {
    return fail("Record the actual credits consumed as a non-negative number.");
  }

  const result = await rpc(session, "orchestration_settle_task", {
    p_task_id: taskId,
    p_ok: ok,
    p_actual_micros: Math.round(Math.max(0, actualCredits) * 1_000_000),
    p_error: error,
  });
  if (result.error) return fail(result.error);
  const refusal = rpcFailure(result.data);
  if (refusal) return fail(refusal);

  refresh(workspaceId, orchestrationId);
  return ok
    ? done(
        "Result recorded as produced. Produced is not verified: attach passing evidence before it can count.",
      )
    : done(
        "Failure recorded and the unused reservation released. Nothing was charged for work that failed.",
      );
}

export async function addEvidenceAction(
  _previous: OrchestrationState,
  formData: FormData,
): Promise<OrchestrationState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const orchestrationId = readText(formData, "orchestration_id");
  const taskId = readText(formData, "task_id");
  const kind = readText(formData, "kind") as EvidenceKind;
  const sourceRef = readText(formData, "source_ref");
  const method = readText(formData, "method");
  const resultValue = readText(formData, "result");
  const verifier = readText(formData, "verifier");

  if (!isUuid(workspaceId) || !isUuid(orchestrationId)) return fail(NOT_AVAILABLE);
  if (!(await roleIn(session, workspaceId))) return fail(NO_PERMISSION);

  const orchestration = await orchestrationIn(session, workspaceId, orchestrationId);
  if (!orchestration) return fail(NOT_AVAILABLE);

  const problem = evidenceProblem({
    kind,
    method,
    result: resultValue,
    source_ref: sourceRef,
    verifier,
  });
  if (!problem.ok) return fail(problem.message);

  if (taskId !== "" && !(await taskIn(session, workspaceId, taskId))) {
    return fail(NOT_AVAILABLE);
  }

  const { error } = await session.supabase.from("orchestration_evidence").insert({
    orchestration_id: orchestrationId,
    workspace_id: workspaceId,
    task_id: taskId === "" ? null : taskId,
    criterion_key: readText(formData, "criterion_key") || null,
    kind,
    source_ref: sourceRef,
    artifact_version: readText(formData, "artifact_version"),
    method,
    result: resultValue,
    limitations: readText(formData, "limitations"),
    verifier,
    created_by: session.user.id,
  });

  if (error) {
    console.error("addEvidenceAction failed:", error.message);
    return fail("We couldn't append that evidence. Nothing changed.");
  }

  await appendEvent(
    session,
    orchestration,
    "evidence_added",
    `${kind} evidence recorded as ${resultValue}.`,
  );

  refresh(workspaceId, orchestrationId);
  return done(
    "Evidence appended. It is labelled by kind, so a proposal or opinion is never counted as proof.",
  );
}

export async function verifyTaskAction(
  _previous: OrchestrationState,
  formData: FormData,
): Promise<OrchestrationState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const orchestrationId = readText(formData, "orchestration_id");
  const taskId = readText(formData, "task_id");
  if (!isUuid(workspaceId) || !isUuid(orchestrationId) || !isUuid(taskId)) {
    return fail(NOT_AVAILABLE);
  }
  if (!(await roleIn(session, workspaceId))) return fail(NO_PERMISSION);

  const result = await rpc(session, "orchestration_verify_task", { p_task_id: taskId });
  if (result.error) return fail(result.error);
  const refusal = rpcFailure(result.data);
  if (refusal) return fail(refusal);

  refresh(workspaceId, orchestrationId);
  return done(
    "Task verified by matching, passing evidence. A proposal or an opinion could not have done this.",
  );
}

// ---------------------------------------------------------------------------
// Human decision checkpoints
// ---------------------------------------------------------------------------

export async function requestCheckpointAction(
  _previous: OrchestrationState,
  formData: FormData,
): Promise<OrchestrationState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const orchestrationId = readText(formData, "orchestration_id");
  if (!isUuid(workspaceId) || !isUuid(orchestrationId)) return fail(NOT_AVAILABLE);
  if (!(await roleIn(session, workspaceId))) return fail(NO_PERMISSION);

  const orchestration = await orchestrationIn(session, workspaceId, orchestrationId);
  if (!orchestration) return fail(NOT_AVAILABLE);

  const kind = readText(formData, "kind");
  const title = readText(formData, "title");
  const whatHappened = readText(formData, "what_happened");
  const decision = readText(formData, "decision");
  const evidence = readText(formData, "evidence");
  const implication = readText(formData, "implication");
  const requestedByKind = readText(formData, "requested_by_kind") === "agent" ? "agent" : "human";

  if (title.length < 3) return fail("Give the decision point a short title.");
  if (whatHappened.length < 5) return fail("Record what happened.");
  if (decision.length < 5) return fail("Record what decision is required.");

  const { error } = await session.supabase.from("orchestration_checkpoints").insert({
    orchestration_id: orchestrationId,
    workspace_id: workspaceId,
    kind,
    title: title.slice(0, 300),
    what_happened: whatHappened,
    evidence,
    decision,
    implication,
    requested_by: requestedByKind === "human" ? session.user.id : null,
    requested_by_kind: requestedByKind,
  });

  if (error) {
    console.error("requestCheckpointAction failed:", error.message);
    return fail("We couldn't record that decision point. Nothing changed.");
  }

  await appendEvent(
    session,
    orchestration,
    "checkpoint_requested",
    `${kind}: ${title}`,
  );

  refresh(workspaceId, orchestrationId);
  return done(
    "Decision point recorded. A different owner or admin decides it; approval records a decision and performs no external action.",
  );
}

export async function decideCheckpointAction(
  _previous: OrchestrationState,
  formData: FormData,
): Promise<OrchestrationState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const orchestrationId = readText(formData, "orchestration_id");
  const checkpointId = readText(formData, "checkpoint_id");
  const decision = readText(formData, "decision");
  if (!isUuid(workspaceId) || !isUuid(orchestrationId) || !isUuid(checkpointId)) {
    return fail(NOT_AVAILABLE);
  }
  if (decision !== "approved" && decision !== "rejected") {
    return fail("Choose approved or rejected.");
  }

  const result = await rpc(session, "orchestration_decide_checkpoint", {
    p_checkpoint_id: checkpointId,
    p_decision: decision,
    p_note: readText(formData, "note"),
  });
  if (result.error) return fail(result.error);
  const refusal = rpcFailure(result.data);
  if (refusal) return fail(refusal);

  refresh(workspaceId, orchestrationId);
  return done(
    decision === "approved"
      ? "Decision recorded by a separate person. No outreach, publication, payment or deployment was performed."
      : "Request rejected. The record stays visible.",
  );
}

// ---------------------------------------------------------------------------
// Lifecycle: pause, resume, stop, cancel
// ---------------------------------------------------------------------------

export async function transitionAction(
  _previous: OrchestrationState,
  formData: FormData,
): Promise<OrchestrationState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const orchestrationId = readText(formData, "orchestration_id");
  const to = readText(formData, "to") as OrchestrationStatus;
  if (!isUuid(workspaceId) || !isUuid(orchestrationId)) return fail(NOT_AVAILABLE);
  if (!(await roleIn(session, workspaceId))) return fail(NO_PERMISSION);

  if (to === "cancellation_requested") {
    const result = await rpc(session, "orchestration_cancel", {
      p_id: orchestrationId,
      p_note: readText(formData, "note"),
    });
    if (result.error) return fail(result.error);
    const refusal = rpcFailure(result.data);
    if (refusal) return fail(refusal);
    refresh(workspaceId, orchestrationId);
    return done(
      "Cancellation recorded. No further work is scheduled; external effects already performed are not reversed here.",
    );
  }

  const result = await rpc(session, "orchestration_transition", {
    p_id: orchestrationId,
    p_to: to,
    p_note: readText(formData, "note"),
  });
  if (result.error) return fail(result.error);
  const refusal = rpcFailure(result.data);
  if (refusal) return fail(refusal);

  refresh(workspaceId, orchestrationId);
  return done("Lifecycle updated. The server checked the transition before changing anything.");
}

// ---------------------------------------------------------------------------
// Human outcome review
// ---------------------------------------------------------------------------

export async function saveOrchestrationReviewAction(
  _previous: OrchestrationState,
  formData: FormData,
): Promise<OrchestrationState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const orchestrationId = readText(formData, "orchestration_id");
  const decision = readText(formData, "decision");
  if (!isUuid(workspaceId) || !isUuid(orchestrationId)) return fail(NOT_AVAILABLE);
  if (!(await roleIn(session, workspaceId))) return fail(NO_PERMISSION);

  const result = await rpc(session, "orchestration_record_review", {
    p_id: orchestrationId,
    p_decision: decision,
    p_built: readText(formData, "built"),
    p_verified: readText(formData, "verified"),
    p_failed: readText(formData, "failed"),
    p_unknown: readText(formData, "unknown"),
    p_deviations: readText(formData, "deviations"),
    p_next_steps: readText(formData, "next_steps"),
  });
  if (result.error) return fail(result.error);
  const refusal = rpcFailure(result.data);
  if (refusal) return fail(refusal);

  refresh(workspaceId, orchestrationId);
  return done(
    decision === "accept"
      ? "Outcome accepted and completed by a person. The evidence and unverified items stay attached."
      : "Outcome decision recorded. The original goal and approved contract stay visible.",
  );
}

// ---------------------------------------------------------------------------
// Build connection: a normal app-builder project
// ---------------------------------------------------------------------------

export async function createPrototypeAction(
  _previous: OrchestrationState,
  formData: FormData,
): Promise<OrchestrationState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const orchestrationId = readText(formData, "orchestration_id");
  if (!isUuid(workspaceId) || !isUuid(orchestrationId)) return fail(NOT_AVAILABLE);
  if (!(await roleIn(session, workspaceId))) return fail(NO_PERMISSION);

  const orchestration = await orchestrationIn(session, workspaceId, orchestrationId);
  if (!orchestration) return fail(NOT_AVAILABLE);
  if (orchestration.prototype_project_id) {
    return fail("A prototype project is already linked to this orchestration.");
  }

  const contractRow = await currentContract(session, orchestration);
  if (!contractRow) return fail("This orchestration has no contract version.");
  const contract: ContractContent = contractRow.content;

  const intake: AppIntakeInput = {
    name: (contract.goal.length >= 3 ? contract.goal : "Orchestrated prototype").slice(0, 72),
    purpose: `${contract.scope} The prototype is one bounded artifact; it is not proof of the outcome.`.slice(0, 1500),
    target_users: contract.stakeholders.slice(0, 600),
    workflows: contract.deliverables
      .map((deliverable) => deliverable.statement)
      .join("\n")
      .slice(0, 1500),
    required_pages:
      "/ | Start | State the goal, the scope and the AI assistance\n/try | Try it | One bounded workflow with a visible way to stop\n/evidence | Evidence | Show recorded evidence, labelled by kind",
    entities: "evidence: kind, source_ref, result\ncriterion: key, criterion, verification",
    auth_requirements: "none",
    integrations: "",
    design_preferences:
      "Calm and clear. Make stopping easy. Label AI assistance. Never present generated content as an observed result.",
    definition_of_done: contract.acceptance_criteria
      .map((criterion) => criterion.criterion)
      .join("\n")
      .slice(0, 1000),
  };

  const problems = intakeProblems(intake);
  if (problems.length > 0) return fail(problems.join(" "));

  let spec;
  try {
    spec = buildSpecDraft(intake);
    buildProjectFiles(spec, { name: intake.name, purpose: intake.purpose });
  } catch (error) {
    if (error instanceof AppBuildError) return fail(error.message);
    throw error;
  }

  const { data: project, error: projectError } = await session.supabase
    .from("app_projects")
    .insert({
      user_id: session.user.id,
      workspace_id: workspaceId,
      name: intake.name,
      purpose: intake.purpose,
      target_users: intake.target_users,
      workflows: intake.workflows,
      required_pages: intake.required_pages,
      entities: intake.entities,
      auth_requirements: intake.auth_requirements,
      integrations: intake.integrations,
      design_preferences: intake.design_preferences,
      definition_of_done: intake.definition_of_done,
      status: "spec_draft",
    })
    .select("id")
    .single();

  if (projectError || !project) {
    console.error("createPrototypeAction project failed:", projectError?.message);
    return fail("We couldn't create a normal app project. Nothing was linked.");
  }

  const projectId = project.id as string;
  const { error: specError } = await session.supabase.from("app_specs").insert({
    project_id: projectId,
    user_id: session.user.id,
    version: 1,
    spec,
  });

  if (specError) {
    await session.supabase
      .from("app_projects")
      .delete()
      .eq("id", projectId)
      .eq("user_id", session.user.id);
    console.error("createPrototypeAction spec failed:", specError.message);
    return fail("The specification could not be saved, so the project was removed.");
  }

  const link = await rpc(session, "orchestration_link_prototype", {
    p_id: orchestrationId,
    p_project_id: projectId,
  });
  if (link.error) return fail(link.error);
  const linkRefusal = rpcFailure(link.data);
  if (linkRefusal) {
    await session.supabase
      .from("app_projects")
      .delete()
      .eq("id", projectId)
      .eq("user_id", session.user.id);
    return fail(linkRefusal);
  }

  refresh(workspaceId, orchestrationId);
  revalidatePath("/build");
  revalidatePath(`/build/${projectId}`);
  redirect(`/build/${projectId}`);
}

