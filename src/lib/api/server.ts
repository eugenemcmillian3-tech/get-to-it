import crypto from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { API_VERSION, API_VERSION_HEADER, ApiError } from "@/lib/api/contracts";

/**
 * Server-only helpers for the developer API.
 *
 * Requests carry a project API token. Only its SHA-256 hash is passed to
 * Postgres; the token itself is never stored, logged or returned by a read.
 */

export type ApiSupabase = SupabaseClient;

export const API_TOKEN_PREFIX = "gti_";

export function apiSupabase(): ApiSupabase {
  const settings = getSupabaseSettings();
  if (!settings) {
    throw new ApiError("insufficient_credentials", {
      message:
        "This deployment has no Supabase project configured, so the developer API is unavailable.",
    });
  }
  return createClient(settings.url, settings.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * API tokens contain 32 random bytes (256 bits), so a fast deterministic digest
 * is intentional. The database looks the token up by this value; a slow
 * password KDF would add per-request cost without making a 256-bit random
 * secret easier to guess. Do not reuse this helper for user-chosen passwords.
 */
export function hashApiToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateApiToken(): { token: string; prefix: string; hash: string } {
  const prefix = `${API_TOKEN_PREFIX}${crypto.randomBytes(4).toString("hex")}`;
  const secret = crypto.randomBytes(32).toString("base64url");
  const token = `${prefix}_${secret}`;
  return { token, prefix, hash: hashApiToken(token) };
}

export function bearerToken(request: Request): string {
  const requestedVersion = request.headers.get(API_VERSION_HEADER);
  if (requestedVersion && requestedVersion !== API_VERSION) {
    throw new ApiError("invalid_request", {
      message: `API version ${requestedVersion} is not supported. This deployment supports ${API_VERSION}.`,
      details: { supported_version: API_VERSION },
    });
  }

  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match || !match[1].startsWith(API_TOKEN_PREFIX) || match[1].length < 40) {
    throw new ApiError("unauthenticated");
  }
  return match[1];
}

export type RpcResult = Record<string, unknown>;

/** Calls a security-definer API function and never surfaces database text. */
export async function callApiRpc(
  client: ApiSupabase,
  fn: string,
  args: Record<string, unknown>,
): Promise<RpcResult> {
  const { data, error } = await client.rpc(fn, args);
  if (error) {
    console.error(`Developer API RPC ${fn} failed:`, error.code ?? "unknown");
    throw new ApiError("internal_error");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new ApiError("internal_error");
  }
  return data as RpcResult;
}
