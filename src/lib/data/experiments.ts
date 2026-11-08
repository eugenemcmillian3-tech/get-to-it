import type { Session } from "@/lib/auth";
import { DataError } from "@/lib/data/goals";
import type {
  Experiment,
  ExperimentApproval,
  ExperimentEvent,
  ExperimentFeedback,
  ExperimentObservation,
  ExperimentReview,
} from "@/lib/experiments";
import type { Workspace, WorkspaceMember, WorkspaceRole } from "@/lib/types";

const LOAD_ERROR =
  "We couldn't load the experiment workspace just now. Refresh the page to try again.";

export type ExperimentCandidate = {
  id: string;
  label: string;
  detail: string;
};

export type ExperimentCandidates = {
  missions: ExperimentCandidate[];
  futurePaths: ExperimentCandidate[];
  radarSignals: ExperimentCandidate[];
  learningGoals: ExperimentCandidate[];
  outcomeReviews: ExperimentCandidate[];
  projects: ExperimentCandidate[];
};

export type ExperimentList = {
  workspace: Workspace;
  myRole: WorkspaceRole;
  members: WorkspaceMember[];
  experiments: Experiment[];
  candidates: ExperimentCandidates;
};

export type ExperimentDetail = ExperimentList & {
  experiment: Experiment;
  observations: ExperimentObservation[];
  feedback: ExperimentFeedback[];
  approvals: ExperimentApproval[];
  review: ExperimentReview | null;
  events: ExperimentEvent[];
  linked: {
    mission: ExperimentCandidate | null;
    futurePath: ExperimentCandidate | null;
    radarSignal: ExperimentCandidate | null;
    learningGoal: ExperimentCandidate | null;
    outcomeReview: ExperimentCandidate | null;
    project: ExperimentCandidate | null;
  };
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
    console.error("experiment workspace read failed:", error.message);
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
    console.error("experiment membership read failed:", memberError.message);
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
    console.error("experiment member directory failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }
  return ((data ?? {}) as { members?: WorkspaceMember[] }).members ?? [];
}

async function candidatesFor(
  session: Session,
  workspaceId: string,
): Promise<ExperimentCandidates> {
  const [
    missions,
    futurePaths,
    radarSignals,
    goals,
    learningPlans,
    outcomeReviews,
    projects,
  ] = await Promise.all([
    session.supabase
      .from("missions")
      .select("id, title, status")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(50),
    session.supabase
      .from("future_paths")
      .select("id, decision, chosen_kind, review_at")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(50),
    session.supabase
      .from("radar_signals")
      .select("id, headline, topic, published_on")
      .eq("user_id", session.user.id)
      .order("published_on", { ascending: false })
      .limit(50),
    session.supabase
      .from("goals")
      .select("id, title, desired_outcome, archived_at")
      .eq("user_id", session.user.id)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(50),
    session.supabase
      .from("learning_plans")
      .select("goal_id, what_to_learn")
      .eq("user_id", session.user.id),
    session.supabase
      .from("outcome_reviews")
      .select("id, title, status, review_at")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(50),
    session.supabase
      .from("app_projects")
      .select("id, name, status")
      .eq("user_id", session.user.id)
      .order("updated_at", { ascending: false })
      .limit(50),
  ]);

  for (const result of [
    missions,
    futurePaths,
    radarSignals,
    goals,
    learningPlans,
    outcomeReviews,
    projects,
  ]) {
    if (result.error) {
      console.error("experiment candidates failed:", result.error.message);
      throw new DataError(LOAD_ERROR);
    }
  }

  const learningGoalIds = new Set(
    ((learningPlans.data ?? []) as { goal_id: string }[]).map((plan) => plan.goal_id),
  );

  return {
    missions: ((missions.data ?? []) as {
      id: string;
      title: string;
      status: string;
    }[]).map((mission) => ({
      id: mission.id,
      label: mission.title,
      detail: `Mission · ${mission.status}`,
    })),
    futurePaths: ((futurePaths.data ?? []) as {
      id: string;
      decision: string;
      chosen_kind: string | null;
      review_at: string | null;
    }[]).map((path) => ({
      id: path.id,
      label: path.decision,
      detail: path.chosen_kind
        ? `Scenario chosen: ${path.chosen_kind}`
        : "No scenario chosen",
    })),
    radarSignals: ((radarSignals.data ?? []) as {
      id: string;
      headline: string;
      topic: string;
      published_on: string;
    }[]).map((signal) => ({
      id: signal.id,
      label: signal.headline,
      detail: `${signal.topic} · published ${signal.published_on}`,
    })),
    learningGoals: ((goals.data ?? []) as {
      id: string;
      title: string;
      desired_outcome: string;
    }[])
      .filter((goal) => learningGoalIds.has(goal.id))
      .map((goal) => ({
        id: goal.id,
        label: goal.title,
        detail: "Goal with a learning plan",
      })),
    outcomeReviews: ((outcomeReviews.data ?? []) as {
      id: string;
      title: string;
      status: string;
      review_at: string | null;
    }[]).map((review) => ({
      id: review.id,
      label: review.title,
      detail: `${review.status}${review.review_at ? ` · review ${review.review_at}` : ""}`,
    })),
    projects: ((projects.data ?? []) as {
      id: string;
      name: string;
      status: string;
    }[]).map((project) => ({
      id: project.id,
      label: project.name,
      detail: `App project · ${project.status}`,
    })),
  };
}

export async function listExperiments(
  session: Session,
  workspaceId: string,
): Promise<ExperimentList | null> {
  const base = await membership(session, workspaceId);
  if (!base) return null;

  const [members, experiments, candidates] = await Promise.all([
    membersFor(session, workspaceId),
    session.supabase
      .from("experiments")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false }),
    candidatesFor(session, workspaceId),
  ]);

  if (experiments.error) {
    console.error("listExperiments failed:", experiments.error.message);
    throw new DataError(LOAD_ERROR);
  }

  return {
    ...base,
    members,
    experiments: (experiments.data ?? []) as Experiment[],
    candidates,
  };
}

export async function getExperimentDetail(
  session: Session,
  workspaceId: string,
  experimentId: string,
): Promise<ExperimentDetail | null> {
  const list = await listExperiments(session, workspaceId);
  if (!list) return null;

  const { data: experiment, error } = await session.supabase
    .from("experiments")
    .select("*")
    .eq("id", experimentId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    console.error("getExperimentDetail failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!experiment) return null;

  const [observations, feedback, approvals, review, events] = await Promise.all([
    session.supabase
      .from("experiment_observations")
      .select("*")
      .eq("experiment_id", experimentId)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true }),
    session.supabase
      .from("experiment_feedback")
      .select("*")
      .eq("experiment_id", experimentId)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true }),
    session.supabase
      .from("experiment_approvals")
      .select("*")
      .eq("experiment_id", experimentId)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false }),
    session.supabase
      .from("experiment_reviews")
      .select("*")
      .eq("experiment_id", experimentId)
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    session.supabase
      .from("experiment_events")
      .select("*")
      .eq("experiment_id", experimentId)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  for (const result of [observations, feedback, approvals, review, events]) {
    if (result.error) {
      console.error("getExperimentDetail child failed:", result.error.message);
      throw new DataError(LOAD_ERROR);
    }
  }

  const row = experiment as Experiment;
  const byId = (items: ExperimentCandidate[], id: string | null) =>
    id ? (items.find((item) => item.id === id) ?? null) : null;

  return {
    ...list,
    experiment: row,
    observations: (observations.data ?? []) as ExperimentObservation[],
    feedback: (feedback.data ?? []) as ExperimentFeedback[],
    approvals: (approvals.data ?? []) as ExperimentApproval[],
    review: (review.data as ExperimentReview | null) ?? null,
    events: (events.data ?? []) as ExperimentEvent[],
    linked: {
      mission: byId(list.candidates.missions, row.mission_id),
      futurePath: byId(list.candidates.futurePaths, row.future_path_id),
      radarSignal: byId(list.candidates.radarSignals, row.radar_signal_id),
      learningGoal: byId(list.candidates.learningGoals, row.learning_goal_id),
      outcomeReview: byId(list.candidates.outcomeReviews, row.outcome_review_id),
      project: byId(list.candidates.projects, row.prototype_project_id),
    },
  };
}
