import type { Session } from "@/lib/auth";
import { DataError } from "@/lib/data/goals";
import type {
  ExperimentOutcome,
  ExperimentPlan,
  ModelDeployment,
  ModelFile,
  ModelIntegration,
  ModelSpec,
  ProjectModel,
  ProjectModelInput,
  ScenarioAnalysis,
} from "@/lib/project-model";
import type { ModelSource } from "@/lib/project-model-source";
import type {
  AppDeployment,
  AppFile,
  AppIntegration,
  AppProject,
  AppSpecRecord,
} from "@/lib/types";

/**
 * Phase 33 reads. Every query is owner-scoped here and by RLS. The safe
 * integration columns are used so sealed credentials never leave the server.
 */

const LOAD_ERROR =
  "We couldn't load the project model just now. Refresh the page to try again.";

const INTEGRATION_COLUMNS =
  "id, project_id, user_id, kind, name, status, config, allowed_operations, mapping, last_tested_at, last_test_status, last_test_note, connected_at, disconnected_at, created_at, updated_at";

const DEPLOYMENT_COLUMNS =
  "id, project_id, user_id, target, snapshot_version, snapshot_digest, plan, plan_hash, status, checks, approval_at, source_commit, external_deployment_id, deployment_url, migration_state, error, partial_failure, created_at, updated_at";

export type ProjectModelRecord = {
  id: string;
  project_id: string;
  user_id: string;
  version: number;
  status: "current" | "superseded";
  spec_version: number;
  app_version: number;
  source_digest: string;
  source_revision: ModelSource;
  model: ProjectModel;
  assumptions: string[];
  missing_information: string[];
  created_at: string;
};

export type ChangeScenarioRecord = {
  id: string;
  project_id: string;
  model_id: string;
  user_id: string;
  kind: "api_change" | "new_user_role" | "background_job" | "database_field";
  question: string;
  target: string;
  basis: "static_model";
  analysis: ScenarioAnalysis;
  created_at: string;
};

export type ChangeExperimentRecord = {
  id: string;
  project_id: string;
  scenario_id: string;
  model_id: string;
  user_id: string;
  kind: "contract_check" | "synthetic_requests" | "resource_observation" | "failure_injection";
  status: "proposed" | "approved" | "running" | "passed" | "failed" | "blocked" | "canceled";
  target: string;
  data_handling: "source_code_only";
  requested_requests: number;
  max_duration_ms: number;
  plan: ExperimentPlan;
  observations: ExperimentOutcome["observations"];
  note: string;
  approved_at: string | null;
  approved_by: string | null;
  executed_at: string | null;
  duration_ms: number | null;
  task_title: string;
  task_description: string;
  scope_paths: string[];
  task_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ProjectBuildTaskRecord = {
  id: string;
  title: string;
  status: string;
  scope_paths: string[];
  created_at: string;
};

export type ProjectModelWorkspace = {
  project: AppProject;
  specs: AppSpecRecord[];
  files: AppFile[];
  integrations: AppIntegration[];
  deployments: AppDeployment[];
  models: ProjectModelRecord[];
  scenarios: ChangeScenarioRecord[];
  experiments: ChangeExperimentRecord[];
  tasks: ProjectBuildTaskRecord[];
};

export function modelFiles(files: AppFile[]): ModelFile[] {
  return files.map((file) => ({ path: file.path, content: file.content }));
}

export function modelInputForWorkspace(workspace: ProjectModelWorkspace): ProjectModelInput {
  const specRecord =
    workspace.specs.find((record) => record.approved_at !== null) ?? workspace.specs[0] ?? null;
  const spec: ModelSpec | null = specRecord
    ? { version: specRecord.version, approved_at: specRecord.approved_at, spec: specRecord.spec }
    : null;
  const integrations: ModelIntegration[] = workspace.integrations.map((integration) => ({
    id: integration.id,
    name: integration.name,
    kind: integration.kind,
    status: integration.status,
    allowed_operations: integration.allowed_operations,
    last_test_status: integration.last_test_status,
    updated_at: integration.updated_at,
  }));
  const deployments: ModelDeployment[] = workspace.deployments.map((deployment) => ({
    id: deployment.id,
    target: deployment.target,
    status: deployment.status,
    snapshot_version: deployment.snapshot_version,
    source_commit: deployment.source_commit,
    deployment_url: deployment.deployment_url,
    created_at: deployment.created_at,
  }));

  return {
    project: {
      id: workspace.project.id,
      name: workspace.project.name,
      purpose: workspace.project.purpose,
      target_users: workspace.project.target_users,
      current_version: workspace.project.current_version,
      auth_requirements: workspace.project.auth_requirements,
    },
    spec,
    files: modelFiles(workspace.files),
    integrations,
    deployments,
  };
}

export async function getProjectModelWorkspace(
  session: Session,
  projectId: string,
): Promise<ProjectModelWorkspace | null> {
  const { data: project, error } = await session.supabase
    .from("app_projects")
    .select("*")
    .eq("id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error) {
    console.error("getProjectModelWorkspace project failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!project) return null;

  const [specs, files, integrations, deployments, models, scenarios, experiments, tasks] =
    await Promise.all([
      session.supabase
        .from("app_specs")
        .select("id, project_id, user_id, version, spec, approved_at, created_at")
        .eq("project_id", projectId)
        .eq("user_id", session.user.id)
        .order("version", { ascending: false })
        .limit(50),
      session.supabase
        .from("app_files")
        .select("id, project_id, user_id, path, content, updated_at")
        .eq("project_id", projectId)
        .eq("user_id", session.user.id)
        .order("path", { ascending: true }),
      session.supabase
        .from("app_integrations")
        .select(INTEGRATION_COLUMNS)
        .eq("project_id", projectId)
        .eq("user_id", session.user.id)
        .order("name", { ascending: true })
        .limit(30),
      session.supabase
        .from("app_deployments")
        .select(DEPLOYMENT_COLUMNS)
        .eq("project_id", projectId)
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(20),
      session.supabase
        .from("app_project_models")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", session.user.id)
        .order("version", { ascending: false })
        .limit(50),
      session.supabase
        .from("app_change_scenarios")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(100),
      session.supabase
        .from("app_change_experiments")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(100),
      session.supabase
        .from("app_build_tasks")
        .select("id, title, status, scope_paths, created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(60),
    ]);

  for (const result of [
    specs,
    files,
    integrations,
    deployments,
    models,
    scenarios,
    experiments,
    tasks,
  ]) {
    if (result.error) {
      console.error("getProjectModelWorkspace child failed:", result.error.message);
      throw new DataError(LOAD_ERROR);
    }
  }

  return {
    project: project as AppProject,
    specs: (specs.data ?? []) as AppSpecRecord[],
    files: (files.data ?? []) as AppFile[],
    integrations: (integrations.data ?? []) as AppIntegration[],
    deployments: (deployments.data ?? []) as AppDeployment[],
    models: (models.data ?? []) as ProjectModelRecord[],
    scenarios: (scenarios.data ?? []) as ChangeScenarioRecord[],
    experiments: (experiments.data ?? []) as ChangeExperimentRecord[],
    tasks: (tasks.data ?? []) as ProjectBuildTaskRecord[],
  };
}
