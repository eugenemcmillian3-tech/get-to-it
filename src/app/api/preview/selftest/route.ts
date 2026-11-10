import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { secretsMatch } from "@/lib/cron-auth";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { isUuid } from "@/lib/validation";
import {
  createRenderSandboxClient,
  getSandboxConfig,
  runSandboxChecks,
  SandboxUnavailableError,
} from "@/lib/preview-sandbox";

/**
 * Render Sandboxes self-test.
 *
 * Proves the deployed backend end to end without a signed-in user: it hands a
 * file set to a real sandbox, runs the same fixed command policy the workspace
 * uses, and reports each check's exit code and the wall time.
 *
 * Three inputs, all server-side:
 *   - nothing: a constant fixture owned by this module.
 *   - `?list=1`: the ten most recently updated projects, so a real id can be
 *     chosen without opening the app.
 *   - `?diag=1`: which role the configured Supabase key carries and how many
 *     rows the app tables hold. Names and counts only, never row contents.
 *   - `?import=1` with `{ name, files }` in the body: stores a new project and its
 *     files for the first account in the database, so an app built outside this
 *     repo can be checked here. Paths are validated and every row it writes is
 *     removed again if any insert fails.
 *   - `?project=<uuid>`: that project's stored files, read with the service role
 *     exactly like the workspace does. `?case=failing` only applies to the
 *     fixture, because a real project's files are never edited here.
 *
 * Requires `Authorization: Bearer $PREVIEW_SELFTEST_TOKEN`. With the variable
 * unset the route is disabled and refuses everything — the same fail-closed rule
 * the cron routes follow. No command comes from the request: the policy is fixed.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_PROJECT_FILES = 400;
const MAX_PROJECT_BYTES = 1_500_000;

const MAX_IMPORT_FILES = 400;
const MAX_IMPORT_BYTES = 1_500_000;
/** Relative, no traversal, no leading slash, no shell metacharacters. */
const SAFE_PATH = /^(?!\/)(?!.*\.\.)[A-Za-z0-9._\-/]+$/;

const PACKAGE_JSON = `{
  "name": "sandbox-selftest",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test lib/sum.test.mjs" },
  "dependencies": {
    "next": "15.1.6",
    "react": "19.0.0",
    "react-dom": "19.0.0"
  },
  "devDependencies": {
    "@eslint/js": "9.18.0",
    "@types/node": "22.10.7",
    "@types/react": "19.0.7",
    "eslint": "9.18.0",
    "typescript": "5.7.3"
  }
}
`;

const TSCONFIG_JSON = `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "preserve",
    "strict": true,
    "noEmit": true,
    "allowJs": true,
    "checkJs": true,
    "skipLibCheck": true,
    "esModuleInterop": true
  },
  "include": ["**/*.ts", "**/*.tsx", "lib/**/*.js"],
  "exclude": ["node_modules", ".next"]
}
`;

const ESLINT_CONFIG = `import js from "@eslint/js";

export default [
  { ignores: [".next/**", "node_modules/**"] },
  {
    files: ["**/*.js", "**/*.mjs"],
    ...js.configs.recommended,
    languageOptions: { ecmaVersion: 2023, sourceType: "module" },
  },
];
`;

const LAYOUT_TSX = `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;

const PAGE_TSX = `export default function Page() {
  return <main>sandbox self-test</main>;
}
`;

const SUM_JS = `/** @param {number[]} values */
export function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}
`;

const PASSING_TEST = `import test from "node:test";
import assert from "node:assert/strict";
import { sum } from "./sum.js";

test("adds numbers", () => {
  assert.equal(sum([1, 2, 3]), 6);
});
`;

const FAILING_TEST = `import test from "node:test";
import assert from "node:assert/strict";
import { sum } from "./sum.js";

test("adds numbers", () => {
  assert.equal(sum([1, 2, 3]), 7);
});
`;

const FIXTURE: { path: string; content: string }[] = [
  { path: "package.json", content: PACKAGE_JSON },
  { path: "tsconfig.json", content: TSCONFIG_JSON },
  { path: "eslint.config.mjs", content: ESLINT_CONFIG },
  { path: "app/layout.tsx", content: LAYOUT_TSX },
  { path: "app/page.tsx", content: PAGE_TSX },
  { path: "lib/sum.js", content: SUM_JS },
  { path: "lib/sum.test.mjs", content: PASSING_TEST },
];

function refuse(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status, headers: { "cache-control": "no-store" } });
}

function serviceSupabase() {
  const settings = getSupabaseSettings();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!settings || !serviceRoleKey) return null;
  return createClient(settings.url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type ServiceDb = NonNullable<ReturnType<typeof serviceSupabase>>;

type ImportFile = { path: string; content: string };

/** Validates an import body without trusting a single byte of it. */
async function readImport(
  request: Request,
): Promise<{ name: string; files: ImportFile[] } | { error: string; status: number }> {
  let body: { name?: unknown; files?: unknown };
  try {
    body = (await request.json()) as { name?: unknown; files?: unknown };
  } catch {
    return { error: "The request body must be JSON.", status: 400 };
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length === 0 || name.length > 120) {
    return { error: "A project name of 1-120 characters is required.", status: 400 };
  }
  if (!Array.isArray(body.files) || body.files.length === 0) {
    return { error: "A non-empty files array is required.", status: 400 };
  }
  if (body.files.length > MAX_IMPORT_FILES) {
    return { error: `An import may contain at most ${MAX_IMPORT_FILES} files.`, status: 413 };
  }

  const files: ImportFile[] = [];
  const seen = new Set<string>();
  let bytes = 0;

  for (const raw of body.files) {
    if (!raw || typeof raw !== "object") {
      return { error: "Each file needs a string path and a string content.", status: 400 };
    }
    const file = raw as { path?: unknown; content?: unknown };
    if (typeof file.path !== "string" || typeof file.content !== "string") {
      return { error: "Each file needs a string path and a string content.", status: 400 };
    }
    const path = file.path.trim();
    if (!SAFE_PATH.test(path)) {
      return { error: `Unsafe file path: ${path.slice(0, 60)}`, status: 400 };
    }
    if (seen.has(path)) {
      return { error: `Duplicate file path: ${path}`, status: 400 };
    }
    seen.add(path);
    bytes += file.content.length;
    files.push({ path, content: file.content });
  }

  if (bytes > MAX_IMPORT_BYTES) {
    return { error: `An import may contain at most ${MAX_IMPORT_BYTES} bytes.`, status: 413 };
  }

  return { name, files };
}

/** The first account in the database, used when no owner is named. */
async function firstUserId(db: ServiceDb): Promise<string | null> {
  const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (error || !data?.users?.length) return null;
  return data.users[0]?.id ?? null;
}

/**
 * The JWT role of the configured Supabase key, without exposing the key. An anon
 * key is filtered by row level security and silently returns no rows, which looks
 * exactly like an empty database.
 */
function keyRole(key: string): string {
  const parts = key.split(".");
  if (parts.length !== 3) return key.startsWith("sb_secret_") ? "secret" : key.startsWith("sb_publishable_") ? "publishable" : "unknown";
  try {
    const claims = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8")) as { role?: unknown };
    return typeof claims.role === "string" ? claims.role : "unknown";
  } catch {
    return "unknown";
  }
}

async function diagnostics(db: ServiceDb) {
  const info: Record<string, unknown> = { key_role: keyRole(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "") };
  for (const table of ["app_projects", "app_files", "app_workspaces", "app_workspace_runs"]) {
    const { count, error } = await db.from(table).select("id", { count: "exact", head: true });
    info[table] = error ? `error: ${error.message}` : count;
  }
  return info;
}

export async function POST(request: Request) {
  const token = process.env.PREVIEW_SELFTEST_TOKEN?.trim();
  if (!token) {
    return refuse("PREVIEW_SELFTEST_TOKEN is not set, so the sandbox self-test is disabled.", 503);
  }

  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ") || !secretsMatch(header.slice("Bearer ".length), token)) {
    return refuse("Unauthorized.", 401);
  }

  const search = new URL(request.url).searchParams;
  const wantsList = search.get("list") === "1";
  const projectId = search.get("project");

  if (!wantsList && projectId !== null && !isUuid(projectId)) {
    return refuse("The project id is not a UUID.", 400);
  }

  const db = serviceSupabase();

  // Diagnostics are about the database, so they do not need a sandbox backend.
  if (search.get("diag") === "1") {
    if (!db) {
      return refuse("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for diagnostics.", 503);
    }
    return NextResponse.json(
      { ok: true, diag: await diagnostics(db) },
      { headers: { "cache-control": "no-store" } },
    );
  }

  // Importing writes rows, so it needs the database but no sandbox backend.
  if (search.get("import") === "1") {
    if (!db) {
      return refuse("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to import a project.", 503);
    }
    const parsed = await readImport(request);
    if ("error" in parsed) return refuse(parsed.error, parsed.status);

    const requestedOwner = search.get("owner");
    if (requestedOwner !== null && !isUuid(requestedOwner)) {
      return refuse("The owner id is not a UUID.", 400);
    }
    const ownerId = requestedOwner ?? (await firstUserId(db));
    if (!ownerId) {
      return refuse(
        "There are no accounts in this deployment's database, so an imported project would have no owner.",
        409,
      );
    }

    const { data: created, error: createError } = await db
      .from("app_projects")
      .insert({ user_id: ownerId, name: parsed.name })
      .select("id, name")
      .single();
    if (createError || !created) {
      return refuse(`The project could not be created: ${createError?.message ?? "no row returned"}`, 500);
    }

    const importedId = created.id as string;
    const bytes = parsed.files.reduce((total, file) => total + file.content.length, 0);

    for (let index = 0; index < parsed.files.length; index += 100) {
      const chunk = parsed.files.slice(index, index + 100).map((file) => ({
        project_id: importedId,
        user_id: ownerId,
        path: file.path,
        content: file.content,
      }));
      const { error: filesError } = await db.from("app_files").insert(chunk);
      if (filesError) {
        // Never leave a half-imported project behind.
        await db.from("app_projects").delete().eq("id", importedId);
        return refuse(`The files could not be stored: ${filesError.message}`, 500);
      }
    }

    return NextResponse.json(
      { ok: true, project: created, files: parsed.files.length, bytes },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const config = getSandboxConfig();
  if (!config) {
    return refuse("Render Sandboxes is not configured on this server.", 503);
  }

  if (!db) {
    return refuse("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to read a project.", 503);
  }

  if (wantsList) {
    const { data, error } = await db
      .from("app_projects")
      .select("id, name, status, updated_at")
      .order("updated_at", { ascending: false })
      .limit(10);
    if (error) return refuse("The project list could not be read.", 500);
    return NextResponse.json(
      { ok: true, projects: data ?? [] },
      { headers: { "cache-control": "no-store" } },
    );
  }

  let files: { path: string; content: string }[] = FIXTURE;
  let label = "fixture";
  let project: { id: string; name: string | null; status: string | null } | null = null;

  if (projectId !== null) {
    const { data: row, error: projectError } = await db
      .from("app_projects")
      .select("id, name, status")
      .eq("id", projectId)
      .maybeSingle();
    if (projectError) return refuse("The project lookup failed.", 500);
    if (!row) return refuse("No project with that id exists.", 404);

    const { data: rows, error: filesError } = await db
      .from("app_files")
      .select("path, content")
      .eq("project_id", projectId)
      .order("path", { ascending: true })
      .limit(MAX_PROJECT_FILES + 1);
    if (filesError) return refuse("The project files could not be read.", 500);

    const stored = (rows ?? []) as { path: string; content: string }[];
    const bytes = stored.reduce((total, file) => total + file.content.length, 0);
    if (stored.length === 0) return refuse("That project has no stored files.", 409);
    if (stored.length > MAX_PROJECT_FILES) {
      return refuse(`That project has more than ${MAX_PROJECT_FILES} files; run it from the workspace instead.`, 413);
    }
    if (bytes > MAX_PROJECT_BYTES) {
      return refuse(`That project has more than ${MAX_PROJECT_BYTES} bytes of source.`, 413);
    }

    project = { id: row.id as string, name: (row.name as string | null) ?? null, status: (row.status as string | null) ?? null };
    files = stored;
    label = project.name ?? project.id;
  }

  const failing = projectId === null && search.get("case") === "failing";
  if (failing) {
    files = FIXTURE.map((file) =>
      file.path === "lib/sum.test.mjs" ? { path: file.path, content: FAILING_TEST } : file,
    );
  }

  try {
    const client = await createRenderSandboxClient(config);
    const result = await runSandboxChecks(config, client, files);
    return NextResponse.json(
      {
        ok: true,
        case: projectId === null ? (failing ? "failing" : "fixture") : "project",
        project,
        label,
        file_count: files.length,
        bytes: files.reduce((total, file) => total + file.content.length, 0),
        status: result.status,
        wall_ms: result.durationMs,
        checks: result.checks.map((check) => ({
          name: check.name,
          label: check.label,
          status: check.status,
          exit_code: check.code,
          log_chars: check.log.length,
        })),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const message =
      error instanceof SandboxUnavailableError
        ? error.message
        : "The Render sandbox could not complete the self-test.";
    return refuse(message, 502);
  }
}
