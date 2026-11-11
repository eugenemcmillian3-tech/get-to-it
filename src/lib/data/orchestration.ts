import type { Session } from "@/lib/auth";
import { DataError } from "@/lib/data/goals";
import type {
  ContractContent,
  OrchestrationOrigin,
  OrchestrationStatus,
  TaskStatus,
} from "@/lib/orchestration";
import type { Workspace, WorkspaceMember, WorkspaceRole } from "@/lib/types";

const LOAD_ERROR =
  "We couldn't load orchestration just now. Refresh the page to try again.";

export type OrchestrationRecord = {
  id: string;
  workspace_id: string;
  created_by: string;
  origin_kind: OrchestrationOrigin;
  mission_id: string | null;
  experiment_id: string | null;
  learning_goal_id: string | null;
  radar_signal_id: string | null;
  future_path_id: string | null;
  outcome_review_id: string | null;
  prototype_project_id: string | null;
  goal: string;
  status: OrchestrationStatus;
  current_contract_id: string | null;
  approved_contract_id: string | null;
  authorized_micros: number;
  reserved_micros: number;
  consumed_micros: number;
  review_at: string;
  stop_condition_reached: boolean;
  created_at: string;
  updated_at: string;
};

export type ContractRow = {
  id: string;
  orchestration_id: string;
  workspace_id: string;
  version: number;
  content: ContractContent;
  fingerprint: string;
  max_credits: number;
  status: "draft" | "approved" | "superseded" | "rejected";
  approval_note: string;
  approved_by: string | null;
  approved_at: string | null;
  created_by: string;
  created_at: string;
};

export type TaskRow = {
  id: string;
  orchestration_id: string;
  workspace_id: string;
  task_key: string;
  position: number;
  title: string;
  purpose: string;
  capability: string;
  depends_on: string[];
  covers: string[];
  input_refs: string;
  expected_output: string;
  verification_method: string;
  credits_micros: number;
  permissions: string[];
  retry_limit: number;
  attempts: number;
  status: TaskStatus;
  external_action_kind: string | null;
  idempotency_key: string | null;
  last_error: string;
  settlement_micros: number;
  created_at: string;
  updated_at: string;
};

export type EvidenceRow = {
  id: string;
  orchestration_id: string;
  workspace_id: string;
  task_id: string | null;
  criterion_key: string | null;
  kind: string;
  source_ref: string;
  artifact_version: string;
  method: string;
  result: "pass" | "fail" | "inconclusive";
  limitations: string;
  verifier: string;
  observed_at: string;
  created_by: string;
  created_at: string;
};

export type CheckpointRow = {
  id: string;
  orchestration_id: string;
  workspace_id: string;
  kind: string;
  title: string;
  what_happened: string;
  evidence: string;
  decision: string;
  implication: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  requested_by: string | null;
  requested_by_kind: "human" | "agent";
  decided_by: string | null;
  decided_at: string | null;
  note: string;
  created_at: string;
};

export type EventRow = {
  id: string;
  orchestration_id: string;
  actor_id: string | null;
  kind: string;
  detail: string;
  created_at: string;
};

export type ReviewRow = {
  id: string;
  orchestration_id: string;
  decision: "undecided" | "accept" | "revise" | "new_contract" | "stop";
  built: string;
  verified: string;
  failed: string;
  unknown: string;
  deviations: string;
  next_steps: string;
  spent_micros: number;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
};

export type OrchestrationCandidate = {
  id: string;
  label: string;
  detail: string;
  origin: OrchestrationOrigin;
};

export type OrchestrationCandidates = {
  missions: OrchestrationCandidate[];
  experiments: OrchestrationCandidate[];
  learningGoals: OrchestrationCandidate[];
  radarSignals: OrchestrationCandidate[];
  futurePaths: OrchestrationCandidate[];
  outcomeReviews: OrchestrationCandidate[];
};

export type OrchestrationList = {
  workspace: Workspace;
  myRole: WorkspaceRole;
  members: WorkspaceMember[];
  orchestrations: OrchestrationRecord[];
  candidates: OrchestrationCandidates;
};

export type OrchestrationDetail = OrchestrationList & {
  orchestration: OrchestrationRecord;
  contracts: ContractRow[];
  tasks: TaskRow[];
  evidence: EvidenceRow[];
  checkpoints: CheckpointRow[];
  events: EventRow[];
  review: ReviewRow | null;
  currentContract: ContractRow | null;
  approvedContract: ContractRow | null;
  linked: { id: string; label: string; detail: string } | null;
  prototype: { id: string; label: string } | null;
};

async function membership(
  session: Session,
  workspaceId: string,
): Promise<{ workspace: Workspace; myRole: WorkspaceRole } | null> {
  const { data: workspace, error } = await session.supabase
    .from("workspaces")
    .select("id, name, description, created_by, created_at, updated_at")
    .eq("id", workspaceId)
    .maybeSingle();

  if (error) {
    console.error("orchestration workspace read failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!workspace) return null;

  const { data: member, error: memberError } = await session.supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", session.user.id)
    .eq("status", "active")
    .maybeSingle();

  if (memberError) {
    console.error("orchestration membership read failed:", memberError.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!member) return null;

  return {
    workspace: workspace as Workspace,
    myRole: (member as { role: WorkspaceRole }).role,
  };
}

async function membersFor(
  session: Session,
  workspaceId: string,
): Promise<WorkspaceMember[]> {
  const { data, error } = await session.supabase.rpc("workspace_member_directory", {
    p_workspace_id: workspaceId,
  });
  if (error) {
    console.error("orchestration member directory failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }
  return ((data ?? {}) as { members?: WorkspaceMember[] }).members ?? [];
}

async function candidatesFor(
  session: Session,
  workspaceId: string,
): Promise<OrchestrationCandidates> {
  const [missions, experiments, goals, plans, radar, paths, reviews] =
    await Promise.all([
      session.supabase
        .from("missions")
        .select("id, title, status")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(50),
      session.supabase
        .from("experiments")
        .select("id, question, status")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(50),
      session.supabase
        .from("goals")
        .select("id, title, archived_at")
        .eq("user_id", session.user.id)
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(50),
      session.supabase
        .from("learning_plans")
        .select("goal_id")
        .eq("user_id", session.user.id),
      session.supabase
        .from("radar_signals")
        .select("id, headline, topic")
        .eq("user_id", session.user.id)
        .order("published_on", { ascending: false })
        .limit(50),
      session.supabase
        .from("future_paths")
        .select("id, decision, chosen_kind")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(50),
      session.supabase
        .from("outcome_reviews")
        .select("id, title, status")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

  for (const result of [missions, experiments, goals, plans, radar, paths, reviews]) {
    if (result.error) {
      console.error("orchestration candidates failed:", result.error.message);
      throw new DataError(LOAD_ERROR);
    }
  }

  const learningGoalIds = new Set(
    ((plans.data ?? []) as { goal_id: string }[]).map((plan) => plan.goal_id),
  );

  return {
    missions: ((missions.data ?? []) as { id: string; title: string; status: string }[]).map(
      (mission) => ({
        id: mission.id,
        label: mission.title,
        detail: `Mission · ${mission.status}`,
        origin: "mission" as OrchestrationOrigin,
      }),
    ),
    experiments: ((experiments.data ?? []) as {
      id: string;
      question: string;
      status: string;
    }[]).map((experiment) => ({
      id: experiment.id,
      label: experiment.question,
      detail: `Experiment · ${experiment.status}`,
      origin: "experiment" as OrchestrationOrigin,
    })),
    learningGoals: ((goals.data ?? []) as { id: string; title: string }[])
      .filter((goal) => learningGoalIds.has(goal.id))
      .map((goal) => ({
        id: goal.id,
        label: goal.title,
        detail: "Goal with a learning plan",
        origin: "learning_goal" as OrchestrationOrigin,
      })),
    radarSignals: ((radar.data ?? []) as {
      id: string;
      headline: string;
      topic: string;
    }[]).map((signal) => ({
      id: signal.id,
      label: signal.headline,
      detail: `Opportunity radar · ${signal.topic}`,
      origin: "radar_signal" as OrchestrationOrigin,
    })),
    futurePaths: ((paths.data ?? []) as {
      id: string;
      decision: string;
      chosen_kind: string | null;
    }[]).map((path) => ({
      id: path.id,
      label: path.decision,
      detail: path.chosen_kind
        ? `Scenario chosen: ${path.chosen_kind}`
        : "Scenario · no choice recorded",
      origin: "future_path" as OrchestrationOrigin,
    })),
    outcomeReviews: ((reviews.data ?? []) as {
      id: string;
      title: string;
      status: string;
    }[]).map((review) => ({
      id: review.id,
      label: review.title,
      detail: `Outcome review · ${review.status}`,
      origin: "outcome_review" as OrchestrationOrigin,
    })),
  };
}

export async function listOrchestrations(
  session: Session,
  workspaceId: string,
): Promise<OrchestrationList | null> {
  const base = await membership(session, workspaceId);
  if (!base) return null;

  const [members, rows, candidates] = await Promise.all([
    membersFor(session, workspaceId),
    session.supabase
      .from("orchestrations")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false }),
    candidatesFor(session, workspaceId),
  ]);

  if (rows.error) {
    console.error("listOrchestrations failed:", rows.error.message);
    throw new DataError(LOAD_ERROR);
  }

  return {
    ...base,
    members,
    orchestrations: (rows.data ?? []) as OrchestrationRecord[],
    candidates,
  };
}

export async function getOrchestrationDetail(
  session: Session,
  workspaceId: string,
  orchestrationId: string,
): Promise<OrchestrationDetail | null> {
  const list = await listOrchestrations(session, workspaceId);
  if (!list) return null;

  const { data: orchestration, error } = await session.supabase
    .from("orchestrations")
    .select("*")
    .eq("id", orchestrationId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    console.error("getOrchestrationDetail failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!orchestration) return null;

  const [contracts, tasks, evidence, checkpoints, events, review] = await Promise.all([
    session.supabase
      .from("orchestration_contracts")
      .select("*")
      .eq("orchestration_id", orchestrationId)
      .eq("workspace_id", workspaceId)
      .order("version", { ascending: false }),
    session.supabase
      .from("orchestration_tasks")
      .select("*")
      .eq("orchestration_id", orchestrationId)
      .eq("workspace_id", workspaceId)
      .order("position", { ascending: true }),
    session.supabase
      .from("orchestration_evidence")
      .select("*")
      .eq("orchestration_id", orchestrationId)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true }),
    session.supabase
      .from("orchestration_checkpoints")
      .select("*")
      .eq("orchestration_id", orchestrationId)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false }),
    session.supabase
      .from("orchestration_events")
      .select("*")
      .eq("orchestration_id", orchestrationId)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(50),
    session.supabase
      .from("orchestration_reviews")
      .select("*")
      .eq("orchestration_id", orchestrationId)
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
  ]);

  for (const result of [contracts, tasks, evidence, checkpoints, events, review]) {
    if (result.error) {
      console.error("getOrchestrationDetail child failed:", result.error.message);
      throw new DataError(LOAD_ERROR);
    }
  }

  const row = orchestration as OrchestrationRecord;
  const contractRows = (contracts.data ?? []) as ContractRow[];
  const currentContract =
    contractRows.find((contract) => contract.id === row.current_contract_id) ?? null;

  const { data: project } = row.prototype_project_id
    ? await session.supabase
        .from("app_projects")
        .select("id, name")
        .eq("id", row.prototype_project_id)
        .maybeSingle()
    : { data: null };

  const allCandidates = [
    ...list.candidates.missions,
    ...list.candidates.experiments,
    ...list.candidates.learningGoals,
    ...list.candidates.radarSignals,
    ...list.candidates.futurePaths,
    ...list.candidates.outcomeReviews,
  ];
  const linkedId =
    row.mission_id ??
    row.experiment_id ??
    row.learning_goal_id ??
    row.radar_signal_id ??
    row.future_path_id ??
    row.outcome_review_id;
  const linked = linkedId
    ? (allCandidates.find((candidate) => candidate.id === linkedId) ?? null)
    : null;

  return {
    ...list,
    orchestration: row,
    contracts: contractRows,
    tasks: (tasks.data ?? []) as TaskRow[],
    evidence: (evidence.data ?? []) as EvidenceRow[],
    checkpoints: (checkpoints.data ?? []) as CheckpointRow[],
    events: (events.data ?? []) as EventRow[],
    review: (review.data as ReviewRow | null) ?? null,
    currentContract,
    approvedContract:
      contractRows.find((contract) => contract.id === row.approved_contract_id) ?? null,
    linked: linked
      ? { id: linked.id, label: linked.label, detail: linked.detail }
      : null,
    prototype: project
      ? { id: (project as { id: string }).id, label: (project as { name: string }).name }
      : null,
  };
}
