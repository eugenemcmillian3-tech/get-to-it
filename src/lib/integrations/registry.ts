/**
 * Phase 26 — Integration Studio.
 *
 * This module is deliberately small and pure. It describes the two kinds of
 * integration this build supports and the safe, non-secret data shape stored in
 * Postgres. It is not a second workflow connector: generated projects own the
 * code, and the existing workflow connector remains the only executor GET TO IT
 * can call. Credentials are sealed with the existing deployment vault.
 */

export type AppIntegrationKind = "openapi_http" | "postgres";
export type AppIntegrationStatus = "draft" | "connected" | "error" | "disconnected";
export type AppIntegrationTestStatus = "never" | "passed" | "failed";
export type IntegrationEnvironment = "development" | "production";

export const APP_INTEGRATION_KINDS = [
  {
    id: "openapi_http" as const,
    label: "External HTTP API",
    short: "OpenAPI 3 JSON",
    note: "Import one JSON OpenAPI 3 document, choose operations, and generate typed server-side fetch wrappers.",
  },
  {
    id: "postgres" as const,
    label: "PostgreSQL database",
    short: "PostgreSQL",
    note: "Connect separate development and production PostgreSQL databases, inspect schema read-only, and preview migrations.",
  },
] as const;

export const INTEGRATION_LIMITS = {
  maxSpecBytes: 262_144,
  maxOperations: 50,
  maxPaths: 100,
  maxTables: 120,
  maxColumnsPerTable: 80,
  maxNameChars: 80,
  maxMappingEntries: 20,
  maxMappingChars: 2_000,
  maxSecretChars: 12_000,
  maxOperationDescriptionChars: 600,
  maxOperationSummaryChars: 240,
} as const;

export type IntegrationOperation = {
  key: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
  path: string;
  operation_id: string;
  summary: string;
  description: string;
  path_params: string[];
  request_type: string;
  response_type: string;
};

export type IntegrationColumn = {
  name: string;
  type: string;
  nullable: boolean;
};

export type IntegrationTable = {
  name: string;
  columns: IntegrationColumn[];
};

export type IntegrationConfig = {
  base_url?: string;
  title?: string;
  version?: string;
  operations?: IntegrationOperation[];
  tables?: IntegrationTable[];
  development_label?: string;
  production_label?: string;
  migration_preview?: string;
  spec_name?: string;
};

export type IntegrationMapping = {
  feature: string;
  source: string;
};

export function integrationKindLabel(kind: string): string {
  return APP_INTEGRATION_KINDS.find((item) => item.id === kind)?.label ?? kind;
}

function slugPart(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  return cleaned === "" ? "integration" : cleaned;
}

/** A stable, filesystem-safe prefix. The id suffix avoids collisions. */
export function integrationSlug(name: string, id: string): string {
  const suffix = id.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase();
  return `${slugPart(name)}${suffix ? `-${suffix}` : ""}`;
}

export function integrationEnvPrefix(name: string): string {
  return `INTEGRATION_${slugPart(name).replace(/-/g, "_").toUpperCase()}`;
}

export function integrationEnvNames(kind: AppIntegrationKind, prefix: string): string[] {
  if (kind === "postgres") {
    return [`${prefix}_DATABASE_URL`, `${prefix}_DATABASE_URL_PRODUCTION`];
  }
  return [`${prefix}_BASE_URL`, `${prefix}_API_KEY`];
}

/** Parse `feature = source` lines without turning them into executable data. */
export function parseMapping(value: string): IntegrationMapping[] {
  const seen = new Set<string>();
  const rows: IntegrationMapping[] = [];
  for (const raw of value.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    const divider = line.includes("=") ? "=" : line.includes(":") ? ":" : null;
    if (!divider) continue;
    const index = line.indexOf(divider);
    const feature = line.slice(0, index).trim().slice(0, 80);
    const source = line.slice(index + 1).trim().slice(0, 120);
    if (feature === "" || source === "") continue;
    const key = `${feature}|${source}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ feature, source });
    if (rows.length >= INTEGRATION_LIMITS.maxMappingEntries) break;
  }
  return rows;
}

export function mappingToText(mapping: IntegrationMapping[]): string {
  return mapping.map((item) => `${item.feature} = ${item.source}`).join("\n");
}

/**
 * Append names only. Existing comments and values are untouched, and no secret
 * value is ever generated here.
 */
export function addEnvExampleNames(existing: string, names: string[]): string {
  const present = new Set(
    existing
      .split(/\r?\n/)
      .map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1] ?? "")
      .filter(Boolean),
  );
  const missing = names.filter((name) => !present.has(name));
  if (missing.length === 0) return existing;
  const base = existing.endsWith("\n") || existing === "" ? existing : `${existing}\n`;
  const block = [
    "# Integration Studio. Names only; never commit values.",
    ...missing.map((name) => `${name}=`),
  ].join("\n");
  return `${base}${base === "" ? "" : "\n"}${block}\n`;
}

export function safeIntegrationName(value: string): string | null {
  const name = value.trim();
  if (name.length < 3 || name.length > INTEGRATION_LIMITS.maxNameChars) return null;
  if (/[\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
}

export function statusLabel(status: string): string {
  return (
    {
      draft: "Draft",
      connected: "Connected",
      error: "Needs attention",
      disconnected: "Disconnected",
      never: "Never tested",
      passed: "Test passed",
      failed: "Test failed",
    }[status] ?? status
  );
}
