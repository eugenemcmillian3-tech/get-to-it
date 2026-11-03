import crypto from "node:crypto";
import { isSafeProjectPath } from "@/lib/app-builder";
import { sourceDigest, type DeploymentFile } from "@/lib/deployments";

/**
 * Phase 25 — project improvement contract.
 *
 * The default implementation is a deterministic, bounded fixture. It never
 * regenerates the application: it starts from the current files, changes at
 * most a few source files, and leaves every other file untouched. The workflow
 * still requires human plan approval, isolated tests, preview, diff review,
 * merge approval and a separate deployment approval.
 */

export const CHANGE_KINDS = [
  "dashboard",
  "bug",
  "mobile_navigation",
  "integration",
  "dependency",
  "other",
] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export const CHANGE_KIND_LABELS: Record<ChangeKind, string> = {
  dashboard: "Add a dashboard",
  bug: "Fix a reported bug",
  mobile_navigation: "Improve mobile navigation",
  integration: "Add a selected API integration",
  dependency: "Upgrade a dependency",
  other: "Other incremental change",
};

export const AUTOMATION_LEVELS = [
  { level: 1, label: "Suggest only", note: "Inspect, clarify and propose a plan. No source patch." },
  { level: 2, label: "Prepare a patch and preview", note: "Implement a bounded patch, test it, preview it and show the diff." },
  { level: 3, label: "Run an approved bounded maintenance job", note: "Run the approved patch/test/preview steps. Deployment remains separate." },
] as const;
export type AutomationLevel = 1 | 2 | 3;

export const CHANGE_STATUSES = [
  "clarifying",
  "proposed",
  "approved",
  "implemented",
  "tested",
  "preview_ready",
  "reviewed",
  "merged",
  "rejected",
  "failed",
] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];

export const CHANGE_LIMITS = {
  maxFiles: 6,
  maxRequestChars: 2_000,
  maxPlanSteps: 6,
  maxFileChars: 60_000,
  maxDiffChars: 200_000,
  maxAiCalls: 2,
} as const;

export const MEMORY_KINDS = [
  "architecture",
  "integration",
  "convention",
  "limitation",
  "test_command",
  "deployment_config",
  "procedure",
] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const MEMORY_KIND_LABELS: Record<MemoryKind, string> = {
  architecture: "Architecture decision",
  integration: "Supported integration",
  convention: "Coding convention",
  limitation: "Known limitation",
  test_command: "Test command",
  deployment_config: "Deployment configuration name",
  procedure: "Prior successful procedure",
};

export const SKILL_PERMISSIONS = [
  "read_project",
  "write_source_snapshot",
  "run_tests",
  "start_preview",
] as const;

export type ProjectInspection = {
  file_count: number;
  digest: string;
  routes: string[];
  components: string[];
  dependencies: string[];
  has_tests: boolean;
  has_supabase: boolean;
  has_navigation: boolean;
  test_commands: string[];
  env_names: string[];
};

export type ChangePlan = {
  version: 1;
  kind: ChangeKind;
  summary: string;
  steps: string[];
  files: { path: string; action: "add" | "update"; reason: string }[];
  tests: string[];
  permissions: string[];
  limitations: string[];
};

export type ChangeInput = {
  files: DeploymentFile[];
  kind: ChangeKind;
  request: string;
};

export type MemoryDraft = {
  kind: MemoryKind;
  title: string;
  body: string;
};

export type SkillDraft = {
  name: string;
  purpose: string;
  inputs: string[];
  outputs: string[];
  tests: string[];
  limitations: string[];
};

export function changeSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "change";
}

export function inspectProject(files: DeploymentFile[]): ProjectInspection {
  const packageFile = files.find((file) => file.path === "package.json");
  let dependencies: string[] = [];
  let testCommands: string[] = [];
  if (packageFile) {
    try {
      const parsed = JSON.parse(packageFile.content) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        scripts?: Record<string, string>;
      };
      dependencies = Object.keys({ ...parsed.dependencies, ...parsed.devDependencies }).sort();
      testCommands = Object.entries(parsed.scripts ?? {})
        .filter(([name]) => /test|typecheck|lint|build/i.test(name))
        .map(([name, command]) => `npm run ${name}: ${command}`);
    } catch {
      dependencies = [];
    }
  }

  return {
    file_count: files.length,
    digest: sourceDigest(files),
    routes: files
      .filter((file) => /^app\/.+\/page\.tsx$/.test(file.path) || file.path === "app/page.tsx")
      .map((file) =>
        file.path === "app/page.tsx"
          ? "/"
          : `/${file.path.replace(/^app\//, "").replace(/\/page\.tsx$/, "")}`,
      )
      .sort(),
    components: files.filter((file) => /^components\/[^/]+\.tsx$/.test(file.path)).map((file) => file.path).sort(),
    dependencies,
    has_tests: files.some((file) => /(^|\/)(tests?|__tests__)\//.test(file.path)),
    has_supabase: files.some((file) => file.path.startsWith("supabase/")),
    has_navigation: files.some((file) => file.path === "components/nav.tsx"),
    test_commands: testCommands,
    env_names: [...new Set(
      files.flatMap((file) => [
        ...[...file.content.matchAll(/process\.env(?:\.([A-Z][A-Z0-9_]*)|\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\])/g)]
          .map((match) => match[1] ?? match[2]),
        ...(file.path.endsWith(".env.example")
          ? file.content.split(/\r?\n/).map((line) => /^\s*([A-Z][A-Z0-9_]*)\s*=/.exec(line)?.[1]).filter((name): name is string => Boolean(name))
          : []),
      ]),
    )].sort(),
  };
}

export function clarifyChange(input: ChangeInput): string[] {
  const request = input.request.trim();
  const questions: string[] = [];
  if (request.length < 15) questions.push("What exactly should be different, and where?");
  if (input.kind === "dashboard" && input.files.some((file) => file.path === "app/dashboard/page.tsx")) {
    questions.push("A dashboard route already exists. Should this update it, and what must it show?");
  }
  if (input.kind === "mobile_navigation" && !input.files.some((file) => file.path === "components/nav.tsx")) {
    questions.push("No shared navigation component was found. Which navigation should change?");
  }
  if (input.kind === "integration" && !/[a-z0-9][a-z0-9 _.-]{2,}/i.test(request)) {
    questions.push("Which API integration should be added, and what should it do?");
  }
  if (input.kind === "dependency" && !/\b[a-z0-9@/_-]+\b.*\b\d+\.\d+|\b\d+\.\d+/.test(request)) {
    questions.push("Which dependency and exact target version should be upgraded?");
  }
  return questions.slice(0, 3);
}

function dashboardPage(request: string): string {
  return `export default function DashboardPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Dashboard</p>
      <h1 className="mt-2 text-3xl font-bold">One place to see what matters</h1>
      <p className="mt-3 text-slate-600">
        ${request.replace(/[{}<>`]/g, "").slice(0, 240)}
      </p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <section className="rounded-xl border border-slate-200 p-4">
          <h2 className="font-semibold">Next useful step</h2>
          <p className="mt-1 text-sm text-slate-600">Start with the smallest unfinished item.</p>
        </section>
        <section className="rounded-xl border border-slate-200 p-4">
          <h2 className="font-semibold">Recent work</h2>
          <p className="mt-1 text-sm text-slate-600">A place for the project&apos;s existing activity.</p>
        </section>
      </div>
    </main>
  );
}
`;
}

function genericPage(request: string, kind: ChangeKind): string {
  return `export default function ImprovementPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">${CHANGE_KIND_LABELS[kind]}</p>
      <h1 className="mt-2 text-3xl font-bold">Requested change</h1>
      <p className="mt-3 text-slate-600">${request.replace(/[{}<>`]/g, "").slice(0, 700)}</p>
      <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        This Phase 25 fixture creates a bounded review page. It does not claim an arbitrary bug fix, dependency upgrade or live API is complete.
      </p>
    </main>
  );
}
`;
}

function integrationRoute(slug: string): string {
  const env = `INTEGRATION_${slug.replace(/-/g, "_").toUpperCase()}_API_KEY`;
  return `// Bounded integration stub. It contacts no external service in this phase.
export async function GET() {
  if (!process.env.${env}) {
    return Response.json({ configured: false, missing: "${env}" }, { status: 501 });
  }
  return Response.json({ configured: true, integration: "${slug}", mocked: true });
}
`;
}

export function buildChangePlan(input: ChangeInput): ChangePlan {
  const request = input.request.trim();
  if (request.length < 5) throw new Error("Describe the change first.");
  if (request.length > CHANGE_LIMITS.maxRequestChars) throw new Error("Keep the change request under 2,000 characters.");
  if (input.files.length === 0) throw new Error("Generate project files before requesting a change.");

  const slug = changeSlug(request);
  const steps: string[] = ["Inspect the current files and keep the existing tree as the base."];
  const files: ChangePlan["files"] = [];

  if (input.kind === "dashboard") {
    const path = "app/dashboard/page.tsx";
    if (input.files.some((file) => file.path === path)) {
      steps.push("Update the existing dashboard route without touching unrelated routes.");
      files.push({ path, action: "update", reason: "Add the requested dashboard content." });
    } else {
      steps.push("Add one dashboard route; do not regenerate any existing page.");
      files.push({ path, action: "add", reason: "Add the dashboard route." });
    }
    if (input.files.some((file) => file.path === "components/nav.tsx")) {
      files.push({
        path: "components/nav.tsx",
        action: "update",
        reason: "Add a dashboard link only if the shared navigation exists.",
      });
    }
  } else if (input.kind === "mobile_navigation" && input.files.some((file) => file.path === "components/nav.tsx")) {
    steps.push("Improve the existing shared navigation component without creating a second navigation.");
    files.push({ path: "components/nav.tsx", action: "update", reason: "Add an accessible mobile-friendly navigation label." });
  } else if (input.kind === "integration") {
    const path = `app/api/integrations/${slug}/route.ts`;
    steps.push("Add one bounded integration route; it is a stub and makes no external call.");
    files.push({ path, action: "add", reason: "Add a reviewable integration endpoint stub." });
  } else {
    const path = `app/improvements/${slug}/page.tsx`;
    steps.push("Add one bounded review page; this fixture does not invent an arbitrary code change.");
    files.push({ path, action: "add", reason: "Record the requested change in a reviewable page." });
  }

  steps.push("Run the existing typecheck, lint, tests and build in an isolated workspace.");
  steps.push("Preview only the patched files and show a line diff.");
  steps.push("Merge into a new reversible source version only after diff approval.");

  return {
    version: 1,
    kind: input.kind,
    summary: `${CHANGE_KIND_LABELS[input.kind]}: ${request.slice(0, 180)}`,
    steps: steps.slice(0, CHANGE_LIMITS.maxPlanSteps),
    files: files.slice(0, CHANGE_LIMITS.maxFiles),
    tests: ["typecheck", "lint", "test", "build"],
    permissions: [...SKILL_PERMISSIONS],
    limitations: [
      "This phase uses deterministic fixture implementations; it does not call a model or regenerate the application.",
      "Bug, dependency and API integration requests produce bounded review scaffolding, not a claim of a complete arbitrary fix.",
      "Production deployment is a separate Phase 24 approval and is not performed by a change merge.",
    ],
  };
}

export function implementFixture(files: DeploymentFile[], plan: ChangePlan): {
  files: DeploymentFile[];
  changed: string[];
  diff: string;
} {
  for (const file of plan.files) {
    if (!isSafeProjectPath(file.path)) throw new Error("The fixture produced an unsafe path.");
  }
  const next = new Map(files.map((file) => [file.path, file.content]));
  const dashboard = plan.files.find((file) => file.path === "app/dashboard/page.tsx");
  if (dashboard) next.set(dashboard.path, dashboardPage(plan.summary));

  const nav = plan.files.find((file) => file.path === "components/nav.tsx");
  if (nav) {
    const current = next.get(nav.path);
    if (!current) throw new Error("The shared navigation component disappeared.");
    let patched = current;
    if (plan.kind === "mobile_navigation") {
      if (!patched.includes('aria-label="Main navigation"')) {
        patched = patched.replace("<nav ", '<nav aria-label="Main navigation" ');
      }
      if (!patched.includes('data-mobile-navigation="true"')) {
        patched = patched.replace("<nav ", '<nav data-mobile-navigation="true" ');
      }
    }
    if (plan.kind === "dashboard" && !patched.includes('href="/dashboard"')) {
      patched = patched.replace(
        "</nav>",
        '        <Link className="underline" href="/dashboard">Dashboard</Link>\n    </nav>',
      );
    }
    next.set(nav.path, patched);
  }

  for (const file of plan.files) {
    if (next.has(file.path)) continue;
    if (file.path.startsWith("app/api/integrations/")) {
      next.set(file.path, integrationRoute(changeSlug(plan.summary)));
    } else if (file.path.startsWith("app/improvements/")) {
      next.set(file.path, genericPage(plan.summary, plan.kind));
    } else if (file.path === "app/dashboard/page.tsx") {
      next.set(file.path, dashboardPage(plan.summary));
    }
  }

  for (const file of next.keys()) {
    if (!files.find((base) => base.path === file)) {
      if (!isSafeProjectPath(file)) throw new Error("The fixture produced an unsafe path.");
    }
  }
  if (next.size > files.length + CHANGE_LIMITS.maxFiles) throw new Error("The change is too large.");

  const result = [...next.entries()].map(([path, content]) => ({ path, content }));
  const changed = result.filter((file) => files.find((base) => base.path === file.path)?.content !== file.content).map((file) => file.path);
  if (changed.length === 0) throw new Error("The fixture produced no change.");
  if (changed.length > CHANGE_LIMITS.maxFiles) throw new Error("The fixture changed too many files.");
  return { files: result.sort((a, b) => a.path.localeCompare(b.path)), changed, diff: simpleDiff(files, result) };
}

function simpleDiff(before: DeploymentFile[], after: DeploymentFile[]): string {
  const old = new Map(before.map((file) => [file.path, file.content]));
  const chunks: string[] = [];
  for (const file of after) {
    const previous = old.get(file.path);
    if (previous === file.content) continue;
    chunks.push(`--- ${previous === undefined ? "/dev/null" : `a/${file.path}`}\n+++ b/${file.path}`);
    if (previous === undefined) {
      chunks.push(file.content.split("\n").map((line) => `+${line}`).join("\n"));
    } else {
      const a = previous.split("\n");
      const b = file.content.split("\n");
      let prefix = 0;
      while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
      let suffix = 0;
      while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix += 1;
      chunks.push(
        [
          ...a.slice(prefix, a.length - suffix).map((line) => `-${line}`),
          ...b.slice(prefix, b.length - suffix).map((line) => `+${line}`),
        ].join("\n"),
      );
    }
  }
  return chunks.join("\n\n").slice(0, CHANGE_LIMITS.maxDiffChars);
}

export function containsSecret(text: string): boolean {
  return (
    /\b(?:gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{20,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|sbp_[A-Za-z0-9]{16,})\b/.test(text) ||
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text) ||
    /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i.test(text) ||
    /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/i.test(text) ||
    /\b(?:api[_-]?key|secret|password|token)\s*[:=]\s*[A-Za-z0-9._~+/=-]{12,}/i.test(text)
  );
}

export function redactError(text: string): { text: string; redactions: number } {
  let redactions = 0;
  const replace = (pattern: RegExp, value: string) => {
    const matches = text.match(pattern);
    if (matches) redactions += matches.length;
    text = text.replace(pattern, value);
  };
  replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]");
  replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{20,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|sbp_[A-Za-z0-9]{16,})\b/g, "[token]");
  replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer [token]");
  replace(/postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@[^\s]+/gi, "[database-url]");
  replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[id]");
  replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]");
  const assignments = text.match(/(?:password|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi);
  if (assignments) redactions += assignments.length;
  text = text.replace(/((?:password|secret|token|api[_-]?key)\s*[:=])\s*\S+/gi, "$1[redacted]");
  return { text: text.slice(0, 20_000), redactions };
}

export function errorFingerprint(message: string): string {
  const normalized = message
    .toLowerCase()
    .replace(/\[(?:id|email|ip|token|database-url|redacted)\]/g, "[value]")
    .replace(/\b[0-9a-f]{8,}\b/g, "[value]")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

export function skillFromPlan(changeId: string, plan: ChangePlan, input: SkillDraft): {
  source_change_id: string;
  name: string;
  purpose: string;
  stack: string;
  required_permissions: string[];
  inputs: string[];
  outputs: string[];
  tests: string[];
  limitations: string[];
} {
  if (containsSecret(`${input.name} ${input.purpose} ${input.inputs.join(" ")} ${input.limitations.join(" ")}`)) {
    throw new Error("Project skills cannot contain credentials or secret values.");
  }
  return {
    source_change_id: changeId,
    name: input.name.trim().slice(0, 80),
    purpose: input.purpose.trim().slice(0, 500),
    stack: "nextjs-typescript-tailwind",
    required_permissions: [...SKILL_PERMISSIONS],
    inputs: input.inputs.map((item) => item.slice(0, 300)).slice(0, 8),
    outputs: input.outputs.map((item) => item.slice(0, 300)).slice(0, 8),
    tests: plan.tests,
    limitations: input.limitations.map((item) => item.slice(0, 300)).slice(0, 8),
  };
}

export function evaluationTotals(rows: {
  accepted: boolean;
  rejected: boolean;
  tests_passed: boolean;
  regression_count: number;
  runtime_seconds: number;
  ai_calls: number;
}[]): {
  accepted: number;
  rejected: number;
  tests_passed: number;
  regressions: number;
  runtime_seconds: number;
  ai_calls: number;
} {
  return {
    accepted: rows.filter((row) => row.accepted).length,
    rejected: rows.filter((row) => row.rejected).length,
    tests_passed: rows.filter((row) => row.tests_passed).length,
    regressions: rows.reduce((sum, row) => sum + row.regression_count, 0),
    runtime_seconds: rows.reduce((sum, row) => sum + row.runtime_seconds, 0),
    ai_calls: rows.reduce((sum, row) => sum + row.ai_calls, 0),
  };
}
