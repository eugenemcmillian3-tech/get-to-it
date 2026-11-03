import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import {
  exchangeSupabaseCode,
  listSupabaseOrganizations,
  stateHash,
} from "@/lib/deploy/supabase-oauth";
import { saveSupabaseAccount } from "@/lib/deploy/supabase-account";
import {
  decryptSecret,
  supabaseOAuthStateAad,
} from "@/lib/deploy/vault";
import { isUuid } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConsumedState = {
  project_id: string;
  code_verifier_sealed: string;
  redirect_uri: string;
  return_path: string;
};

function consumedState(data: unknown): ConsumedState | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;
  const value = row as Record<string, unknown>;
  if (
    typeof value.project_id !== "string" ||
    typeof value.code_verifier_sealed !== "string" ||
    typeof value.redirect_uri !== "string" ||
    typeof value.return_path !== "string"
  ) {
    return null;
  }
  return {
    project_id: value.project_id,
    code_verifier_sealed: value.code_verifier_sealed,
    redirect_uri: value.redirect_uri,
    return_path: value.return_path,
  };
}

function safeReturnPath(value: string, projectId: string): string {
  const expected = `/build/${projectId}/deploy`;
  return value === expected ? value : expected;
}

function redirectWith(origin: string, path: string, key: string, value: string) {
  const target = new URL(path, origin);
  target.searchParams.set(key, value);
  return NextResponse.redirect(target);
}

/**
 * Supabase redirects here with an authorization code. The state row is consumed
 * atomically; a replay or an expired state gets no token exchange.
 */
export async function GET(request: NextRequest) {
  const origin = new URL(request.url).origin;
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const code = request.nextUrl.searchParams.get("code") ?? "";
  const providerError = request.nextUrl.searchParams.get("error");

  if (!state || !code) {
    return redirectWith(origin, "/build", "supabase_error", providerError ? "oauth_denied" : "oauth_missing_code");
  }

  const session = await getSession();
  if (!session) {
    const target = new URL("/sign-in", origin);
    target.searchParams.set("next", "/build");
    return NextResponse.redirect(target);
  }

  const hash = stateHash(state);
  const { data, error } = await session.supabase.rpc("consume_supabase_oauth_state", {
    p_state_hash: hash,
  });
  if (error) {
    return redirectWith(origin, "/build", "supabase_error", "oauth_state_failed");
  }
  const consumed = consumedState(data);
  if (!consumed || !isUuid(consumed.project_id)) {
    return redirectWith(origin, "/build", "supabase_error", "oauth_state_invalid");
  }

  const path = safeReturnPath(consumed.return_path, consumed.project_id);

  try {
    const verifier = decryptSecret(
      consumed.code_verifier_sealed,
      supabaseOAuthStateAad(hash),
    );
    const tokens = await exchangeSupabaseCode({
      code,
      codeVerifier: verifier,
      redirectUri: consumed.redirect_uri,
    });

    let accountLabel = "Supabase account";
    try {
      const organizations = await listSupabaseOrganizations({ accessToken: tokens.access_token });
      if (organizations.length === 1) accountLabel = organizations[0].name;
      else if (organizations.length > 1) accountLabel = `Supabase (${organizations.length} organizations)`;
    } catch {
      // A scope problem must not discard a valid grant. The organization picker
      // will show a useful reconnect message instead.
    }

    await saveSupabaseAccount(session, tokens, accountLabel);
    return redirectWith(origin, path, "supabase", "connected");
  } catch {
    // Never include the authorization code, verifier or token in a redirect or
    // log. The owner can retry the connection.
    return redirectWith(origin, path, "supabase_error", "oauth_failed");
  }
}
