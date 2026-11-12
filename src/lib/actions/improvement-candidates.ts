"use server";

import { revalidatePath } from "next/cache";
import type { BuildState } from "@/lib/action-state";
import { getSession, type Session } from "@/lib/auth";
import {
  CANDIDATE_LIMITS,
  criteriaHash,
  candidateProblems,
  isCandidateKind,
  type CandidateDraft,
} from "@/lib/improvement-candidates";
import {
  BASELINE_POLICY,
  CHANNEL_LOOKUP_POLICY,
  EVAL_SUITE_NAME,
  EVAL_SUITE_VERSION,
  WIDENED_TOOLSET_POLICY,
  evaluateCandidate,
  policyDigest,
  suiteDigest,
  type ToolPolicy,
} from "@/lib/improvement-eval";
import { isUuid, readText } from "@/lib/validation";

/**
 * Phase 40 — improvement proposals.
 *
 * This layer writes the record, freezes the success criteria, runs the authored
 * evaluation and passes the numbers to Postgres, which re-derives the verdict.
 * It cannot approve its own candidate or promote anything; those are separate
 * decisions by a different person, and deployment is not here at all.
 */

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That workspace isn't available to you.";

/** The policies a candidate may carry. A name, never free-form code. */
const POLICIES: Record<string, ToolPolicy> = {
  "channel-lookup": CHANNEL_LOOKUP_POLICY,
  "widened-toolset": WIDENED_TOOLSET_POLICY,
  "shipped": BASELINE_POLICY,
};

function fail(message: string): BuildState {
  return { status: "error", message: message.slice(0, 1_000), nonce: Date.now() };
}

function done(message: string): BuildState {
  return { status: "success", message: message.slice(0, 1_000), nonce: Date.now() };
}

function refresh(workspaceId: string): void {
  revalidatePath(`/workspace/${workspaceId}/improvements`);
}

async function memberRole(session: Session, workspaceId: string): Promise<string | null> {
  const { data } = await session.supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", session.user.id)
    .eq("status", "active")
    .maybeSingle();
  return (data as { role: string } | null)?.role ?? null;
}

async function recordBlock(
  session: Session,
  workspaceId: string,
  candidateId: string | null,
  action: string,
  reason: string,
): Promise<void> {
  await session.supabase.from("improvement_boundary_blocks").insert({
    workspace_id: workspaceId,
    user_id: session.user.id,
    candidate_id: candidateId,
    attempted_action: action.slice(0, 120),
    reason: reason.slice(0, 500),
  });
}

export async function createImprovementCandidateAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspaceId");
  if (!isUuid(workspaceId)) return fail(NOT_AVAILABLE);
  if (!(await memberRole(session, workspaceId))) return fail(NOT_AVAILABLE);

  const kind = readText(formData, "kind");
  if (!isCandidateKind(kind)) return fail("Choose one of the seven proposal kinds.");

  const projectId = readText(formData, "projectId");
  if (!isUuid(projectId)) return fail("Choose the project this proposal belongs to.");

  const { data: project } = await session.supabase
    .from("app_projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (!project) return fail("That project isn't available to you.");

  const policyName = readText(formData, "policy");
  if (!POLICIES[policyName]) {
    return fail("Choose which candidate policy this proposal would run.");
  }

  const requested = formData.getAll("requestedAuthorities").map((value) => String(value));

  const draft: CandidateDraft = {
    kind,
    title: readText(formData, "title"),
    problem: readText(formData, "problem"),
    evidence: readText(formData, "evidence"),
    proposedChange: readText(formData, "proposedChange"),
    expectedBenefit: readText(formData, "expectedBenefit"),
    possibleRegressions: readText(formData, "possibleRegressions"),
    affectedComponents: readText(formData, "affectedComponents")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    evaluationPlan: readText(formData, "evaluationPlan"),
    costImpact: readText(formData, "costImpact"),
    securityImplications: readText(formData, "securityImplications"),
    rollbackPlan: readText(formData, "rollbackPlan"),
    requestedAuthorities: requested,
    sandboxKind: readText(formData, "sandboxKind") === "branch" ? "branch" : "sandbox",
    baseRef: readText(formData, "baseRef"),
    candidateRef: readText(formData, "candidateRef"),
  };

  // A protected authority is refused, and the refusal is recorded rather than
  // silently dropped.
  if (requested.length > 0) {
    const reason =
      "Refused: the improvement engine cannot grant permissions, remove an approval gate, raise spending authority, change a billing price, disable audit logging, alter held-out answers, rewrite success criteria after evaluation or deploy its own change.";
    await recordBlock(session, workspaceId, null, `request:${requested.join(",")}`, reason);
    return fail(reason);
  }

  const problems = candidateProblems(draft);
  if (problems.length > 0) return fail(problems.slice(0, 4).join(" "));

  const { count } = await session.supabase
    .from("improvement_candidates")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);
  if ((count ?? 0) >= CANDIDATE_LIMITS.maxPerWorkspace) {
    return fail(`This workspace already holds ${CANDIDATE_LIMITS.maxPerWorkspace} proposals.`);
  }

  const { error } = await session.supabase.from("improvement_candidates").insert({
    workspace_id: workspaceId,
    user_id: session.user.id,
    project_id: projectId,
    kind: draft.kind,
    title: draft.title.trim(),
    problem: draft.problem.trim(),
    evidence: draft.evidence.trim(),
    proposed_change: draft.proposedChange.trim(),
    expected_benefit: draft.expectedBenefit.trim(),
    possible_regressions: draft.possibleRegressions.trim(),
    affected_components: draft.affectedComponents,
    evaluation_plan: draft.evaluationPlan.trim(),
    cost_impact: draft.costImpact.trim(),
    security_implications: draft.securityImplications.trim(),
    rollback_plan: draft.rollbackPlan.trim(),
    sandbox_kind: draft.sandboxKind,
    base_ref: draft.baseRef.trim(),
    candidate_ref: draft.candidateRef.trim(),
    candidate_config: { policy: policyName },
    requested_authorities: [],
    status: "draft",
  });

  if (error) {
    console.error("improvement candidate insert failed:", error.message);
    return fail("That proposal could not be saved. Check the fields and try again.");
  }

  refresh(workspaceId);
  return done("Proposal saved as a draft. Run the evaluation when you are ready to freeze its criteria.");
}

export async function evaluateImprovementCandidateAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspaceId");
  const candidateId = readText(formData, "candidateId");
  if (!isUuid(workspaceId) || !isUuid(candidateId)) return fail(NOT_AVAILABLE);

  const { data, error } = await session.supabase
    .from("improvement_candidates")
    .select("id, user_id, status, evaluation_plan, expected_benefit, candidate_config")
    .eq("id", candidateId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error || !data) return fail(NOT_AVAILABLE);

  const row = data as {
    user_id: string;
    status: string;
    evaluation_plan: string;
    expected_benefit: string;
    candidate_config: { policy?: string } | null;
  };
  if (row.user_id !== session.user.id) {
    return fail("Only the person who wrote this proposal can run its evaluation.");
  }
  if (row.status !== "draft") return fail("This proposal has already been evaluated.");

  const policy = POLICIES[row.candidate_config?.policy ?? ""];
  if (!policy) return fail("This proposal names a policy that is not installed.");

  const suite = suiteDigest();
  const criteria = criteriaHash({
    evaluationPlan: row.evaluation_plan,
    expectedBenefit: row.expected_benefit,
    suiteName: EVAL_SUITE_NAME,
    suiteVersion: EVAL_SUITE_VERSION,
  });

  const begin = await session.supabase.rpc("improvement_candidate_begin_evaluation", {
    p_id: candidateId,
    p_suite_name: EVAL_SUITE_NAME,
    p_suite_version: EVAL_SUITE_VERSION,
    p_suite_hash: suite,
    p_criteria_hash: criteria,
  });
  const begun = begin.data as { ok?: boolean; code?: string } | null;
  if (begin.error || !begun?.ok) {
    return fail(
      begun?.code === "not-draft"
        ? "This proposal has already been evaluated."
        : "The evaluation could not start.",
    );
  }

  // The criteria are frozen now. Everything below is measured, not chosen.
  const result = evaluateCandidate({ policy, expectedSuiteDigest: suite });
  if (result.suiteIntegrity !== "verified") {
    return fail("The evaluation suite does not match the frozen one, so nothing was recorded.");
  }

  const recorded = await session.supabase.rpc("improvement_candidate_record_evaluation", {
    p_id: candidateId,
    p_suite_hash: suite,
    p_totals: result.numbers,
    p_case_results: result.cases,
  });
  const saved = recorded.data as { ok?: boolean; verdict?: string; code?: string } | null;
  if (recorded.error || !saved?.ok) {
    console.error("improvement evaluation failed:", recorded.error?.message ?? saved?.code);
    return fail("The evaluation ran but could not be recorded; the proposal stays frozen.");
  }

  refresh(workspaceId);
  return done(
    `Evaluated against the baseline: ${result.numbers.candidatePassed} of ${result.numbers.totalCases} cases pass versus ${result.numbers.baselinePassed}. Verdict: ${result.comparison.verdict}. Policy digest ${policyDigest(policy).slice(0, 12)}.`,
  );
}

export async function decideImprovementCandidateAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspaceId");
  const candidateId = readText(formData, "candidateId");
  const decision = readText(formData, "decision");
  const note = readText(formData, "note");
  const deploymentId = readText(formData, "deploymentId");
  if (!isUuid(workspaceId) || !isUuid(candidateId)) return fail(NOT_AVAILABLE);
  if (!(await memberRole(session, workspaceId))) return fail(NOT_AVAILABLE);

  const calls: Record<string, () => PromiseLike<{ data: unknown; error: unknown }>> = {
    approve: () =>
      session.supabase.rpc("improvement_candidate_approve", { p_id: candidateId, p_note: note }),
    reject: () =>
      session.supabase.rpc("improvement_candidate_reject", { p_id: candidateId, p_reason: note }),
    promote: () =>
      session.supabase.rpc("improvement_candidate_promote", {
        p_id: candidateId,
        p_deployment_id: isUuid(deploymentId) ? deploymentId : null,
        p_note: note,
      }),
    cancel: () => session.supabase.rpc("improvement_candidate_cancel", { p_id: candidateId }),
  };

  const call = calls[decision];
  if (!call) return fail("Choose approve, reject, promote or cancel.");

  const { data, error } = await call();
  const result = data as { ok?: boolean; code?: string } | null;

  if (error || !result?.ok) {
    const messages: Record<string, string> = {
      "self-review": "The author cannot approve or promote their own proposal.",
      "not-evaluated": "Run the evaluation before reviewing this proposal.",
      "result-worse": "The measured result is not better than or equal to the baseline.",
      "security-findings": "Security findings have to be resolved first.",
      regressions: "Guarded behaviour changed; that needs its own review.",
      "suite-mismatch": "The evaluation did not run against the frozen suite.",
      "note-required": "Record the review decision in at least a sentence.",
      "not-approved": "Only an approved proposal can be promoted.",
      "deployment-required": "Choose an approved deployment to ship this through.",
      "deployment-not-approved": "That deployment has not been approved yet. Approve its exact plan with the typed confirmation first.",
      "deployment-not-found": "That deployment no longer exists.",
      "deployment-mismatch": "That deployment belongs to another project or person.",
      "project-required": "Link this proposal to a project before promoting it.",
      "reason-required": "Give a reason for rejecting this proposal.",
      final: "That decision is already final.",
    };
    const code = result?.code ?? "";
    return fail(messages[code] ?? "That decision could not be recorded.");
  }

  refresh(workspaceId);
  const verb =
    decision === "approve" ? "approved for promotion" : decision === "promote" ? "promoted" : decision;
  return done(`Proposal ${verb}.`);
}

/**
 * The "weaken the test" attempt a person or an agent might try: make the plan
 * easier after seeing the numbers. Postgres refuses it, and the refusal is kept.
 */
export async function attemptRelaxationAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspaceId");
  const candidateId = readText(formData, "candidateId");
  const relaxedPlan = readText(formData, "relaxedPlan");
  if (!isUuid(workspaceId) || !isUuid(candidateId)) return fail(NOT_AVAILABLE);
  if (relaxedPlan.trim().length < 20) return fail("Write the easier plan you are attempting.");

  // Clients hold no update policy on this table, so an accepted-by-RLS-free write
  // is a zero-row update; the trigger is what refuses the write when it is allowed
  // through a privileged path.
  const { data, error } = await session.supabase
    .from("improvement_candidates")
    .update({ evaluation_plan: relaxedPlan.trim() })
    .eq("id", candidateId)
    .eq("workspace_id", workspaceId)
    .select("id");

  if (!error && (data ?? []).length > 0) {
    refresh(workspaceId);
    return fail("The change was accepted, which should not be possible. Report this.");
  }

  const reason = error?.message.includes("frozen")
    ? "Refused: the success criteria are frozen once evaluation starts."
    : "Refused: the success criteria cannot be rewritten, and the database will not accept the write.";

  await recordBlock(session, workspaceId, candidateId, "rewrite_evaluation_plan", reason);
  refresh(workspaceId);
  return fail(reason);
}
