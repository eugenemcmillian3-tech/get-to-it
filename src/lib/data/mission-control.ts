import type { Session } from "@/lib/auth";
import { DataError } from "@/lib/data/goals";
import { listMissions, type MissionList } from "@/lib/data/missions";
import type {
  MissionAgentJob,
  MissionApproval,
  MissionJobDependency,
  MissionMilestone,
  MissionMilestoneDependency,
  MissionProjectLink,
} from "@/lib/mission-control";
import type { Mission, MissionDecision } from "@/lib/types";

const LOAD_ERROR =
  "We couldn't load mission control just now. Refresh the page to try again.";

export type MissionControlProjectSummary = {
  id: string;
  name: string;
  status: string;
  current_version: number;
};

export type MissionControlTask = {
  id: string;
  project_id: string;
  title: string;
  status: string;
  assignee_kind: "human" | "agent";
  agent_role: string | null;
};

export type MissionControlDetail = MissionList & {
  mission: Mission;
  projects: MissionProjectLink[];
  projectSummaries: MissionControlProjectSummary[];
  availableProjects: MissionControlProjectSummary[];
  milestones: MissionMilestone[];
  milestoneDependencies: MissionMilestoneDependency[];
  jobs: MissionAgentJob[];
  jobDependencies: MissionJobDependency[];
  approvals: MissionApproval[];
  events: {
    id: string;
    mission_id: string;
    workspace_id: string;
    actor_id: string | null;
    kind: string;
    detail: string;
    created_at: string;
  }[];
  decisions: MissionDecision[];
  projectTasks: MissionControlTask[];
};

/**
 * Phase 34 reads. Workspace membership is checked by the existing mission read
 * and repeated by RLS on every mission-control table. Project rows stay behind
 * app-project RLS, so a mission member without project access sees only the
 * explicit link label, not project internals.
 */
export async function getMissionControl(
  session: Session,
  workspaceId: string,
  missionId: string,
): Promise<MissionControlDetail | null> {
  const list = await listMissions(session, workspaceId);
  if (!list) return null;

  const { data: mission, error } = await session.supabase
    .from("missions")
    .select("*")
    .eq("id", missionId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    console.error("getMissionControl mission failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!mission) return null;

  // Recovery is a manager action. It only pauses stale running jobs and never
  // deletes a saved output.
  if (list.myRole === "owner" || list.myRole === "admin") {
    const recovered = await session.supabase.rpc("mission_control_recover", {
      p_mission_id: missionId,
    });
    if (recovered.error) {
      console.error("getMissionControl recover failed:", recovered.error.message);
    }
  }

  const [
    projects,
    milestones,
    milestoneDependencies,
    jobs,
    jobDependencies,
    approvals,
    events,
    decisions,
    ownedProjects,
    tasks,
  ] = await Promise.all([
    session.supabase
      .from("mission_projects")
      .select("*")
      .eq("mission_id", missionId)
      .order("created_at", { ascending: true }),
    session.supabase
      .from("mission_milestones")
      .select("*")
      .eq("mission_id", missionId)
      .order("position", { ascending: true }),
    session.supabase
      .from("mission_milestone_dependencies")
      .select("*")
      .eq("mission_id", missionId)
      .order("created_at", { ascending: true }),
    session.supabase
      .from("mission_agent_jobs")
      .select("*")
      .eq("mission_id", missionId)
      .order("created_at", { ascending: true }),
    session.supabase
      .from("mission_job_dependencies")
      .select("*")
      .eq("mission_id", missionId)
      .order("created_at", { ascending: true }),
    session.supabase
      .from("mission_approvals")
      .select("*")
      .eq("mission_id", missionId)
      .order("created_at", { ascending: false }),
    session.supabase
      .from("mission_events")
      .select("*")
      .eq("mission_id", missionId)
      .order("created_at", { ascending: false })
      .limit(50),
    session.supabase
      .from("mission_decisions")
      .select("*")
      .eq("mission_id", missionId)
      .order("decided_at", { ascending: false }),
    session.supabase
      .from("app_projects")
      .select("id, name, status, current_version")
      .order("updated_at", { ascending: false }),
    session.supabase
      .from("app_build_tasks")
      .select("id, project_id, title, status, assignee_kind, agent_role")
      .order("created_at", { ascending: false }),
  ]);

  for (const result of [
    projects,
    milestones,
    milestoneDependencies,
    jobs,
    jobDependencies,
    approvals,
    events,
    decisions,
    ownedProjects,
    tasks,
  ]) {
    if (result.error) {
      console.error("getMissionControl child failed:", result.error.message);
      throw new DataError(LOAD_ERROR);
    }
  }

  const linked = (projects.data ?? []) as MissionProjectLink[];
  const owned = (ownedProjects.data ?? []) as MissionControlProjectSummary[];
  const linkedIds = new Set(linked.map((project) => project.project_id));

  return {
    ...list,
    mission: mission as Mission,
    projects: linked,
    projectSummaries: owned.filter((project) => linkedIds.has(project.id)),
    availableProjects: owned.filter((project) => !linkedIds.has(project.id)),
    milestones: (milestones.data ?? []) as MissionMilestone[],
    milestoneDependencies: (milestoneDependencies.data ?? []) as MissionMilestoneDependency[],
    jobs: (jobs.data ?? []) as MissionAgentJob[],
    jobDependencies: (jobDependencies.data ?? []) as MissionJobDependency[],
    approvals: (approvals.data ?? []) as MissionApproval[],
    events: (events.data ?? []) as MissionControlDetail["events"],
    decisions: (decisions.data ?? []) as MissionDecision[],
    projectTasks: ((tasks.data ?? []) as MissionControlTask[]).filter((task) =>
      linkedIds.has(task.project_id),
    ),
  };
}
