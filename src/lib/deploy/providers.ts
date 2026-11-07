import { DeploymentError, redactSecrets, type DeploymentFile } from "@/lib/deployments";

/**
 * Real provider adapters, with an injectable fetch so tests can prove the
 * request shape without making a network call. Tokens are passed explicitly and
 * are never put in an error, URL, log or returned object.
 */

export type FetchLike = typeof fetch;
export class ProviderError extends DeploymentError {
  status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
  }
}

type Json = Record<string, unknown>;

async function requestJson(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  token: string,
  timeoutMs = 25_000,
): Promise<Json> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "get-to-it-deployment",
        ...(init.headers ?? {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ProviderError("The provider could not be reached. Nothing was retried.");
  }

  const text = await response.text();
  let payload: Json = {};
  try {
    payload = text ? (JSON.parse(text) as Json) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const raw =
      typeof payload.message === "string"
        ? payload.message
        : typeof payload.error === "string"
          ? payload.error
          : `Provider returned HTTP ${response.status}.`;
    throw new ProviderError(
      redactSecrets(raw, [token]).slice(0, 500),
      response.status,
    );
  }
  return payload;
}

function encoded(value: string): string {
  return encodeURIComponent(value);
}

function safeBranch(branch: string): string {
  if (
    branch.length < 1 ||
    branch.length > 120 ||
    branch.includes("..") ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    !/^[A-Za-z0-9._/-]+$/.test(branch)
  ) {
    throw new ProviderError("Use a simple GitHub branch name.");
  }
  return branch;
}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

export type GitHubValidation = {
  login: string;
  repo_id: number | null;
  full_name: string;
  private: boolean;
  default_branch: string;
  branch: string;
};

export async function validateGitHub(input: {
  token: string;
  repo: string;
  branch: string;
  fetchImpl?: FetchLike;
}): Promise<GitHubValidation> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const repo = input.repo.trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new ProviderError("Enter a GitHub repository as owner/name.");
  }
  const branch = safeBranch(input.branch.trim());
  const user = await requestJson(fetchImpl, "https://api.github.com/user", { method: "GET" }, input.token);
  const repoPayload = await requestJson(
    fetchImpl,
    `https://api.github.com/repos/${repo}`,
    { method: "GET" },
    input.token,
  );
  await requestJson(
    fetchImpl,
    `https://api.github.com/repos/${repo}/git/ref/${encoded(`heads/${branch}`)}`,
    { method: "GET" },
    input.token,
  );

  return {
    login: String(user.login ?? ""),
    repo_id: typeof repoPayload.id === "number" ? repoPayload.id : null,
    full_name: String(repoPayload.full_name ?? repo),
    private: repoPayload.private === true,
    default_branch: String(repoPayload.default_branch ?? "main"),
    branch,
  };
}

export type GitHubCommitResult = {
  commit_sha: string;
  branch: string;
  parent_sha: string | null;
};

export async function commitSnapshot(input: {
  token: string;
  repo: string;
  branch: string;
  files: DeploymentFile[];
  sourceVersion: number;
  sourceDigest: string;
  fetchImpl?: FetchLike;
}): Promise<GitHubCommitResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const repo = input.repo.trim();
  const branch = safeBranch(input.branch.trim());
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new ProviderError("The connected GitHub repository is invalid.");
  }
  if (input.files.length === 0) throw new ProviderError("There are no files to commit.");

  let parentSha: string | null = null;
  try {
    const ref = await requestJson(
      fetchImpl,
      `https://api.github.com/repos/${repo}/git/ref/${encoded(`heads/${branch}`)}`,
      { method: "GET" },
      input.token,
    );
    const object = ref.object as Json | undefined;
    parentSha = typeof object?.sha === "string" ? object.sha : null;
  } catch (error) {
    if (!(error instanceof ProviderError) || error.status !== 404) throw error;
  }

  const entries: Json[] = [];
  for (const file of [...input.files].sort((a, b) => a.path.localeCompare(b.path))) {
    const blob = await requestJson(
      fetchImpl,
      `https://api.github.com/repos/${repo}/git/blobs`,
      {
        method: "POST",
        body: JSON.stringify({
          content: Buffer.from(file.content, "utf8").toString("base64"),
          encoding: "base64",
        }),
      },
      input.token,
    );
    if (typeof blob.sha !== "string") throw new ProviderError("GitHub did not return a blob id.");
    entries.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
  }

  // No base_tree: the branch tree is exactly the approved snapshot. This is
  // shown in the plan, because it removes tracked files outside the snapshot.
  const tree = await requestJson(
    fetchImpl,
    `https://api.github.com/repos/${repo}/git/trees`,
    { method: "POST", body: JSON.stringify({ tree: entries }) },
    input.token,
  );
  if (typeof tree.sha !== "string") throw new ProviderError("GitHub did not return a tree id.");

  const commit = await requestJson(
    fetchImpl,
    `https://api.github.com/repos/${repo}/git/commits`,
    {
      method: "POST",
      body: JSON.stringify({
        message: `GET TO IT deployment: source version ${input.sourceVersion}\n\nSource digest: ${input.sourceDigest}`,
        tree: tree.sha,
        ...(parentSha ? { parents: [parentSha] } : {}),
      }),
    },
    input.token,
  );
  if (typeof commit.sha !== "string") throw new ProviderError("GitHub did not return a commit id.");

  if (parentSha) {
    await requestJson(
      fetchImpl,
      `https://api.github.com/repos/${repo}/git/refs/${encoded(`heads/${branch}`)}`,
      { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false }) },
      input.token,
    );
  } else {
    await requestJson(
      fetchImpl,
      `https://api.github.com/repos/${repo}/git/refs`,
      { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }) },
      input.token,
    );
  }

  return { commit_sha: commit.sha, branch, parent_sha: parentSha };
}

// ---------------------------------------------------------------------------
// Vercel
// ---------------------------------------------------------------------------

export type VercelValidation = {
  account: string;
  project_id: string;
  project_name: string;
  team_id: string | null;
};

function teamQuery(teamId: string | null): string {
  return teamId ? `?teamId=${encoded(teamId)}` : "";
}

export async function validateVercel(input: {
  token: string;
  project: string;
  teamId?: string | null;
  fetchImpl?: FetchLike;
}): Promise<VercelValidation> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const teamId = input.teamId?.trim() || null;
  const project = input.project.trim();
  if (project === "") throw new ProviderError("Enter a Vercel project id or name.");
  const user = await requestJson(fetchImpl, "https://api.vercel.com/v2/user", { method: "GET" }, input.token);
  const payload = await requestJson(
    fetchImpl,
    `https://api.vercel.com/v9/projects/${encoded(project)}${teamQuery(teamId)}`,
    { method: "GET" },
    input.token,
  );
  const id = typeof payload.id === "string" ? payload.id : "";
  const name = typeof payload.name === "string" ? payload.name : "";
  if (!id || !name) throw new ProviderError("Vercel did not return that project.");
  return {
    account: String(user.username ?? user.email ?? "Vercel account"),
    project_id: id,
    project_name: name,
    team_id: teamId,
  };
}

export type VercelDomainResult = {
  verified: boolean;
  detail: Record<string, unknown>;
};

/** Attach a customer domain to the connected Vercel project. DNS is separate. */
export async function addVercelDomain(input: {
  token: string;
  projectId: string;
  teamId: string | null;
  domain: string;
  fetchImpl?: FetchLike;
}): Promise<VercelDomainResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const payload = await requestJson(
    fetchImpl,
    `https://api.vercel.com/v10/projects/${encoded(input.projectId)}/domains${teamQuery(input.teamId)}`,
    { method: "POST", body: JSON.stringify({ name: input.domain }) },
    input.token,
  );

  return {
    verified: payload.verified === true,
    detail: payload as Record<string, unknown>,
  };
}

export type VercelEnvInput = {
  name: string;
  value: string;
  visibility: "public" | "server";
};

export async function upsertVercelEnv(input: {
  token: string;
  projectId: string;
  teamId: string | null;
  target: "preview" | "production";
  values: VercelEnvInput[];
  fetchImpl?: FetchLike;
}): Promise<{ updated: string[]; failed: string[] }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const q = input.teamId ? `&teamId=${encoded(input.teamId)}` : "";
  const list = await requestJson(
    fetchImpl,
    `https://api.vercel.com/v10/projects/${encoded(input.projectId)}/env${input.teamId ? `?teamId=${encoded(input.teamId)}` : ""}`,
    { method: "GET" },
    input.token,
  );
  const existing = new Map<string, { id: string; targets: string[] }>();
  const envs = Array.isArray(list.envs) ? list.envs : Array.isArray(list) ? list : [];
  for (const item of envs as Json[]) {
    if (typeof item.key !== "string" || typeof item.id !== "string") continue;
    const targets = Array.isArray(item.target)
      ? item.target.filter((target): target is string => typeof target === "string")
      : typeof item.target === "string"
        ? [item.target]
        : [];
    existing.set(item.key, { id: item.id, targets });
  }

  const updated: string[] = [];
  const failed: string[] = [];
  for (const value of input.values) {
    try {
      const previous = existing.get(value.name);
      if (previous) {
        const targets = [...new Set([...previous.targets, input.target])];
        await requestJson(
          fetchImpl,
          `https://api.vercel.com/v9/projects/${encoded(input.projectId)}/env/${encoded(previous.id)}?teamId=${encoded(input.teamId ?? "")}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              value: value.value,
              type: value.visibility === "public" ? "plain" : "encrypted",
              target: targets,
            }),
          },
          input.token,
        );
      } else {
        const created = await requestJson(
          fetchImpl,
          `https://api.vercel.com/v10/projects/${encoded(input.projectId)}/env?upsert=true${q}`,
          {
            method: "POST",
            body: JSON.stringify({
              key: value.name,
              value: value.value,
              type: value.visibility === "public" ? "plain" : "encrypted",
              target: [input.target],
            }),
          },
          input.token,
        );
        const failedItems = Array.isArray(created.failed) ? (created.failed as Json[]) : [];
        if (failedItems.length > 0) throw new ProviderError("Vercel refused one environment variable.");
      }
      updated.push(value.name);
    } catch {
      // Never include the value or the provider response in the error.
      failed.push(value.name);
    }
  }
  return { updated, failed };
}

export type VercelDeployment = {
  id: string;
  ready_state: string;
  url: string | null;
  error: string | null;
};

function vercelUrl(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  return /^https?:\/\//.test(value) ? value : `https://${value}`;
}

export async function createVercelDeployment(input: {
  token: string;
  projectId: string;
  projectName: string;
  teamId: string | null;
  target: "preview" | "production";
  repo: { owner: string; name: string };
  branch: string;
  commitSha: string;
  fetchImpl?: FetchLike;
}): Promise<VercelDeployment> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const query = new URLSearchParams();
  if (input.teamId) query.set("teamId", input.teamId);
  query.set("forceNew", "1");
  const payload = await requestJson(
    fetchImpl,
    `https://api.vercel.com/v13/deployments?${query.toString()}`,
    {
      method: "POST",
      body: JSON.stringify({
        name: input.projectName,
        project: input.projectId,
        ...(input.target === "production" ? { target: "production" } : {}),
        gitSource: {
          type: "github",
          org: input.repo.owner,
          repo: input.repo.name,
          ref: input.branch,
          sha: input.commitSha,
        },
      }),
    },
    input.token,
  );
  const id = typeof payload.id === "string" ? payload.id : "";
  if (!id) throw new ProviderError("Vercel did not return a deployment id.");
  return {
    id,
    ready_state: String(payload.readyState ?? "QUEUED"),
    url: vercelUrl(payload.url),
    error: typeof payload.errorMessage === "string" ? redactSecrets(payload.errorMessage, [input.token]) : null,
  };
}

export async function getVercelDeployment(input: {
  token: string;
  deploymentId: string;
  teamId: string | null;
  fetchImpl?: FetchLike;
}): Promise<VercelDeployment> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const payload = await requestJson(
    fetchImpl,
    `https://api.vercel.com/v13/deployments/${encoded(input.deploymentId)}${teamQuery(input.teamId)}`,
    { method: "GET" },
    input.token,
  );
  return {
    id: String(payload.id ?? input.deploymentId),
    ready_state: String(payload.readyState ?? "UNKNOWN"),
    url: vercelUrl(payload.url),
    error:
      typeof payload.errorMessage === "string"
        ? redactSecrets(payload.errorMessage, [input.token])
        : null,
  };
}

// ---------------------------------------------------------------------------
// Supabase direct Postgres
// ---------------------------------------------------------------------------

export type PostgresTarget = {
  ref: string;
  host: string;
  database: string;
};

export function parsePostgresTarget(value: string): PostgresTarget {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DeploymentError("Enter a full Postgres connection string.");
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) throw new DeploymentError("Use a Postgres connection string.");
  if (!url.hostname || !url.pathname || url.pathname === "/") {
    throw new DeploymentError("The Postgres connection string needs a host and database.");
  }
  const sslmode = url.searchParams.get("sslmode");
  if (sslmode !== "require" && sslmode !== "verify-full") {
    throw new DeploymentError("Add sslmode=require or sslmode=verify-full to each Supabase connection string.");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const direct = /^db\.([a-z0-9-]+)\.supabase\.co$/i.exec(url.hostname);
  const poolerUser = decodeURIComponent(url.username);
  const pooler =
    /(^|\.)pooler\.supabase\.com$/i.test(url.hostname)
      ? /^postgres\.([a-z0-9-]+)$/i.exec(poolerUser)
      : null;
  const ref = direct?.[1] ?? pooler?.[1] ?? database;
  return { ref, host: url.hostname, database };
}

export function validateSupabasePair(devUrl: string, prodUrl: string): {
  development_ref: string;
  production_ref: string;
  account: string;
} {
  const dev = parsePostgresTarget(devUrl);
  const prod = parsePostgresTarget(prodUrl);
  if (dev.ref === prod.ref || dev.host === prod.host) {
    throw new DeploymentError("Development and production must be different Supabase projects or databases.");
  }
  return {
    development_ref: dev.ref,
    production_ref: prod.ref,
    account: `Supabase ${dev.ref} → ${prod.ref}`,
  };
}

export async function checkPostgresTarget(url: string): Promise<void> {
  const { Client } = await import("pg");
  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10_000,
    statement_timeout: 10_000,
    application_name: "get-to-it-deployment-check",
  });
  try {
    await client.connect();
    await client.query("select 1");
  } catch {
    throw new DeploymentError("The Supabase database could not be reached with that connection string.");
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function applyPostgresMigrations(input: {
  url: string;
  migrations: { path: string; sql: string }[];
}): Promise<{ applied: string[] }> {
  if (input.migrations.length === 0) return { applied: [] };
  const { Client } = await import("pg");
  const client = new Client({
    connectionString: input.url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
    statement_timeout: 60_000,
    application_name: "get-to-it-migrations",
  });
  try {
    await client.connect();
    await client.query("begin");
    for (const migration of input.migrations) {
      await client.query(migration.sql);
    }
    await client.query("commit");
    return { applied: input.migrations.map((migration) => migration.path) };
  } catch {
    await client.query("rollback").catch(() => undefined);
    throw new DeploymentError("The approved migration transaction failed and was rolled back.");
  } finally {
    await client.end().catch(() => undefined);
  }
}
