import type { Session } from "@/lib/auth";
import { DataError } from "@/lib/data/goals";
import type {
  CandidateKind,
  CandidateStatus,
  Verdict,
} from "@/lib/improvement-candidates";
import type { Workspace, WorkspaceRole } from "@/lib/types";

const LOAD_ERROR =
  "We couldn't load the improvement workspace just now. Refresh the page to try again.";

export type ImprovementCandidate = {
  id: string;
  workspace_id: string;
  user_id: string;
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

export type ImprovementList = {
  workspace: Workspace;
  myRole: WorkspaceRole;
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

  const [candidates, evaluations, events, blocks] = await Promise.all([
    session.supabase
      .from("improvement_candidates")
      .select(
        "id, workspace_id, user_id, kind, title, problem, evidence, proposed_change, expected_benefit, possible_regressions, affected_components, evaluation_plan, cost_impact, security_implications, rollback_plan, sandbox_kind, base_ref, candidate_ref, status, verdict, integrity, security_findings, regressions, cost_delta_ratio, criteria_frozen_at, reviewed_at, reviewed_by, review_note, promotion_ref, promoted_at, created_at",
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
  ]);

  for (const result of [candidates, evaluations, events, blocks]) {
    if (result.error) {
      console.error("improvement read failed:", result.error.message);
      throw new DataError(LOAD_ERROR);
    }
  }

  return {
    workspace: workspace as Workspace,
    myRole: (member as { role: WorkspaceRole }).role,
    candidates: (candidates.data ?? []) as ImprovementCandidate[],
    evaluations: (evaluations.data ?? []) as ImprovementEvaluation[],
    events: (events.data ?? []) as ImprovementEvent[],
    blocks: (blocks.data ?? []) as ImprovementBlock[],
  };
}
