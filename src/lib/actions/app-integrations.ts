"use server";

import { revalidatePath } from "next/cache";
import type { BuildState } from "@/lib/action-state";
import { getSession } from "@/lib/auth";
import { summarizeChanges } from "@/lib/app-builder";
import { addEnvExampleNames, integrationEnvNames, integrationEnvPrefix, integrationSlug, parseMapping, safeIntegrationName, type IntegrationConfig } from "@/lib/integrations/registry";
import { isUuid, readText } from "@/lib/validation";
import { appIntegrationAad, decryptSecret, encryptSecret, vaultConfigured } from "@/lib/deploy/vault";
import type { AppIntegration } from "@/lib/types";
import {
  OpenApiImportError,
  generateOpenApiClient,
  parseOpenApiDocument,
} from "@/lib/integrations/openapi";
import {
  DatabaseIntegrationError,
  buildMigrationPreview,
  generateDatabaseClient,
  inspectPostgresSchema,
  parsePostgresUrl,
  testPostgresConnection,
} from "@/lib/integrations/database";
import {
  IntegrationNetworkError,
  assertPublicHttpUrl,
  probePublicApi,
} from "@/lib/integrations/network";

/**
 * Phase 26 Integration Studio actions.
 *
 * Secrets are encrypted with the existing deployment vault before they reach
 * Postgres. Actions never return a secret, never log one, and never execute an
 * imported description. Database calls are read-only; generated code is written
 * to the existing app_files snapshot system, not executed here.
 */

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That app project isn't available to you.";
const VAULT_MISSING =
  "The deployment vault isn't configured. Add a server-only DEPLOYMENT_VAULT_KEY before saving credentials.";

type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

function fail(message: string): BuildState {
  return { status: "error", message: message.slice(0, 1_000), nonce: Date.now() };
}

function done(message: string): BuildState {
  return { status: "success", message: message.slice(0, 1_000), nonce: Date.now() };
}

function refresh(projectId: string): void {
  revalidatePath("/build");
  revalidatePath(`/build/${projectId}`);
  revalidatePath(`/build/${projectId}/integrations`);
}

async function ownerProject(session: Session, projectId: string) {
  if (!isUuid(projectId)) return null;
  const { data } = await session.supabase
    .from("app_projects")
    .select("id, name, purpose")
    .eq("id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  return data;
}

async function ownerIntegration(
  session: Session,
  projectId: string,
  integrationId: string,
): Promise<AppIntegration | null> {
  if (!isUuid(projectId) || !isUuid(integrationId)) return null;
  const { data } = await session.supabase
    .from("app_integrations")
    .select(
      "id, project_id, user_id, kind, name, status, config, allowed_operations, mapping, last_tested_at, last_test_status, last_test_note, connected_at, disconnected_at, created_at, updated_at",
    )
    .eq("id", integrationId)
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  return (data ?? null) as AppIntegration | null;
}

function safeError(error: unknown): string {
  if (
    error instanceof OpenApiImportError ||
    error instanceof DatabaseIntegrationError ||
    error instanceof IntegrationNetworkError
  ) {
    return error.message.slice(0, 1_000);
  }
  if (error instanceof Error && error.name === "DeploymentError") {
    return error.message.slice(0, 1_000);
  }
  return "The integration action stopped before it could finish. Nothing outside GET TO IT was changed.";
}

async function readSecret(
  session: Session,
  integration: AppIntegration,
  environment: "development" | "production",
): Promise<string | null> {
  const { data, error } = await session.supabase.rpc("get_app_integration_secret", {
    p_id: integration.id,
    p_environment: environment,
  });
  if (error) throw new DatabaseIntegrationError("The stored credential could not be read.");
  if (typeof data !== "string" || data === "") return null;
  return decryptSecret(data, appIntegrationAad(integration.project_id, integration.id, environment));
}

async function saveSecrets(
  session: Session,
  integrationId: string,
  projectId: string,
  development: string | null,
  production: string | null,
): Promise<void> {
  const devSealed = development
    ? encryptSecret(development, appIntegrationAad(projectId, integrationId, "development"))
    : null;
  const prodSealed = production
    ? encryptSecret(production, appIntegrationAad(projectId, integrationId, "production"))
    : null;
  const { error } = await session.supabase.rpc("save_app_integration_secrets", {
    p_id: integrationId,
    p_development_secret_sealed: devSealed,
    p_production_secret_sealed: prodSealed,
  });
  if (error) throw new DatabaseIntegrationError("The encrypted credential could not be saved.");
}

async function discardEmptyIntegration(session: Session, integrationId: string): Promise<void> {
  await session.supabase.rpc("disconnect_app_integration", { p_id: integrationId });
}

export async function createOpenApiDraftAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  const name = safeIntegrationName(readText(formData, "name"));
  if (!name) return fail("Give the integration a name between 3 and 80 characters.");

  const file = formData.get("spec");
  if (!file || typeof file === "string" || typeof (file as File).text !== "function") {
    return fail("Choose a JSON OpenAPI 3 document.");
  }
  if ((file as File).size > 262_144) {
    return fail("The specification is larger than the 262144 byte limit.");
  }

  let text: string;
  try {
    text = await (file as File).text();
  } catch {
    return fail("That file could not be read. Try exporting it as JSON.");
  }

  let parsed;
  try {
    parsed = parseOpenApiDocument(text);
  } catch (error) {
    return fail(safeError(error));
  }

  const baseUrl = (readText(formData, "base_url").trim() || parsed.baseUrl).trim();
  if (baseUrl === "") return fail("Enter the API base URL, or include a server URL in the OpenAPI document.");
  try {
    await assertPublicHttpUrl(baseUrl);
  } catch (error) {
    return fail(safeError(error));
  }

  const apiKey = readText(formData, "api_key").trim();
  if (apiKey.length > 12_000) return fail("That credential is too long.");
  if (apiKey !== "" && !vaultConfigured()) return fail(VAULT_MISSING);

  const config: IntegrationConfig = {
    base_url: baseUrl,
    title: parsed.title,
    version: parsed.version,
    operations: parsed.operations,
    spec_name: (file as File).name.slice(0, 120),
  };

  const { data: integrationId, error } = await session.supabase.rpc("create_app_integration", {
    p_project_id: projectId,
    p_kind: "openapi_http",
    p_name: name,
    p_config: config,
    p_allowed_operations: [],
    p_mapping: [],
    p_status: "draft",
  });

  if (error || typeof integrationId !== "string") {
    return fail("That integration could not be saved. Check that the name is not already used.");
  }

  if (apiKey !== "") {
    try {
      await saveSecrets(session, integrationId, projectId, apiKey, null);
    } catch (error) {
      await discardEmptyIntegration(session, integrationId);
      return fail(safeError(error));
    }
  }

  refresh(projectId);
  return done(
    "OpenAPI preview saved as a draft. Review the operations, choose the allowed ones, and map them to app features.",
  );
}

export async function saveIntegrationSelectionAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  const integrationId = readText(formData, "integration_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  const integration = await ownerIntegration(session, projectId, integrationId);
  if (!integration) return fail("That integration is not available to you.");

  const selected = [...new Set(formData.getAll("operations").filter((value): value is string => typeof value === "string"))];
  if (selected.length === 0) return fail("Select at least one operation or table.");
  if (selected.length > 50) return fail("Select 50 or fewer operations or tables.");
  const mapping = parseMapping(readText(formData, "mapping"));
  if (mapping.length > 20) return fail("Keep the feature mapping to 20 lines or fewer.");

  const config: IntegrationConfig = { ...integration.config };
  let allowed: string[] = [];

  if (integration.kind === "openapi_http") {
    const available = new Set((config.operations ?? []).map((operation) => operation.key));
    allowed = selected.filter((key) => available.has(key));
    if (allowed.length === 0) return fail("Choose operations from this specification.");
  } else {
    const available = new Set((config.tables ?? []).map((table) => table.name));
    allowed = selected.filter((name) => available.has(name));
    if (allowed.length === 0) return fail("Choose tables from the inspected schema.");
    const tables = (config.tables ?? []).filter((table) => allowed.includes(table.name));
    config.migration_preview = buildMigrationPreview(tables, integrationSlug(integration.name, integration.id));
  }

  const { error } = await session.supabase.rpc("save_app_integration_selection", {
    p_id: integration.id,
    p_allowed_operations: allowed,
    p_mapping: mapping,
    p_config: config,
    p_status: "connected",
  });
  if (error) return fail("The selection could not be saved. Nothing changed.");

  refresh(projectId);
  return done(
    `Saved ${allowed.length} allowed ${integration.kind === "postgres" ? "table(s)" : "operation(s)"} and ${mapping.length} feature mapping(s).`,
  );
}

export async function connectDatabaseAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  if (!vaultConfigured()) return fail(VAULT_MISSING);

  const projectId = readText(formData, "project_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  const name = safeIntegrationName(readText(formData, "name"));
  if (!name) return fail("Give the integration a name between 3 and 80 characters.");

  const developmentUrl = readText(formData, "development_url").trim();
  const productionUrl = readText(formData, "production_url").trim();
  let development;
  let production;
  try {
    development = parsePostgresUrl(developmentUrl);
    production = parsePostgresUrl(productionUrl);
  } catch (error) {
    return fail(safeError(error));
  }
  if (development.label === production.label) {
    return fail("Development and production must be different database connections.");
  }

  let tables;
  try {
    [tables] = await Promise.all([
      inspectPostgresSchema(developmentUrl),
      testPostgresConnection(productionUrl),
    ]);
  } catch (error) {
    return fail(safeError(error));
  }

  const config: IntegrationConfig = {
    tables,
    development_label: development.label,
    production_label: production.label,
    migration_preview: buildMigrationPreview(tables, `${name}-preview`),
  };

  const { data: integrationId, error } = await session.supabase.rpc("create_app_integration", {
    p_project_id: projectId,
    p_kind: "postgres",
    p_name: name,
    p_config: config,
    p_allowed_operations: [],
    p_mapping: [],
    p_status: "connected",
  });
  if (error || typeof integrationId !== "string") {
    return fail("That database integration could not be saved. Check that the name is not already used.");
  }

  try {
    await saveSecrets(session, integrationId, projectId, developmentUrl, productionUrl);
  } catch (error) {
    await discardEmptyIntegration(session, integrationId);
    return fail(safeError(error));
  }

  refresh(projectId);
  return done(
    `Connected ${tables.length} public table(s) with a read-only schema inspection. Choose the allowed tables and review the migration preview.`,
  );
}

export async function testIntegrationAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  const integrationId = readText(formData, "integration_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  const integration = await ownerIntegration(session, projectId, integrationId);
  if (!integration) return fail("That integration is not available to you.");
  if (integration.status === "disconnected") return fail("Reconnect this integration before testing it.");

  let status: "passed" | "failed" = "failed";
  let note = "";

  try {
    const secret = await readSecret(session, integration, "development");
    if (integration.kind === "openapi_http") {
      const baseUrl = integration.config.base_url;
      if (!baseUrl) return fail("Add a base URL before testing.");
      const probe = await probePublicApi({ url: baseUrl, apiKey: secret });
      status = probe.ok ? "passed" : "failed";
      note = probe.message;
    } else {
      if (!secret) return fail("Add a development connection before testing.");
      await testPostgresConnection(secret);
      status = "passed";
      note = "Read-only PostgreSQL connection test passed.";
    }
  } catch (error) {
    note = safeError(error);
    status = "failed";
  }

  const { error } = await session.supabase.rpc("record_app_integration_test", {
    p_id: integration.id,
    p_status: status,
    p_note: note.slice(0, 500),
  });
  if (error) return fail("The test finished, but its result could not be saved.");

  refresh(projectId);
  return status === "passed"
    ? done(note)
    : fail(`Test failed: ${note}`);
}

export async function rotateIntegrationSecretAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  if (!vaultConfigured()) return fail(VAULT_MISSING);

  const projectId = readText(formData, "project_id");
  const integrationId = readText(formData, "integration_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  const integration = await ownerIntegration(session, projectId, integrationId);
  if (!integration) return fail("That integration is not available to you.");

  try {
    if (integration.kind === "openapi_http") {
      const key = readText(formData, "api_key").trim();
      if (key === "" || key.length > 12_000) return fail("Enter the replacement API key.");
      await saveSecrets(session, integration.id, projectId, key, null);
    } else {
      const dev = readText(formData, "development_url").trim();
      const prod = readText(formData, "production_url").trim();
      const development = parsePostgresUrl(dev);
      const production = parsePostgresUrl(prod);
      if (development.label === production.label) {
        return fail("Development and production must be different database connections.");
      }
      await testPostgresConnection(dev);
      await testPostgresConnection(prod);
      await saveSecrets(session, integration.id, projectId, dev, prod);
    }

    const { error } = await session.supabase.rpc("save_app_integration_selection", {
      p_id: integration.id,
      p_allowed_operations: integration.allowed_operations,
      p_mapping: integration.mapping,
      p_config: integration.config,
      p_status: "connected",
    });
    if (error) return fail("The credential was saved, but the connection state could not be updated.");
  } catch (error) {
    return fail(safeError(error));
  }

  refresh(projectId);
  return done("Credential rotated. The previous value was replaced and is no longer used.");
}

export async function disconnectIntegrationAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  const integrationId = readText(formData, "integration_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);

  const { error } = await session.supabase.rpc("disconnect_app_integration", {
    p_id: integrationId,
  });
  if (error) return fail("The integration could not be disconnected. Nothing changed.");

  refresh(projectId);
  return done("Disconnected. The sealed credential was cleared; generated files remain in the project until you remove them.");
}

export async function generateIntegrationCodeAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  const integrationId = readText(formData, "integration_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  const integration = await ownerIntegration(session, projectId, integrationId);
  if (!integration) return fail("That integration is not available to you.");
  if (integration.status !== "connected") return fail("Connect and test the integration before generating code.");

  const { data: currentFiles, error: filesError } = await session.supabase
    .from("app_files")
    .select("path, content")
    .eq("project_id", projectId)
    .eq("user_id", session.user.id);

  if (filesError || !currentFiles || currentFiles.length === 0) {
    return fail("Generate the app project files before adding integration code.");
  }

  const envExample = currentFiles.find((file) => file.path === ".env.example");
  if (!envExample) return fail("The project has no .env.example file to update.");

  const slug = integrationSlug(integration.name, integration.id);
  const prefix = integrationEnvPrefix(integration.name);
  const codePath = `lib/integrations/${slug}.ts`;
  const selected = integration.allowed_operations;

  let code: string;
  let migration: string | null = null;
  try {
    if (integration.kind === "openapi_http") {
      const operations = (integration.config.operations ?? []).filter((operation) =>
        selected.includes(operation.key),
      );
      code = generateOpenApiClient({
        name: integration.name,
        slug,
        envPrefix: prefix,
        baseUrl: integration.config.base_url ?? "",
        hasApiKey: true,
        operations,
      });
    } else {
      const tables = (integration.config.tables ?? []).filter((table) => selected.includes(table.name));
      code = generateDatabaseClient({
        name: integration.name,
        slug,
        envPrefix: prefix,
        tables,
      });
      migration = integration.config.migration_preview ?? buildMigrationPreview(tables, slug);
    }
  } catch (error) {
    return fail(safeError(error));
  }

  const next = new Map(
    (currentFiles as { path: string; content: string }[]).map((file) => [file.path, file.content]),
  );
  next.set(codePath, code);
  if (migration) next.set(`lib/integrations/${slug}.sql`, migration);
  next.set(
    ".env.example",
    addEnvExampleNames(envExample.content, integrationEnvNames(integration.kind, prefix)),
  );

  for (const value of next.values()) {
    if (value.length > 60_000) return fail("The generated integration file is too large to save.");
  }
  if (next.size > 60) return fail("The project already has the maximum number of files.");

  const files = [...next.entries()]
    .map(([path, content]) => ({ path, content }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const summary = summarizeChanges(
    currentFiles as { path: string; content: string }[],
    files,
  );

  const { data: version, error } = await session.supabase.rpc("replace_app_files", {
    p_project_id: projectId,
    p_files: files,
    p_summary: `Integration Studio: ${integration.name}. ${summary.summary}`.slice(0, 500),
    p_note: `Generated ${integration.kind === "postgres" ? "read-only database" : "OpenAPI"} wrappers. No credential is stored in a project file.`,
  });

  if (error || typeof version !== "number") {
    return fail("The generated integration files could not be saved. The previous snapshot is unchanged.");
  }

  refresh(projectId);
  return done(
    `Saved integration ${codePath} as version ${version}. Credentials remain environment references only and the code was not executed.`,
  );
}
