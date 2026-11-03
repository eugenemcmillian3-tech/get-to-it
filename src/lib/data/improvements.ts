import type { Session } from "@/lib/auth";
import type {
  AppChangeEvaluation,
  AppChangeRequest,
  AppErrorEvent,
  AppObservabilitySettings,
  AppSkill,
  ProjectMemoryRecord,
} from "@/lib/types";
import { DataError } from "@/lib/data/goals";

const LOAD_ERROR =
  "We couldn't load the improvement workspace just now. Refresh the page to try again.";

export type ImprovementDetail = {
  memory: ProjectMemoryRecord[];
  changes: AppChangeRequest[];
  skills: AppSkill[];
  settings: AppObservabilitySettings | null;
  errors: AppErrorEvent[];
  evaluations: AppChangeEvaluation[];
  successfulDeployments: number;
};

export async function getImprovementDetail(
  session: Session,
  projectId: string,
): Promise<ImprovementDetail> {
  const [memory, changes, skills, settings, errors, evaluations, deployments] = await Promise.all([
    session.supabase.from("app_project_memory").select("*").eq("project_id", projectId).eq("user_id", session.user.id).order("kind").order("title"),
    session.supabase
      .from("app_change_requests")
      .select("id, project_id, user_id, kind, request, answers, status, automation_level, base_version, base_digest, inspection, questions, plan, diff, checks, preview_url, runner_key, error, merged_version, created_at, updated_at")
      .eq("project_id", projectId)
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(20),
    session.supabase.from("app_skills").select("*").eq("project_id", projectId).eq("user_id", session.user.id).order("created_at", { ascending: false }).limit(30),
    session.supabase.from("app_observability_settings").select("*").eq("project_id", projectId).eq("user_id", session.user.id).maybeSingle(),
    session.supabase.from("app_error_events").select("*").eq("project_id", projectId).eq("user_id", session.user.id).order("created_at", { ascending: false }).limit(20),
    session.supabase.from("app_change_evaluations").select("*").eq("project_id", projectId).eq("user_id", session.user.id),
    session.supabase.from("app_deployments").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("user_id", session.user.id).eq("status", "succeeded"),
  ]);

  for (const result of [memory, changes, skills, settings, errors, evaluations, deployments]) {
    if (result.error) {
      console.error("getImprovementDetail failed:", result.error.message);
      throw new DataError(LOAD_ERROR);
    }
  }

  return {
    memory: (memory.data ?? []) as ProjectMemoryRecord[],
    changes: (changes.data ?? []) as AppChangeRequest[],
    skills: (skills.data ?? []) as AppSkill[],
    settings: (settings.data as AppObservabilitySettings | null) ?? null,
    errors: (errors.data ?? []) as AppErrorEvent[],
    evaluations: (evaluations.data ?? []) as AppChangeEvaluation[],
    successfulDeployments: deployments.count ?? 0,
  };
}
