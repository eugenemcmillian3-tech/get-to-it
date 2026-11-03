import type { Session } from "@/lib/auth";
import type {
  AppDeployment,
  AppDeploymentEvent,
  AppEnvValue,
  AppProviderConnection,
  SupabaseAccountConnection,
} from "@/lib/types";
import { DataError } from "@/lib/data/goals";

/**
 * Phase 24 reads. Sealed provider secrets are never selected here; server
 * actions retrieve ciphertext through an owner-checked database function.
 */

const LOAD_ERROR =
  "We couldn't load the deployment settings just now. Refresh the page to try again.";

export type DeploymentDetail = {
  connections: AppProviderConnection[];
  envValues: AppEnvValue[];
  deployments: AppDeployment[];
  events: AppDeploymentEvent[];
  supabaseAccount: SupabaseAccountConnection | null;
};

export async function getDeploymentDetail(
  session: Session,
  projectId: string,
): Promise<DeploymentDetail> {
  const [connections, envValues, deployments] = await Promise.all([
    session.supabase
      .from("app_provider_connections_safe")
      .select(
        "id, project_id, user_id, provider, status, account_label, external_ref, scope_label, metadata, connected_at, revoked_at, created_at, updated_at",
      )
      .eq("project_id", projectId)
      .eq("user_id", session.user.id)
      .order("provider", { ascending: true }),
    session.supabase
      .from("app_env_values_safe")
      .select("id, project_id, user_id, environment, name, visibility, created_at, updated_at")
      .eq("project_id", projectId)
      .eq("user_id", session.user.id)
      .order("environment", { ascending: true })
      .order("name", { ascending: true }),
    session.supabase
      .from("app_deployments")
      .select(
        "id, project_id, user_id, target, snapshot_version, snapshot_digest, plan, plan_hash, status, checks, approval_at, source_commit, external_deployment_id, deployment_url, migration_state, error, partial_failure, created_at, updated_at",
      )
      .eq("project_id", projectId)
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  for (const result of [connections, envValues, deployments]) {
    if (result.error) {
      console.error("getDeploymentDetail failed:", result.error.message);
      throw new DataError(LOAD_ERROR);
    }
  }

  const rows = (deployments.data ?? []) as AppDeployment[];
  let events: AppDeploymentEvent[] = [];
  if (rows[0]) {
    const eventResult = await session.supabase
      .from("app_deployment_events")
      .select("id, deployment_id, project_id, user_id, kind, detail, created_at")
      .eq("deployment_id", rows[0].id)
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(30);
    if (eventResult.error) {
      console.error("getDeploymentDetail events failed:", eventResult.error.message);
    } else {
      events = (eventResult.data ?? []) as AppDeploymentEvent[];
    }
  }

  // This read is deliberately non-fatal until migration 0027 has been applied.
  // The rest of the deploy page must keep working during a rolling deployment.
  let supabaseAccount: SupabaseAccountConnection | null = null;
  const accountResult = await session.supabase
    .from("supabase_account_connections_safe")
    .select(
      "id, user_id, status, account_label, scopes, expires_at, connected_at, revoked_at, created_at, updated_at",
    )
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (accountResult.error) {
    console.error("getDeploymentDetail Supabase account read failed:", accountResult.error.message);
  } else {
    supabaseAccount = (accountResult.data ?? null) as SupabaseAccountConnection | null;
  }

  return {
    connections: (connections.data ?? []) as AppProviderConnection[],
    envValues: (envValues.data ?? []) as AppEnvValue[],
    deployments: rows,
    events,
    supabaseAccount,
  };
}
