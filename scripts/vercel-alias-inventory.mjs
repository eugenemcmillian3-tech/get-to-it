#!/usr/bin/env node
/**
 * Read-only Vercel project, domain and alias inventory.
 *
 * Enumerates every accessible team and the personal scope, then lists each
 * project's project domains and aliases. Only GET requests are made. The token
 * is read from VERCEL_TOKEN and is never printed.
 *
 * Usage:
 *   VERCEL_TOKEN=... node scripts/vercel-alias-inventory.mjs
 *   VERCEL_TOKEN=... node scripts/vercel-alias-inventory.mjs --json
 */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_API_BASE = "https://api.vercel.com";
const PAGE_LIMIT = 100;
const MAX_PAGES = 100;
const REQUEST_TIMEOUT_MS = 30_000;

class VercelApiError extends Error {
  constructor(message, { status, code = null, path }) {
    super(message);
    this.name = "VercelApiError";
    this.status = status;
    this.code = code;
    this.path = path;
  }
}

async function requestJson({ token, fetchImpl, apiBase, path, params = {} }) {
  const url = new URL(path, apiBase);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not reach the Vercel API at ${path}: ${detail}`);
  }

  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const code = typeof body?.error?.code === "string" ? body.error.code : null;
    const message =
      typeof body?.error?.message === "string" ? body.error.message : `HTTP ${response.status}`;
    throw new VercelApiError(message, { status: response.status, code, path });
  }

  if (body === null) {
    throw new VercelApiError("Vercel returned invalid JSON.", {
      status: response.status,
      path,
    });
  }

  return body;
}

async function collectPages({ context, path, params = {}, itemsKey, cursorKey }) {
  const items = [];
  let cursor = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const pageParams = { ...params, limit: PAGE_LIMIT };
    if (cursor !== null) pageParams[cursorKey] = cursor;

    const data = await requestJson({ ...context, path, params: pageParams });
    const pageItems = Array.isArray(data?.[itemsKey]) ? data[itemsKey] : [];
    items.push(...pageItems);

    const next = data?.pagination?.next;
    if (next === undefined || next === null) return items;
    if (String(next) === String(cursor)) {
      throw new Error(`Vercel pagination did not advance for ${path}.`);
    }
    cursor = next;
  }

  throw new Error(`Vercel pagination exceeded ${MAX_PAGES} pages for ${path}.`);
}

async function listTeams(context) {
  return collectPages({
    context,
    path: "/v2/teams",
    itemsKey: "teams",
    cursorKey: "until",
  });
}

async function listProjects(context, teamId) {
  return collectPages({
    context,
    path: "/v9/projects",
    params: teamId ? { teamId } : {},
    itemsKey: "projects",
    cursorKey: "from",
  });
}

async function listDomains(context, teamId, projectId) {
  return collectPages({
    context,
    path: `/v9/projects/${encodeURIComponent(projectId)}/domains`,
    params: teamId ? { teamId } : {},
    itemsKey: "domains",
    cursorKey: "until",
  });
}

async function listAliases(context, teamId, projectId) {
  return collectPages({
    context,
    path: "/v4/aliases",
    params: { projectId, ...(teamId ? { teamId } : {}) },
    itemsKey: "aliases",
    cursorKey: "until",
  });
}

function normalizeDomain(domain) {
  return {
    name: typeof domain?.name === "string" ? domain.name : "",
    verified: typeof domain?.verified === "boolean" ? domain.verified : null,
    redirect: typeof domain?.redirect === "string" ? domain.redirect : null,
    gitBranch: typeof domain?.gitBranch === "string" ? domain.gitBranch : null,
  };
}

function normalizeAlias(alias) {
  return {
    alias: typeof alias?.alias === "string" ? alias.alias : "",
    uid: typeof alias?.uid === "string" ? alias.uid : null,
    deploymentId:
      typeof alias?.deploymentId === "string"
        ? alias.deploymentId
        : typeof alias?.deployment?.id === "string"
          ? alias.deployment.id
          : null,
    deploymentUrl:
      typeof alias?.deployment?.url === "string" ? alias.deployment.url : null,
    createdAt: typeof alias?.createdAt === "number" ? alias.createdAt : null,
  };
}

async function inventoryScope(context, scope, teamId) {
  const projects = await listProjects(context, teamId);
  const summaries = [];

  for (const project of projects) {
    const id = typeof project?.id === "string" ? project.id : "";
    const name = typeof project?.name === "string" ? project.name : "";
    if (!id || !name) {
      throw new Error(`Vercel returned a project without an id or name in ${scope.name}.`);
    }

    const domains = (await listDomains(context, teamId, id))
      .map(normalizeDomain)
      .filter((domain) => domain.name !== "")
      .sort((left, right) => left.name.localeCompare(right.name));

    const aliases = (await listAliases(context, teamId, id))
      .map(normalizeAlias)
      .filter((alias) => alias.alias !== "")
      .sort((left, right) => left.alias.localeCompare(right.alias));

    summaries.push({ id, name, domains, aliases });
  }

  return { scope, projects: summaries };
}

export async function inventoryVercel({
  token,
  fetchImpl = fetch,
  apiBase = DEFAULT_API_BASE,
  teamId,
} = {}) {
  if (typeof token !== "string" || token.trim() === "") {
    throw new Error("VERCEL_TOKEN is required.");
  }

  const context = { token: token.trim(), fetchImpl, apiBase };
  const configuredTeamId =
    typeof teamId === "string" && teamId.trim() !== "" ? teamId.trim() : null;
  const warnings = [];

  let teams;
  try {
    teams = await listTeams(context);
  } catch (error) {
    if (configuredTeamId && error instanceof VercelApiError && error.status === 403) {
      warnings.push("Team listing was not permitted; using VERCEL_TEAM_ID.");
      teams = [];
    } else {
      throw error;
    }
  }

  const normalizedTeams = teams.map((team) => {
    if (typeof team?.id !== "string" || team.id === "") {
      throw new Error("Vercel returned a team without an id.");
    }
    return {
      id: team.id,
      slug: typeof team.slug === "string" ? team.slug : null,
      name: typeof team.name === "string" ? team.name : null,
    };
  });

  if (configuredTeamId && !normalizedTeams.some((team) => team.id === configuredTeamId)) {
    normalizedTeams.push({
      id: configuredTeamId,
      slug: null,
      name: "Configured team",
    });
  }

  const scopes = [];
  for (const team of normalizedTeams) {
    const scope = {
      kind: "team",
      id: team.id,
      slug: team.slug,
      name: team.name ?? team.slug ?? team.id,
    };
    scopes.push(await inventoryScope(context, scope, team.id));
  }

  try {
    scopes.push(
      await inventoryScope(
        context,
        { kind: "personal", id: null, slug: null, name: "Personal" },
        null,
      ),
    );
  } catch (error) {
    if (error instanceof VercelApiError && error.status === 403) {
      warnings.push("The personal Vercel scope is not accessible with this token; skipped.");
    } else {
      throw error;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    scopes,
    warnings,
  };
}

function formatTimestamp(value) {
  if (typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function formatInventory(inventory) {
  const lines = ["Vercel alias inventory", `Generated: ${inventory.generatedAt}`];
  let totalProjects = 0;
  let totalDomains = 0;
  let totalAliases = 0;

  for (const entry of inventory.scopes) {
    const { scope, projects } = entry;
    const scopeLabel =
      scope.kind === "team" ? `team ${scope.slug ?? scope.id}` : "personal scope";
    lines.push("", `Scope: ${scopeLabel}${scope.kind === "team" ? ` (${scope.id})` : ""}`);

    if (scope.kind === "team" && scope.name !== scope.slug) {
      lines.push(`  Name: ${scope.name}`);
    }

    lines.push(`  Projects: ${projects.length}`);
    if (projects.length === 0) continue;

    for (const project of projects) {
      totalProjects += 1;
      totalDomains += project.domains.length;
      totalAliases += project.aliases.length;

      lines.push(`  Project: ${project.name} (${project.id})`);
      if (project.domains.length === 0) {
        lines.push("    Domains (0): none");
      } else {
        lines.push(`    Domains (${project.domains.length}):`);
        for (const domain of project.domains) {
          const verified =
            domain.verified === true ? " [verified]" : domain.verified === false ? " [unverified]" : "";
          const redirect = domain.redirect ? ` -> ${domain.redirect}` : "";
          lines.push(`      - ${domain.name}${verified}${redirect}`);
        }
      }

      if (project.aliases.length === 0) {
        lines.push("    Aliases (0): none");
      } else {
        lines.push(`    Aliases (${project.aliases.length}):`);
        for (const alias of project.aliases) {
          const target = alias.deploymentUrl ?? alias.deploymentId;
          const created = formatTimestamp(alias.createdAt);
          lines.push(
            `      - ${alias.alias}${target ? ` -> ${target}` : ""}${created ? ` (${created})` : ""}`,
          );
        }
      }
    }
  }

  lines.push(
    "",
    `Totals: ${inventory.scopes.length} scope(s), ${totalProjects} project(s), ${totalDomains} project domain(s), ${totalAliases} alias(es).`,
  );

  if (inventory.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const warning of inventory.warnings) lines.push(`  - ${warning}`);
  }

  lines.push("", "Read-only: no projects, domains or aliases were changed.");
  return lines.join("\n");
}

function printUsage() {
  console.log(`Usage: VERCEL_TOKEN=... node scripts/vercel-alias-inventory.mjs [--json]

Options:
  --json    Print the complete inventory as JSON.
  --help    Show this help.

Environment:
  VERCEL_TOKEN     Vercel access token (required).
  VERCEL_TEAM_ID   Optional fallback when the token cannot list teams.

The command performs GET requests only and never prints the token.`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }

  const unknown = args.filter((arg) => arg !== "--json");
  if (unknown.length > 0) {
    throw new Error(`Unknown argument: ${unknown[0]}`);
  }

  const token = process.env.VERCEL_TOKEN?.trim();
  if (!token) {
    printUsage();
    throw new Error("VERCEL_TOKEN is required.");
  }

  const inventory = await inventoryVercel({
    token,
    teamId: process.env.VERCEL_TEAM_ID?.trim() || undefined,
  });

  if (args.includes("--json")) {
    console.log(JSON.stringify(inventory, null, 2));
  } else {
    console.log(formatInventory(inventory));
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";

if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(
      `vercel-alias-inventory: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
