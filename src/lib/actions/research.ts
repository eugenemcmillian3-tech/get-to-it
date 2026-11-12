"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ResearchState } from "@/lib/action-state";
import { getSession, type Session } from "@/lib/auth";
import {
  RESEARCH_FORBIDDEN_TOOLS,
  RESEARCH_TOOLS,
  buildResearchBrief,
  researchTaskPlan,
  syntheticResearchMission,
  validateResearchContract,
  type FindingLabel,
  type ResearchFinding,
  type ResearchHypothesis,
  type ResearchMission,
  type ResearchSource,
  type ResearchSpecialistFunction,
  type RequiredSourceTier,
  type ResearchSourceKind,
  type SourceStance,
  type SourceTier,
  type StatementKind,
} from "@/lib/research-missions";
import { isUuid, readText } from "@/lib/validation";

/**
 * Phase 39 actions.
 *
 * These actions write records. They do not search the web, contact anyone,
 * publish a brief, run an agent or charge credits: a mission is executed by the
 * Phase 36 orchestration layer, and a proposed experiment is an ordinary draft
 * Phase 35 record that still needs its own approvals.
 */

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That research mission isn't available to you.";

function fail(message: string): ResearchState {
  return { status: "error", message, nonce: Date.now() };
}

function succeed(message: string): ResearchState {
  return { status: "success", message, nonce: Date.now() };
}

function refreshList(workspaceId: string) {
  revalidatePath(`/workspace/${workspaceId}/research`);
}

function refreshMission(workspaceId: string, missionId: string) {
  refreshList(workspaceId);
  revalidatePath(`/workspace/${workspaceId}/research/${missionId}`);
}

async function membershipRole(
  session: Session,
  workspaceId: string,
): Promise<string | null> {
  const { data } = await session.supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", session.user.id)
    .eq("status", "active")
    .maybeSingle();
  return (data as { role: string } | null)?.role ?? null;
}

function intField(formData: FormData, key: string, fallback: number): number {
  const raw = readText(formData, key);
  if (raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : Number.NaN;
}

function listField(formData: FormData, key: string): string[] {
  return formData
    .getAll(key)
    .map((value) => String(value).trim())
    .filter((value) => value !== "");
}

// ---------------------------------------------------------------------------
// Creating the contract
// ---------------------------------------------------------------------------

export async function createResearchMissionAction(
  _previous: ResearchState,
  formData: FormData,
): Promise<ResearchState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  if (!isUuid(workspaceId)) return fail(NOT_AVAILABLE);
  if (!(await membershipRole(session, workspaceId))) return fail(NOT_AVAILABLE);

  const tools = listField(formData, "allowed_tools");
  const unknownTool = tools.find(
    (tool) => !(RESEARCH_TOOLS as readonly string[]).includes(tool),
  );
  if (unknownTool) {
    return fail(
      `${unknownTool} is not a research tool in this build. Outreach and publishing are never allowed.`,
    );
  }
  const forbidden = tools.find((tool) =>
    (RESEARCH_FORBIDDEN_TOOLS as readonly string[]).includes(tool),
  );
  if (forbidden) return fail(`Research missions cannot use ${forbidden}.`);

  const hypotheses = [
    readText(formData, "hypothesis_1"),
    readText(formData, "hypothesis_2"),
    readText(formData, "hypothesis_3"),
    readText(formData, "hypothesis_4"),
  ].filter((statement) => statement !== "");

  const stopConditions = [
    readText(formData, "stop_condition_1"),
    readText(formData, "stop_condition_2"),
    readText(formData, "stop_condition_3"),
  ].filter((entry) => entry !== "");
  const checkpoints = [
    readText(formData, "checkpoint_1"),
    readText(formData, "checkpoint_2"),
  ].filter((entry) => entry !== "");

  const contract = {
    question: readText(formData, "question"),
    scope: readText(formData, "scope"),
    existing_evidence: readText(formData, "existing_evidence"),
    required_source_tier: (readText(formData, "required_source_tier") ||
      "primary") as RequiredSourceTier,
    allowed_tools: tools,
    deliverables: [
      "Sourced research brief",
      "Proposed bounded experiment",
      ...listField(formData, "deliverables"),
    ],
    task_budget: intField(formData, "task_budget", 6),
    agent_budget: intField(formData, "agent_budget", 4),
    retry_budget: intField(formData, "retry_budget", 1),
    spend_ceiling_cents: intField(formData, "spend_ceiling_cents", 200),
    time_ceiling_minutes: intField(formData, "time_ceiling_minutes", 120),
    stop_conditions: stopConditions,
    checkpoints,
    hypotheses,
  };

  const problems = validateResearchContract(contract);
  if (problems.length > 0) {
    return fail(problems.slice(0, 3).map((problem) => problem.message).join(" "));
  }

  const orchestrationId = readText(formData, "orchestration_id");
  if (orchestrationId !== "") {
    if (!isUuid(orchestrationId)) return fail(NOT_AVAILABLE);
    const { data: orchestration } = await session.supabase
      .from("orchestrations")
      .select("id")
      .eq("id", orchestrationId)
      .eq("workspace_id", workspaceId)
      .eq("created_by", session.user.id)
      .maybeSingle();
    if (!orchestration) {
      return fail("That orchestration isn't one of yours in this workspace.");
    }
  }

  const { data: created, error } = await session.supabase
    .from("research_missions")
    .insert({
      workspace_id: workspaceId,
      created_by: session.user.id,
      orchestration_id: orchestrationId === "" ? null : orchestrationId,
      question: contract.question,
      scope: contract.scope,
      existing_evidence: contract.existing_evidence,
      required_source_tier: contract.required_source_tier,
      allowed_tools: contract.allowed_tools,
      deliverables: contract.deliverables,
      task_budget: contract.task_budget,
      agent_budget: contract.agent_budget,
      retry_budget: contract.retry_budget,
      spend_ceiling_cents: contract.spend_ceiling_cents,
      time_ceiling_minutes: contract.time_ceiling_minutes,
      stop_conditions: contract.stop_conditions,
      checkpoints: contract.checkpoints,
      status: "ready",
    })
    .select("id")
    .single();

  if (error || !created) {
    console.error("createResearchMissionAction failed:", error?.message);
    return fail(
      error?.message?.includes("outreach")
        ? "A research mission may not use outreach or publishing tools."
        : "We couldn't save that research contract. Nothing was created.",
    );
  }

  const missionId = created.id as string;

  const { error: hypothesisError } = await session.supabase
    .from("research_hypotheses")
    .insert(
      hypotheses.map((statement, index) => ({
        mission_id: missionId,
        workspace_id: workspaceId,
        created_by: session.user.id,
        statement,
        role: index === 0 ? "leading" : "competing",
      })),
    );

  if (hypothesisError) {
    console.error("research hypotheses failed:", hypothesisError.message);
    return fail(
      "The contract was saved but its hypotheses were not. Open the mission and add them again.",
    );
  }

  refreshList(workspaceId);
  redirect(`/workspace/${workspaceId}/research/${missionId}`);
}

// ---------------------------------------------------------------------------
// A synthetic mission, used to exercise the whole path honestly
// ---------------------------------------------------------------------------

export async function seedSyntheticResearchAction(
  _previous: ResearchState,
  formData: FormData,
): Promise<ResearchState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  if (!isUuid(workspaceId)) return fail(NOT_AVAILABLE);
  if (!(await membershipRole(session, workspaceId))) return fail(NOT_AVAILABLE);

  const synthetic = syntheticResearchMission();
  const contract = synthetic.contract;

  const { data: mission, error } = await session.supabase
    .from("research_missions")
    .insert({
      workspace_id: workspaceId,
      created_by: session.user.id,
      question: contract.question,
      scope: contract.scope,
      existing_evidence: contract.existing_evidence,
      required_source_tier: contract.required_source_tier,
      allowed_tools: contract.allowed_tools,
      deliverables: contract.deliverables,
      task_budget: contract.task_budget,
      agent_budget: contract.agent_budget,
      retry_budget: contract.retry_budget,
      spend_ceiling_cents: contract.spend_ceiling_cents,
      time_ceiling_minutes: contract.time_ceiling_minutes,
      stop_conditions: contract.stop_conditions,
      checkpoints: contract.checkpoints,
      status: "ready",
    })
    .select("id")
    .single();

  if (error || !mission) {
    console.error("seedSyntheticResearchAction mission failed:", error?.message);
    return fail("We couldn't create the synthetic mission. Nothing was created.");
  }

  const missionId = mission.id as string;

  const { data: hypotheses, error: hypothesisError } = await session.supabase
    .from("research_hypotheses")
    .insert(
      synthetic.hypothesisStatements.map((statement, index) => ({
        mission_id: missionId,
        workspace_id: workspaceId,
        created_by: session.user.id,
        statement,
        role: index === 0 ? "leading" : "competing",
      })),
    )
    .select("id, statement");

  if (hypothesisError || !hypotheses) {
    console.error("seedSyntheticResearchAction hypotheses failed:", hypothesisError?.message);
    return fail("The mission was created but its hypotheses were not recorded.");
  }

  const hypothesisId = (index: number | null): string | null => {
    if (index === null) return null;
    const match = (hypotheses as { id: string; statement: string }[]).find(
      (entry) => entry.statement === synthetic.hypothesisStatements[index],
    );
    return match?.id ?? null;
  };

  const { error: sourceError } = await session.supabase
    .from("research_sources")
    .insert(
      synthetic.sources.map((source) => ({
        mission_id: missionId,
        workspace_id: workspaceId,
        created_by: session.user.id,
        hypothesis_id: hypothesisId(source.hypothesisIndex),
        stance: source.stance,
        statement_kind: source.statement_kind,
        source_tier: source.source_tier,
        source_kind: source.source_kind,
        title: source.title,
        locator: source.locator,
        excerpt: source.excerpt,
        verified: source.verified,
      })),
    );

  if (sourceError) {
    console.error("seedSyntheticResearchAction sources failed:", sourceError.message);
    return fail("The mission was created but its sources were not recorded.");
  }

  const { error: findingError } = await session.supabase
    .from("research_findings")
    .insert(
      synthetic.findings.map((finding) => ({
        mission_id: missionId,
        workspace_id: workspaceId,
        created_by: session.user.id,
        hypothesis_id: hypothesisId(finding.hypothesisIndex),
        claim: finding.claim,
        label: finding.label,
        author_role: finding.author_role,
        verifier_role: finding.verifier_role,
        status: finding.status,
        verified_at: finding.verified ? new Date().toISOString() : null,
      })),
    );

  if (findingError) {
    console.error("seedSyntheticResearchAction findings failed:", findingError.message);
    return fail(
      `The sources were recorded but the findings were refused: ${findingError.message}`,
    );
  }

  // The deliberately unsupported conclusion. The database must refuse it; if it
  // were accepted, the mission would be lying about what it established.
  const attempt = synthetic.unsupportedAttempt;
  const { error: unsupportedError } = await session.supabase
    .from("research_findings")
    .insert({
      mission_id: missionId,
      workspace_id: workspaceId,
      created_by: session.user.id,
      claim: attempt.claim,
      label: attempt.label,
      author_role: attempt.author_role,
      verifier_role: attempt.verifier_role,
      status: attempt.status,
      verified_at: new Date().toISOString(),
    });

  if (!unsupportedError) {
    return fail(
      "The unsupported conclusion was accepted. That is a defect: nothing is shown as a discovery without independent verification.",
    );
  }
  const refusal = unsupportedError.message;

  const { error: completeError } = await session.supabase
    .from("research_missions")
    .update({ status: "complete" })
    .eq("id", missionId)
    .eq("workspace_id", workspaceId);

  if (completeError) {
    console.error("seedSyntheticResearchAction complete failed:", completeError.message);
  }

  refreshList(workspaceId);
  revalidatePath(`/workspace/${workspaceId}/research/${missionId}`);

  return succeed(
    `Synthetic mission recorded: ${synthetic.sources.length} sources, ${synthetic.findings.length} findings. The unsupported conclusion was refused: "${refusal}".`,
  );
}

// ---------------------------------------------------------------------------
// Evidence and findings
// ---------------------------------------------------------------------------

export async function addResearchSourceAction(
  _previous: ResearchState,
  formData: FormData,
): Promise<ResearchState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const missionId = readText(formData, "mission_id");
  if (!isUuid(workspaceId) || !isUuid(missionId)) return fail(NOT_AVAILABLE);
  if (!(await membershipRole(session, workspaceId))) return fail(NOT_AVAILABLE);

  const hypothesisId = readText(formData, "hypothesis_id");
  const statementKind = readText(formData, "statement_kind") as StatementKind;

  const { error } = await session.supabase.from("research_sources").insert({
    mission_id: missionId,
    workspace_id: workspaceId,
    created_by: session.user.id,
    hypothesis_id: hypothesisId === "" ? null : hypothesisId,
    stance: (readText(formData, "stance") || "supports") as SourceStance,
    statement_kind: statementKind,
    source_tier: (readText(formData, "source_tier") || "unverified") as SourceTier,
    source_kind: readText(formData, "source_kind") as ResearchSourceKind,
    title: readText(formData, "title"),
    locator: readText(formData, "locator"),
    excerpt: readText(formData, "excerpt"),
    verified: readText(formData, "verified") === "yes",
  });

  if (error) {
    console.error("addResearchSourceAction failed:", error.message);
    return fail(
      error.message.includes("quotation")
        ? "A quotation has to quote something. Add the words the source used."
        : error.message.includes("locator")
          ? "Record where the source came from."
          : `We couldn't record that source: ${error.message}`,
    );
  }

  refreshMission(workspaceId, missionId);
  return succeed("Source recorded with its provenance. Nothing was published.");
}

export async function addResearchFindingAction(
  _previous: ResearchState,
  formData: FormData,
): Promise<ResearchState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const missionId = readText(formData, "mission_id");
  if (!isUuid(workspaceId) || !isUuid(missionId)) return fail(NOT_AVAILABLE);
  if (!(await membershipRole(session, workspaceId))) return fail(NOT_AVAILABLE);

  const authorRole = readText(formData, "author_role") as ResearchSpecialistFunction;
  const verify = readText(formData, "verify") === "yes";
  const verifierRole = verify
    ? (readText(formData, "verifier_role") as ResearchSpecialistFunction)
    : null;

  if (verify && verifierRole === authorRole) {
    return fail(
      "A conclusion cannot be verified by the same specialist function that produced it. Role labels alone do not establish independent verification.",
    );
  }

  const label = (readText(formData, "label") || "observation") as FindingLabel;
  const hypothesisId = readText(formData, "hypothesis_id");

  const { error } = await session.supabase.from("research_findings").insert({
    mission_id: missionId,
    workspace_id: workspaceId,
    created_by: session.user.id,
    hypothesis_id: hypothesisId === "" ? null : hypothesisId,
    claim: readText(formData, "claim"),
    label,
    author_role: authorRole,
    verifier_role: verifierRole,
    status: verify && label !== "proposal" ? "supported" : "pending",
    verified_at: verify ? new Date().toISOString() : null,
  });

  if (error) {
    console.error("addResearchFindingAction failed:", error.message);
    return fail(`The database refused this finding: ${error.message}`);
  }

  refreshMission(workspaceId, missionId);
  return succeed(
    label === "discovery"
      ? "Finding recorded as a verified discovery, with the evidence it needs."
      : "Finding recorded. It is not shown as established until it is verified.",
  );
}

export async function completeResearchMissionAction(
  _previous: ResearchState,
  formData: FormData,
): Promise<ResearchState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const missionId = readText(formData, "mission_id");
  if (!isUuid(workspaceId) || !isUuid(missionId)) return fail(NOT_AVAILABLE);
  if (!(await membershipRole(session, workspaceId))) return fail(NOT_AVAILABLE);

  const { error } = await session.supabase
    .from("research_missions")
    .update({ status: "complete" })
    .eq("id", missionId)
    .eq("workspace_id", workspaceId);

  if (error) {
    console.error("completeResearchMissionAction failed:", error.message);
    return fail(`The mission isn't ready to close: ${error.message}`);
  }

  refreshMission(workspaceId, missionId);
  return succeed("Mission closed. The brief stays inside this workspace.");
}

export async function cancelResearchMissionAction(
  _previous: ResearchState,
  formData: FormData,
): Promise<ResearchState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const missionId = readText(formData, "mission_id");
  if (!isUuid(workspaceId) || !isUuid(missionId)) return fail(NOT_AVAILABLE);
  if (!(await membershipRole(session, workspaceId))) return fail(NOT_AVAILABLE);

  const { data, error } = await session.supabase.rpc("research_cancel", {
    p_id: missionId,
    p_note: readText(formData, "note"),
  });

  if (error) {
    console.error("cancelResearchMissionAction failed:", error.message);
    return fail("We couldn't cancel that mission just now. Nothing changed.");
  }

  const result = (data ?? {}) as {
    ok?: boolean;
    code?: string;
    orchestration?: { ok?: boolean } | null;
  };
  if (!result.ok) {
    return fail(
      result.code === "no-permission"
        ? NOT_AVAILABLE
        : "We couldn't cancel that mission just now. Nothing changed.",
    );
  }

  refreshMission(workspaceId, missionId);
  return succeed(
    result.orchestration
      ? "Mission cancelled, and the orchestration behind it was cancelled too."
      : "Mission cancelled. It had no orchestration to stop.",
  );
}

// ---------------------------------------------------------------------------
// Dispatch into the existing orchestration plan
// ---------------------------------------------------------------------------

export async function planResearchTasksAction(
  _previous: ResearchState,
  formData: FormData,
): Promise<ResearchState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const missionId = readText(formData, "mission_id");
  if (!isUuid(workspaceId) || !isUuid(missionId)) return fail(NOT_AVAILABLE);
  if (!(await membershipRole(session, workspaceId))) return fail(NOT_AVAILABLE);

  const { data: mission } = await session.supabase
    .from("research_missions")
    .select("*")
    .eq("id", missionId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!mission) return fail(NOT_AVAILABLE);

  const record = mission as ResearchMission;
  if (record.status === "cancelled") {
    return fail("This mission is cancelled. Nothing will be scheduled for it.");
  }
  if (!record.orchestration_id) {
    return fail(
      "Link an orchestration to this mission first: the plan runs on the existing task queue, not a separate one.",
    );
  }

  const { data: orchestration } = await session.supabase
    .from("orchestrations")
    .select("id, status")
    .eq("id", record.orchestration_id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!orchestration) return fail("That orchestration isn't available in this workspace.");

  const status = (orchestration as { status: string }).status;
  if (!["draft", "awaiting_approval", "ready"].includes(status)) {
    return fail(
      "A plan can only be added before execution starts. This orchestration has already begun.",
    );
  }

  const { data: existing } = await session.supabase
    .from("orchestration_tasks")
    .select("task_key")
    .eq("orchestration_id", record.orchestration_id)
    .like("task_key", "research-%");

  if ((existing ?? []).length > 0) {
    return fail("This orchestration already carries a research plan.");
  }

  const tasks = researchTaskPlan(record);
  if (tasks.length === 0) {
    return fail("The contract's budgets leave no room for a task.");
  }

  const { error } = await session.supabase.from("orchestration_tasks").insert(
    tasks.map((task, index) => ({
      orchestration_id: record.orchestration_id,
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
    })),
  );

  if (error) {
    console.error("planResearchTasksAction failed:", error.message);
    return fail(`We couldn't add that plan: ${error.message}`);
  }

  refreshMission(workspaceId, missionId);
  revalidatePath(`/workspace/${workspaceId}/orchestrations`);

  return succeed(
    `Added ${tasks.length} research tasks to the orchestration plan, within ${record.task_budget} tasks, ${record.agent_budget} agents and ${record.spend_ceiling_cents} cents.`,
  );
}

// ---------------------------------------------------------------------------
// The proposal becomes an ordinary Phase 35 record
// ---------------------------------------------------------------------------

export async function proposeResearchExperimentAction(
  _previous: ResearchState,
  formData: FormData,
): Promise<ResearchState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const workspaceId = readText(formData, "workspace_id");
  const missionId = readText(formData, "mission_id");
  if (!isUuid(workspaceId) || !isUuid(missionId)) return fail(NOT_AVAILABLE);
  if (!(await membershipRole(session, workspaceId))) return fail(NOT_AVAILABLE);

  const { data: mission } = await session.supabase
    .from("research_missions")
    .select("*")
    .eq("id", missionId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!mission) return fail(NOT_AVAILABLE);

  const record = mission as ResearchMission;
  if (record.proposed_experiment_id) {
    return fail("This mission already proposed an experiment. Open it from the brief.");
  }

  const [hypotheses, sources, findings] = await Promise.all([
    session.supabase.from("research_hypotheses").select("*").eq("mission_id", missionId),
    session.supabase.from("research_sources").select("*").eq("mission_id", missionId),
    session.supabase.from("research_findings").select("*").eq("mission_id", missionId),
  ]);

  const brief = buildResearchBrief({
    mission: record,
    hypotheses: (hypotheses.data ?? []) as ResearchHypothesis[],
    sources: (sources.data ?? []) as ResearchSource[],
    findings: (findings.data ?? []) as ResearchFinding[],
  });

  const proposal = brief.proposedExperiment;
  if (!proposal) {
    return fail("This brief has no next experiment to propose yet.");
  }

  const reviewAt = new Date();
  reviewAt.setUTCDate(reviewAt.getUTCDate() + 14);

  const summarisedEvidence = brief.findings
    .map(
      (finding) =>
        `${finding.label}: ${finding.claim} (${finding.supportedBy} supporting, ${finding.contradictedBy} contradicting)`,
    )
    .join(" ")
    .slice(0, 3900);

  const { data: created, error } = await session.supabase
    .from("experiments")
    .insert({
      workspace_id: workspaceId,
      created_by: session.user.id,
      question: proposal.question,
      hypothesis: proposal.hypothesis,
      target_users: proposal.target_users,
      evidence_available: summarisedEvidence || record.existing_evidence,
      assumptions: record.existing_evidence.slice(0, 4000),
      proposed_prototype: proposal.proposed_prototype,
      success_criteria: proposal.success_criteria.slice(0, 2000),
      failure_criteria: proposal.failure_criteria.slice(0, 2000),
      time_limit_minutes: proposal.time_limit_minutes,
      resource_limit: `Research mission spend ceiling: ${record.spend_ceiling_cents} cents.`,
      privacy_requirements:
        "Synthetic or consented data only. No participant is contacted by this system.",
      consent_requirements:
        "Any real participation uses the existing experiment consent flow and is approved by a person first.",
      stop_conditions: proposal.stop_conditions.slice(0, 2000) ||
        "Stop if a source cannot be verified or a participant withdraws.",
      high_stakes: false,
      review_at: reviewAt.toISOString().slice(0, 10),
      status: "draft",
    })
    .select("id")
    .single();

  if (error || !created) {
    console.error("proposeResearchExperimentAction failed:", error?.message);
    return fail(
      `We couldn't create the experiment record: ${error?.message ?? "unknown error"}`,
    );
  }

  const experimentId = created.id as string;
  const { error: linkError } = await session.supabase
    .from("research_missions")
    .update({ proposed_experiment_id: experimentId })
    .eq("id", missionId)
    .eq("workspace_id", workspaceId);

  if (linkError) {
    console.error("research experiment link failed:", linkError.message);
    return fail("The experiment was created but not linked to the mission.");
  }

  refreshMission(workspaceId, missionId);
  revalidatePath(`/workspace/${workspaceId}/experiments`);
  return succeed(
    "Experiment created as a normal draft record. It still needs its own review and consent before anyone takes part.",
  );
}
