import type { Session } from "@/lib/auth";
import { DataError } from "@/lib/data/goals";
import type {
  ReleaseCheckConfig,
  ReleaseCheckKind,
  ReleaseCheckStatus,
  ReleaseReview,
  ReleaseTestResult,
  DependencyChange,
  MigrationRequirement,
  RecoveryKind,
} from "@/lib/releases";
import type { AppChangeRequest, AppDeployment, AppErrorEvent } from "@/lib/types";

/** Phase 29 reads. Every read is owner-scoped; no release data is public. */

const LOAD_ERROR =
  "We couldn't load the release dashboard just now. Refresh the page to try again.";

export type AppRelease = {
  id: string;
  project_id: string;
  user_id: string;
  version: number;
  deployment_id: string | null;
  source_revision: string;
  source_digest: string;
  status: "review_ready" | "reviewed" | "superseded";
  changed_features: string[];
  test_results: ReleaseTestResult[];
  dependency_changes: DependencyChange[];
  migration_requirements: MigrationRequirement[];
  config_changes: string[];
  known_issues: string[];
  rollback_limitations: string[];
  review: ReleaseReview;
  review_generated_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ReleaseCheckRun = {
  id: string;
  release_id: string;
  config_id: string | null;
  project_id: string;
  user_id: string;
  name: string;
  kind: ReleaseCheckKind;
  status: ReleaseCheckStatus;
  observed: Record<string, unknown>;
  detail: string;
  synthetic: boolean;
  destructive: boolean;
  created_at: string;
};

export type ReleaseIncident = {
  id: string;
  project_id: string;
  release_id: string;
  deployment_id: string | null;
  check_run_id: string | null;
  user_id: string;
  title: string;
  trigger: string;
  severity: "low" | "medium" | "high" | "critical";
  status:
    | "evidence_collected"
    | "diagnosed"
    | "recovery_prepared"
    | "awaiting_approval"
    | "approved"
    | "resolved"
    | "dismissed";
  evidence: Record<string, unknown>[];
  diagnosis_hypothesis: string | null;
  diagnosis_support: string | null;
  root_cause: string | null;
  root_cause_confirmed: boolean;
  recovery_kind: RecoveryKind | null;
  recovery_plan: {
    steps?: string[];
    limitations?: string[];
    [key: string]: unknown;
  } | null;
  requested_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type IncidentEvent = {
  id: string;
  incident_id: string;
  kind: string;
  detail: string;
  created_at: string;
};

export type ReleaseAutomation = {
  project_id: string;
  auto_rollback_enabled: boolean;
  conditions: string[];
  limitations: string;
  updated_at: string;
};

export type ReleaseAutomationEvent = {
  id: string;
  kind: string;
  detail: string;
  created_at: string;
};

export type ReleaseProject = {
  id: string;
  name: string;
  current_version: number;
};

export type ReleaseDashboard = {
  project: ReleaseProject;
  releases: AppRelease[];
  configs: ReleaseCheckConfig[];
  runs: ReleaseCheckRun[];
  incidents: ReleaseIncident[];
  incidentEvents: IncidentEvent[];
  automation: ReleaseAutomation | null;
  automationEvents: ReleaseAutomationEvent[];
  errors: AppErrorEvent[];
  deployments: AppDeployment[];
  changes: AppChangeRequest[];
};

export async function getReleaseDashboard(
  session: Session,
  projectId: string,
): Promise<ReleaseDashboard | null> {
  const project = await session.supabase
    .from("app_projects")
    .select("id, name, current_version")
    .eq("id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (project.error) {
    console.error("getReleaseDashboard project failed:", project.error.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!project.data) return null;

  const [releases, configs, runs, incidents, incidentEvents, automation, automationEvents, errors, deployments, changes] =
    await Promise.all([
      session.supabase
        .from("app_releases")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", session.user.id)
        .order("version", { ascending: false }),
      session.supabase
        .from("app_release_check_configs")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: true }),
      session.supabase
        .from("app_release_check_runs")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(60),
      session.supabase
        .from("app_release_incidents")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(30),
      session.supabase
        .from("app_incident_events")
        .select("id, incident_id, kind, detail, created_at")
        .eq("project_id", projectId)
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: true })
        .limit(120),
      session.supabase
        .from("app_release_automation")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", session.user.id)
        .maybeSingle(),
      session.supabase
        .from("app_release_automation_events")
        .select("id, kind, detail, created_at")
        .eq("project_id", projectId)
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(30),
      session.supabase
        .from("app_error_events")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(30),
      session.supabase
        .from("app_deployments")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(20),
      session.supabase
        .from("app_change_requests")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(30),
    ]);

  for (const result of [
    releases,
    configs,
    runs,
    incidents,
    incidentEvents,
    automation,
    automationEvents,
    errors,
    deployments,
    changes,
  ]) {
    if (result.error) {
      console.error("getReleaseDashboard failed:", result.error.message);
      throw new DataError(LOAD_ERROR);
    }
  }

  return {
    project: project.data as ReleaseProject,
    releases: (releases.data ?? []) as AppRelease[],
    configs: (configs.data ?? []) as ReleaseCheckConfig[],
    runs: (runs.data ?? []) as ReleaseCheckRun[],
    incidents: (incidents.data ?? []) as ReleaseIncident[],
    incidentEvents: (incidentEvents.data ?? []) as IncidentEvent[],
    automation: (automation.data as ReleaseAutomation | null) ?? null,
    automationEvents: (automationEvents.data ?? []) as ReleaseAutomationEvent[],
    errors: (errors.data ?? []) as AppErrorEvent[],
    deployments: (deployments.data ?? []) as AppDeployment[],
    changes: (changes.data ?? []) as AppChangeRequest[],
  };
}
