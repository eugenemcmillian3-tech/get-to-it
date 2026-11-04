"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import type { BuildState } from "@/lib/action-state";
import { API_LIMITS, API_SCOPES, type ApiScope } from "@/lib/api/contracts";
import { generateApiToken } from "@/lib/api/server";
import { getSession } from "@/lib/auth";
import { apiWebhookAad, encryptSecret, vaultConfigured } from "@/lib/deploy/vault";
import { isUuid, readText } from "@/lib/validation";

/**
 * Phase 30 owner actions for project API credentials and webhooks.
 *
 * The plaintext token and webhook secret are returned once in the action state
 * and never stored. Only a SHA-256 hash (credentials) or a vault-sealed secret
 * (webhooks) reaches Postgres.
 */

export type ApiCredentialState = BuildState & {
  secret?: string;
  prefix?: string;
  webhookSecret?: string;
};

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That app project isn't available to you.";
const VAULT_MISSING =
  "The deployment vault isn't configured. Add a server-only DEPLOYMENT_VAULT_KEY before registering webhooks; event signing has no fallback key.";

function fail(message: string): ApiCredentialState {
  return { status: "error", message, nonce: Date.now() };
}

function done(message: string, extra: Partial<ApiCredentialState> = {}): ApiCredentialState {
  return { status: "success", message, nonce: Date.now(), ...extra };
}

async function ownerProject(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  projectId: string,
) {
  if (!isUuid(projectId)) return null;
  const { data } = await session.supabase
    .from("app_projects")
    .select("id, name")
    .eq("id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  return data;
}

export async function createApiKeyAction(
  _previous: ApiCredentialState,
  formData: FormData,
): Promise<ApiCredentialState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);

  const name = readText(formData, "name").trim();
  if (name.length < 2 || name.length > 80) {
    return fail("Give the key a name of 2 to 80 characters so usage stays readable.");
  }

  const scopes = formData
    .getAll("scopes")
    .map((value) => String(value))
    .filter((value): value is ApiScope =>
      (API_SCOPES as readonly string[]).includes(value),
    );
  if (scopes.length === 0) return fail("Choose at least one scope. A key with no scope can do nothing.");

  const rateLimit = Number(readText(formData, "rate_limit"));
  if (
    !Number.isInteger(rateLimit) ||
    rateLimit < 1 ||
    rateLimit > API_LIMITS.maxRateLimitPerMinute
  ) {
    return fail(`Set a per-minute limit between 1 and ${API_LIMITS.maxRateLimitPerMinute}.`);
  }

  const days = Number(readText(formData, "expires_days"));
  if (!Number.isInteger(days) || days < 1 || days > API_LIMITS.maxKeyDays) {
    return fail(`Choose an expiry between 1 and ${API_LIMITS.maxKeyDays} days.`);
  }

  const generated = generateApiToken();
  const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();

  const { error } = await session.supabase.rpc("create_project_api_key", {
    p_project_id: projectId,
    p_name: name,
    p_prefix: generated.prefix,
    p_key_hash: generated.hash,
    p_scopes: scopes,
    p_rate_limit: rateLimit,
    p_expires_at: expiresAt,
  });

  if (error) {
    console.error("createApiKeyAction failed:", error.code ?? "unknown");
    return fail("The API key could not be created. Nothing was stored.");
  }

  revalidatePath(`/build/${projectId}/api`);
  return done(
    `Key ${generated.prefix} created. Copy the full token now: it is shown once and only its hash is stored.`,
    { secret: generated.token, prefix: generated.prefix },
  );
}

export async function revokeApiKeyAction(
  _previous: ApiCredentialState,
  formData: FormData,
): Promise<ApiCredentialState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);

  const keyId = readText(formData, "key_id");
  if (!isUuid(keyId)) return fail("Unknown API key.");

  const { data, error } = await session.supabase.rpc("revoke_project_api_key", {
    p_key_id: keyId,
  });
  if (error || data !== true) {
    return fail("The API key could not be revoked. Refresh and try again.");
  }

  revalidatePath(`/build/${projectId}/api`);
  return done("API key revoked. Requests using it now fail with 401 credential_revoked.");
}

export async function createApiWebhookAction(
  _previous: ApiCredentialState,
  formData: FormData,
): Promise<ApiCredentialState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  if (!vaultConfigured()) return fail(VAULT_MISSING);

  const projectId = readText(formData, "project_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);

  const url = readText(formData, "url").trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return fail("Enter a full webhook URL, for example https://example.com/hooks/gettoit.");
  }
  const loopback =
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "[::1]";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    return fail("Webhook URLs must use HTTPS. Plain HTTP is allowed only for localhost development.");
  }
  if (url.length > 1000) return fail("Keep the webhook URL under 1000 characters.");

  const allowed = ["build.completed", "build.failed"] as const;
  const events = formData
    .getAll("events")
    .map((value) => String(value))
    .filter((value): value is (typeof allowed)[number] =>
      (allowed as readonly string[]).includes(value),
    );
  if (events.length === 0) return fail("Choose at least one event to send.");

  const webhookId = crypto.randomUUID();
  const secret = `whsec_${crypto.randomBytes(24).toString("base64url")}`;

  let sealed: string;
  try {
    sealed = encryptSecret(secret, apiWebhookAad(projectId, webhookId));
  } catch {
    return fail(VAULT_MISSING);
  }

  const { error } = await session.supabase.rpc("create_api_webhook", {
    p_webhook_id: webhookId,
    p_project_id: projectId,
    p_url: url,
    p_events: events,
    p_secret_sealed: sealed,
  });

  if (error) {
    console.error("createApiWebhookAction failed:", error.code ?? "unknown");
    return fail("The webhook could not be saved. Nothing was registered.");
  }

  revalidatePath(`/build/${projectId}/api`);
  return done(
    "Webhook registered. Copy the signing secret now: reads never return it.",
    { webhookSecret: secret },
  );
}

export async function revokeApiWebhookAction(
  _previous: ApiCredentialState,
  formData: FormData,
): Promise<ApiCredentialState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);

  const webhookId = readText(formData, "webhook_id");
  if (!isUuid(webhookId)) return fail("Unknown webhook.");

  const { data, error } = await session.supabase.rpc("revoke_api_webhook", {
    p_webhook_id: webhookId,
  });
  if (error || data !== true) {
    return fail("The webhook could not be removed. Refresh and try again.");
  }

  revalidatePath(`/build/${projectId}/api`);
  return done("Webhook removed. Pending deliveries for it are gone with it.");
}
