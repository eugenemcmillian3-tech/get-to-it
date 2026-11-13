"use server";

import { revalidatePath } from "next/cache";
import type { BuildState } from "@/lib/action-state";
import { getSession, type Session } from "@/lib/auth";
import {
  TOOL_COSTS,
  evaluateCandidate,
  type EvalCase,
} from "@/lib/improvement-eval";
import {
  PERFORMANCE_BASELINE,
  PERFORMANCE_FAMILY_DIGEST,
  PERFORMANCE_FAMILY_KEY,
  PERFORMANCE_FAMILY_VERSION,
  PERFORMANCE_LIMITS,
  PERFORMANCE_PERMITTED_TOOLS,
  PERFORMANCE_POLICIES,
  familyDistribution,
  programProblems,
  protocolFingerprint,
  type PerformanceDraft,
} from "@/lib/performance-program";
import { EVAL_CASES } from "@/lib/improvement-eval";
import { isUuid, readText } from "@/lib/validation";

/**
 * Phase 41 — the controlled performance research program.
 *
 * This layer registers the comparison before any trial exists, runs the authored
 * suite for both configurations, records the numbers it actually measured, and
 * accepts documented human references and independent review marks. It never
 * writes a claim verdict: Postgres derives that from the rows on every read, so
 * the claim cannot be edited into existence.
 */

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That workspace isn't available to you.";

function fail(message: string): BuildState {
  return { status: "error", message: message.slice(0, 1_000), nonce: Date.now() };
}

function done(message: string): BuildState {
  return { status: "success", message: message.slice(0, 1_000), nonce: Date.now() };
}

function refresh(workspaceId: string, programId?: string): void {
  revalidatePath(`/workspace/${workspaceId}/performance`);
  if (programId) revalidatePath(`/workspace/${workspaceId}/performance/${programId}`);
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

function int(formData: FormData, name: string): number {
  return Number.parseInt(readText(formData, name), 10);
}

function decimal(formData: FormData, name: string): number {
  return Number.parseFloat(readText(formData, name).replace(",", "."));
}

export async function registerPerformanceProgramAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspaceId");
  if (!isUuid(workspaceId)) return fail(NOT_AVAILABLE);
  if (!(await memberRole(session, workspaceId))) return fail(NOT_AVAILABLE);

  const draft: PerformanceDraft = {
    title: readText(formData, "title"),
    question: readText(formData, "question"),
    inclusionRules: readText(formData, "inclusionRules"),
    exclusionRules: readText(formData, "exclusionRules"),
    scoringMethod: readText(formData, "scoringMethod"),
    candidatePolicy: readText(formData, "candidatePolicy"),
    trials: int(formData, "trials"),
    timeLimitSeconds: int(formData, "timeLimitSeconds"),
    costLimitCents: int(formData, "costLimitCents"),
    humanAssistancePolicy: readText(formData, "humanAssistancePolicy"),
    failureCriteria: readText(formData, "failureCriteria"),
    supportedClaim: readText(formData, "supportedClaim"),
    claimText: readText(formData, "claimText"),
    minimumEffect: decimal(formData, "minimumEffect"),
    noninferiorityMargin: decimal(formData, "noninferiorityMargin"),
    maxDisagreements: int(formData, "maxDisagreements"),
  };

  const problems = programProblems(draft);
  if (problems.length > 0) return fail(problems.slice(0, 4).join(" "));

  const candidate = PERFORMANCE_POLICIES[draft.candidatePolicy];
  if (!candidate) return fail("Choose one of the installed candidate policies.");

  const { count } = await session.supabase
    .from("performance_programs")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);
  if ((count ?? 0) >= PERFORMANCE_LIMITS.maxProgramsPerWorkspace) {
    return fail(
      `This workspace already holds ${PERFORMANCE_LIMITS.maxProgramsPerWorkspace} registered programs.`,
    );
  }

  const distribution = familyDistribution();
  const protocol = {
    ...draft,
    title: draft.title.trim(),
    question: draft.question.trim(),
    inclusionRules: draft.inclusionRules.trim(),
    exclusionRules: draft.exclusionRules.trim(),
    scoringMethod: draft.scoringMethod.trim(),
    humanAssistancePolicy: draft.humanAssistancePolicy.trim(),
    failureCriteria: draft.failureCriteria.trim(),
    claimText: draft.claimText.trim(),
  };

  const { data, error } = await session.supabase
    .from("performance_programs")
    .insert({
      workspace_id: workspaceId,
      user_id: session.user.id,
      title: protocol.title,
      question: protocol.question,
      task_family: PERFORMANCE_FAMILY_KEY,
      distribution,
      inclusion_rules: protocol.inclusionRules,
      exclusion_rules: protocol.exclusionRules,
      scoring_method: protocol.scoringMethod,
      baseline_label: PERFORMANCE_BASELINE.label,
      baseline_config: { policy: PERFORMANCE_BASELINE.key },
      candidate_label: candidate.label,
      candidate_config: { policy: draft.candidatePolicy },
      permitted_tools: PERFORMANCE_PERMITTED_TOOLS,
      time_limit_seconds: protocol.timeLimitSeconds,
      cost_limit_cents: protocol.costLimitCents,
      trials: protocol.trials,
      human_assistance_policy: protocol.humanAssistancePolicy,
      failure_criteria: protocol.failureCriteria,
      supported_claim: protocol.supportedClaim,
      claim_text: protocol.claimText,
      minimum_effect: protocol.minimumEffect,
      noninferiority_margin: protocol.noninferiorityMargin,
      max_disagreements: protocol.maxDisagreements,
      status: "registered",
      fingerprint: protocolFingerprint(protocol),
      registered_at: new Date().toISOString(),
      registered_by: session.user.id,
    })
    .select("id")
    .maybeSingle();

  if (error || !data) {
    console.error("performance program registration failed:", error?.message);
    return fail("That comparison could not be registered. Check the fields and try again.");
  }

  refresh(workspaceId, (data as { id: string }).id);
  return done(
    "Comparison registered and frozen. Recording trials now uses the task family and limits above.",
  );
}

/** The registered task keys, in the suite's order, with the installed cases. */
function registeredCases(taskKeys: string[]): EvalCase[] {
  const byId = new Map(EVAL_CASES.map((entry) => [entry.id, entry]));
  return taskKeys.flatMap((key) => {
    const entry = byId.get(key);
    return entry ? [entry] : [];
  });
}

/**
 * Runs both configurations over the registered cases for the registered number
 * of trials. Cost is the authored suite's cost units; a real money cost is 0
 * because no paid call is made, and latency is left empty because none was
 * measured. The report refuses speed and cost claims that this cannot support,
 * which is the point of registering the claim before running.
 */
export async function runPerformanceTrialsAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspaceId");
  const programId = readText(formData, "programId");
  if (!isUuid(workspaceId) || !isUuid(programId)) return fail(NOT_AVAILABLE);
  if (!(await memberRole(session, workspaceId))) return fail(NOT_AVAILABLE);

  const { data, error } = await session.supabase
    .from("performance_programs")
    .select("id, workspace_id, status, task_family, distribution, trials, candidate_config")
    .eq("id", programId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error || !data) return fail("That comparison isn't available to you.");

  const program = data as {
    workspace_id: string;
    status: string;
    task_family: string;
    distribution: { suite?: string; version?: string; digest?: string; task_keys?: string[] };
    trials: number;
    candidate_config: { policy?: string } | null;
  };

  if (program.status !== "registered") {
    return fail(
      program.status === "draft"
        ? "Register the comparison before recording trials."
        : "This comparison is closed.",
    );
  }
  if (
    program.task_family !== PERFORMANCE_FAMILY_KEY ||
    program.distribution.digest !== PERFORMANCE_FAMILY_DIGEST ||
    program.distribution.version !== PERFORMANCE_FAMILY_VERSION
  ) {
    return fail(
      "The installed task family no longer matches the one this program registered, so nothing was recorded.",
    );
  }

  const candidatePolicy = PERFORMANCE_POLICIES[program.candidate_config?.policy ?? ""];
  if (!candidatePolicy) return fail("This comparison names a policy that is not installed.");

  const taskKeys = program.distribution.task_keys ?? [];
  const cases = registeredCases(taskKeys);
  if (cases.length !== taskKeys.length || cases.length === 0) {
    return fail("The registered task list does not match the installed suite, so nothing ran.");
  }

  const { count } = await session.supabase
    .from("performance_trials")
    .select("id", { count: "exact", head: true })
    .eq("program_id", programId);
  if ((count ?? 0) > 0) return fail("This comparison already has trials recorded.");

  const result = evaluateCandidate({ policy: candidatePolicy.policy, cases });
  if (result.suiteIntegrity !== "verified") {
    return fail("The suite does not match the registered digest, so nothing was recorded.");
  }

  const rows = [];
  for (let trial = 1; trial <= program.trials; trial += 1) {
    for (const run of [
      { config: "baseline" as const, results: result.baseline.results },
      { config: "candidate" as const, results: result.candidate.results },
    ]) {
      for (const row of run.results) {
        const passed = row.chosen === row.expected;
        rows.push({
          program_id: programId,
          workspace_id: workspaceId,
          config: run.config,
          task_key: row.id,
          trial,
          outcome: passed ? "pass" : "fail",
          score: passed ? 1 : 0,
          cost_cents: 0,
          cost_units: TOOL_COSTS[row.chosen] ?? 0,
          duration_ms: null,
          human_assisted: false,
          source: "authored_suite" as const,
          recorded_by: session.user.id,
        });
      }
    }
  }

  for (let index = 0; index < rows.length; index += 200) {
    const { error: insertError } = await session.supabase
      .from("performance_trials")
      .insert(rows.slice(index, index + 200));
    if (insertError) {
      console.error("performance trial insert failed:", insertError.message);
      return fail(
        insertError.code === "23505"
          ? "This comparison already has trials recorded."
          : "The trials ran but could not all be recorded. The recorded evidence is append-only, so review it before retrying.",
      );
    }
  }

  refresh(workspaceId, programId);
  return done(
    `Recorded ${rows.length} trials: ${result.candidate.passed} of ${cases.length} cases pass for the candidate versus ${result.baseline.passed} for the baseline. The claim verdict is derived from these rows.`,
  );
}

export async function recordHumanReferenceAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspaceId");
  const programId = readText(formData, "programId");
  if (!isUuid(workspaceId) || !isUuid(programId)) return fail(NOT_AVAILABLE);
  if (!(await memberRole(session, workspaceId))) return fail(NOT_AVAILABLE);

  const expertise = readText(formData, "expertise");
  const toolAccess = readText(formData, "toolAccess");
  const conditions = readText(formData, "conditions");
  const consentBasis = readText(formData, "consentBasis");
  const collectionMethod = readText(formData, "collectionMethod");
  const participants = int(formData, "participants");
  const taskCount = int(formData, "taskCount");
  const passed = int(formData, "passed");
  const meanScore = decimal(formData, "meanScore");
  const notes = readText(formData, "notes");

  if (
    expertise.trim().length < 20 ||
    toolAccess.trim().length < 20 ||
    conditions.trim().length < 20 ||
    consentBasis.trim().length < 20 ||
    collectionMethod.trim().length < 30
  ) {
    return fail(
      "A human reference needs its expertise, tool access, working conditions, consent basis and collection method documented in full.",
    );
  }
  if (
    !Number.isInteger(participants) ||
    participants < 1 ||
    participants > 1000 ||
    !Number.isInteger(taskCount) ||
    taskCount < 1 ||
    taskCount > 1000
  ) {
    return fail("Participants and tasks must each be a whole number between 1 and 1,000.");
  }
  if (!Number.isInteger(passed) || passed < 0 || passed > taskCount) {
    return fail("Passed tasks must be a whole number up to the number of tasks.");
  }
  if (!Number.isFinite(meanScore) || meanScore < 0 || meanScore > 1) {
    return fail("The mean score must be between 0 and 1.");
  }

  const { error } = await session.supabase.from("performance_human_references").insert({
    program_id: programId,
    workspace_id: workspaceId,
    user_id: session.user.id,
    expertise: expertise.trim(),
    tool_access: toolAccess.trim(),
    conditions: conditions.trim(),
    consent_basis: consentBasis.trim(),
    collection_method: collectionMethod.trim(),
    participants,
    task_count: taskCount,
    passed,
    mean_score: meanScore,
    notes: notes.trim() || null,
  });

  if (error) {
    console.error("performance human reference insert failed:", error.message);
    return fail(
      error.message.includes("register the comparison")
        ? "Register the comparison before documenting a human reference."
        : "That human reference could not be recorded.",
    );
  }

  refresh(workspaceId, programId);
  return done(
    "Human reference recorded. It is labelled as a documented reference, not used as the machine baseline.",
  );
}

export async function reviewPerformanceTrialAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspaceId");
  const programId = readText(formData, "programId");
  const trialId = readText(formData, "trialId");
  const verdict = readText(formData, "verdict");
  const note = readText(formData, "note");
  if (!isUuid(workspaceId) || !isUuid(programId) || !isUuid(trialId)) return fail(NOT_AVAILABLE);
  if (verdict !== "agree" && verdict !== "disagree") return fail("Choose agree or disagree.");
  if (note.trim().length < 10) return fail("Record what you checked in at least a sentence.");

  const { error } = await session.supabase.from("performance_review_marks").insert({
    program_id: programId,
    trial_id: trialId,
    workspace_id: workspaceId,
    reviewer_id: session.user.id,
    verdict,
    note: note.trim(),
  });

  if (error) {
    console.error("performance review mark insert failed:", error.message);
    if (error.message.includes("cannot review it")) {
      return fail("The person who recorded a trial cannot review it.");
    }
    if (error.message.includes("cannot independently review it")) {
      return fail(
        "The person who registered the comparison cannot independently review its trials.",
      );
    }
    return fail("That review could not be recorded.");
  }

  refresh(workspaceId, programId);
  return done("Review recorded. Disagreements above the registered allowance block the claim.");
}

export async function closePerformanceProgramAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspaceId");
  const programId = readText(formData, "programId");
  if (!isUuid(workspaceId) || !isUuid(programId)) return fail(NOT_AVAILABLE);

  const { data, error } = await session.supabase.rpc("performance_program_close", {
    p_program_id: programId,
  });
  const result = data as { ok?: boolean; code?: string } | null;
  if (error || !result?.ok) {
    const messages: Record<string, string> = {
      "not-registered": "Only a registered comparison can be closed.",
      forbidden: "Only the person who registered it, or a workspace owner or admin, can close it.",
      "no-workspace": NOT_AVAILABLE,
      "not-found": "That comparison no longer exists.",
    };
    return fail(messages[result?.code ?? ""] ?? "That comparison could not be closed.");
  }

  refresh(workspaceId, programId);
  return done("Comparison closed. No further trials can be recorded against it.");
}
