import type { Session } from "@/lib/auth";
import { DataError } from "@/lib/data/goals";
import {
  buildResearchBrief,
  type ResearchBrief,
  type ResearchFinding,
  type ResearchHypothesis,
  type ResearchMission,
  type ResearchSource,
} from "@/lib/research-missions";
import type { Workspace, WorkspaceRole } from "@/lib/types";

const LOAD_ERROR =
  "We couldn't load the research workspace just now. Refresh the page to try again.";

export type ResearchOrchestrationOption = {
  id: string;
  goal: string;
  status: string;
};

export type ResearchList = {
  workspace: Workspace;
  myRole: WorkspaceRole;
  missions: ResearchMission[];
  orchestrations: ResearchOrchestrationOption[];
};

export type ResearchDetail = ResearchList & {
  mission: ResearchMission;
  hypotheses: ResearchHypothesis[];
  sources: ResearchSource[];
  findings: ResearchFinding[];
  brief: ResearchBrief;
  orchestration: ResearchOrchestrationOption | null;
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
    console.error("research workspace read failed:", error.message);
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
    console.error("research membership read failed:", memberError.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!member) return null;

  return {
    workspace: workspace as Workspace,
    myRole: (member as { role: WorkspaceRole }).role,
  };
}

async function orchestrationOptions(
  session: Session,
  workspaceId: string,
): Promise<ResearchOrchestrationOption[]> {
  const { data, error } = await session.supabase
    .from("orchestrations")
    .select("id, goal, status")
    .eq("workspace_id", workspaceId)
    .eq("created_by", session.user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("research orchestration read failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }
  return (data ?? []) as ResearchOrchestrationOption[];
}

export async function listResearchMissions(
  session: Session,
  workspaceId: string,
): Promise<ResearchList | null> {
  const scope = await membership(session, workspaceId);
  if (!scope) return null;

  const [missions, orchestrations] = await Promise.all([
    session.supabase
      .from("research_missions")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(50),
    orchestrationOptions(session, workspaceId),
  ]);

  if (missions.error) {
    console.error("research mission list failed:", missions.error.message);
    throw new DataError(LOAD_ERROR);
  }

  return {
    ...scope,
    missions: (missions.data ?? []) as ResearchMission[],
    orchestrations,
  };
}

export async function getResearchMission(
  session: Session,
  workspaceId: string,
  missionId: string,
): Promise<ResearchDetail | null> {
  const scope = await membership(session, workspaceId);
  if (!scope) return null;

  const { data: mission, error } = await session.supabase
    .from("research_missions")
    .select("*")
    .eq("id", missionId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    console.error("research mission read failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!mission) return null;

  const [hypotheses, sources, findings, orchestrations] = await Promise.all([
    session.supabase
      .from("research_hypotheses")
      .select("*")
      .eq("mission_id", missionId)
      .order("created_at"),
    session.supabase
      .from("research_sources")
      .select("*")
      .eq("mission_id", missionId)
      .order("created_at"),
    session.supabase
      .from("research_findings")
      .select("*")
      .eq("mission_id", missionId)
      .order("created_at"),
    orchestrationOptions(session, workspaceId),
  ]);

  if (hypotheses.error || sources.error || findings.error) {
    console.error(
      "research evidence read failed:",
      hypotheses.error?.message ?? sources.error?.message ?? findings.error?.message,
    );
    throw new DataError(LOAD_ERROR);
  }

  const record = mission as ResearchMission;
  const typedSources = (sources.data ?? []) as ResearchSource[];
  const typedHypotheses = (hypotheses.data ?? []) as ResearchHypothesis[];
  const typedFindings = (findings.data ?? []) as ResearchFinding[];

  return {
    ...scope,
    missions: [],
    orchestrations: orchestrations,
    mission: record,
    hypotheses: typedHypotheses,
    sources: typedSources,
    findings: typedFindings,
    brief: buildResearchBrief({
      mission: record,
      hypotheses: typedHypotheses,
      sources: typedSources,
      findings: typedFindings,
    }),
    orchestration:
      orchestrations.find((entry) => entry.id === record.orchestration_id) ?? null,
  };
}
