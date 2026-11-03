import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import {
  createOAuthState,
  createPkce,
  supabaseAuthorizationUrl,
  supabaseOAuthClient,
  stateHash,
  validateSupabaseManagementClient,
} from "@/lib/deploy/supabase-oauth";
import {
  encryptSecret,
  supabaseOAuthStateAad,
  vaultConfigured,
} from "@/lib/deploy/vault";
import { isUuid } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function deployPath(projectId: string): string {
  return `/build/${projectId}/deploy`;
}

function failure(origin: string, projectId: string, code: string) {
  const target = new URL(deployPath(projectId), origin);
  target.searchParams.set("supabase_error", code);
  return NextResponse.redirect(target);
}

function redirectUriFor(request: NextRequest): string {
  const configured = process.env.SUPABASE_OAUTH_REDIRECT_URI?.trim();
  if (configured) return configured;
  return new URL("/api/integrations/supabase/callback", request.nextUrl.origin).toString();
}

/**
 * Start the Supabase Management API OAuth flow for one app project. The state
 * and PKCE verifier are single-use database rows; only the state hash is stored.
 */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const projectId = request.nextUrl.searchParams.get("project_id") ?? "";
  if (!isUuid(projectId)) {
    return NextResponse.redirect(new URL("/build?supabase_error=invalid_project", origin));
  }

  const session = await getSession();
  if (!session) {
    const target = new URL("/sign-in", origin);
    target.searchParams.set("next", deployPath(projectId));
    return NextResponse.redirect(target);
  }

  if (!vaultConfigured()) return failure(origin, projectId, "vault_missing");
  const client = supabaseOAuthClient();
  if (!client) return failure(origin, projectId, "oauth_not_configured");

  const { data: project } = await session.supabase
    .from("app_projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (!project) return failure(origin, projectId, "invalid_project");

  const redirectUri = redirectUriFor(request);
  const validation = await validateSupabaseManagementClient({
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    redirectUri,
  });
  if (!validation.ok) {
    return failure(
      origin,
      projectId,
      validation.reason === "invalid_client" ? "oauth_client_invalid" : "oauth_preflight_failed",
    );
  }

  const state = createOAuthState();
  const hash = stateHash(state);
  const pkce = createPkce();

  const { error } = await session.supabase.rpc("create_supabase_oauth_state", {
    p_state_hash: hash,
    p_project_id: projectId,
    p_code_verifier_sealed: encryptSecret(pkce.verifier, supabaseOAuthStateAad(hash)),
    p_redirect_uri: redirectUri,
    p_return_path: deployPath(projectId),
  });
  if (error) return failure(origin, projectId, "oauth_state_failed");

  return NextResponse.redirect(
    supabaseAuthorizationUrl({
      clientId: client.clientId,
      redirectUri,
      state,
      codeChallenge: pkce.challenge,
    }),
  );
}
