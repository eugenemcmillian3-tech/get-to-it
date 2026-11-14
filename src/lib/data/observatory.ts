import type { Session } from "@/lib/auth";
import type { CapabilityRunRecord, CapabilityVersionRecord } from "@/lib/capability-eval";
import { DataError } from "@/lib/data/goals";
import {
  listImprovementCandidates,
  type ImprovementList,
} from "@/lib/data/improvement-candidates";
import {
  listPerformancePrograms,
  type PerformanceProgramSummary,
} from "@/lib/data/performance-program";
import { OBSERVATORY_LIMITS } from "@/lib/observatory";
import type { Workspace, WorkspaceRole } from "@/lib/types";

/**
 * Phase 42 reads. Nothing here writes. Every query is workspace-scoped (or
 * owner-scoped where the underlying table is owner-scoped), and the page adds
 * no cross-workspace view.
 */

const LOAD_ERROR =
  "We couldn't load the research observatory just now. Refresh the page to try again.";

export type ObservatoryExperiment = {
  id: string;
  question: string;
};

export type ObservatoryReview = {
  id: string;
  versionId: string;
  findings: string;
  limitations: string;
  reviewedAt: string;
};

export type ObservatoryEvaluation = {
  id: string;
  name: string;
  description: string;
  datasetVersion: string;
  linkedExperimentId: string;
  experimentQuestion: string;
  versions: CapabilityVersionRecord[];
  runs: CapabilityRunRecord[];
  reviews: ObservatoryReview[];
};

export type ObservatoryMission = {
  id: string;
  question: string;
  scope: string;
  status: "draft" | "ready" | "running" | "paused" | "complete" | "cancelled";
  checkpoints: string[];
  proposedExperimentId: string | null;
  createdAt: string;
};

export type ObservatoryHypothesis = {
  id: string;
  missionId: string;
  statement: string;
  role: "leading" | "competing";
  status: "open" | "supported" | "rejected" | "unresolved";
};

export type ObservatoryDeployment = {
  id: string;
  projectId: string;
  target: string;
  status: string;
  approvalAt: string | null;
  createdAt: string;
  deploymentUrl: string | null;
  sourceCommit: string | null;
};

export type ObservatoryIncident = {
  id: string;
  projectId: string;
  deploymentId: string | null;
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  status: string;
  recoveryKind: string | null;
  rootCauseConfirmed: boolean;
  approvedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

export type ObservatoryRelease = {
  id: string;
  projectId: string;
  version: number;
  status: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  deploymentId: string | null;
  createdAt: string;
};

export type ObservatoryData = {
  workspace: Workspace;
  myRole: WorkspaceRole;
  improvements: ImprovementList;
  programs: PerformanceProgramSummary[];
  evaluations: ObservatoryEvaluation[];
  missions: ObservatoryMission[];
  hypotheses: ObservatoryHypothesis[];
  deployments: ObservatoryDeployment[];
  incidents: ObservatoryIncident[];
  releases: ObservatoryRelease[];
};

type ExperimentRow = { id: string; question: string };
type EvalRow = {
  id: string;
  name: string;
  description: string;
  dataset_version: string;
  linked_experiment_id: string | null;
};
type RunRow = CapabilityRunRecord & Record<string, unknown>;

function fail(message: string): never {
  console.error("observatory read failed:", message);
  throw new DataError(LOAD_ERROR);
}

export async function getObservatory(
  session: Session,
  workspaceId: string,
): Promise<ObservatoryData | null> {
  const improvements = await listImprovementCandidates(session, workspaceId);
  if (!improvements) return null;

  const [experiments, missionsResult, programs] = await Promise.all([
    session.supabase
      .from("experiments")
      .select("id, question")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(50),
    session.supabase
      .from("research_missions")
      .select("id, question, scope, status, checkpoints, proposed_experiment_id, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(OBSERVATORY_LIMITS.maxMissions),
    listPerformancePrograms(session, workspaceId),
  ]);

  if (experiments.error) fail(experiments.error.message);
  if (missionsResult.error) fail(missionsResult.error.message);

  const experimentRows = (experiments.data ?? []) as ExperimentRow[];
  const experimentById = new Map(experimentRows.map((row) => [row.id, row]));
  const missions = ((missionsResult.data ?? []) as Array<{
    id: string;
    question: string;
    scope: string;
    status: ObservatoryMission["status"];
    checkpoints: string[];
    proposed_experiment_id: string | null;
    created_at: string;
  }>).map((row) => ({
    id: row.id,
    question: row.question,
    scope: row.scope,
    status: row.status,
    checkpoints: row.checkpoints,
    proposedExperimentId: row.proposed_experiment_id,
    createdAt: row.created_at,
  }));

  const [hypothesesResult, evaluationsResult] = await Promise.all([
    missions.length === 0
      ? { data: [], error: null }
      : session.supabase
          .from("research_hypotheses")
          .select("id, mission_id, statement, role, status")
          .eq("workspace_id", workspaceId)
          .in(
            "mission_id",
            missions.map((mission) => mission.id),
          )
          .limit(120),
    experimentRows.length === 0
      ? { data: [], error: null }
      : session.supabase
          .from("capability_evals")
          .select("id, name, description, dataset_version, linked_experiment_id")
          .eq("user_id", session.user.id)
          .in(
            "linked_experiment_id",
            experimentRows.map((row) => row.id),
          )
          .order("created_at", { ascending: false })
          .limit(OBSERVATORY_LIMITS.maxEvaluations),
  ]);

  if (hypothesesResult.error) fail(hypothesesResult.error.message);
  if (evaluationsResult.error) fail(evaluationsResult.error.message);

  const hypotheses = ((hypothesesResult.data ?? []) as Array<{
    id: string;
    mission_id: string;
    statement: string;
    role: "leading" | "competing";
    status: ObservatoryHypothesis["status"];
  }>).map((row) => ({
    id: row.id,
    missionId: row.mission_id,
    statement: row.statement,
    role: row.role,
    status: row.status,
  }));

  const evalRows = (evaluationsResult.data ?? []) as EvalRow[];
  const evalIds = evalRows.map((row) => row.id);

  const [versionsResult, runsResult, reviewsResult] = await Promise.all([
    evalIds.length === 0
      ? { data: [], error: null }
      : session.supabase
          .from("capability_eval_versions")
          .select("*")
          .eq("user_id", session.user.id)
          .in("eval_id", evalIds)
          .order("version", { ascending: true })
          .limit(OBSERVATORY_LIMITS.maxVersionsPerEvaluation * OBSERVATORY_LIMITS.maxEvaluations),
    evalIds.length === 0
      ? { data: [], error: null }
      : session.supabase
          .from("capability_eval_runs")
          .select("*")
          .eq("user_id", session.user.id)
          .in("eval_id", evalIds)
          .order("created_at", { ascending: false })
          .limit(OBSERVATORY_LIMITS.maxRunsPerEvaluation * OBSERVATORY_LIMITS.maxEvaluations),
    evalIds.length === 0
      ? { data: [], error: null }
      : session.supabase
          .from("capability_eval_reviews")
          .select("id, eval_id, version_id, findings, limitations, reviewed_at")
          .eq("requested_by", session.user.id)
          .eq("status", "completed")
          .in("eval_id", evalIds)
          .order("reviewed_at", { ascending: false })
          .limit(OBSERVATORY_LIMITS.maxEvaluations * OBSERVATORY_LIMITS.maxVersionsPerEvaluation),
  ]);

  if (reviewsResult.error) fail(reviewsResult.error.message);

  if (versionsResult.error) fail(versionsResult.error.message);
  if (runsResult.error) fail(runsResult.error.message);
  const reviewRows = ((reviewsResult.data ?? []) as Array<{
    id: string;
    eval_id: string;
    version_id: string;
    findings: string;
    limitations: string;
    reviewed_at: string;
  }>).map((row) => ({
    id: row.id,
    evalId: row.eval_id,
    versionId: row.version_id,
    findings: row.findings,
    limitations: row.limitations,
    reviewedAt: row.reviewed_at,
  }));

  const versions = (versionsResult.data ?? []) as CapabilityVersionRecord[];
  const runs = (runsResult.data ?? []) as RunRow[];

  const evaluations: ObservatoryEvaluation[] = evalRows
    .filter((row) => row.linked_experiment_id !== null)
    .map((row) => {
      const experiment = experimentById.get(row.linked_experiment_id!);
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        datasetVersion: row.dataset_version,
        linkedExperimentId: row.linked_experiment_id!,
        experimentQuestion: experiment?.question ?? "Experiment not readable",
        versions: versions.filter((version) => version.eval_id === row.id),
        runs: runs.filter((run) => run.eval_id === row.id),
        reviews: reviewRows
          .filter((review) => review.evalId === row.id)
          .map((review) => ({
            id: review.id,
            versionId: review.versionId,
            findings: review.findings,
            limitations: review.limitations,
            reviewedAt: review.reviewedAt,
          })),
      };
    });

  const projectIds = [
    ...new Set(
      [
        ...improvements.projects.map((project) => project.id),
        ...improvements.candidates
          .map((candidate) => candidate.project_id)
          .filter((id): id is string => Boolean(id)),
      ],
    ),
  ];

  const [deploymentsResult, incidentsResult, releasesResult] = await Promise.all([
    projectIds.length === 0
      ? { data: [], error: null }
      : session.supabase
          .from("app_deployments")
          .select(
            "id, project_id, target, status, approval_at, created_at, deployment_url, source_commit",
          )
          .eq("user_id", session.user.id)
          .in("project_id", projectIds)
          .order("created_at", { ascending: false })
          .limit(OBSERVATORY_LIMITS.maxDeployments),
    projectIds.length === 0
      ? { data: [], error: null }
      : session.supabase
          .from("app_release_incidents")
          .select(
            "id, project_id, deployment_id, title, severity, status, recovery_kind, root_cause_confirmed, approved_at, resolved_at, created_at",
          )
          .in("project_id", projectIds)
          .order("created_at", { ascending: false })
          .limit(OBSERVATORY_LIMITS.maxIncidents),
    projectIds.length === 0
      ? { data: [], error: null }
      : session.supabase
          .from("app_releases")
          .select("id, project_id, version, status, reviewed_at, reviewed_by, deployment_id, created_at")
          .eq("user_id", session.user.id)
          .in("project_id", projectIds)
          .order("created_at", { ascending: false })
          .limit(OBSERVATORY_LIMITS.maxReleases),
  ]);

  if (deploymentsResult.error) fail(deploymentsResult.error.message);
  if (incidentsResult.error) fail(incidentsResult.error.message);
  if (releasesResult.error) fail(releasesResult.error.message);

  return {
    workspace: improvements.workspace,
    myRole: improvements.myRole,
    improvements,
    programs: programs?.programs ?? [],
    evaluations,
    missions,
    hypotheses,
    deployments: ((deploymentsResult.data ?? []) as Array<{
      id: string;
      project_id: string;
      target: string;
      status: string;
      approval_at: string | null;
      created_at: string;
      deployment_url: string | null;
      source_commit: string | null;
    }>).map((row) => ({
      id: row.id,
      projectId: row.project_id,
      target: row.target,
      status: row.status,
      approvalAt: row.approval_at,
      createdAt: row.created_at,
      deploymentUrl: row.deployment_url,
      sourceCommit: row.source_commit,
    })),
    incidents: ((incidentsResult.data ?? []) as Array<{
      id: string;
      project_id: string;
      deployment_id: string | null;
      title: string;
      severity: ObservatoryIncident["severity"];
      status: string;
      recovery_kind: string | null;
      root_cause_confirmed: boolean;
      approved_at: string | null;
      resolved_at: string | null;
      created_at: string;
    }>).map((row) => ({
      id: row.id,
      projectId: row.project_id,
      deploymentId: row.deployment_id,
      title: row.title,
      severity: row.severity,
      status: row.status,
      recoveryKind: row.recovery_kind,
      rootCauseConfirmed: row.root_cause_confirmed,
      approvedAt: row.approved_at,
      resolvedAt: row.resolved_at,
      createdAt: row.created_at,
    })),
    releases: ((releasesResult.data ?? []) as Array<{
      id: string;
      project_id: string;
      version: number;
      status: string;
      reviewed_at: string | null;
      reviewed_by: string | null;
      deployment_id: string | null;
      created_at: string;
    }>).map((row) => ({
      id: row.id,
      projectId: row.project_id,
      version: row.version,
      status: row.status,
      reviewedAt: row.reviewed_at,
      reviewedBy: row.reviewed_by,
      deploymentId: row.deployment_id,
      createdAt: row.created_at,
    })),
  };
}
