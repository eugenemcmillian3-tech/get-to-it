import { describe, expect, it } from "vitest";
import {
  buildDeploymentPlan,
  extractEnvRequirements,
  planHash,
  planProblems,
  previewMigrations,
  redactSecrets,
  smokeFailureReason,
  sourceDigest,
  type GitHubTarget,
  type SupabaseTarget,
  type VercelTarget,
} from "@/lib/deployments";
import {
  commitSnapshot,
  createVercelDeployment,
  parsePostgresTarget,
  upsertVercelEnv,
  validateSupabasePair,
  type FetchLike,
} from "@/lib/deploy/providers";
import {
  decryptSecretWithKey,
  encryptSecretWithKey,
} from "@/lib/deploy/vault";

const files = [
  { path: "app/page.tsx", content: "export default function Page(){return <main>Hello deployment</main>}" },
  { path: "app/api/notes/route.ts", content: "const key = process.env.SUPABASE_SERVICE_KEY; export async function GET(){return Response.json({ok:true})}" },
  { path: ".env.example", content: "NEXT_PUBLIC_SUPABASE_URL=\nNEXT_PUBLIC_SUPABASE_ANON_KEY=\nSUPABASE_SERVICE_KEY=\nNODE_ENV=\n" },
  { path: "supabase/migrations/0001_init.sql", content: "create table notes (id uuid primary key, title text);\ncreate index notes_title_idx on notes(title);" },
  { path: "supabase/migrations/0002_cleanup.sql", content: "drop table old_notes;\ntruncate audit_log;" },
];

const github: GitHubTarget = {
  provider: "github",
  login: "owner",
  full_name: "owner/app",
  branch: "main",
  private: true,
  repo_id: 42,
};
const vercel: VercelTarget = {
  provider: "vercel",
  account: "owner",
  project_id: "prj_123",
  project_name: "app",
  team_id: "team_123",
};
const supabase: SupabaseTarget = {
  provider: "supabase",
  account: "Supabase dev → production",
  development_ref: "devref",
  production_ref: "prodref",
  target_ref: "devref",
};

function plan(target: "preview" | "production" = "preview") {
  return buildDeploymentPlan({
    projectId: "11111111-1111-4111-8111-111111111111",
    projectName: "App",
    target,
    version: 3,
    files,
    github,
    vercel,
    supabase: { ...supabase, target_ref: target === "production" ? "prodref" : "devref" },
    envRequirements: extractEnvRequirements(files),
    setEnvNames: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_KEY"],
  });
}

describe("deployment plan", () => {
  it("derives public and server-only requirements from code and .env.example", () => {
    const requirements = extractEnvRequirements(files);
    expect(requirements.map((item) => item.name)).toEqual([
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_SERVICE_KEY",
    ]);
    expect(requirements.find((item) => item.name === "NEXT_PUBLIC_SUPABASE_URL")?.visibility).toBe("public");
    expect(requirements.find((item) => item.name === "SUPABASE_SERVICE_KEY")?.visibility).toBe("server");
    expect(requirements.some((item) => item.name === "NODE_ENV")).toBe(false);
  });

  it("fingerprints a source snapshot independent of input order", () => {
    expect(sourceDigest(files)).toBe(sourceDigest([...files].reverse()));
    expect(sourceDigest(files)).toMatch(/^[a-f0-9]{64}$/);
    expect(sourceDigest([{ ...files[0], content: "changed" }])).not.toBe(sourceDigest(files));
  });

  it("previews migration statements and flags destructive changes", () => {
    const migrations = previewMigrations(files);
    expect(migrations).toHaveLength(2);
    expect(migrations[0].path).toBe("supabase/migrations/0001_init.sql");
    expect(migrations[0].statement_count).toBe(2);
    expect(migrations[0].destructive).toEqual([]);
    expect(migrations[1].destructive.join(" ")).toMatch(/DROP|TRUNCATE/);
  });

  it("does not apply production migrations in a preview plan", () => {
    expect(plan("preview").database.apply_migrations).toBe(false);
    expect(plan("preview").database.migration_target).toBe("none");
    expect(plan("production").database.apply_migrations).toBe(true);
  });

  it("blocks destructive production plans and missing environment values", () => {
    const withoutValues = buildDeploymentPlan({
      projectId: "11111111-1111-4111-8111-111111111111",
      projectName: "App",
      target: "production",
      version: 3,
      files,
      github,
      vercel,
      supabase: { ...supabase, target_ref: "prodref" },
      envRequirements: extractEnvRequirements(files),
      setEnvNames: [],
    });
    const problems = planProblems(withoutValues);
    expect(problems.join(" ")).toMatch(/destructive migration/i);
    expect(problems.join(" ")).toMatch(/environment value/i);
  });

  it("binds approval to a stable plan fingerprint", () => {
    const first = plan();
    const second = plan();
    expect(planHash(first)).toBe(planHash(second));
    expect(planHash({ ...first, target: "production" })).not.toBe(planHash(first));
  });

  it("redacts tokens and auth headers from errors", () => {
    const token = "github_pat_abcdefghijklmnopqrstuvwxyz123456";
    const output = redactSecrets(`failed Bearer ${token} and ${token}`, [token]);
    expect(output).not.toContain(token);
    expect(output).toContain("[redacted]");
  });

  it("does not treat an empty or framework-error page as a successful smoke check", () => {
    expect(smokeFailureReason(500, "text/html", "Internal Server Error")).not.toBeNull();
    expect(smokeFailureReason(200, "application/json", "{\"ok\":true}")).not.toBeNull();
    expect(smokeFailureReason(200, "text/html", "x".repeat(200))).toBeNull();
  });
});

describe("encrypted vault", () => {
  const key = Buffer.alloc(32, 7);

  it("round-trips with associated data and rejects tampering or a different project", () => {
    const sealed = encryptSecretWithKey("hello", key, "connection:p:github");
    expect(sealed).not.toContain("hello");
    expect(decryptSecretWithKey(sealed, key, "connection:p:github")).toBe("hello");
    expect(() => decryptSecretWithKey(sealed, key, "connection:other:github")).toThrow();
    const parts = sealed.split(".");
    const tamperedIv = `${parts[1][0] === "A" ? "B" : "A"}${parts[1].slice(1)}`;
    const tampered = [parts[0], tamperedIv, parts[2], parts[3]].join(".");
    expect(() => decryptSecretWithKey(tampered, key, "connection:p:github")).toThrow();
  });
});

describe("provider adapters with a fake transport", () => {
  it("commits an exact tree snapshot to GitHub", async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const fake: FetchLike = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.endsWith("/git/ref/heads%2Fmain")) {
        return Response.json({ object: { sha: "parent" } });
      }
      if (url.endsWith("/git/blobs")) return Response.json({ sha: `blob-${calls.length}` });
      if (url.endsWith("/git/trees")) return Response.json({ sha: "tree" });
      if (url.endsWith("/git/commits")) return Response.json({ sha: "commit" });
      if (url.includes("/git/refs/")) return Response.json({});
      return Response.json({});
    };
    const result = await commitSnapshot({
      token: "github_pat_test_token_1234567890",
      repo: "owner/app",
      branch: "main",
      files: [{ path: "app/page.tsx", content: "hello" }],
      sourceVersion: 1,
      sourceDigest: "a".repeat(64),
      fetchImpl: fake,
    });
    expect(result.commit_sha).toBe("commit");
    const tree = calls.find((call) => call.url.endsWith("/git/trees"));
    expect(tree?.body).not.toHaveProperty("base_tree");
    expect(calls.some((call) => call.method === "PATCH" && call.url.includes("/git/refs/"))).toBe(true);
  });

  it("does not expose a token from a provider error body", async () => {
    const token = "github_pat_supersecretvalue1234567890";
    const fake: FetchLike = async () => Response.json({ message: `bad ${token}` }, { status: 401 });
    await expect(
      commitSnapshot({
        token,
        repo: "owner/app",
        branch: "main",
        files: [{ path: "a", content: "b" }],
        sourceVersion: 1,
        sourceDigest: "a".repeat(64),
        fetchImpl: fake,
      }),
    ).rejects.not.toThrow(token);
  });

  it("creates a Vercel deployment from the approved commit", async () => {
    let body: Record<string, unknown> | null = null;
    const fake: FetchLike = async (input, init) => {
      expect(String(input)).toContain("teamId=team_123");
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ id: "dpl_1", readyState: "QUEUED", url: "app.vercel.app" });
    };
    const result = await createVercelDeployment({
      token: "vercel_test_token_1234567890",
      projectId: "prj_123",
      projectName: "app",
      teamId: "team_123",
      target: "production",
      repo: { owner: "owner", name: "app" },
      branch: "main",
      commitSha: "abc123",
      fetchImpl: fake,
    });
    expect(result.id).toBe("dpl_1");
    expect(body).toMatchObject({
      project: "prj_123",
      target: "production",
      gitSource: { type: "github", org: "owner", repo: "app", ref: "main", sha: "abc123" },
    });
  });

  it("upserts environment variables by key", async () => {
    const calls: string[] = [];
    const fake: FetchLike = async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("/env") && (init?.method ?? "GET") === "GET") {
        return Response.json({ envs: [{ id: "env_1", key: "NEXT_PUBLIC_SUPABASE_URL" }] });
      }
      return Response.json({});
    };
    const result = await upsertVercelEnv({
      token: "vercel_test_token_1234567890",
      projectId: "prj_123",
      teamId: "team_123",
      target: "preview",
      values: [
        { name: "NEXT_PUBLIC_SUPABASE_URL", value: "https://example.test", visibility: "public" },
        { name: "SUPABASE_SERVICE_KEY", value: "secret", visibility: "server" },
      ],
      fetchImpl: fake,
    });
    expect(result.failed).toEqual([]);
    expect(result.updated).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(calls.some((call) => call.startsWith("PATCH"))).toBe(true);
  });

  it("requires distinct Supabase targets and encrypted connections", () => {
    expect(() =>
      validateSupabasePair(
        "postgresql://postgres:one@db.devref.supabase.co:5432/postgres?sslmode=require",
        "postgresql://postgres:two@db.prodref.supabase.co:5432/postgres?sslmode=require",
      ),
    ).not.toThrow();
    expect(() =>
      validateSupabasePair(
        "postgresql://postgres:one@db.same.supabase.co:5432/postgres?sslmode=require",
        "postgresql://postgres:two@db.same.supabase.co:5432/postgres?sslmode=require",
      ),
    ).toThrow(/different/);
    expect(parsePostgresTarget("postgresql://postgres:pw@db.abcdefgh.supabase.co:5432/postgres?sslmode=require").ref).toBe("abcdefgh");
  });
});
