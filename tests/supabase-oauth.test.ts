import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applySupabaseMigrations,
  createOAuthState,
  createPkce,
  exchangeSupabaseCode,
  getSupabaseProjectApiKeys,
  listSupabaseOrganizations,
  listSupabaseProjects,
  refreshSupabaseToken,
  runSupabaseQuery,
  stateHash,
  supabaseAuthorizationUrl,
  validateSupabaseManagementClient,
  type FetchLike,
} from "@/lib/deploy/supabase-oauth";

const previous = {
  clientId: process.env.SUPABASE_OAUTH_CLIENT_ID,
  clientSecret: process.env.SUPABASE_OAUTH_CLIENT_SECRET,
};

beforeEach(() => {
  process.env.SUPABASE_OAUTH_CLIENT_ID = "test-client-id";
  process.env.SUPABASE_OAUTH_CLIENT_SECRET = "test-client-secret";
});

afterEach(() => {
  if (previous.clientId === undefined) delete process.env.SUPABASE_OAUTH_CLIENT_ID;
  else process.env.SUPABASE_OAUTH_CLIENT_ID = previous.clientId;
  if (previous.clientSecret === undefined) delete process.env.SUPABASE_OAUTH_CLIENT_SECRET;
  else process.env.SUPABASE_OAUTH_CLIENT_SECRET = previous.clientSecret;
});

describe("Supabase OAuth helpers", () => {
  it("creates a PKCE verifier and S256 challenge without a token", () => {
    const pkce = createPkce();
    expect(pkce.verifier.length).toBeGreaterThan(40);
    expect(pkce.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pkce.challenge).not.toContain(pkce.verifier);
    expect(stateHash(createOAuthState())).toMatch(/^[a-f0-9]{64}$/);
  });

  it("builds the authorize URL with PKCE and without the client secret", () => {
    const url = new URL(
      supabaseAuthorizationUrl({
        clientId: "client",
        redirectUri: "https://example.test/api/integrations/supabase/callback",
        state: "state-value",
        codeChallenge: "challenge-value",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://api.supabase.com/v1/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("client");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-value");
    expect(url.searchParams.get("client_secret")).toBeNull();
  });

  it("exchanges a code with Basic auth and the exact redirect URI", async () => {
    let request: RequestInit | undefined;
    const fake: FetchLike = async (_input, init) => {
      request = init;
      return Response.json({
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
        token_type: "bearer",
        scope: "projects:read",
      });
    };
    const tokens = await exchangeSupabaseCode({
      code: "code-value",
      codeVerifier: "verifier-value",
      redirectUri: "https://example.test/api/integrations/supabase/callback",
      fetchImpl: fake,
    });
    expect(tokens.access_token).toBe("access-token");
    expect(tokens.scope).toBe("projects:read");
    const headers = request?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from("test-client-id:test-client-secret").toString("base64")}`,
    );
    const body = request?.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code_verifier")).toBe("verifier-value");
    expect(body.get("redirect_uri")).toBe("https://example.test/api/integrations/supabase/callback");
  });

  it("refreshes a token with the refresh_token grant", async () => {
    let body: URLSearchParams | undefined;
    const fake: FetchLike = async (_input, init) => {
      body = init?.body as URLSearchParams;
      return Response.json({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 3600,
      });
    };
    const tokens = await refreshSupabaseToken({ refreshToken: "old-refresh", fetchImpl: fake });
    expect(tokens.access_token).toBe("new-access");
    expect(body?.get("grant_type")).toBe("refresh_token");
    expect(body?.get("refresh_token")).toBe("old-refresh");
  });

  it("lists organizations and projects without exposing the access token", async () => {
    const calls: string[] = [];
    const fake: FetchLike = async (input, init) => {
      calls.push(String(input));
      const auth = (init?.headers as Record<string, string>).Authorization;
      expect(auth).toBe("Bearer access-token");
      if (String(input).endsWith("/organizations")) {
        return Response.json([{ id: "org-1", slug: "team", name: "Team" }]);
      }
      return Response.json([
        {
          id: "project-1",
          ref: "abcdefghijklmnopqrst",
          name: "App",
          organization_slug: "team",
          status: "ACTIVE_HEALTHY",
          region: "us-east-1",
        },
      ]);
    };
    const organizations = await listSupabaseOrganizations({ accessToken: "access-token", fetchImpl: fake });
    const projects = await listSupabaseProjects({ accessToken: "access-token", fetchImpl: fake });
    expect(organizations).toEqual([{ id: "org-1", slug: "team", name: "Team" }]);
    expect(projects[0]).toMatchObject({ ref: "abcdefghijklmnopqrst", name: "App", organization_slug: "team" });
    expect(calls.every((call) => call.startsWith("https://api.supabase.com/v1/"))).toBe(true);
    expect(JSON.stringify({ organizations, projects })).not.toContain("access-token");
  });

  it("selects an anon key and never a service-role key", async () => {
    let url = "";
    const fake: FetchLike = async (input) => {
      url = String(input);
      return Response.json([
        { type: "service_role", api_key: "service-secret" },
        { type: "anon", api_key: "anon-key" },
      ]);
    };
    const keys = await getSupabaseProjectApiKeys({
      accessToken: "access-token",
      ref: "abcdefghijklmnopqrst",
      fetchImpl: fake,
    });
    expect(keys.anonKey).toBe("anon-key");
    expect(keys.url).toBe("https://abcdefghijklmnopqrst.supabase.co");
    expect(url).toContain("reveal=true");
    expect(JSON.stringify(keys)).not.toContain("service-secret");
  });

  it("runs the approved migration set through the Management API", async () => {
    let sentQuery = "";
    const fake: FetchLike = async (_input, init) => {
      sentQuery = (JSON.parse(String(init?.body)) as { query?: string }).query ?? "";
      return Response.json({});
    };
    const applied = await applySupabaseMigrations({
      accessToken: "access-token",
      projectRef: "abcdefghijklmnopqrst",
      migrations: [
        { path: "supabase/migrations/0001_init.sql", sql: "create table notes (id uuid primary key);" },
      ],
      fetchImpl: fake,
    });
    expect(applied.applied).toEqual(["supabase/migrations/0001_init.sql"]);
    expect(sentQuery).toContain("begin;");
    expect(sentQuery).toContain("create table notes");
    expect(sentQuery).toContain("commit;");
  });

  it("sends a single SQL query to the selected project", async () => {
    let url = "";
    let sentQuery = "";
    const fake: FetchLike = async (input, init) => {
      url = String(input);
      sentQuery = (JSON.parse(String(init?.body)) as { query?: string }).query ?? "";
      return Response.json({});
    };
    await runSupabaseQuery({
      accessToken: "access-token",
      ref: "abcdefghijklmnopqrst",
      query: "select 1;",
      fetchImpl: fake,
    });
    expect(url).toContain("/projects/abcdefghijklmnopqrst/database/query");
    expect(sentQuery).toBe("select 1;");
  });

  it("accepts the provider's expired-code response at the preflight", async () => {
    const fake: FetchLike = async () =>
      Response.json({ message: "Invalid or expired OAuth authorization" }, { status: 404 });
    const result = await validateSupabaseManagementClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "https://example.test/callback",
      fetchImpl: fake,
    });
    expect(result).toEqual({ ok: true, status: 404 });
  });

  it("accepts a Management API client when the grant check is reached", async () => {
    let request: RequestInit | undefined;
    const fake: FetchLike = async (_input, init) => {
      request = init;
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    };
    const result = await validateSupabaseManagementClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "https://example.test/api/integrations/supabase/callback",
      fetchImpl: fake,
    });
    expect(result).toEqual({ ok: true, status: 400 });
    const headers = request?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from("client-id:client-secret").toString("base64")}`,
    );
    const body = request?.body as URLSearchParams;
    expect(body.get("redirect_uri")).toBe("https://example.test/api/integrations/supabase/callback");
  });

  it("rejects a project Auth OAuth client at the Management API preflight", async () => {
    const fake: FetchLike = async () =>
      Response.json({ message: "Unrecognized client_id" }, { status: 422 });
    const result = await validateSupabaseManagementClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "https://example.test/callback",
      fetchImpl: fake,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a rejected client");
    expect(result.reason).toBe("invalid_client");
  });

  it("reports an unreachable Management API preflight", async () => {
    const fake: FetchLike = async () => {
      throw new Error("network down");
    };
    const result = await validateSupabaseManagementClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "https://example.test/callback",
      fetchImpl: fake,
    });
    expect(result).toEqual({ ok: false, reason: "unreachable", status: null });
  });

  it("does not echo a provider error body", async () => {
    const token = "supabase-access-token-that-must-not-leak";
    const fake: FetchLike = async () =>
      Response.json({ error_description: `bad ${token}` }, { status: 401 });
    await expect(
      listSupabaseOrganizations({ accessToken: token, fetchImpl: fake }),
    ).rejects.not.toThrow(token);
  });
});
