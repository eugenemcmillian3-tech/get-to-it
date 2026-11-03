import crypto from "node:crypto";

/**
 * Phase 24 — deployment contract.
 *
 * This module is deliberately pure: it does not call GitHub, Vercel, Supabase,
 * a model or the network. It builds the exact plan a person approves, computes
 * its fingerprint, extracts environment requirements from real generated code,
 * previews migrations and decides which actions are safe.
 */

export const DEPLOYMENT_TARGETS = ["preview", "production"] as const;
export type DeploymentTarget = (typeof DEPLOYMENT_TARGETS)[number];

export const DEPLOYMENT_STATUSES = [
  "draft",
  "checks_ready",
  "approved",
  "repository",
  "migrations",
  "infrastructure",
  "deploying",
  "succeeded",
  "partial_failure",
  "failed",
] as const;
export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

export const PROVIDERS = ["github", "vercel", "supabase"] as const;
export type DeploymentProvider = (typeof PROVIDERS)[number];

export type DeploymentEnvVisibility = "public" | "server";
export type DeploymentEnvironment = "preview" | "production";

export type DeploymentEnvRequirement = {
  name: string;
  visibility: DeploymentEnvVisibility;
  /** Relative files that actually use or declare the name. Never values. */
  sources: string[];
};

export type DeploymentMigrationPreview = {
  path: string;
  statement_count: number;
  destructive: string[];
  preview: string;
};

export type DeploymentFile = { path: string; content: string };

export type GitHubTarget = {
  provider: "github";
  login: string;
  full_name: string;
  branch: string;
  private: boolean;
  repo_id: number | null;
};

export type VercelTarget = {
  provider: "vercel";
  account: string;
  project_id: string;
  project_name: string;
  team_id: string | null;
};

export type SupabaseTarget = {
  provider: "supabase";
  account: string;
  development_ref: string;
  production_ref: string;
  target_ref: string;
};

export type DeploymentPlan = {
  version: 1;
  project: { id: string; name: string };
  target: DeploymentTarget;
  source: {
    version: number;
    digest: string;
    file_count: number;
    paths: string[];
  };
  repository: GitHubTarget & {
    visibility: "private" | "public";
    action: string;
  };
  hosting: VercelTarget & {
    deployment_visibility: "public";
    action: string;
  };
  database: SupabaseTarget & {
    migrations: DeploymentMigrationPreview[];
    apply_migrations: boolean;
    migration_target: "none" | "production";
    action: string;
  };
  environment: {
    environment: DeploymentEnvironment;
    names: { name: string; visibility: DeploymentEnvVisibility; set: boolean }[];
  };
  visibility: {
    repository: "private" | "public";
    deployment: "public";
    note: string;
  };
  actions: string[];
  costs: { known: string[]; unknown: string[] };
  rollback: string[];
  limitations: string[];
};

export class DeploymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeploymentError";
  }
}

const SYSTEM_ENV = new Set([
  "NODE_ENV",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_URL",
  "VERCEL_GIT_COMMIT_SHA",
  "NEXT_RUNTIME",
]);

/** Names used by generated code and by the generated `.env.example`. */
export function extractEnvRequirements(files: DeploymentFile[]): DeploymentEnvRequirement[] {
  const names = new Map<string, Set<string>>();
  const add = (name: string, path: string) => {
    const clean = name.trim();
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(clean) || SYSTEM_ENV.has(clean)) return;
    const sources = names.get(clean) ?? new Set<string>();
    sources.add(path);
    names.set(clean, sources);
  };

  for (const file of files) {
    const processEnv = /process\.env(?:\.([A-Z][A-Z0-9_]*)|\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\])/g;
    for (const match of file.content.matchAll(processEnv)) add(match[1] ?? match[2], file.path);

    if (file.path === ".env.example" || file.path.endsWith("/.env.example")) {
      for (const line of file.content.split(/\r?\n/)) {
        const match = /^\s*([A-Z][A-Z0-9_]*)\s*=/.exec(line);
        if (match) add(match[1], file.path);
      }
    }
  }

  return [...names.entries()]
    .map(([name, sources]) => ({
      name,
      visibility: name.startsWith("NEXT_PUBLIC_") ? ("public" as const) : ("server" as const),
      sources: [...sources].sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function sourceDigest(files: DeploymentFile[]): string {
  const hash = crypto.createHash("sha256");
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

type DestructivePattern = [RegExp, string];

const DESTRUCTIVE_PATTERNS: DestructivePattern[] = [
  [/\bdrop\s+(table|column|schema|database|type|function|policy|index|constraint)\b/i, "DROP removes an existing schema object"],
  [/\btruncate\b/i, "TRUNCATE removes all rows"],
  [/\bdelete\s+from\b(?![^;]*\bwhere\b)/i, "DELETE without a WHERE clause removes all rows"],
  [/\balter\s+table\b[\s\S]*?\bdrop\b/i, "ALTER TABLE ... DROP removes existing data or structure"],
  [/\bupdate\s+[\w."]+\s+set\b(?![^;]*\bwhere\b)/i, "UPDATE without a WHERE clause rewrites every row"],
];

export function previewMigrations(files: DeploymentFile[]): DeploymentMigrationPreview[] {
  return files
    .filter((file) => /^supabase\/migrations\/[^/]+\.sql$/.test(file.path))
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => {
      const destructive = DESTRUCTIVE_PATTERNS.filter(([pattern]) => pattern.test(file.content)).map(
        ([, reason]) => reason,
      );
      const statementCount = file.content
        .replace(/--[^\n]*/g, "")
        .split(";")
        .map((statement) => statement.trim())
        .filter(Boolean).length;
      return {
        path: file.path,
        statement_count: statementCount,
        destructive: [...new Set(destructive)],
        preview: file.content.slice(0, 2_500),
      };
    });
}

export function migrationFiles(files: DeploymentFile[]): { path: string; sql: string }[] {
  return files
    .filter((file) => /^supabase\/migrations\/[^/]+\.sql$/.test(file.path))
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => ({ path: file.path, sql: file.content }));
}

export function hasDestructiveMigrations(migrations: DeploymentMigrationPreview[]): boolean {
  return migrations.some((migration) => migration.destructive.length > 0);
}

export type BuildPlanInput = {
  projectId: string;
  projectName: string;
  target: DeploymentTarget;
  version: number;
  files: DeploymentFile[];
  github: GitHubTarget;
  vercel: VercelTarget;
  supabase: SupabaseTarget;
  envRequirements: DeploymentEnvRequirement[];
  setEnvNames: string[];
};

export function buildDeploymentPlan(input: BuildPlanInput): DeploymentPlan {
  if (input.files.length === 0) throw new DeploymentError("Generate project files before planning a deployment.");
  if (input.version < 1) throw new DeploymentError("A deployment needs a saved source version.");
  if (input.github.branch.trim() === "") throw new DeploymentError("Choose a GitHub branch.");

  const envNames = input.setEnvNames.map((name) => name.trim()).filter(Boolean);
  const set = new Set(envNames);
  const environment: DeploymentEnvironment = input.target === "production" ? "production" : "preview";
  const migrations = previewMigrations(input.files);
  const applyMigrations = input.target === "production" && migrations.length > 0;
  const digest = sourceDigest(input.files);
  const envRows = input.envRequirements.map((requirement) => ({
    name: requirement.name,
    visibility: requirement.visibility,
    set: set.has(requirement.name),
  }));

  const plan: DeploymentPlan = {
    version: 1,
    project: { id: input.projectId, name: input.projectName },
    target: input.target,
    source: {
      version: input.version,
      digest,
      file_count: input.files.length,
      paths: [...input.files.map((file) => file.path)].sort(),
    },
    repository: {
      ...input.github,
      visibility: input.github.private ? "private" : "public",
      action: `Commit this exact snapshot to ${input.github.full_name}@${input.github.branch}. The branch tree becomes exactly the snapshot; tracked files outside it are removed.`,
    },
    hosting: {
      ...input.vercel,
      deployment_visibility: "public",
      action: `Upsert the approved environment-variable names in ${input.vercel.project_name}, then create a ${input.target} Vercel deployment from the new commit.`,
    },
    database: {
      ...input.supabase,
      migrations,
      apply_migrations: applyMigrations,
      migration_target: applyMigrations ? "production" : "none",
      action: applyMigrations
        ? `Apply ${migrations.length} migration file(s) to the production database target ${input.supabase.production_ref} before deployment.`
        : "No database migration is applied by this deployment. Preview plans never touch the production database.",
    },
    environment: { environment, names: envRows },
    visibility: {
      repository: input.github.private ? "private" : "public",
      deployment: "public",
      note: "Vercel production URLs are public by default. Preview URLs may also be public. This action does not add a custom domain or change DNS.",
    },
    actions: [
      `GitHub: commit ${input.files.length} files to ${input.github.full_name}@${input.github.branch}.`,
      `Vercel: upsert ${envRows.length} environment variable name(s) for ${environment}.`,
      applyMigrations
        ? `Supabase: apply ${migrations.length} migration file(s) to ${input.supabase.production_ref}.`
        : "Supabase: no migration write.",
      `Vercel: create one ${input.target} deployment.`,
      "No purchase, plan upgrade, domain purchase, DNS change or database deletion is included.",
    ],
    costs: {
      known: ["No purchase or plan change is made by this action."],
      unknown: [
        "Vercel plan charges, build minutes, bandwidth and function usage are not priced here.",
        "Supabase plan, compute, storage, egress and branching charges are not priced here.",
        "GitHub plan, storage and Actions charges, if any, are not priced here.",
      ],
    },
    rollback: [
      "A previous source snapshot can be used to create a new deployment, but that does not rewrite GitHub history or move Vercel aliases by itself.",
      "Database migrations are forward-only. Restoring an application version does not reverse schema or data changes.",
      "Revoke a provider token at the provider if a connection may be compromised; disconnecting here only removes the stored copy.",
    ],
    limitations: [
      "The generated app remains a scaffold and is not production-ready without review.",
      "A successful deployment API response is not proof the app works; smoke checks are limited.",
      "The Vercel project must already have access to the connected GitHub repository; this plan does not create or repair that Git link.",
      "No custom domain, DNS, paid plan or database rollback is included.",
      "Preview deployments do not apply production migrations.",
    ],
  };

  return plan;
}

export function planProblems(plan: DeploymentPlan): string[] {
  const problems: string[] = [];
  if (plan.source.file_count === 0) problems.push("The source snapshot is empty.");
  if (plan.target === "production" && hasDestructiveMigrations(plan.database.migrations)) {
    problems.push(
      "A destructive migration is present. It is blocked from automatic production application; review and run it manually with a backup.",
    );
  }
  const missing = plan.environment.names.filter((item) => !item.set).map((item) => item.name);
  if (missing.length > 0) {
    problems.push(`Set every required ${plan.environment.environment} environment value: ${missing.join(", ")}.`);
  }
  return problems;
}

export function planHash(plan: DeploymentPlan): string {
  return crypto.createHash("sha256").update(stableJson(plan)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function isTerminalDeploymentStatus(status: DeploymentStatus): boolean {
  return ["succeeded", "partial_failure", "failed"].includes(status);
}

export function nextDeploymentActions(status: DeploymentStatus): string[] {
  switch (status) {
    case "draft":
      return ["Run pre-deploy checks", "Review the plan", "Approve when checks pass"];
    case "checks_ready":
      return ["Type DEPLOY to approve the resolved actions", "Then create the repository commit"];
    case "approved":
    case "repository":
    case "migrations":
    case "infrastructure":
      return ["Continue the approved pipeline; do not create a second deployment"];
    case "deploying":
      return ["Poll the hosting status", "Run smoke checks only after the host reports ready"];
    case "succeeded":
      return ["Inspect the deployment result", "Redeploy an earlier source snapshot if needed"];
    case "partial_failure":
      return ["Inspect which action succeeded", "Fix the cause and create a new plan; do not blindly retry"];
    case "failed":
      return ["Inspect the error", "Create a new plan after fixing the cause; no resource was silently retried"];
    default:
      return [];
  }
}

export function redactSecrets(text: string, secrets: string[] = []): string {
  let result = text;
  for (const secret of secrets) {
    if (secret.length >= 8) result = result.split(secret).join("[redacted]");
  }
  return result
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "[redacted]")
    .replace(/\b(?:sbp_[A-Za-z0-9_]{16,}|vercel_[A-Za-z0-9_]{16,})\b/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]")
    .slice(0, 1_000);
}

export function smokeFailureReason(status: number, contentType: string | null, body: string): string | null {
  if (status < 200 || status >= 400) return `The deployed app returned HTTP ${status}.`;
  if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    return "The deployed app did not return an HTML page.";
  }
  if (body.trim().length < 100) return "The deployed app returned an empty or incomplete page.";
  if (/application error|internal server error|unhandled runtime error/i.test(body)) {
    return "The deployed app returned a framework error page.";
  }
  return null;
}
