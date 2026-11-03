import type { Session } from "@/lib/auth";
import { DataError } from "@/lib/data/goals";
import type {
  Mission,
  MissionDecision,
  MissionEvidence,
  MissionOutcome,
  MissionReport,
  MissionSuggestion,
  MissionTask,
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
} from "@/lib/types";

/**
 * Mission reads.
 *
 * Every query is scoped to one workspace and relies on the row-level policies
 * from 0012: only an active member can read a workspace row, and 0018 repeats
 * that rule on every mission table. Names come from the workspace member
 * directory function; profiles stay private to their owner.
 */

const LOAD_ERROR =
  "We couldn't load that mission just now. Refresh the page to try again.";

export type MissionList = {
  workspace: Workspace;
  myRole: WorkspaceRole;
  missions: Mission[];
  members: WorkspaceMember[];
};

export async function listMissions(
  session: Session,
  workspaceId: string,
): Promise<MissionList | null> {
  const { data: workspace, error: workspaceError } = await session.supabase
    .from("workspaces")
    .select("id, name, description, created_by, created_at, updated_at")
    .eq("id", workspaceId)
    .maybeSingle();

  if (workspaceError) {
    console.error("listMissions workspace failed:", workspaceError.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!workspace) return null;

  const [membership, directory, missionsResult] = await Promise.all([
    session.supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", session.user.id)
      .eq("status", "active")
      .maybeSingle(),
    session.supabase.rpc("workspace_member_directory", {
      p_workspace_id: workspaceId,
    }),
    session.supabase
      .from("missions")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false }),
  ]);

  if (membership.error || directory.error || missionsResult.error) {
    console.error(
      "listMissions failed:",
      membership.error?.message ??
        directory.error?.message ??
        missionsResult.error?.message,
    );
    throw new DataError(LOAD_ERROR);
  }
  if (!membership.data) return null;

  return {
    workspace: workspace as Workspace,
    myRole: (membership.data as { role: WorkspaceRole }).role,
    missions: (missionsResult.data ?? []) as Mission[],
    members:
      ((directory.data ?? {}) as { members?: WorkspaceMember[] }).members ?? [],
  };
}

export type MissionDetail = MissionList & {
  mission: Mission;
  evidence: MissionEvidence[];
  decisions: MissionDecision[];
  tasks: MissionTask[];
  outcomes: MissionOutcome[];
  suggestions: MissionSuggestion[];
  reports: MissionReport[];
};

export async function getMissionDetail(
  session: Session,
  workspaceId: string,
  missionId: string,
): Promise<MissionDetail | null> {
  const list = await listMissions(session, workspaceId);
  if (!list) return null;

  const { data: mission, error } = await session.supabase
    .from("missions")
    .select("*")
    .eq("id", missionId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    console.error("getMissionDetail mission failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!mission) return null;

  const [evidence, decisions, tasks, outcomes, suggestions, reports] =
    await Promise.all([
      session.supabase
        .from("mission_evidence")
        .select("*")
        .eq("mission_id", missionId)
        .order("created_at", { ascending: true }),
      session.supabase
        .from("mission_decisions")
        .select("*")
        .eq("mission_id", missionId)
        .order("decided_at", { ascending: false }),
      session.supabase
        .from("mission_tasks")
        .select("*")
        .eq("mission_id", missionId)
        .order("created_at", { ascending: true }),
      session.supabase
        .from("mission_outcomes")
        .select("*")
        .eq("mission_id", missionId)
        .order("created_at", { ascending: true }),
      session.supabase
        .from("mission_suggestions")
        .select("*")
        .eq("mission_id", missionId)
        .order("created_at", { ascending: false }),
      session.supabase
        .from("mission_reports")
        .select("*")
        .eq("mission_id", missionId)
        .order("created_at", { ascending: false }),
    ]);

  for (const result of [evidence, decisions, tasks, outcomes, suggestions, reports]) {
    if (result.error) {
      console.error("getMissionDetail children failed:", result.error.message);
      throw new DataError(LOAD_ERROR);
    }
  }

  return {
    ...list,
    mission: mission as Mission,
    evidence: (evidence.data ?? []) as MissionEvidence[],
    decisions: (decisions.data ?? []) as MissionDecision[],
    tasks: (tasks.data ?? []) as MissionTask[],
    outcomes: (outcomes.data ?? []) as MissionOutcome[],
    suggestions: (suggestions.data ?? []) as MissionSuggestion[],
    reports: (reports.data ?? []) as MissionReport[],
  };
}
