import { describe, expect, it } from "vitest";
import {
  AppBuildError,
  PROJECT_LIMITS,
  SUPPORTED_STACK,
  assertGenerationFits,
  buildProjectFiles,
  buildSpecDraft,
  composeSpec,
  envVarForIntegration,
  identifier,
  intakeProblems,
  intakeSchema,
  isSafeProjectPath,
  keepNewestVersions,
  parseEntityLine,
  safeRoutePath,
  specToInput,
  summarizeChanges,
  type AppIntakeInput,
  type AppSpec,
  type GeneratedFile,
} from "@/lib/app-builder";
import { crc32, createZip, downloadFileName } from "@/lib/zip";

const INTAKE: AppIntakeInput = {
  name: "Repair log",
  purpose: "Keep a private record of repairs, parts and follow-ups for a small workshop.",
  target_users: "Two workshop volunteers who are comfortable with email but not with spreadsheets.",
  workflows: "Log a repair\nTrack parts on order\nSee what is waiting for collection",
  required_pages: "/repairs | Repairs | See every repair\n/parts | Parts | See parts on order",
  entities: "repair: title, notes, status, contact\npart: title, notes, status",
  auth_requirements: "supabase",
  integrations: "Stripe payments\nEmail reminders",
  design_preferences: "Calm, high contrast, no dense tables.",
  definition_of_done: "A volunteer can log a repair and find it again the same day.",
};

function draft(): AppSpec {
  return buildSpecDraft(INTAKE);
}

function generated(): GeneratedFile[] {
  return buildProjectFiles(draft(), { name: INTAKE.name, purpose: INTAKE.purpose });
}

describe("app intake", () => {
  it("accepts a complete intake and rejects short fields", () => {
    expect(intakeSchema.safeParse(INTAKE).success).toBe(true);
    expect(intakeSchema.safeParse({ ...INTAKE, name: "ab" }).success).toBe(false);
    expect(intakeSchema.safeParse({ ...INTAKE, purpose: "short" }).success).toBe(false);
  });

  it("refuses path traversal in page lines before a project exists", () => {
    const problems = intakeProblems({
      ...INTAKE,
      required_pages: "/../../etc/passwd | Escape | Read the host",
    });
    expect(problems.join(" ")).toContain("cannot contain '..'");

    expect(
      intakeProblems({
        ...INTAKE,
        required_pages: Array.from({ length: PROJECT_LIMITS.maxPages + 1 }, (_, index) => `/p${index}`).join("\n"),
      }).join(" "),
    ).toContain(`${PROJECT_LIMITS.maxPages} or fewer`);
  });
});

describe("project path safety", () => {
  it("accepts normal relative paths", () => {
    for (const path of [
      "README.md",
      "app/page.tsx",
      "app/api/repairs/route.ts",
      "supabase/migrations/0001_init.sql",
      ".env.example",
      "components/nav.tsx",
    ]) {
      expect(isSafeProjectPath(path)).toBe(true);
    }
  });

  it("rejects traversal, absolute paths and secret files", () => {
    for (const path of [
      "../outside.ts",
      "app/../../outside.ts",
      "/etc/passwd",
      "app\\page.tsx",
      "app//page.tsx",
      "app/page.tsx/",
      "",
      "node_modules/left-pad/index.js",
      ".git/config",
      ".env",
      ".env.local",
      "app/page.tsx\0",
      "app/ space.tsx",
      "a/".repeat(9) + "file.ts",
      `${"a".repeat(65)}.ts`,
    ]) {
      expect(isSafeProjectPath(path)).toBe(false);
    }
  });

  it("normalises a route and refuses traversal there too", () => {
    expect(safeRoutePath("/Repairs")).toBe("/repairs");
    expect(safeRoutePath("/new repair")).toBe("/new-repair");
    expect(safeRoutePath("/")).toBe("/");
    expect(safeRoutePath("/../secret")).toBeNull();
    expect(safeRoutePath("repairs")).toBeNull();
    expect(safeRoutePath("/a//b")).toBeNull();
  });

  it("cleans identifiers without inventing reserved columns", () => {
    expect(identifier("Repair Log!")).toBe("repair_log");
    expect(identifier("3 parts")).toBe("item_3_parts");
    expect(parseEntityLine("repair: title, user_id, created_at, notes").fields).toEqual([
      "title",
      "notes",
    ]);
    expect(envVarForIntegration("Stripe payments — cards")).toBe(
      "INTEGRATION_STRIPE_PAYMENTS_API_KEY",
    );
  });
});

describe("editable specification", () => {
  it("builds pages, navigation, entities and features from the intake", () => {
    const spec = draft();
    expect(spec.stack).toBe(SUPPORTED_STACK.id);
    expect(spec.pages.map((page) => page.path)).toEqual(["/", "/repairs", "/parts"]);
    expect(spec.navigation.map((item) => item.href)).toEqual(["/", "/repairs", "/parts"]);
    expect(spec.features).toHaveLength(3);
    expect(spec.entities.map((entity) => entity.name)).toEqual(["repair", "part"]);
    expect(spec.env_vars).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "INTEGRATION_STRIPE_PAYMENTS_API_KEY",
      "INTEGRATION_EMAIL_REMINDERS_API_KEY",
    ]);
    expect(spec.integrations.every((integration) => integration.mocked)).toBe(true);
    expect(spec.authorization_rules.join(" ")).toContain("row level security");
  });

  it("labels every integration as mocked and adds no secret values", () => {
    const spec = draft();
    expect(spec.integrations).toHaveLength(2);
    expect(spec.integrations[0]?.mocked).toBe(true);
    expect(JSON.stringify(spec)).not.toMatch(/sk_(live|test)_/);
  });

  it("keeps edits round-trippable and removes duplicate or reserved pages", () => {
    const spec = composeSpec(
      {
        features: "Log a repair\nLog a repair\nTrack parts",
        exclusions: "No payments",
        pages: "/parts | Parts | See parts\n/parts | Duplicate | Ignored\n/../secret | Bad | Bad",
        entities: "repair: title, notes\nrepair: ignored",
        integrations: "Stripe",
        acceptance_checks: "A repair can be found again",
        auth_requirements: "none",
      },
      "Calm",
      "Useful on day one",
    );

    expect(spec.features).toEqual(["Log a repair", "Track parts"]);
    expect(spec.pages.map((page) => page.path)).toEqual(["/", "/parts"]);
    expect(spec.entities).toHaveLength(1);
    expect(spec.env_vars).toEqual(["INTEGRATION_STRIPE_API_KEY"]);
    expect(spec.supabase).toBe(false);
    expect(spec.authorization_rules.join(" ")).toContain("no accounts");

    const input = specToInput(spec);
    const roundTrip = composeSpec(input, "Calm", "Useful on day one");
    expect(roundTrip.pages.map((page) => page.path)).toEqual(["/", "/parts"]);
    expect(roundTrip.entities).toEqual(spec.entities);
  });

  it("treats a missing data model as empty instead of inventing tables", () => {
    const spec = composeSpec(
      {
        features: "Show a page",
        exclusions: "",
        pages: "/about | About | What this is",
        entities: "",
        integrations: "",
        acceptance_checks: "",
        auth_requirements: "none",
      },
      "",
      "",
    );
    expect(spec.entities).toEqual([]);
    expect(spec.env_vars).toEqual([]);
  });
});

describe("generated project files", () => {
  it("produces a coherent Next.js, TypeScript and Tailwind tree", () => {
    const files = generated();
    const paths = files.map((file) => file.path);

    expect(paths).toContain("package.json");
    expect(paths).toContain("tsconfig.json");
    expect(paths).toContain("app/layout.tsx");
    expect(paths).toContain("app/page.tsx");
    expect(paths).toContain("app/repairs/page.tsx");
    expect(paths).toContain("app/parts/page.tsx");
    expect(paths).toContain("app/api/repairs/route.ts");
    expect(paths).toContain("app/api/parts/route.ts");
    expect(paths).toContain("components/repair-form.tsx");
    expect(paths).toContain("supabase/migrations/0001_init.sql");
    expect(paths).toContain("README.md");
    expect(paths).toContain(".env.example");
    expect(paths).toContain("ACCEPTANCE.md");
    expect(paths).toContain("lib/integrations.ts");

    const pkg = JSON.parse(files.find((file) => file.path === "package.json")!.content);
    expect(pkg.dependencies.next).toBeTruthy();
    expect(pkg.devDependencies.tailwindcss).toBeTruthy();
    expect(pkg.dependencies.typescript).toBeUndefined();
  });

  it("writes owner-only SQL and a labelled mock instead of a working integration", () => {
    const files = generated();
    const sql = files.find((file) => file.path === "supabase/migrations/0001_init.sql")!.content;
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("user_id = (select auth.uid())");
    expect(sql).not.toContain("service_role");

    const integrations = files.find((file) => file.path === "lib/integrations.ts")!.content;
    expect(integrations).toContain("MOCKED");
    expect(integrations).toContain("throw new Error");
    expect(integrations).not.toContain("fetch(");

    const readme = files.find((file) => file.path === "README.md")!.content;
    expect(readme).toContain("not a\nproduction-ready application");
    expect(readme).toContain("MOCKED");
    expect(readme).toContain(INTAKE.definition_of_done);
  });

  it("ships no secret values and only names in the environment example", () => {
    const files = generated();
    const env = files.find((file) => file.path === ".env.example")!.content;
    const assignments = env
      .split("\n")
      .filter((line) => line.trim() !== "" && !line.trim().startsWith("#"));

    expect(assignments.length).toBeGreaterThan(0);
    for (const line of assignments) {
      expect(line.endsWith("=")).toBe(true);
    }
    expect(env).toContain("NEXT_PUBLIC_SUPABASE_URL=");
    expect(env).not.toContain("eyJ");

    const everything = files.map((file) => file.content).join("\n");
    expect(everything).not.toMatch(/sk_(live|test)_[A-Za-z0-9]/);
    expect(everything).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY=/);
    expect(everything).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);

    const acceptance = files.find((file) => file.path === "ACCEPTANCE.md")!.content;
    expect(acceptance).toContain("not production ready");
    expect(acceptance).toContain("not evidence that the app works");
  });

  it("includes validation and visible error states in the generated app", () => {
    const files = generated();
    const route = files.find((file) => file.path === "app/api/repairs/route.ts")!.content;
    expect(route).toContain("safeParse");
    expect(route).toContain("status: 401");
    expect(route).toContain("status: 400");
    expect(route).toContain("status: 500");

    const form = files.find((file) => file.path === "components/repair-form.tsx")!.content;
    expect(form).toContain("role=\"alert\"");
    expect(form).toContain("Could not reach the server");

    // A required page that matches an entity renders that entity's form, so the
    // generated app has a real way to reach the write API.
    const repairPage = files.find((file) => file.path === "app/repairs/page.tsx")!.content;
    expect(repairPage).toContain("RepairForm");
    expect(repairPage).not.toContain("Replace this scaffold copy");
  });

  it("does not wire persistence when no accounts are chosen", () => {
    const spec = draft();
    const noAuth = buildProjectFiles(
      { ...spec, supabase: false, integrations: [], env_vars: [] },
      { name: INTAKE.name, purpose: INTAKE.purpose },
    );

    expect(noAuth.map((file) => file.path)).not.toContain("supabase/migrations/0001_init.sql");
    expect(noAuth.map((file) => file.path)).not.toContain("lib/supabase/server.ts");
    const route = noAuth.find((file) => file.path === "app/api/repairs/route.ts")!.content;
    expect(route).toContain("status: 501");
    expect(route).toContain("Persistence is not configured");
    const env = noAuth.find((file) => file.path === ".env.example")!.content;
    expect(env).toContain("No environment variables are required");
  });

  it("refuses an unsupported stack and oversized requests", () => {
    expect(() =>
      buildProjectFiles({ ...draft(), stack: "sveltekit" as never }, {
        name: INTAKE.name,
        purpose: INTAKE.purpose,
      }),
    ).toThrow(AppBuildError);

    const many = Array.from({ length: PROJECT_LIMITS.maxFiles + 1 }, (_, index) => ({
      path: `file-${index}.ts`,
      content: "x",
    }));
    expect(() => assertGenerationFits(many)).toThrow(/limit is 60/);

    expect(() => assertGenerationFits([
      { path: "app/page.tsx", content: "a" },
      { path: "app/page.tsx", content: "b" },
    ])).toThrow(/share the path/);

    expect(() => assertGenerationFits([{ path: "../escape.ts", content: "x" }])).toThrow(/Unsafe/);
    expect(() =>
      assertGenerationFits([{ path: "app/page.tsx", content: "x".repeat(PROJECT_LIMITS.maxFileChars + 1) }]),
    ).toThrow(/60000/);

    expect(() => buildProjectFiles(draft(), { name: INTAKE.name, purpose: INTAKE.purpose })).not.toThrow();
    expect(() =>
      assertGenerationFits(
        Array.from({ length: 20 }, (_, index) => ({
          path: `large-${index}.ts`,
          content: "x".repeat(PROJECT_LIMITS.maxFileChars),
        })),
      ),
    ).toThrow(/character project limit/);
  });
});

describe("versions and downloads", () => {
  it("summarises added, changed and removed files", () => {
    const previous = [
      { path: "a.ts", content: "one" },
      { path: "b.ts", content: "two" },
    ];
    const next = [
      { path: "b.ts", content: "two changed" },
      { path: "c.ts", content: "three" },
    ];
    const summary = summarizeChanges(previous, next);
    expect(summary).toEqual({
      added: 1,
      changed: 1,
      removed: 1,
      summary: "2 files (1 added, 1 changed, 1 removed).",
    });
  });

  it("keeps the newest snapshots only", () => {
    const versions = Array.from({ length: 25 }, (_, index) => ({ version: index + 1 }));
    expect(keepNewestVersions(versions, 20).map((item) => item.version)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 6),
    );
  });

  it("creates a stored zip with every file and a verified CRC", () => {
    const files = generated();
    const archive = createZip(files);
    const text = new TextDecoder("latin1").decode(archive);

    expect(archive[0]).toBe(0x50);
    expect(archive[1]).toBe(0x4b);
    expect(text).toContain("PK\u0003\u0004");
    expect(text).toContain("PK\u0005\u0006");
    for (const file of files) {
      expect(text).toContain(file.path);
    }
    expect(crc32(new TextEncoder().encode("hello"))).toBe(0x3610a686);
    expect(downloadFileName("Repair log!")).toBe("repair-log.zip");
    expect(() => createZip([{ path: "../evil.ts", content: "x" }])).toThrow(AppBuildError);
  });
});
