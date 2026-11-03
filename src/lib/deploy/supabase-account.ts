import type { Session } from "@/lib/auth";
import { DeploymentError } from "@/lib/deployments";
import {
  refreshSupabaseToken,
  type SupabaseTokenSet,
} from "@/lib/deploy/supabase-oauth";
import {
  decryptSecret,
  encryptSecret,
  supabaseAccountAad,
} from "@/lib/deploy/vault";

type TokenRow = {
  id: string;
  status: "connected" | "error" | "revoked";
  account_label: string;
  scopes: string;
  access_token_sealed: string | null;
  refresh_token_sealed: string | null;
  expires_at: string | null;
};

export type SupabaseAccountAccess = {
  connectionId: string;
  accessToken: string;
  accountLabel: string;
  scopes: string;
  expiresAt: string;
};

function tokenRow(data: unknown): TokenRow | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;
  return row as TokenRow;
}

export async function saveSupabaseAccount(
  session: Session,
  tokens: SupabaseTokenSet,
  accountLabel: string,
): Promise<string> {
  const aad = supabaseAccountAad(session.user.id);
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const { data, error } = await session.supabase.rpc("save_supabase_account_connection", {
    p_account_label: accountLabel.slice(0, 120),
    p_scopes: tokens.scope.slice(0, 1000),
    p_access_token_sealed: encryptSecret(tokens.access_token, aad),
    p_refresh_token_sealed: encryptSecret(tokens.refresh_token, aad),
    p_expires_at: expiresAt,
  });
  if (error || typeof data !== "string" || data === "") {
    throw new DeploymentError("The Supabase OAuth connection could not be saved.");
  }
  return data;
}

/**
 * Return a usable access token for the signed-in owner. An expired token is
 * refreshed once; revocation by the user surfaces as a normal error, never as a
 * token in a message.
 */
export async function getSupabaseAccountAccess(
  session: Session,
  connectionId?: string | null,
): Promise<SupabaseAccountAccess> {
  const { data, error } = await session.supabase.rpc("get_supabase_account_tokens", {
    p_connection_id: connectionId ?? null,
  });
  if (error) {
    throw new DeploymentError("The Supabase OAuth connection could not be read.");
  }
  const row = tokenRow(data);
  if (!row) {
    throw new DeploymentError("Connect a Supabase account before choosing projects.");
  }
  if (row.status === "revoked") {
    throw new DeploymentError("That Supabase OAuth connection was revoked. Reconnect the account.");
  }
  if (!row.access_token_sealed || !row.refresh_token_sealed || !row.expires_at) {
    throw new DeploymentError("That Supabase OAuth connection has no usable tokens. Reconnect the account.");
  }

  const aad = supabaseAccountAad(session.user.id);
  let accessToken = decryptSecret(row.access_token_sealed, aad);
  let refreshToken = decryptSecret(row.refresh_token_sealed, aad);
  let expiresAt = row.expires_at;
  const expiresAtMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now() + 60_000) {
    let refreshed: SupabaseTokenSet;
    try {
      refreshed = await refreshSupabaseToken({ refreshToken });
    } catch (refreshError) {
      await session.supabase.rpc("mark_supabase_account_error", {
        p_connection_id: row.id,
      });
      throw refreshError;
    }
    accessToken = refreshed.access_token;
    refreshToken = refreshed.refresh_token || refreshToken;
    expiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
    const { error: updateError } = await session.supabase.rpc("update_supabase_account_tokens", {
      p_connection_id: row.id,
      p_access_token_sealed: encryptSecret(accessToken, aad),
      p_refresh_token_sealed: encryptSecret(refreshToken, aad),
      p_expires_at: expiresAt,
    });
    if (updateError) {
      throw new DeploymentError("The refreshed Supabase OAuth token could not be saved.");
    }
  }

  return {
    connectionId: row.id,
    accessToken,
    accountLabel: row.account_label,
    scopes: row.scopes,
    expiresAt,
  };
}
