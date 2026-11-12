import type { Session } from "@/lib/auth";
import { DataError } from "@/lib/data/goals";
import type {
  CandidateKind,
  CandidateStatus,
  Verdict,
} from "@/lib/improvement-candidates";
import {
  promotionState,
  type PromotionLaterDeployment,
  type PromotionRollbackEvidence,
  type PromotionState,
} from "@/lib/promotion-state";
import type { Workspace, WorkspaceRole } from "@/lib/types";

const LOAD_ERROR =
  "We couldn't load the improvement workspace just now. Refresh the page to try again.";

export type ImprovementCandidate = {
  id: string;
  workspace_id: string;
  user_id: string;
  project_id: string | null;
  kind: CandidateKind;
  title: string;
  problem: string;
  evidence: string;
  proposed_change: string;
  expected_benefit: string;
  possible_regressions: string;
  affected_components: string[];
  evaluation_plan: string;
  cost_impact: string;
  security_implications: string;
  rollback_plan: string;
  sandbox_kind: "branch" | "sandbox";
  base_ref: string;
  candidate_ref: string;
  status: CandidateStatus;
  verdict: Verdict | null;
  integrity: "verified" | "mismatch" | null;
  security_findings: number;
  regressions: number;
  cost_delta_ratio: number;
  criteria_frozen_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_note: string | null;
  promotion_ref: string | null;
  deployment_id: string | null;
  promoted_at: string | null;
  created_at: string;
};

export type ImprovementEvaluation = {
  id: string;
  candidate_id: string;
  suite_name: string;
  suite_version: string;
  total_cases: number;
  baseline_passed: number;
  candidate_passed: number;
  security_findings: number;
  regressions: number;
  cost_delta_ratio: number;
  verdict: Verdict;
  created_at: string;
};

export type ImprovementEvent = {
  id: string;
  candidate_id: string;
  kind: string;
  detail: string;
  created_at: string;
};

export type ImprovementBlock = {
  id: string;
  attempted_action: string;
  reason: string;
  created_at: string;
};

export type DeploymentOption = {
  id: string;
  project_id: string;
  target: string;
  status: string;
  approval_at: string | null;
  created_at: string;
};

export type ProjectOption = { id: string; name: string };

export type ImprovementList = {
  workspace: Workspace;
  myRole: WorkspaceRole;
  projects: ProjectOption[];
  deployments: DeploymentOption[];
  candidates: ImprovementCandidate[];
  evaluations: ImprovementEvaluation[];
  events: ImprovementEvent[];
  blocks: ImprovementBlock[];
};

export async function listImprovementCandidates(
  session: Session,
  workspaceId: string,
): Promise<ImprovementList | null> {
  const { data: workspace, error } = await session.supabase
    .from("workspaces")
    .select("id, name, description, created_by, created_at, updated_at")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) {
    console.error("improvement workspace read failed:", error.message);
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
    console.error("improvement membership read failed:", memberError.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!member) return null;

  const [candidates, evaluations, events, blocks, projects, deployments] = await Promise.all([
    session.supabase
      .from("improvement_candidates")
      .select(
        "id, workspace_id, user_id, project_id, kind, title, problem, evidence, proposed_change, expected_benefit, possible_regressions, affected_components, evaluation_plan, cost_impact, security_implications, rollback_plan, sandbox_kind, base_ref, candidate_ref, status, verdict, integrity, security_findings, regressions, cost_delta_ratio, criteria_frozen_at, reviewed_at, reviewed_by, review_note, promotion_ref, deployment_id, promoted_at, created_at",
      )
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(40),
    session.supabase
      .from("improvement_candidate_evaluations")
      .select(
        "id, candidate_id, suite_name, suite_version, total_cases, baseline_passed, candidate_passed, security_findings, regressions, cost_delta_ratio, verdict, created_at",
      )
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(80),
    session.supabase
      .from("improvement_candidate_events")
      .select("id, candidate_id, kind, detail, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(120),
    session.supabase
      .from("improvement_boundary_blocks")
      .select("id, attempted_action, reason, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(20),
    session.supabase
      .from("app_projects")
      .select("id, name")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(20),
    session.supabase
      .from("app_deployments")
      .select("id, project_id, target, status, approval_at, created_at")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(40),
  ]);

  for (const result of [candidates, evaluations, events, blocks, projects, deployments]) {
    if (result.error) {
      console.error("improvement read failed:", result.error.message);
      throw new DataError(LOAD_ERROR);
    }
  }

  return {
    workspace: workspace as Workspace,
    myRole: (member as { role: WorkspaceRole }).role,
    projects: (projects.data ?? []) as ProjectOption[],
    deployments: (deployments.data ?? []) as DeploymentOption[],
    candidates: (candidates.data ?? []) as ImprovementCandidate[],
    evaluations: (evaluations.data ?? []) as ImprovementEvaluation[],
    events: (events.data ?? []) as ImprovementEvent[],
    blocks: (blocks.data ?? []) as ImprovementBlock[],
  };
}

export type PromotionAuditRow = {
  id: string;
  title: string;
  kind: CandidateKind;
  project_id: string | null;
  verdict: Verdict | null;
  promoted_at: string | null;
  promotion_ref: string | null;
  rollback_plan: string;
  review_note: string | null;
  approved_at: string | null;
  approved_by: string | null;
  approved_by_name: string | null;
  promotion_approved_by: string | null;
  promotion_approved_by_name: string | null;
  deployment: {
    id: string;
    target: string;
    status: string;
    approval_at: string | null;
    deployment_url: string | null;
    external_deployment_id: string | null;
    created_at: string;
  } | null;
  state: PromotionState;
};

export type PromotionAudit = {
  workspace: Workspace;
  myRole: WorkspaceRole;
  rows: PromotionAuditRow[];
};

/**
 * One place to answer "what did we promote, through which deployment, on whose
 * decision, and how would we undo it".
 */
export async function listPromotionAudit(
  session: Session,
  workspaceId: string,
): Promise<PromotionAudit | null> {
  const { data: workspace, error } = await session.supabase
    .from("workspaces")
    .select("id, name, description, created_by, created_at, updated_at")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) {
    console.error("promotion audit workspace read failed:", error.message);
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
    console.error("promotion audit membership read failed:", memberError.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!member) return null;

  const { data: promoted, error: promotedError } = await session.supabase
    .from("improvement_candidates")
    .select(
      "id, title, kind, project_id, verdict, promoted_at, promotion_ref, rollback_plan, review_note, reviewed_at, reviewed_by, promotion_approved_by, deployment_id",
    )
    .eq("workspace_id", workspaceId)
    .eq("status", "promoted")
    .order("promoted_at", { ascending: false })
    .limit(100);
  if (promotedError) {
    console.error("promotion audit read failed:", promotedError.message);
    throw new DataError(LOAD_ERROR);
  }

  const rows = (promoted ?? []) as {
    id: string;
    title: string;
    kind: CandidateKind;
    project_id: string | null;
    verdict: Verdict | null;
    promoted_at: string | null;
    promotion_ref: string | null;
    rollback_plan: string;
    review_note: string | null;
    reviewed_at: string | null;
    reviewed_by: string | null;
    promotion_approved_by: string | null;
    deployment_id: string | null;
  }[];

  // Profiles and deployments are private to their owner, so names and liveness
  // come from workspace-scoped reads; a member who did not deploy still sees
  // whether the change is live.
  const [liveness, directory] = await Promise.all([
    session.supabase.rpc("improvement_promotion_liveness", { p_workspace_id: workspaceId }),
    session.supabase.rpc("workspace_member_directory", { p_workspace_id: workspaceId }),
  ]);

  if (liveness.error || directory.error) {
    console.error(
      "promotion audit detail read failed:",
      liveness.error?.message ?? directory.error?.message,
    );
    throw new DataError(LOAD_ERROR);
  }

  type LivenessRow = {
    candidate_id: string;
    deployment_id: string;
    target: string;
    status: string;
    approval_at: string | null;
    deployment_url: string | null;
    external_deployment_id: string | null;
    created_at: string;
    rollback_title: string | null;
    rollback_kind: string | null;
    rollback_resolved_at: string | null;
    later_target: string | null;
    later_created_at: string | null;
  };
  const evidenceRows =
    ((liveness.data ?? {}) as { deployments?: LivenessRow[] }).deployments ?? [];
  const evidenceById = new Map(evidenceRows.map((row) => [row.candidate_id, row]));

  const members =
    ((directory.data ?? {}) as { members?: { user_id: string; display_name: string | null }[] })
      .members ?? [];
  const nameById = new Map(members.map((row) => [row.user_id, row.display_name]));

  return {
    workspace: workspace as Workspace,
    myRole: (member as { role: WorkspaceRole }).role,
    rows: rows.map((row) => {
      const evidence = evidenceById.get(row.id) ?? null;
      const rollback: PromotionRollbackEvidence | null =
        evidence && evidence.rollback_kind && evidence.rollback_title
          ? {
              title: evidence.rollback_title,
              recovery_kind:
                evidence.rollback_kind === "code_rollback" ? "code_rollback" : "config_rollback",
              resolved_at: evidence.rollback_resolved_at,
            }
          : null;
      const laterDeployment: PromotionLaterDeployment | null =
        evidence && evidence.later_created_at && evidence.later_target
          ? {
              id: `${evidence.deployment_id}-later`,
              target: evidence.later_target,
              created_at: evidence.later_created_at,
            }
          : null;
      return {
        id: row.id,
        title: row.title,
        kind: row.kind,
        project_id: row.project_id,
        verdict: row.verdict,
        promoted_at: row.promoted_at,
        promotion_ref: row.promotion_ref,
        rollback_plan: row.rollback_plan,
        review_note: row.review_note,
        approved_at: row.reviewed_at,
        approved_by: row.reviewed_by,
        approved_by_name: row.reviewed_by ? (nameById.get(row.reviewed_by) ?? null) : null,
        promotion_approved_by: row.promotion_approved_by,
        promotion_approved_by_name: row.promotion_approved_by
          ? (nameById.get(row.promotion_approved_by) ?? null)
          : null,
        deployment: evidence
          ? {
              id: evidence.deployment_id,
              target: evidence.target,
              status: evidence.status,
              approval_at: evidence.approval_at,
              deployment_url: evidence.deployment_url,
              external_deployment_id: evidence.external_deployment_id,
              created_at: evidence.created_at,
            }
          : null,
        state: promotionState({
          deployment: evidence
            ? {
                id: evidence.deployment_id,
                target: evidence.target,
                status: evidence.status,
                created_at: evidence.created_at,
              }
            : null,
          rollback,
          laterDeployment,
        }),
      };
    }),
  };
}
