"use server";

import { revalidatePath } from "next/cache";
import type { BuildState } from "@/lib/action-state";
import { getSession } from "@/lib/auth";
import { hasBillingGrant } from "@/lib/billing/entitlements";
import {
  DeploymentError,
  buildDeploymentPlan,
  extractEnvRequirements,
  migrationFiles,
  planHash,
  planProblems,
  redactSecrets,
  smokeFailureReason,
  sourceDigest,
  type DeploymentFile,
  type DeploymentPlan,
  type DeploymentTarget,
} from "@/lib/deployments";
import {
  applyPostgresMigrations,
  checkPostgresTarget,
  commitSnapshot,
  createVercelDeployment,
  getVercelDeployment,
  parsePostgresTarget,
  upsertVercelEnv,
  validateGitHub,
  validateSupabasePair,
  validateVercel,
  type ProviderError,
} from "@/lib/deploy/providers";
import {
  connectionAad,
  decryptSecret,
  encryptSecret,
  environmentAad,
  vaultConfigured,
} from "@/lib/deploy/vault";
import { getSupabaseAccountAccess } from "@/lib/deploy/supabase-account";
import {
  applySupabaseMigrations,
  getSupabaseProjectApiKeys,
  listSupabaseProjects,
} from "@/lib/deploy/supabase-oauth";
import {
  checkSummary,
  createRunnerWorkspace,
  getPreviewConfig,
  runRunnerChecks,
  stopRunnerWorkspace,
} from "@/lib/preview-workspace";
import type { AppDeployment, AppProviderConnection } from "@/lib/types";
import { isUuid, readText } from "@/lib/validation";

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That app project isn't available to you.";
const VAULT_MISSING =
  "The deployment vault isn't configured. Add a server-only DEPLOYMENT_VAULT_KEY (32-byte base64 or 64-character hex).";
const RUNNER_MISSING =
  "The preview runner isn't configured, so the required pre-deploy checks cannot run. Configure PREVIEW_RUNNER_URL, PREVIEW_RUNNER_TOKEN, PREVIEW_SIGNING_SECRET and PREVIEW_PUBLIC_ORIGIN.";

function fail(message: string): BuildState {
  return { status: "error", message: redactSecrets(message), nonce: Date.now() };
}

function done(message: string, link?: string): BuildState {
  return { status: "success", message: redactSecrets(message), link, nonce: Date.now() };
}

function refresh(projectId: string): void {
  revalidatePath("/build");
  revalidatePath(`/build/${projectId}`);
  revalidatePath(`/build/${projectId}/deploy`);
}

async function ownerProject(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  projectId: string,
) {
  if (!isUuid(projectId)) return null;
  const { data } = await session.supabase
    .from("app_projects")
    .select("*")
    .eq("id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  return data;
}

async function projectFiles(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  projectId: string,
): Promise<DeploymentFile[]> {
  const { data } = await session.supabase
    .from("app_files")
    .select("path, content")
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .order("path", { ascending: true });
  return (data ?? []) as DeploymentFile[];
}

async function safeError(error: unknown): Promise<string> {
  if (error instanceof DeploymentError || (error as ProviderError)?.name === "ProviderError") {
    return (error as Error).message.slice(0, 1000);
  }
  return "The deployment action stopped before it could finish. Inspect the recorded state.";
}

async function readSecret(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  projectId: string,
  provider: "github" | "vercel" | "supabase",
): Promise<string> {
  const { data, error } = await session.supabase.rpc("get_provider_secret", {
    p_project_id: projectId,
    p_provider: provider,
  });
  if (error || typeof data !== "string" || data === "") {
    throw new DeploymentError(`The ${provider} connection is not available. Reconnect it.`);
  }
  return decryptSecret(data, connectionAad(projectId, provider));
}

async function event(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  input: { deploymentId: string; projectId: string; kind: string; detail: string },
): Promise<void> {
  await session.supabase.from("app_deployment_events").insert({
    deployment_id: input.deploymentId,
    project_id: input.projectId,
    user_id: session.user.id,
    kind: input.kind.slice(0, 80),
    detail: redactSecrets(input.detail).slice(0, 1000),
  });
}

export async function connectGitHubAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  if (!vaultConfigured()) return fail(VAULT_MISSING);
  const projectId = readText(formData, "project_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);

  const token = readText(formData, "token").trim();
  const repo = readText(formData, "repo").trim();
  const branch = readText(formData, "branch").trim() || "main";
  if (token.length < 20) return fail("Paste a scoped GitHub token for this repository.");

  try {
    const validated = await validateGitHub({ token, repo, branch });
    const { error } = await session.supabase.rpc("save_provider_connection", {
      p_project_id: projectId,
      p_provider: "github",
      p_status: "connected",
      p_account_label: validated.login || "GitHub account",
      p_external_ref: validated.full_name,
      p_scope_label: `Contents read/write on ${validated.full_name}; branch ${validated.branch}`,
      p_metadata: {
        login: validated.login,
        repo_id: validated.repo_id,
        private: validated.private,
        default_branch: validated.default_branch,
        branch: validated.branch,
      },
      p_secret_sealed: encryptSecret(token, connectionAad(projectId, "github")),
    });
    if (error) throw new DeploymentError("The GitHub connection could not be saved.");
    refresh(projectId);
    return done(`GitHub connected to ${validated.full_name}@${validated.branch}. The token is encrypted and scoped to this project.`);
  } catch (error) {
    return fail(await safeError(error));
  }
}

export async function connectVercelAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  if (!vaultConfigured()) return fail(VAULT_MISSING);
  const projectId = readText(formData, "project_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);

  const token = readText(formData, "token").trim();
  const project = readText(formData, "project").trim();
  const teamId = readText(formData, "team_id").trim() || null;
  if (token.length < 20) return fail("Paste a scoped Vercel token.");

  try {
    const validated = await validateVercel({ token, project, teamId });
    const { error } = await session.supabase.rpc("save_provider_connection", {
      p_project_id: projectId,
      p_provider: "vercel",
      p_status: "connected",
      p_account_label: validated.account,
      p_external_ref: validated.project_id,
      p_scope_label: `Vercel project ${validated.project_name}${validated.team_id ? ` in team ${validated.team_id}` : ""}`,
      p_metadata: validated,
      p_secret_sealed: encryptSecret(token, connectionAad(projectId, "vercel")),
    });
    if (error) throw new DeploymentError("The Vercel connection could not be saved.");
    refresh(projectId);
    return done(`Vercel project ${validated.project_name} connected. The token is encrypted and scoped to this project.`);
  } catch (error) {
    return fail(await safeError(error));
  }
}

export async function connectSupabaseAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  if (!vaultConfigured()) return fail(VAULT_MISSING);
  const projectId = readText(formData, "project_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);

  const devUrl = readText(formData, "development_url").trim();
  const prodUrl = readText(formData, "production_url").trim();

  try {
    const pair = validateSupabasePair(devUrl, prodUrl);
    await checkPostgresTarget(devUrl);
    await checkPostgresTarget(prodUrl);
    const secret = JSON.stringify({ development_url: devUrl, production_url: prodUrl });
    const { error } = await session.supabase.rpc("save_provider_connection", {
      p_project_id: projectId,
      p_provider: "supabase",
      p_status: "connected",
      p_account_label: pair.account,
      p_external_ref: `${pair.development_ref}->${pair.production_ref}`,
      p_scope_label: "Direct migration role; preview never applies production migrations",
      p_metadata: {
        development_ref: parsePostgresTarget(devUrl).ref,
        production_ref: parsePostgresTarget(prodUrl).ref,
      },
      p_secret_sealed: encryptSecret(secret, connectionAad(projectId, "supabase")),
    });
    if (error) throw new DeploymentError("The Supabase connection could not be saved.");
    refresh(projectId);
    return done("Supabase development and production databases connected. Both connection strings are encrypted; preview never writes production migrations.");
  } catch (error) {
    return fail(await safeError(error));
  }
}

function supabaseProjectRef(value: string): string {
  if (!/^[a-z0-9]{10,30}$/i.test(value)) {
    throw new DeploymentError("Choose a valid Supabase project reference.");
  }
  return value;
}

export async function connectSupabaseProjectsAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  if (!vaultConfigured()) return fail(VAULT_MISSING);
  const projectId = readText(formData, "project_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);

  const developmentRef = readText(formData, "development_ref").trim();
  const productionRef = readText(formData, "production_ref").trim();

  try {
    const devRef = supabaseProjectRef(developmentRef);
    const prodRef = supabaseProjectRef(productionRef);
    if (devRef === prodRef) {
      throw new DeploymentError("Development and production must be different Supabase projects.");
    }

    const account = await getSupabaseAccountAccess(session);
    const projects = await listSupabaseProjects({ accessToken: account.accessToken });
    const byRef = new Map(projects.map((project) => [project.ref, project]));
    const development = byRef.get(devRef);
    const production = byRef.get(prodRef);
    if (!development || !production) {
      throw new DeploymentError("One of those Supabase projects is not available to this account. Reconnect or refresh the project list.");
    }

    const [developmentKeys, productionKeys] = await Promise.all([
      getSupabaseProjectApiKeys({ accessToken: account.accessToken, ref: devRef }),
      getSupabaseProjectApiKeys({ accessToken: account.accessToken, ref: prodRef }),
    ]);

    const { error } = await session.supabase.rpc("save_provider_connection", {
      p_project_id: projectId,
      p_provider: "supabase",
      p_status: "connected",
      p_account_label: `${account.accountLabel} (OAuth)`.slice(0, 120),
      p_external_ref: `${devRef}->${prodRef}`,
      p_scope_label: "Supabase OAuth Management API; preview never applies production migrations",
      p_metadata: {
        development_ref: devRef,
        production_ref: prodRef,
        development_url: developmentKeys.url,
        production_url: productionKeys.url,
        oauth: true,
        connection_id: account.connectionId,
      },
      p_secret_sealed: null,
    });
    if (error) throw new DeploymentError("The Supabase project connection could not be saved.");

    const requirements = extractEnvRequirements(await projectFiles(session, projectId));
    const required = new Set(requirements.map((item) => item.name));
    const environments = [
      { environment: "preview" as const, keys: developmentKeys },
      { environment: "production" as const, keys: productionKeys },
    ];
    let savedValues = 0;
    let envFailed = false;
    for (const item of environments) {
      const values = [
        { name: "NEXT_PUBLIC_SUPABASE_URL", value: item.keys.url },
        { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", value: item.keys.anonKey },
      ];
      for (const value of values) {
        if (!required.has(value.name)) continue;
        const { error: envError } = await session.supabase.rpc("save_env_value", {
          p_project_id: projectId,
          p_environment: item.environment,
          p_name: value.name,
          p_visibility: "public",
          p_secret_sealed: encryptSecret(
            value.value,
            environmentAad(projectId, item.environment, value.name),
          ),
        });
        if (envError) envFailed = true;
        else savedValues += 1;
      }
    }

    refresh(projectId);
    const envNote = envFailed
      ? " Some API-key values could not be saved; set them in Environment values before planning."
      : savedValues > 0
        ? ` ${savedValues} public Supabase value(s) were saved for the required environment names.`
        : " The current generated code does not require Supabase environment names; add them manually if needed.";
    return done(
      `Supabase projects ${devRef} (preview) and ${prodRef} (production) connected. Migrations will use the Management API; no database password is stored.${envNote}`,
    );
  } catch (error) {
    return fail(await safeError(error));
  }
}

export async function disconnectSupabaseAccountAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);

  const { data } = await session.supabase
    .from("supabase_account_connections_safe")
    .select("id")
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (!data?.id) return fail("No Supabase OAuth account is connected.");

  const { error } = await session.supabase.rpc("revoke_supabase_account", {
    p_connection_id: data.id,
  });
  if (error) return fail("The Supabase OAuth connection could not be disconnected.");
  refresh(projectId);
  return done(
    "Supabase account disconnected and its sealed tokens deleted. Project connections that used it were revoked. Revoke the app in Supabase as well if you want to invalidate the grant immediately.",
  );
}

export async function disconnectProviderAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const provider = readText(formData, "provider");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  if (!["github", "vercel", "supabase"].includes(provider)) return fail("Unknown provider.");

  const { error } = await session.supabase
    .from("app_provider_connections")
    .update({ status: "revoked", secret_sealed: null, revoked_at: new Date().toISOString() })
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .eq("provider", provider);
  if (error) return fail("The connection could not be disconnected.");
  refresh(projectId);
  return done(
    `${provider} disconnected and its sealed secret deleted. Revoke or rotate the credential at ${provider} as well; disconnecting here cannot revoke a token the provider still holds.`,
  );
}

export async function setEnvValueAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  if (!vaultConfigured()) return fail(VAULT_MISSING);
  const projectId = readText(formData, "project_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  const environment = readText(formData, "environment");
  const name = readText(formData, "name").trim();
  const value = readText(formData, "value");
  if (!["preview", "production"].includes(environment)) return fail("Unknown environment.");
  if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(name)) return fail("That environment-variable name is invalid.");
  if (value.length < 1 || value.length > 12000) return fail("Enter a value up to 12,000 characters.");

  const files = await projectFiles(session, projectId);
  const requirement = extractEnvRequirements(files).find((item) => item.name === name);
  if (!requirement) return fail("That name is not required by the current generated code.");

  const { error } = await session.supabase.rpc("save_env_value", {
    p_project_id: projectId,
    p_environment: environment,
    p_name: name,
    p_visibility: requirement.visibility,
    p_secret_sealed: encryptSecret(value, environmentAad(projectId, environment, name)),
  });
  if (error) return fail("The environment value could not be saved.");
  refresh(projectId);
  return done(`${name} is saved for ${environment}. Its value is not shown again.`);
}

export async function deleteEnvValueAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const id = readText(formData, "id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  if (!isUuid(id)) return fail("Unknown environment value.");
  const { error } = await session.supabase
    .from("app_env_values")
    .delete()
    .eq("id", id)
    .eq("project_id", projectId)
    .eq("user_id", session.user.id);
  if (error) return fail("The environment value could not be deleted.");
  refresh(projectId);
  return done("Environment value deleted.");
}

function targetFrom(value: string): DeploymentTarget | null {
  return value === "preview" || value === "production" ? value : null;
}

async function connectionMap(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  projectId: string,
): Promise<Map<string, AppProviderConnection>> {
  const { data } = await session.supabase
    .from("app_provider_connections_safe")
    .select("id, project_id, user_id, provider, status, account_label, external_ref, scope_label, metadata, connected_at, revoked_at, created_at, updated_at")
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .eq("status", "connected");
  return new Map(((data ?? []) as AppProviderConnection[]).map((row) => [row.provider, row]));
}

async function envSetNames(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  projectId: string,
  environment: string,
): Promise<string[]> {
  const { data } = await session.supabase
    .from("app_env_values_safe")
    .select("name")
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .eq("environment", environment);
  return ((data ?? []) as { name: string }[]).map((row) => row.name);
}

export async function createDeploymentPlanAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const project = await ownerProject(session, projectId);
  if (!project) return fail(NOT_AVAILABLE);
  const target = targetFrom(readText(formData, "target"));
  if (!target) return fail("Choose preview or production.");
  if (target === "production" && !(await hasBillingGrant(session, "build_release"))) {
    return fail("Production deployment is part of the Build & release pack. Buy it under Plans; preview deployment stays available.");
  }

  const files = await projectFiles(session, projectId);
  if (files.length === 0) return fail("Generate project files before planning a deployment.");
  const connections = await connectionMap(session, projectId);
  const github = connections.get("github");
  const vercel = connections.get("vercel");
  const supabase = connections.get("supabase");
  if (!github || !vercel || !supabase) {
    return fail("Connect GitHub, Vercel and Supabase for this project before creating a plan.");
  }

  const metadata = (row: AppProviderConnection) => row.metadata as Record<string, unknown>;
  const gh = metadata(github);
  const vc = metadata(vercel);
  const sb = metadata(supabase);
  const environment = target === "production" ? "production" : "preview";
  const setNames = await envSetNames(session, projectId, environment);

  try {
    const plan = buildDeploymentPlan({
      projectId,
      projectName: String(project.name),
      target,
      version: Number(project.current_version ?? 0),
      files,
      github: {
        provider: "github",
        login: String(gh.login ?? github.account_label),
        full_name: github.external_ref,
        branch: String(gh.branch ?? gh.default_branch ?? "main"),
        private: gh.private === true,
        repo_id: typeof gh.repo_id === "number" ? gh.repo_id : null,
      },
      vercel: {
        provider: "vercel",
        account: vercel.account_label,
        project_id: vercel.external_ref,
        project_name: String(vc.project_name ?? vercel.account_label),
        team_id: typeof vc.team_id === "string" ? vc.team_id : null,
      },
      supabase: {
        provider: "supabase",
        account: supabase.account_label,
        development_ref: String(sb.development_ref ?? "development"),
        production_ref: String(sb.production_ref ?? "production"),
        target_ref: target === "production" ? String(sb.production_ref ?? "production") : String(sb.development_ref ?? "development"),
      },
      envRequirements: extractEnvRequirements(files),
      setEnvNames: setNames,
    });

    const hash = planHash(plan);
    const { data: inserted, error } = await session.supabase
      .from("app_deployments")
      .insert({
        project_id: projectId,
        user_id: session.user.id,
        target,
        snapshot_version: Number(project.current_version),
        snapshot_digest: plan.source.digest,
        snapshot: files,
        plan,
        plan_hash: hash,
        status: "draft",
        checks: [],
        migration_state: "not_applied",
      })
      .select("id")
      .single();
    if (error || !inserted) throw new DeploymentError("The deployment plan could not be saved.");

    refresh(projectId);
    const warnings = planProblems(plan);
    return done(
      warnings.length > 0
        ? `Plan saved. Before approval: ${warnings.join(" ")}`
        : "Plan saved with an exact source digest. Review every line, run pre-deploy checks, then approve.",
    );
  } catch (error) {
    return fail(await safeError(error));
  }
}

export async function runDeploymentPrechecksAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const deploymentId = readText(formData, "deployment_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  if (!isUuid(deploymentId)) return fail("Unknown deployment.");

  const config = getPreviewConfig();
  if (!config) return fail(RUNNER_MISSING);

  const { data: row } = await session.supabase
    .from("app_deployments")
    .select("id, snapshot, status")
    .eq("id", deploymentId)
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (!row) return fail("Unknown deployment.");
  if (!["draft", "checks_ready"].includes(String(row.status))) {
    return fail("Pre-deploy checks can run only before approval.");
  }

  let key: string | null = null;
  try {
    const files = row.snapshot as DeploymentFile[];
    const created = await createRunnerWorkspace(config, {
      projectId,
      userId: session.user.id,
      files,
    });
    key = created.key;
    const checks = await runRunnerChecks(config, key, files);
    await stopRunnerWorkspace(config, key).catch(() => undefined);
    key = null;
    const passed = checks.status === "passed";
    await session.supabase
      .from("app_deployments")
      .update({
        status: passed ? "checks_ready" : "draft",
        checks: checks.checks,
        error: passed ? null : "One or more pre-deploy checks failed.",
      })
      .eq("id", deploymentId)
      .eq("project_id", projectId)
      .eq("user_id", session.user.id);
    await event(session, {
      deploymentId,
      projectId,
      kind: "prechecks",
      detail: passed ? `Pre-deploy checks passed: ${checkSummary(checks.checks)}` : `Pre-deploy checks failed: ${checkSummary(checks.checks)}`,
    });
    refresh(projectId);
    return passed
      ? done(`Pre-deploy checks passed: ${checkSummary(checks.checks)}. Review the plan and type DEPLOY to approve.`)
      : fail(`Pre-deploy checks failed: ${checkSummary(checks.checks)}. Nothing external was changed.`);
  } catch (error) {
    if (key) await stopRunnerWorkspace(config, key).catch(() => undefined);
    return fail(await safeError(error));
  }
}

async function envValuesForDeployment(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  projectId: string,
  plan: DeploymentPlan,
): Promise<{ name: string; value: string; visibility: "public" | "server" }[]> {
  const environment = plan.environment.environment;
  const { data, error } = await session.supabase.rpc("get_project_env_values", {
    p_project_id: projectId,
    p_environment: environment,
  });
  if (error) throw new DeploymentError("The approved environment values could not be read.");
  const rows = Array.isArray(data) ? (data as { name: string; visibility: string; sealed: string }[]) : [];
  const byName = new Map(rows.map((row) => [row.name, row]));
  const values: { name: string; value: string; visibility: "public" | "server" }[] = [];
  for (const requirement of plan.environment.names) {
    if (!requirement.set) throw new DeploymentError(`The ${requirement.name} value is missing.`);
    const row = byName.get(requirement.name);
    if (!row?.sealed) throw new DeploymentError(`The ${requirement.name} value is missing.`);
    values.push({
      name: requirement.name,
      visibility: requirement.visibility,
      value: decryptSecret(
        row.sealed,
        environmentAad(projectId, environment, requirement.name),
      ),
    });
  }
  return values;
}

async function runApprovedPipeline(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  deployment: AppDeployment & { snapshot: DeploymentFile[] },
): Promise<void> {
  const projectId = deployment.project_id;
  const plan = deployment.plan;
  const repoParts = plan.repository.full_name.split("/");
  if (repoParts.length !== 2) throw new DeploymentError("The connected repository reference is invalid.");

  let commit = deployment.source_commit;
  try {
    if (!commit) {
      const token = await readSecret(session, projectId, "github");
      const result = await commitSnapshot({
        token,
        repo: plan.repository.full_name,
        branch: plan.repository.branch,
        files: deployment.snapshot,
        sourceVersion: plan.source.version,
        sourceDigest: plan.source.digest,
      });
      commit = result.commit_sha;
      await session.supabase
        .from("app_deployments")
        .update({ source_commit: commit, status: "repository" })
        .eq("id", deployment.id)
        .eq("user_id", session.user.id);
      await event(session, {
        deploymentId: deployment.id,
        projectId,
        kind: "repository",
        detail: `Committed source digest ${plan.source.digest.slice(0, 12)} to ${plan.repository.full_name}@${plan.repository.branch}.`,
      });
    }

    let migrationState = "not_applied";
    if (plan.database.apply_migrations) {
      const migrations = migrationFiles(deployment.snapshot);
      const { data: supabaseConnection } = await session.supabase
        .from("app_provider_connections_safe")
        .select("metadata")
        .eq("project_id", projectId)
        .eq("user_id", session.user.id)
        .eq("provider", "supabase")
        .eq("status", "connected")
        .maybeSingle();
      const metadata = (supabaseConnection?.metadata ?? {}) as Record<string, unknown>;
      const oauthConnectionId = typeof metadata.connection_id === "string" ? metadata.connection_id : null;
      const applied =
        metadata.oauth === true && oauthConnectionId
          ? await (async () => {
              const account = await getSupabaseAccountAccess(session, oauthConnectionId);
              return applySupabaseMigrations({
                accessToken: account.accessToken,
                projectRef: plan.database.production_ref,
                migrations,
              });
            })()
          : await (async () => {
              const secret = JSON.parse(await readSecret(session, projectId, "supabase")) as {
                production_url?: string;
              };
              if (!secret.production_url) throw new DeploymentError("The production database connection is missing.");
              return applyPostgresMigrations({ url: secret.production_url, migrations });
            })();
      migrationState = `applied: ${applied.applied.join(", ")}`;
      await session.supabase
        .from("app_deployments")
        .update({ migration_state: migrationState.slice(0, 500), status: "migrations" })
        .eq("id", deployment.id)
        .eq("user_id", session.user.id);
      await event(session, {
        deploymentId: deployment.id,
        projectId,
        kind: "migrations",
        detail: `Applied ${applied.applied.length} approved production migration file(s)${
          metadata.oauth === true ? " through the Supabase Management API." : "."
        }`,
      });
    } else {
      migrationState = deployment.target === "preview" ? "not_applied_preview" : "not_applicable";
    }

    const values = await envValuesForDeployment(session, projectId, plan);
    const vercelToken = await readSecret(session, projectId, "vercel");
    const envResult = await upsertVercelEnv({
      token: vercelToken,
      projectId: plan.hosting.project_id,
      teamId: plan.hosting.team_id,
      target: deployment.target,
      values,
    });
    if (envResult.failed.length > 0) {
      throw new DeploymentError(
        `Vercel refused these environment variable names: ${envResult.failed.join(", ")}. No deployment was created.`,
      );
    }
    await session.supabase
      .from("app_deployments")
      .update({ status: "infrastructure" })
      .eq("id", deployment.id)
      .eq("user_id", session.user.id);
    await event(session, {
      deploymentId: deployment.id,
      projectId,
      kind: "infrastructure",
      detail: `Upserted ${envResult.updated.length} environment variable name(s) for ${deployment.target}.`,
    });

    const created = await createVercelDeployment({
      token: vercelToken,
      projectId: plan.hosting.project_id,
      projectName: plan.hosting.project_name,
      teamId: plan.hosting.team_id,
      target: deployment.target,
      repo: { owner: repoParts[0], name: repoParts[1] },
      branch: plan.repository.branch,
      commitSha: commit,
    });
    await session.supabase
      .from("app_deployments")
      .update({
        status: "deploying",
        external_deployment_id: created.id,
        deployment_url: created.url,
        migration_state: migrationState.slice(0, 500),
      })
      .eq("id", deployment.id)
      .eq("user_id", session.user.id);
    await event(session, {
      deploymentId: deployment.id,
      projectId,
      kind: "deployment",
      detail: `Vercel accepted deployment ${created.id}. Status is not success until smoke checks pass.`,
    });
  } catch (error) {
    const message = await safeError(error);
    const partial = Boolean(commit);
    await session.supabase
      .from("app_deployments")
      .update({
        status: partial ? "partial_failure" : "failed",
        partial_failure: partial
          ? "A repository commit may have succeeded before the failure. Inspect the recorded state before creating a new plan."
          : null,
        error: message,
        migration_state: plan.database.apply_migrations
          ? "failed or unconfirmed; verify the production database before retrying"
          : "not_applied",
      })
      .eq("id", deployment.id)
      .eq("user_id", session.user.id);
    await event(session, {
      deploymentId: deployment.id,
      projectId,
      kind: partial ? "partial_failure" : "failure",
      detail: message,
    });
  }
}

export async function approveDeploymentAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const deploymentId = readText(formData, "deployment_id");
  const planHashInput = readText(formData, "plan_hash");
  const confirmation = readText(formData, "confirmation").trim();
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  if (!isUuid(deploymentId)) return fail("Unknown deployment.");
  if (confirmation !== "DEPLOY") return fail("Type DEPLOY exactly to approve the resolved external actions.");

  const { data: row } = await session.supabase
    .from("app_deployments")
    .select("*")
    .eq("id", deploymentId)
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (!row) return fail("Unknown deployment.");
  const deployment = row as AppDeployment & { snapshot: DeploymentFile[] };
  if (deployment.status !== "checks_ready") return fail("Run successful pre-deploy checks before approving.");
  if (deployment.target === "production" && !(await hasBillingGrant(session, "build_release"))) {
    return fail("Production deployment is part of the Build & release pack. Buy it under Plans; preview deployment stays available.");
  }
  if (!planHashInput || planHashInput !== deployment.plan_hash || planHash(deployment.plan) !== deployment.plan_hash) {
    return fail("The plan changed or its fingerprint does not match. Nothing external was changed.");
  }
  if (!deployment.checks.length || deployment.checks.some((check) => !["passed", "skipped"].includes(check.status))) {
    return fail("Pre-deploy checks did not pass. Nothing external was changed.");
  }

  const files = await projectFiles(session, projectId);
  if (sourceDigest(files) !== deployment.snapshot_digest) {
    return fail("The project files changed after this plan was made. Create a new plan; nothing external was changed.");
  }

  const connections = await connectionMap(session, projectId);
  if (connections.size < 3) return fail("All three provider connections must be connected for this project.");
  const github = connections.get("github");
  const vercel = connections.get("vercel");
  const supabase = connections.get("supabase");
  const githubMeta = (github?.metadata ?? {}) as Record<string, unknown>;
  if (
    !github ||
    !vercel ||
    !supabase ||
    github.external_ref !== deployment.plan.repository.full_name ||
    String(githubMeta.branch ?? "") !== deployment.plan.repository.branch ||
    vercel.external_ref !== deployment.plan.hosting.project_id ||
    supabase.external_ref !==
      `${deployment.plan.database.development_ref}->${deployment.plan.database.production_ref}`
  ) {
    return fail("A provider connection changed after this plan was made. Create a new plan; nothing external was changed.");
  }
  const currentEnvNames = new Set(
    await envSetNames(session, projectId, deployment.plan.environment.environment),
  );
  const missingEnv = deployment.plan.environment.names
    .filter((item) => !currentEnvNames.has(item.name))
    .map((item) => item.name);
  if (missingEnv.length > 0) {
    return fail(`Required environment values are missing now: ${missingEnv.join(", ")}. Create a new plan; nothing external was changed.`);
  }
  const warnings = planProblems(deployment.plan);
  if (warnings.length > 0) return fail(warnings.join(" "));

  const { data: claimed } = await session.supabase
    .from("app_deployments")
    .update({ status: "approved", approval_at: new Date().toISOString() })
    .eq("id", deploymentId)
    .eq("user_id", session.user.id)
    .eq("status", "checks_ready")
    .select("id");
  if (!claimed || claimed.length === 0) return fail("This deployment was already approved or changed. No action was repeated.");

  await event(session, {
    deploymentId,
    projectId,
    kind: "approval",
    detail: `Owner approved the exact plan ${deployment.plan_hash.slice(0, 12)}.`,
  });
  await runApprovedPipeline(session, deployment);
  refresh(projectId);

  const { data: after } = await session.supabase
    .from("app_deployments")
    .select("status, error, partial_failure")
    .eq("id", deploymentId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (after?.status === "failed") return fail(`The approved pipeline failed: ${after.error ?? "inspect the event log."}`);
  if (after?.status === "partial_failure") {
    return fail(`Partial failure: ${after.error ?? "inspect the event log."} ${after.partial_failure ?? ""}`);
  }
  return done("The approved repository and infrastructure actions completed. Poll the hosting status, then run smoke checks only when ready.");
}

export async function refreshDeploymentAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const deploymentId = readText(formData, "deployment_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  if (!isUuid(deploymentId)) return fail("Unknown deployment.");

  const { data: row } = await session.supabase
    .from("app_deployments")
    .select("*")
    .eq("id", deploymentId)
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (!row) return fail("Unknown deployment.");
  const deployment = row as AppDeployment & { snapshot: DeploymentFile[] };
  if (!["deploying", "approved", "repository", "migrations", "infrastructure"].includes(deployment.status)) {
    return fail(`Nothing to poll: this deployment is ${deployment.status}.`);
  }
  if (!deployment.external_deployment_id) return fail("No hosting deployment id has been recorded. Do not create a second deployment blindly.");

  try {
    const token = await readSecret(session, projectId, "vercel");
    const remote = await getVercelDeployment({
      token,
      deploymentId: deployment.external_deployment_id,
      teamId: deployment.plan.hosting.team_id,
    });
    const url = remote.url ?? deployment.deployment_url;
    if (remote.ready_state === "READY") {
      if (!url) throw new DeploymentError("Vercel reported ready without a deployment URL.");
      let smokeDetail = "Smoke check did not run.";
      let smokePassed = false;
      try {
        const response = await fetch(url, {
          redirect: "follow",
          cache: "no-store",
          signal: AbortSignal.timeout(20_000),
          headers: { "User-Agent": "get-to-it-smoke-check" },
        });
        const body = (await response.text()).slice(0, 20_000);
        const reason = smokeFailureReason(response.status, response.headers.get("content-type"), body);
        smokePassed = reason === null;
        smokeDetail = reason ?? `HTTP ${response.status} HTML response received.`;
      } catch {
        smokeDetail = "The deployed URL could not be reached for a smoke check.";
      }
      await session.supabase
        .from("app_deployments")
        .update({
          status: smokePassed ? "succeeded" : "partial_failure",
          deployment_url: url,
          checks: [
            {
              name: "smoke",
              label: "Deployed page",
              status: smokePassed ? "passed" : "failed",
              code: null,
              detail: smokeDetail.slice(0, 500),
            },
          ],
          error: smokePassed ? null : smokeDetail.slice(0, 1000),
          partial_failure: smokePassed ? null : "The deployment is ready, but the smoke check failed.",
        })
        .eq("id", deploymentId)
        .eq("user_id", session.user.id);
      await event(session, {
        deploymentId,
        projectId,
        kind: smokePassed ? "smoke_passed" : "smoke_failed",
        detail: smokeDetail,
      });
      refresh(projectId);
      return smokePassed
        ? done("Vercel reports ready and the deployed page passed the smoke check.", url)
        : fail(`Vercel reports ready, but the app did not pass the smoke check: ${smokeDetail}`);
    }

    if (["ERROR", "CANCELED", "BLOCKED"].includes(remote.ready_state)) {
      const message = remote.error ?? `Vercel reported ${remote.ready_state}.`;
      await session.supabase
        .from("app_deployments")
        .update({ status: "failed", error: message.slice(0, 1000), deployment_url: url })
        .eq("id", deploymentId)
        .eq("user_id", session.user.id);
      await event(session, { deploymentId, projectId, kind: "hosting_failed", detail: message });
      refresh(projectId);
      return fail(message);
    }

    await session.supabase
      .from("app_deployments")
      .update({ status: "deploying", deployment_url: url })
      .eq("id", deploymentId)
      .eq("user_id", session.user.id);
    refresh(projectId);
    return done(`Vercel is still ${remote.ready_state}. Poll again; smoke checks wait for READY.`);
  } catch (error) {
    return fail(await safeError(error));
  }
}

export async function redeploySnapshotAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const deploymentId = readText(formData, "deployment_id");
  const target = targetFrom(readText(formData, "target"));
  const project = await ownerProject(session, projectId);
  if (!project) return fail(NOT_AVAILABLE);
  if (!target) return fail("Choose preview or production.");
  if (target === "production" && !(await hasBillingGrant(session, "build_release"))) {
    return fail("Production deployment is part of the Build & release pack. Buy it under Plans; preview deployment stays available.");
  }
  if (!isUuid(deploymentId)) return fail("Unknown deployment.");

  const { data: previous } = await session.supabase
    .from("app_deployments")
    .select("snapshot, snapshot_version")
    .eq("id", deploymentId)
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (!previous) return fail("The previous snapshot is not available.");

  const files = previous.snapshot as DeploymentFile[];
  const connections = await connectionMap(session, projectId);
  const github = connections.get("github");
  const vercel = connections.get("vercel");
  const supabase = connections.get("supabase");
  if (!github || !vercel || !supabase) return fail("Reconnect all three providers before redeploying an old snapshot.");
  const gh = github.metadata as Record<string, unknown>;
  const vc = vercel.metadata as Record<string, unknown>;
  const sb = supabase.metadata as Record<string, unknown>;
  const environment = target === "production" ? "production" : "preview";
  const setNames = await envSetNames(session, projectId, environment);

  try {
    const plan = buildDeploymentPlan({
      projectId,
      projectName: String(project.name),
      target,
      version: Number(previous.snapshot_version),
      files,
      github: {
        provider: "github",
        login: String(gh.login ?? github.account_label),
        full_name: github.external_ref,
        branch: String(gh.branch ?? gh.default_branch ?? "main"),
        private: gh.private === true,
        repo_id: typeof gh.repo_id === "number" ? gh.repo_id : null,
      },
      vercel: {
        provider: "vercel",
        account: vercel.account_label,
        project_id: vercel.external_ref,
        project_name: String(vc.project_name ?? vercel.account_label),
        team_id: typeof vc.team_id === "string" ? vc.team_id : null,
      },
      supabase: {
        provider: "supabase",
        account: supabase.account_label,
        development_ref: String(sb.development_ref ?? "development"),
        production_ref: String(sb.production_ref ?? "production"),
        target_ref: target === "production" ? String(sb.production_ref ?? "production") : String(sb.development_ref ?? "development"),
      },
      envRequirements: extractEnvRequirements(files),
      setEnvNames: setNames,
    });
    const { data: inserted, error } = await session.supabase
      .from("app_deployments")
      .insert({
        project_id: projectId,
        user_id: session.user.id,
        target,
        snapshot_version: Number(previous.snapshot_version),
        snapshot_digest: plan.source.digest,
        snapshot: files,
        plan,
        plan_hash: planHash(plan),
        status: "draft",
        checks: [],
        migration_state: "not_applied",
      })
      .select("id")
      .single();
    if (error || !inserted) throw new DeploymentError("The redeploy plan could not be saved.");
    refresh(projectId);
    return done("A new plan was created from the earlier source snapshot. It still needs checks and explicit approval; nothing external was changed.");
  } catch (error) {
    return fail(await safeError(error));
  }
}
