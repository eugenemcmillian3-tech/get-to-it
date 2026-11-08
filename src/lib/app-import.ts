import { z } from "zod";

import { isSafeProjectPath } from "@/lib/app-builder";
import {
  buildChangePlan,
  implementFixture,
  inspectProject,
  type ChangeKind,
  type ChangePlan,
} from "@/lib/improvements";
import {
  AppImportError,
  IMPORT_LIMITS,
  IMPORT_OBJECTIVE_LABELS,
  IMPORT_OBJECTIVES,
  type ImportObjective,
} from "./app-import-constants";
import type { ZipEntry } from "./app-import-archive";

export type ImportedFile = {
  path: string;
  content: string;
};

export type ImportSkipSummary = {
  counts: {
    secret: number;
    binary: number;
    ignored: number;
    instructions: number;
    outside: number;
    lockfiles: number;
  };
  secret: string[];
  binary: string[];
  ignored: string[];
  instructions: string[];
  outside: string[];
  lockfiles: string[];
};

export type ImportSelection = {
  files: ImportedFile[];
  skipped: ImportSkipSummary;
  packageName: string;
  packageManager: string;
  root: string;
};

type ParsedPackage = {
  name?: string;
  packageManager?: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
};

export type StackDetection = {
  packageJson: ParsedPackage;
  packagePath: string;
  nextVersion: string;
  router: "app";
  appFiles: string[];
};

type Basis = "inspected" | "inferred";

type MapFile = {
  label: string;
  file: string;
  basis: Basis;
};

export type AppMap = {
  version: 1;
  summary: string;
  framework: {
    name: string;
    version: string;
    router: "app";
    supported: boolean;
    files: string[];
    basis: Basis;
  };
  dependencies: Array<{
    name: string;
    version: string;
    files: string[];
    basis: Basis;
  }>;
  routes: Array<{
    path: string;
    file: string;
    kind: "page" | "layout";
    basis: Basis;
  }>;
  components: Array<{
    name: string;
    file: string;
    basis: Basis;
  }>;
  backend_operations: Array<{
    method: string;
    path: string;
    file: string;
    basis: Basis;
  }>;
  database: MapFile[];
  auth: MapFile[];
  integrations: MapFile[];
  env_names: Array<{
    name: string;
    files: string[];
    basis: Basis;
  }>;
  commands: {
    install: string;
    build: string;
    test: string;
    lint: string;
    typecheck: string;
  };
  uncertainties: string[];
  notes: string[];
  generated_at: string;
};

export type BaselineSnapshot = {
  status: "passed" | "failed" | "blocked";
  summary: string;
  failures: string[];
  at: string | null;
};

export type AppModernizationProposal = {
  version: 1;
  objective: ImportObjective;
  objective_label: string;
  request: string;
  kind: ChangeKind;
  plan: ChangePlan;
  affected_files: Array<{ path: string; action: string; reason: string }>;
  changed_files: string[];
  diff: string;
  compatibility_concerns: string[];
  acceptance_checks: string[];
  reversal_plan: string[];
  baseline: BaselineSnapshot;
  base_version: number;
  base_digest: string;
  generated_at: string;
  not_executed: true;
};

export type AppImportRecord = {
  id: string;
  project_id: string;
  user_id: string;
  source_kind: "git" | "archive";
  source_label: string;
  source_ref: string | null;
  source_connection_id: string | null;
  framework: string;
  framework_version: string | null;
  router: "app" | null;
  package_manager: string | null;
  file_count: number;
  archive_bytes: number;
  expanded_bytes: number;
  skipped: ImportSkipSummary;
  map: AppMap;
  metadata: Record<string, unknown>;
  status: "imported" | "map_edited";
  baseline_status: "not_run" | "passed" | "failed" | "blocked";
  baseline_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AppImportBaselineRecord = {
  id: string;
  import_id: string;
  project_id: string;
  user_id: string;
  status: "passed" | "failed" | "blocked";
  summary: string;
  checks: Array<{
    name: string;
    label: string;
    status: "passed" | "failed" | "skipped" | "timed_out";
    code: number | null;
    log: string;
  }>;
  failures: string[];
  log: string;
  duration_ms: number;
  created_at: string;
};

export type AppModernizationRecord = {
  id: string;
  import_id: string;
  project_id: string;
  user_id: string;
  objective: ImportObjective;
  request: string;
  status: "proposed" | "change_created" | "rejected";
  proposal: AppModernizationProposal;
  change_id: string | null;
  created_at: string;
  updated_at: string;
};

const IGNORED_SEGMENTS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  ".cache",
  ".vercel",
  "dist",
  "build",
  "coverage",
]);

const INSTRUCTION_BASENAMES = new Set([
  "agents.md",
  "claude.md",
  "gemini.md",
  "copilot-instructions.md",
  ".cursorrules",
  ".windsurfrules",
]);

const LOCKFILE_BASENAMES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
]);

const TEXT_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "json",
  "css",
  "scss",
  "sass",
  "md",
  "mdx",
  "sql",
  "yml",
  "yaml",
  "txt",
  "html",
  "svg",
]);

const TEXT_BASENAMES = new Set([
  "package.json",
  "tsconfig.json",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "postcss.config.js",
  "postcss.config.mjs",
  "tailwind.config.js",
  "tailwind.config.ts",
  "eslint.config.js",
  "eslint.config.mjs",
  "middleware.ts",
  "middleware.js",
  "instrumentation.ts",
  "instrumentation.js",
  "next-env.d.ts",
  ".env.example",
  ".gitignore",
  "Dockerfile",
  "Procfile",
]);

const SECRET_BASENAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  ".env.test",
  ".npmrc",
  ".pypirc",
  ".netrc",
  ".git-credentials",
]);

const INTEGRATION_PACKAGES: Array<[RegExp, string]> = [
  [/^stripe$/, "Stripe"],
  [/^@stripe\//, "Stripe"],
  [/^resend$/, "Resend"],
  [/^@sendgrid\//, "SendGrid"],
  [/^@composio\//, "Composio"],
  [/^openai$/, "OpenAI"],
  [/^@anthropic-ai\//, "Anthropic"],
  [/^@google\/generative-ai$/, "Google AI"],
  [/^twilio$/, "Twilio"],
  [/^posthog-js$/, "PostHog"],
  [/^@sentry\//, "Sentry"],
  [/^@clerk\//, "Clerk"],
  [/^next-auth$/, "NextAuth"],
  [/^@supabase\//, "Supabase"],
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value);
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === "string") out[key] = entry;
  }
  return out;
}

function readPackage(content: string, path: string): ParsedPackage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new AppImportError(`${path} is not valid JSON.`);
  }
  const record = asRecord(parsed);
  return {
    name: typeof record.name === "string" ? record.name : undefined,
    packageManager: typeof record.packageManager === "string" ? record.packageManager : undefined,
    dependencies: stringRecord(record.dependencies),
    devDependencies: stringRecord(record.devDependencies),
    scripts: stringRecord(record.scripts),
  };
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).toLowerCase();
}

function extension(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1);
}

export function isSecretImportPath(path: string): boolean {
  const lower = path.toLowerCase();
  const name = baseName(path);
  if (SECRET_BASENAMES.has(name)) return true;
  if (/^\.env\.(local|production|development|test|preview|staging)$/.test(name)) return true;
  if (/\.(pem|key|p12|pfx|jks|keystore)$/.test(name)) return true;
  if (name.startsWith("id_rsa") || name.startsWith("id_ed25519")) return true;
  if (lower.includes("/.aws/credentials")) return true;
  if (/(^|\/)firebase-adminsdk[^/]*\.json$/.test(lower)) return true;
  return false;
}

export function isInstructionImportPath(path: string): boolean {
  const lower = path.toLowerCase();
  if (lower.startsWith(".github/copilot-instructions")) return true;
  return INSTRUCTION_BASENAMES.has(baseName(path));
}

function isIgnoredPath(path: string): boolean {
  return path.split("/").some((segment) => IGNORED_SEGMENTS.has(segment));
}

function isTextPath(path: string): boolean {
  const name = baseName(path);
  if (TEXT_BASENAMES.has(name)) return true;
  if (name.startsWith(".env.example")) return true;
  return TEXT_EXTENSIONS.has(extension(path));
}

/**
 * Select the smallest useful text project from an archive. A single leading
 * folder is stripped when it contains package.json (the shape produced by
 * GitHub zipballs and by zipping a project folder).
 */
export function selectImportFiles(entries: ZipEntry[]): ImportSelection {
  const packages = entries
    .filter((entry) => baseName(entry.path) === "package.json" && entry.content !== null)
    .map((entry) => {
      const directory = entry.path.includes("/")
        ? entry.path.slice(0, entry.path.lastIndexOf("/"))
        : "";
      let parsed: ParsedPackage | null = null;
      try {
        parsed = readPackage(entry.content ?? "", entry.path);
      } catch {
        parsed = null;
      }
      return { entry, directory, parsed };
    });

  if (packages.length === 0) {
    throw new AppImportError("The archive does not contain a readable package.json.");
  }

  const nextPackages = packages.filter((candidate) => candidate.parsed?.dependencies.next);
  const chosen = (nextPackages.length > 0 ? nextPackages : packages).sort(
    (a, b) => a.directory.split("/").length - b.directory.split("/").length,
  )[0];
  const root = chosen.directory;
  const prefix = root ? `${root}/` : "";

  const skipped: ImportSkipSummary = {
    counts: {
      secret: 0,
      binary: 0,
      ignored: 0,
      instructions: 0,
      outside: 0,
      lockfiles: 0,
    },
    secret: [],
    binary: [],
    ignored: [],
    instructions: [],
    outside: [],
    lockfiles: [],
  };

  const remember = (bucket: string[], path: string) => {
    if (bucket.length < 25) bucket.push(path);
  };

  const files: ImportedFile[] = [];
  let totalChars = 0;

  for (const entry of entries) {
    if (root && !entry.path.startsWith(prefix)) {
      skipped.counts.outside += 1;
      remember(skipped.outside, entry.path);
      continue;
    }
    const path = root ? entry.path.slice(prefix.length) : entry.path;
    if (!path) continue;

    // Secret and ignored files are filtered before the builder path policy,
    // which deliberately rejects names such as .env. The archive reader has
    // already rejected traversal, absolute paths and unsafe names.
    if (isIgnoredPath(path)) {
      skipped.counts.ignored += 1;
      remember(skipped.ignored, path);
      continue;
    }
    if (isSecretImportPath(path)) {
      skipped.counts.secret += 1;
      remember(skipped.secret, path);
      continue;
    }
    if (isInstructionImportPath(path)) {
      skipped.counts.instructions += 1;
      remember(skipped.instructions, path);
      continue;
    }
    if (LOCKFILE_BASENAMES.has(baseName(path))) {
      skipped.counts.lockfiles += 1;
      remember(skipped.lockfiles, path);
      continue;
    }
    if (!isSafeProjectPath(path)) {
      throw new AppImportError(`The archive contains an unsafe project path: ${path.slice(0, 80)}.`);
    }
    if (entry.content === null) {
      skipped.counts.binary += 1;
      remember(skipped.binary, path);
      continue;
    }
    if (!isTextPath(path)) {
      skipped.counts.binary += 1;
      remember(skipped.binary, path);
      continue;
    }
    if (entry.content.length > IMPORT_LIMITS.maxFileChars) {
      throw new AppImportError(
        `${path} is larger than ${IMPORT_LIMITS.maxFileChars.toLocaleString()} characters.`,
      );
    }
    totalChars += entry.content.length;
    if (totalChars > IMPORT_LIMITS.maxTotalChars) {
      throw new AppImportError(
        `The selected project text is larger than ${IMPORT_LIMITS.maxTotalChars.toLocaleString()} characters.`,
      );
    }
    files.push({ path, content: entry.content });
  }

  if (files.length === 0) {
    throw new AppImportError("No supported text files were found in the archive.");
  }
  if (files.length > IMPORT_LIMITS.maxFiles) {
    throw new AppImportError(
      `The selected project has ${files.length} text files; this importer stores up to ${IMPORT_LIMITS.maxFiles}.`,
    );
  }

  const packageFile = files.find((file) => file.path === "package.json");
  if (!packageFile) {
    throw new AppImportError("The archive root does not contain package.json.");
  }
  const packageJson = readPackage(packageFile.content, "package.json");

  const lockManager = skipped.lockfiles.some((path) => /pnpm-lock/.test(path))
    ? "pnpm"
    : skipped.lockfiles.some((path) => /yarn.lock/.test(path))
      ? "yarn"
      : skipped.lockfiles.some((path) => /bun.lock/.test(path))
        ? "bun"
        : "npm";

  return {
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
    skipped,
    packageName: packageJson.name ?? "imported-app",
    packageManager: packageJson.packageManager?.split("@")[0] ?? lockManager,
    root,
  };
}

export function detectStack(files: ImportedFile[]): StackDetection {
  const packagePath = "package.json";
  const packageFile = files.find((file) => file.path === packagePath);
  if (!packageFile) throw new AppImportError("package.json is required at the project root.");
  const packageJson = readPackage(packageFile.content, packagePath);

  if (!packageJson.dependencies.next) {
    throw new AppImportError(
      `This importer supports ${IMPORT_STACK_LABEL} only; package.json does not declare next.`,
    );
  }
  const hasTypeScript = Boolean(
    packageJson.dependencies.typescript ||
      packageJson.devDependencies.typescript ||
      files.some((file) => file.path === "tsconfig.json"),
  );
  if (!hasTypeScript) {
    throw new AppImportError(
      `This importer supports ${IMPORT_STACK_LABEL} only; no TypeScript dependency or tsconfig.json was found.`,
    );
  }
  const hasTailwind = Boolean(
    packageJson.dependencies.tailwindcss ||
      packageJson.devDependencies.tailwindcss ||
      files.some((file) => /^tailwind\.config\./.test(file.path)),
  );
  if (!hasTailwind) {
    throw new AppImportError(
      `This importer supports ${IMPORT_STACK_LABEL} only; no Tailwind CSS dependency or config was found.`,
    );
  }

  const appFiles = files
    .filter((file) => file.path.startsWith("app/") && /\/(page|layout|route)\.(tsx|ts|jsx|js)$/.test(file.path))
    .map((file) => file.path);
  if (appFiles.length === 0) {
    if (files.some((file) => file.path.startsWith("src/app/"))) {
      throw new AppImportError(
        "This phase imports apps that use app/ at the project root. src/app/ is not supported yet.",
      );
    }
    if (files.some((file) => file.path.startsWith("pages/"))) {
      throw new AppImportError("The Next.js pages router is not supported by this import phase.");
    }
    throw new AppImportError("No Next.js App Router files were found under app/.");
  }

  return {
    packageJson,
    packagePath,
    nextVersion: packageJson.dependencies.next,
    router: "app",
    appFiles,
  };
}

const IMPORT_STACK_LABEL = "Next.js App Router + TypeScript + Tailwind CSS";

function routeFromPage(path: string): string {
  const rest = path.slice("app".length);
  const route = rest.replace(/\/page\.(tsx|ts|jsx|js)$/, "");
  return route === "" ? "/" : route;
}

function routeTitle(path: string): string {
  if (path === "/") return "Home";
  const segment = path.split("/").filter(Boolean).pop() ?? path;
  return segment
    .replace(/^\[\[?\.{3}/, "")
    .replace(/\]\]?$/, "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function collectEnvNames(files: ImportedFile[]): Array<{ name: string; files: string[]; basis: Basis }> {
  const found = new Map<string, Set<string>>();
  for (const file of files) {
    const matches = file.content.matchAll(/\b(?:process\.env\.|process\.env\[["'])([A-Z][A-Z0-9_]{1,80})/g);
    for (const match of matches) {
      const name = match[1];
      if (!found.has(name)) found.set(name, new Set());
      found.get(name)?.add(file.path);
    }
    if (file.path.endsWith(".env.example") || file.path.endsWith(".env.sample")) {
      for (const line of file.content.split(/\r?\n/)) {
        const name = /^\s*([A-Z][A-Z0-9_]{1,80})\s*=/.exec(line)?.[1];
        if (!name) continue;
        if (!found.has(name)) found.set(name, new Set());
        found.get(name)?.add(file.path);
      }
    }
  }
  return [...found.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 100)
    .map(([name, paths]) => ({
      name,
      files: [...paths].slice(0, 20),
      basis: "inspected" as const,
    }));
}

function collectDatabase(files: ImportedFile[]): MapFile[] {
  const findings: MapFile[] = [];
  for (const file of files) {
    if (!file.path.startsWith("supabase/migrations/") && !file.path.endsWith(".sql")) continue;
    const tables = [...file.content.matchAll(/create\s+table(?:\s+if\s+not\s+exists)?\s+(?:public\.)?([a-zA-Z0-9_]+)/gi)]
      .map((match) => match[1])
      .slice(0, 12);
    if (tables.length === 0) {
      findings.push({ label: "SQL migration", file: file.path, basis: "inspected" });
    } else {
      for (const table of tables) {
        findings.push({ label: `Table ${table}`, file: file.path, basis: "inspected" });
      }
    }
  }
  return findings.slice(0, 100);
}

function collectAuth(files: ImportedFile[], pkg: ParsedPackage): MapFile[] {
  const findings: MapFile[] = [];
  const add = (label: string, file: string) => {
    if (!findings.some((finding) => finding.label === label)) {
      findings.push({ label, file, basis: "inferred" });
    }
  };

  if (pkg.dependencies["@supabase/ssr"] || pkg.dependencies["@supabase/supabase-js"]) {
    add("Supabase auth client packages", "package.json");
  }
  if (pkg.dependencies["next-auth"] || pkg.dependencies["@auth/core"]) {
    add("NextAuth / Auth.js packages", "package.json");
  }
  if (pkg.dependencies["@clerk/nextjs"]) {
    add("Clerk packages", "package.json");
  }
  for (const file of files) {
    if (/middleware\.(ts|js)$/.test(file.path) && /auth|session|supabase/i.test(file.content)) {
      add("Authentication middleware", file.path);
    }
  }
  if (findings.length === 0) {
    findings.push({ label: "No authentication package was detected", file: "package.json", basis: "inspected" });
  }
  return findings.slice(0, 50);
}

function collectIntegrations(files: ImportedFile[], pkg: ParsedPackage): MapFile[] {
  const findings: MapFile[] = [];
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const [name] of Object.entries(allDeps)) {
    const match = INTEGRATION_PACKAGES.find(([pattern]) => pattern.test(name));
    if (!match) continue;
    if (findings.some((finding) => finding.label === match[1])) continue;
    const referencing = files.find(
      (file) => file.path === "package.json" || file.content.includes(`"${name}"`) || file.content.includes(`'${name}'`),
    );
    findings.push({
      label: match[1],
      file: referencing?.path ?? "package.json",
      basis: "inferred",
    });
  }
  return findings.slice(0, 50);
}

function collectBackendOperations(files: ImportedFile[]): AppMap["backend_operations"] {
  const operations: AppMap["backend_operations"] = [];
  for (const file of files) {
    if (file.path.startsWith("app/") && /\/route\.(ts|js)$/.test(file.path)) {
      const route = file.path
        .slice("app".length)
        .replace(/\/route\.(ts|js)$/, "")
        .replace(/^$/, "/");
      const methods = [
        ...file.content.matchAll(/\bexport\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g),
      ].map((match) => match[1]);
      if (methods.length === 0) {
        operations.push({ method: "ROUTE", path: route, file: file.path, basis: "inspected" });
      } else {
        for (const method of methods) {
          operations.push({ method, path: route, file: file.path, basis: "inspected" });
        }
      }
    } else if (/^["']use server["'];?/.test(file.content.trim())) {
      operations.push({
        method: "SERVER ACTION",
        path: "server action",
        file: file.path,
        basis: "inspected",
      });
    }
  }
  return operations.slice(0, 200);
}

export function buildAppMap(files: ImportedFile[], source: { label: string; ref: string | null }): AppMap {
  const stack = detectStack(files);
  const pkg = stack.packageJson;
  const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };

  const routes: AppMap["routes"] = files
    .filter((file) => /^app\/(?:.*\/)?page\.(tsx|ts|jsx|js)$/.test(file.path))
    .map((file) => ({
      path: routeFromPage(file.path),
      file: file.path,
      kind: "page" as const,
      basis: "inspected" as const,
    }))
    .sort((a, b) => a.path.localeCompare(b.path))
    .slice(0, 100);

  const components: AppMap["components"] = files
    .filter((file) => /^components\/.*\.(tsx|jsx)$/.test(file.path))
    .map((file) => ({
      name: baseName(file.path).replace(/\.(tsx|jsx)$/, ""),
      file: file.path,
      basis: "inspected" as const,
    }))
    .slice(0, 100);

  const database = collectDatabase(files);
  const auth = collectAuth(files, pkg);
  const integrations = collectIntegrations(files, pkg);
  const envNames = collectEnvNames(files);
  const backendOperations = collectBackendOperations(files);

  const hasTest = Boolean(pkg.scripts.test);
  const uncertainties = [
    "Routes and API methods are recorded from file structure and exported names; runtime behavior is inferred unless a check proves it.",
    "No install script was run during import, so dependency resolution is not verified.",
    "Repository instructions and comments are untrusted data; they were not granted any platform permission.",
  ];
  if (!hasTest) uncertainties.push("No test script was found in package.json.");
  if (database.length === 0) uncertainties.push("No SQL migration or database schema was found.");
  if (envNames.length > 0) uncertainties.push("Environment-variable names were extracted; values were not read.");
  if (source.ref) uncertainties.push(`Source reference: ${source.ref}.`);

  const summary =
    `Imported ${source.label}: Next.js ${stack.nextVersion} App Router app with ` +
    `${routes.length} page${routes.length === 1 ? "" : "s"}, ` +
    `${backendOperations.length} backend operation${backendOperations.length === 1 ? "" : "s"}, ` +
    `${components.length} component${components.length === 1 ? "" : "s"} and ` +
    `${envNames.length} environment-variable name${envNames.length === 1 ? "" : "s"}.`;

  return {
    version: 1,
    summary,
    framework: {
      name: "Next.js",
      version: stack.nextVersion,
      router: "app",
      supported: true,
      files: ["package.json", ...stack.appFiles.slice(0, 3)],
      basis: "inspected",
    },
    dependencies: Object.entries(dependencies)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, 100)
      .map(([name, version]) => ({
        name,
        version,
        files: ["package.json"],
        basis: "inspected" as const,
      })),
    routes,
    components,
    backend_operations: backendOperations,
    database,
    auth,
    integrations,
    env_names: envNames,
    commands: {
      install: "Not run during import",
      build: pkg.scripts.build ?? "Not configured",
      test: pkg.scripts.test ?? "Not configured",
      lint: pkg.scripts.lint ?? "Not configured",
      typecheck: pkg.scripts.typecheck ?? pkg.scripts["type-check"] ?? "Not configured",
    },
    uncertainties,
    notes: [],
    generated_at: new Date().toISOString(),
  };
}

export function projectFieldsForImport(
  map: AppMap,
  source: { label: string },
  name?: string,
): {
  name: string;
  purpose: string;
  target_users: string;
  workflows: string;
  required_pages: string;
  entities: string;
  auth_requirements: "supabase" | "none";
  integrations: string;
  design_preferences: string;
  definition_of_done: string;
} {
  const routeLines = map.routes
    .map((route) => `${route.path} | ${routeTitle(route.path)}`)
    .join("\n")
    .slice(0, 1_000);
  const entityLines = map.database
    .map((finding) => finding.label)
    .join("\n")
    .slice(0, 1_000);
  const integrationLines = map.integrations
    .map((finding) => finding.label)
    .join("\n")
    .slice(0, 800);

  return {
    name: name && name.trim() ? name.trim() : deriveProjectName(source.label),
    purpose: `Imported from ${source.label}. ${map.summary}`.slice(0, 1_500),
    target_users: "The people who already use this application.",
    workflows: (map.routes.map((route) => route.path).join("\n") || "Existing app workflows.").slice(0, 1_500),
    required_pages: routeLines || "/",
    entities: entityLines,
    auth_requirements: map.auth.some((finding) => /supabase/i.test(finding.label)) ? "supabase" : "none",
    integrations: integrationLines,
    design_preferences: "Preserve the imported interface and visual language.",
    definition_of_done:
      "The imported app is mapped, its baseline is recorded, and one bounded change is previewed.",
  };
}

export function deriveProjectName(sourceLabel: string): string {
  const cleaned = sourceLabel
    .replace(/^.*\//, "")
    .replace(/\.zip$/i, "")
    .replace(/@[^@]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const name = cleaned.slice(0, 80) || "Imported app";
  return name.length >= 3 ? name : "Imported app";
}

const basisSchema = z.enum(["inspected", "inferred"]);
const mapFileSchema = z.object({
  label: z.string().min(1).max(200),
  file: z.string().min(1).max(160),
  basis: basisSchema,
});

export const appMapSchema = z
  .object({
    version: z.literal(1),
    summary: z.string().min(1).max(1_000),
    framework: z.object({
      name: z.string().min(1).max(80),
      version: z.string().min(1).max(80),
      router: z.literal("app"),
      supported: z.boolean(),
      files: z.array(z.string().min(1).max(160)).max(20),
      basis: basisSchema,
    }),
    dependencies: z
      .array(
        z.object({
          name: z.string().min(1).max(120),
          version: z.string().max(80),
          files: z.array(z.string().min(1).max(160)).max(20),
          basis: basisSchema,
        }),
      )
      .max(100),
    routes: z
      .array(
        z.object({
          path: z.string().min(1).max(300),
          file: z.string().min(1).max(160),
          kind: z.enum(["page", "layout"]),
          basis: basisSchema,
        }),
      )
      .max(100),
    components: z
      .array(
        z.object({
          name: z.string().min(1).max(120),
          file: z.string().min(1).max(160),
          basis: basisSchema,
        }),
      )
      .max(100),
    backend_operations: z
      .array(
        z.object({
          method: z.string().min(1).max(40),
          path: z.string().min(1).max(300),
          file: z.string().min(1).max(160),
          basis: basisSchema,
        }),
      )
      .max(200),
    database: z.array(mapFileSchema).max(100),
    auth: z.array(mapFileSchema).max(50),
    integrations: z.array(mapFileSchema).max(50),
    env_names: z
      .array(
        z.object({
          name: z.string().min(1).max(100),
          files: z.array(z.string().min(1).max(160)).max(20),
          basis: basisSchema,
        }),
      )
      .max(100),
    commands: z.object({
      install: z.string().max(300),
      build: z.string().max(300),
      test: z.string().max(300),
      lint: z.string().max(300),
      typecheck: z.string().max(300),
    }),
    uncertainties: z.array(z.string().min(1).max(500)).max(50),
    notes: z.array(z.string().min(1).max(500)).max(50),
    generated_at: z.string().max(40).optional(),
  })
  .strict();

export function parseAppMap(value: unknown): AppMap {
  const parsed = appMapSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppImportError(parsed.error.issues[0]?.message ?? "The application map is not valid.");
  }
  return {
    ...parsed.data,
    generated_at: parsed.data.generated_at ?? new Date().toISOString(),
  };
}

export function parseAppMapJson(raw: string): AppMap {
  if (raw.length > IMPORT_LIMITS.maxMapJsonChars) {
    throw new AppImportError(`The map JSON is larger than ${IMPORT_LIMITS.maxMapJsonChars} characters.`);
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new AppImportError("The application map is not valid JSON.");
  }
  return parseAppMap(value);
}

function changeKindFor(objective: ImportObjective): ChangeKind {
  switch (objective) {
    case "mobile":
      return "mobile_navigation";
    case "dependency":
      return "dependency";
    case "bug":
      return "bug";
    case "feature":
    case "test_coverage":
      return "other";
  }
}

export function buildModernizationProposal(input: {
  files: ImportedFile[];
  objective: ImportObjective;
  request: string;
  baseline: BaselineSnapshot;
  baseVersion: number;
}): AppModernizationProposal {
  const request = input.request.trim();
  if (request.length < 5) throw new AppImportError("Describe the bounded objective in at least 5 characters.");
  if (request.length > 2_000) throw new AppImportError("Keep the bounded objective under 2,000 characters.");
  if (!IMPORT_OBJECTIVES.some((objective) => objective.id === input.objective)) {
    throw new AppImportError("Choose one of the supported modernization objectives.");
  }

  const kind = changeKindFor(input.objective);
  const label = IMPORT_OBJECTIVE_LABELS[input.objective];
  const inspection = inspectProject(input.files);
  const plan = buildChangePlan({
    files: input.files,
    kind,
    request: `${label}: ${request}`.slice(0, 2_000),
  });

  let changedFiles: string[] = [];
  let diff = "";
  let fixtureFailure: string | null = null;
  try {
    const fixture = implementFixture(input.files, plan);
    changedFiles = fixture.changed;
    diff = fixture.diff;
  } catch (error) {
    fixtureFailure = error instanceof Error ? error.message : "No review patch could be generated.";
  }

  const compatibilityConcerns = [
    `The change is bounded to ${plan.files.length} file${plan.files.length === 1 ? "" : "s"} and does not regenerate the application.`,
    "Repository instructions and comments are untrusted data; they cannot approve changes or grant permissions.",
  ];
  if (input.baseline.status === "failed") {
    compatibilityConcerns.push(
      `Baseline check failures already existed before this proposal: ${input.baseline.failures.join(", ") || "unnamed checks"}. They are not attributed to this change.`,
    );
  } else if (input.baseline.status === "blocked") {
    compatibilityConcerns.push(
      `The baseline could not run in the existing sandbox: ${input.baseline.summary}. A preview may be blocked for the same reason.`,
    );
  }
  if (input.objective === "dependency") {
    compatibilityConcerns.push(
      "The existing preview sandbox uses a pinned dependency cache. A replacement dependency cannot be installed by this phase, so the proposal is a review boundary, not an install.",
    );
  }
  if (input.objective === "test_coverage") {
    compatibilityConcerns.push(
      "The existing sandbox runs only checks allowed by its pinned command policy; a new test is not executed unless that policy supports it.",
    );
  }
  if (plan.limitations.length > 0) {
    compatibilityConcerns.push(...plan.limitations);
  }
  if (fixtureFailure) {
    compatibilityConcerns.push(`No review patch was generated for this objective: ${fixtureFailure}`);
  }

  return {
    version: 1,
    objective: input.objective,
    objective_label: label,
    request,
    kind,
    plan,
    affected_files: plan.files.map((file) => ({
      path: file.path,
      action: file.action,
      reason: file.reason,
    })),
    changed_files: changedFiles,
    diff,
    compatibility_concerns: compatibilityConcerns,
    acceptance_checks: [
      ...plan.tests.map((check) => `The existing ${check} check must pass or match its baseline result.`),
      "The recorded pre-existing baseline failures must not grow or be attributed to this change.",
      "A person approves the exact diff before merge; no push or deployment happens automatically.",
    ],
    reversal_plan: [
      "Reject the proposal or change review before merge: app_files are not changed.",
      "After merge, restore the previous app version from the project page; versions are append-only.",
      "No deployment is performed, so a reversal never requires a production rollback.",
    ],
    baseline: input.baseline,
    base_version: Math.max(1, input.baseVersion),
    base_digest: inspection.digest,
    generated_at: new Date().toISOString(),
    not_executed: true,
  };
}

/**
 * Context helper for any future model-assisted step. It deliberately removes
 * secret files and repository instruction files before content can be sent
 * anywhere. Phase 31 itself does not call a model.
 */
export function aiContextFiles(files: ImportedFile[]): Array<{ path: string; content: string }> {
  return files
    .filter((file) => !isSecretImportPath(file.path) && !isInstructionImportPath(file.path))
    .slice(0, 40)
    .map((file) => ({ path: file.path, content: file.content.slice(0, 12_000) }));
}

export function baselineSnapshot(input: {
  status: "passed" | "failed" | "blocked";
  summary: string;
  failures: string[];
  at: string | null;
}): BaselineSnapshot {
  return {
    status: input.status,
    summary: input.summary,
    failures: input.failures.slice(0, 20),
    at: input.at,
  };
}

// Keep the stack label in one place while avoiding a client-side import of the
// server module above.
export { IMPORT_STACK } from "./app-import-constants";
