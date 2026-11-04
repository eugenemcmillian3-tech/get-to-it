import crypto from "node:crypto";
import { DeploymentError, redactSecrets } from "@/lib/deployments";

/**
 * Supabase Integration OAuth and Management API calls.
 *
 * The OAuth client secret stays in the server environment. Access and refresh
 * tokens are returned to the caller, which seals them before storage. No helper
 * here logs a token or puts one in a URL, error message or returned metadata.
 */

export type SupabaseOAuthClient = {
  clientId: string;
  clientSecret: string;
};

export type SupabaseTokenSet = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
};

export type SupabaseOrganization = {
  id: string;
  slug: string;
  name: string;
};

export type SupabaseProject = {
  id: string;
  ref: string;
  name: string;
  organization_slug: string;
  status: string;
  region: string;
};

export type SupabaseProjectApiKeys = {
  ref: string;
  url: string;
  anonKey: string;
};

export type SupabaseOAuthError = DeploymentError & { status: number | null };

export type SupabaseClientValidation =
  | { ok: true; status: number }
  | {
      ok: false;
      reason: "invalid_client" | "unreachable" | "unexpected";
      status: number | null;
    };

type Json = Record<string, unknown>;
export type FetchLike = typeof fetch;

const AUTHORIZE_URL = "https://api.supabase.com/v1/oauth/authorize";
const TOKEN_URL = "https://api.supabase.com/v1/oauth/token";
const API_BASE = "https://api.supabase.com/v1";

export function supabaseOAuthClient(): SupabaseOAuthClient | null {
  const clientId = process.env.SUPABASE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.SUPABASE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function supabaseOAuthConfigured(): boolean {
  return supabaseOAuthClient() !== null;
}

export function sha256Base64Url(value: string): string {
  return crypto.createHash("sha256").update(value).digest("base64url");
}

/**
 * OAuth state is 32 random bytes (256 bits), not a password. The callback looks
 * it up by this deterministic digest. A slow password KDF would add latency
 * without improving resistance to guessing a 256-bit single-use nonce.
 */
export function stateHash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(48).toString("base64url");
  return { verifier, challenge: sha256Base64Url(verifier) };
}

export function createOAuthState(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function supabaseAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  organizationSlug?: string | null;
}): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (input.organizationSlug) url.searchParams.set("organization_slug", input.organizationSlug);
  return url.toString();
}

async function readJson(response: Response): Promise<Json> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Json;
  } catch {
    return {};
  }
}

function oauthError(message: string, status: number | null = null): SupabaseOAuthError {
  const error = new DeploymentError(message) as SupabaseOAuthError;
  error.name = "SupabaseOAuthError";
  error.status = status;
  return error;
}

function providerMessage(payload: Json, status: number, secrets: string[] = []): string {
  const raw =
    typeof payload.message === "string"
      ? payload.message
      : typeof payload.error_description === "string"
        ? payload.error_description
        : typeof payload.error === "string"
          ? payload.error
          : `Supabase returned HTTP ${status}.`;
  return redactSecrets(raw, secrets).slice(0, 500);
}

async function tokenRequest(
  body: URLSearchParams,
  fetchImpl: FetchLike,
): Promise<SupabaseTokenSet> {
  const client = supabaseOAuthClient();
  if (!client) {
    throw oauthError(
      "Supabase OAuth is not configured. Add SUPABASE_OAUTH_CLIENT_ID and SUPABASE_OAUTH_CLIENT_SECRET.",
    );
  }
  const basic = Buffer.from(`${client.clientId}:${client.clientSecret}`, "utf8").toString("base64");
  let response: Response;
  try {
    response = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
        "User-Agent": "get-to-it-supabase-oauth",
      },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    throw oauthError("Supabase OAuth could not be reached. Nothing was retried.");
  }
  const payload = await readJson(response);
  if (!response.ok) {
    throw oauthError(
      providerMessage(payload, response.status, [client.clientSecret]),
      response.status,
    );
  }
  const accessToken = payload.access_token;
  const refreshToken = payload.refresh_token;
  if (typeof accessToken !== "string" || accessToken === "" || typeof refreshToken !== "string" || refreshToken === "") {
    throw oauthError("Supabase did not return a usable OAuth token set.", response.status);
  }
  const expiresIn = typeof payload.expires_in === "number" && payload.expires_in > 0
    ? payload.expires_in
    : 3600;
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: expiresIn,
    token_type: typeof payload.token_type === "string" ? payload.token_type : "bearer",
    scope: typeof payload.scope === "string" ? payload.scope : "",
  };
}

/**
 * Preflight the configured client against the Management API token endpoint.
 * A valid client reaches the grant check and returns invalid_grant; a client
 * created for a project's Auth OAuth server returns invalid_client here.
 * No authorization code is used and no token is stored.
 */
export async function validateSupabaseManagementClient(input: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: FetchLike;
}): Promise<SupabaseClientValidation> {
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(
          `${input.clientId}:${input.clientSecret}`,
          "utf8",
        ).toString("base64")}`,
        "User-Agent": "get-to-it-supabase-oauth-preflight",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: "invalid-preflight-code",
        redirect_uri: input.redirectUri,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, reason: "unreachable", status: null };
  }

  const payload = await readJson(response);
  const error = typeof payload.error === "string" ? payload.error : "";
  const message = typeof payload.message === "string" ? payload.message : "";
  // Supabase has returned both shapes for a recognized client with a bad code:
  // 400 invalid_grant, and 404 "Invalid or expired OAuth authorization".
  if (
    (response.status === 400 && error === "invalid_grant") ||
    (response.status === 404 && /invalid or expired oauth authorization/i.test(message))
  ) {
    return { ok: true, status: response.status };
  }
  if (
    response.status === 401 ||
    response.status === 422 ||
    error === "invalid_client" ||
    /invalid client_id|unrecognized client_id/i.test(message)
  ) {
    return { ok: false, reason: "invalid_client", status: response.status };
  }
  return { ok: false, reason: "unexpected", status: response.status };
}

export async function exchangeSupabaseCode(input: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  fetchImpl?: FetchLike;
}): Promise<SupabaseTokenSet> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  });
  return tokenRequest(body, input.fetchImpl ?? fetch);
}

export async function refreshSupabaseToken(input: {
  refreshToken: string;
  fetchImpl?: FetchLike;
}): Promise<SupabaseTokenSet> {
  return tokenRequest(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: input.refreshToken }),
    input.fetchImpl ?? fetch,
  );
}

async function managementRequest(input: {
  accessToken: string;
  path: string;
  method?: string;
  body?: unknown;
  fetchImpl?: FetchLike;
}): Promise<Json | Json[]> {
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(`${API_BASE}${input.path}`, {
      method: input.method ?? "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.accessToken}`,
        "User-Agent": "get-to-it-supabase-management",
      },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw oauthError("The Supabase Management API could not be reached. Nothing was retried.");
  }
  const payload = await readJson(response);
  if (!response.ok) {
    throw oauthError(providerMessage(payload, response.status, [input.accessToken]), response.status);
  }
  if (Array.isArray(payload)) return payload as Json[];
  return payload;
}

export async function listSupabaseOrganizations(input: {
  accessToken: string;
  fetchImpl?: FetchLike;
}): Promise<SupabaseOrganization[]> {
  const payload = await managementRequest({
    accessToken: input.accessToken,
    path: "/organizations",
    fetchImpl: input.fetchImpl,
  });
  if (!Array.isArray(payload)) throw oauthError("Supabase returned an invalid organization list.");
  return payload
    .filter((item): item is Json => Boolean(item) && typeof item === "object")
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : "",
      slug: typeof item.slug === "string" ? item.slug : "",
      name: typeof item.name === "string" ? item.name : "",
    }))
    .filter((item) => item.slug !== "" && item.name !== "");
}

export async function listSupabaseProjects(input: {
  accessToken: string;
  fetchImpl?: FetchLike;
}): Promise<SupabaseProject[]> {
  const payload = await managementRequest({
    accessToken: input.accessToken,
    path: "/projects",
    fetchImpl: input.fetchImpl,
  });
  if (!Array.isArray(payload)) throw oauthError("Supabase returned an invalid project list.");
  return payload
    .filter((item): item is Json => Boolean(item) && typeof item === "object")
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : "",
      ref: typeof item.ref === "string" ? item.ref : "",
      name: typeof item.name === "string" ? item.name : "",
      organization_slug: typeof item.organization_slug === "string" ? item.organization_slug : "",
      status: typeof item.status === "string" ? item.status : "UNKNOWN",
      region: typeof item.region === "string" ? item.region : "",
    }))
    .filter((item) => item.ref !== "" && item.name !== "");
}

function anonKeyFrom(payload: Json[]): string | null {
  const keys = payload
    .filter((item): item is Json => Boolean(item) && typeof item === "object")
    .map((item) => ({
      type: typeof item.type === "string" ? item.type : "",
      name: typeof item.name === "string" ? item.name : "",
      apiKey: typeof item.api_key === "string" ? item.api_key : "",
    }))
    .filter((item) => item.apiKey !== "");
  const anon = keys.find((item) => item.type === "anon" || item.name === "anon");
  if (anon) return anon.apiKey;
  const publishable = keys.find((item) => item.type === "publishable" || item.name === "publishable");
  return publishable?.apiKey ?? null;
}

export async function getSupabaseProjectApiKeys(input: {
  accessToken: string;
  ref: string;
  fetchImpl?: FetchLike;
}): Promise<SupabaseProjectApiKeys> {
  if (!/^[a-z0-9]{10,30}$/i.test(input.ref)) {
    throw oauthError("That Supabase project reference is invalid.");
  }
  const payload = await managementRequest({
    accessToken: input.accessToken,
    path: `/projects/${encodeURIComponent(input.ref)}/api-keys?reveal=true`,
    fetchImpl: input.fetchImpl,
  });
  if (!Array.isArray(payload)) throw oauthError("Supabase returned an invalid API-key list.");
  const anonKey = anonKeyFrom(payload);
  if (!anonKey) {
    throw oauthError("That Supabase project has no anon or publishable API key available.");
  }
  return { ref: input.ref, url: `https://${input.ref}.supabase.co`, anonKey };
}

export async function runSupabaseQuery(input: {
  accessToken: string;
  ref: string;
  query: string;
  fetchImpl?: FetchLike;
}): Promise<void> {
  if (!/^[a-z0-9]{10,30}$/i.test(input.ref)) {
    throw oauthError("That Supabase project reference is invalid.");
  }
  await managementRequest({
    accessToken: input.accessToken,
    path: `/projects/${encodeURIComponent(input.ref)}/database/query`,
    method: "POST",
    body: { query: input.query },
    fetchImpl: input.fetchImpl,
  });
}

/**
 * Apply an approved migration set in one transaction through the Management
 * API. This avoids a direct Postgres connection from Vercel, including the
 * IPv6-only direct-host limitation. The SQL is the already-approved snapshot;
 * it is never model output at this point.
 */
export async function applySupabaseMigrations(input: {
  accessToken: string;
  projectRef: string;
  migrations: { path: string; sql: string }[];
  fetchImpl?: FetchLike;
}): Promise<{ applied: string[] }> {
  if (input.migrations.length === 0) return { applied: [] };
  const comments = input.migrations.map(
    (migration) => `-- ${migration.path.replace(/[\r\n]+/g, " ")}`,
  );
  const query = ["begin;", ...comments, ...input.migrations.map((migration) => migration.sql), "commit;"].join("\n");
  try {
    await runSupabaseQuery({
      accessToken: input.accessToken,
      ref: input.projectRef,
      query,
      fetchImpl: input.fetchImpl,
    });
  } catch {
    throw new DeploymentError(
      "The approved migration transaction failed through the Supabase Management API and was not confirmed. Verify the production database before retrying.",
    );
  }
  return { applied: input.migrations.map((migration) => migration.path) };
}
