import { isSafeProjectPath, type AppSpec } from "@/lib/app-builder";

/**
 * Phase 23 — optional agent-team mode.
 *
 * This module is pure and deterministic. It models the queue, permissions and
 * integration rules; it does not call a model, a shell, a deployment tool or an
 * external service. The built-in workers are controlled fixtures, so the whole
 * collaboration can be exercised before any paid multi-agent run.
 *
 * A generated project remains the source of truth. Each task works on a
 * logical branch: a full-file list based on the files it was given. Nothing is
 * written to the project until the owner runs the explicit integration step.
 */

export const TEAM_ROLES = [
  "coordinator",
  "frontend",
  "backend",
  "data",
  "qa",
  "security",
] as const;

export type TeamRole = (typeof TEAM_ROLES)[number];

export const TEAM_TASK_STATUSES = [
  "queued",
  "running",
  "blocked",
  "awaiting_review",
  "completed",
  "failed",
  "cancelled",
] as const;

export type TeamTaskStatus = (typeof TEAM_TASK_STATUSES)[number];

export const TEAM_RUN_STATUSES = [
  "queued",
  "running",
  "paused",
  "awaiting_review",
  "completed",
  "failed",
  "cancelled",
] as const;

export type TeamRunStatus = (typeof TEAM_RUN_STATUSES)[number];

export const TEAM_INTEGRATION_STATUSES = [
  "pending",
  "merged",
  "conflict",
  "checks_failed",
] as const;

export type TeamIntegrationStatus = (typeof TEAM_INTEGRATION_STATUSES)[number];

export const TEAM_LIMITS = {
  minAgents: 1,
  maxAgents: 4,
  defaultAgents: 2,
  maxCalls: 24,
  defaultCalls: 0,
  minRuntimeSeconds: 60,
  maxRuntimeSeconds: 1800,
  defaultRuntimeSeconds: 600,
  maxTasks: 24,
  maxTaskSeconds: 300,
} as const;

const IMPLEMENTATION_ROLES: TeamRole[] = ["frontend", "backend", "data"];

export const TEAM_ROLE_LABELS: Record<TeamRole, string> = {
  coordinator: "Coordinator",
  frontend: "Frontend agent",
  backend: "Backend agent",
  data: "Data agent",
  qa: "QA agent",
  security: "Security reviewer",
};

export type RoleDefinition = {
  label: string;
  tools: string[];
  writeRoots: string[];
  canWrite: boolean;
  note: string;
};

/**
 * Tools are capability labels, not shell commands. No role has a deployment,
 * billing, credential or arbitrary-execution tool. External actions are absent
 * by design; adding one requires the owner's explicit approval.
 */
export const TEAM_ROLES_SPEC: Record<TeamRole, RoleDefinition> = {
  coordinator: {
    label: "Coordinator",
    tools: ["read_spec", "queue_tasks", "request_review"],
    writeRoots: [],
    canWrite: false,
    note: "Keeps the approved specification and work queue coherent. Cannot add scope or write files.",
  },
  frontend: {
    label: "Frontend agent",
    tools: ["read_files", "write_files", "run_typecheck", "run_lint"],
    writeRoots: ["app/", "components/"],
    canWrite: true,
    note: "Owns pages and client components. Cannot edit APIs, data migrations or tests.",
  },
  backend: {
    label: "Backend agent",
    tools: ["read_files", "write_files", "run_typecheck", "run_lint", "run_tests"],
    writeRoots: ["app/api/", "lib/"],
    canWrite: true,
    note: "Owns APIs, validation and application logic. Cannot deploy or read credentials.",
  },
  data: {
    label: "Data agent",
    tools: ["read_files", "write_files", "run_typecheck", "run_tests"],
    writeRoots: ["supabase/"],
    canWrite: true,
    note: "Owns schema, migrations and access policies. No production database access.",
  },
  qa: {
    label: "QA agent",
    tools: ["read_files", "run_tests", "report_findings"],
    writeRoots: [],
    canWrite: false,
    note: "Runs acceptance and regression checks and reports evidence. Cannot change code to make a check pass.",
  },
  security: {
    label: "Security reviewer",
    tools: ["read_files", "run_lint", "report_findings"],
    writeRoots: [],
    canWrite: false,
    note: "Reports issues and suggested corrections. Its review is not a complete security audit.",
  },
};

export type TeamBranchFile = {
  path: string;
  content: string;
  /** The content this branch was based on. Null means the file is new. */
  base_content: string | null;
};

export type TeamTaskOutput = {
  summary: string;
  findings?: string[];
  evidence?: string[];
  checks?: TeamCheck[];
};

export type TeamCheck = {
  name: string;
  label: string;
  status: "passed" | "failed" | "timed_out" | "skipped";
  code: number | null;
  log: string;
};

export type TeamTaskDraft = {
  role: TeamRole;
  objective: string;
  inputs: string[];
  allowed_tools: string[];
  expected_artifacts: string[];
  acceptance_checks: string[];
  file_claims: string[];
  budget_seconds: number;
  budget_calls: number;
};

export type TeamTaskRecord = TeamTaskDraft & {
  id: string;
  run_id: string;
  project_id: string;
  user_id: string;
  position: number;
  status: TeamTaskStatus;
  calls_used: number;
  attempts: number;
  branch_files: TeamBranchFile[];
  changed_files: string[];
  output: TeamTaskOutput | null;
  blocker: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TeamRunRecord = {
  id: string;
  project_id: string;
  user_id: string;
  spec_version: number;
  spec: AppSpec;
  status: TeamRunStatus;
  mode: "fixture";
  max_agents: number;
  max_calls: number;
  max_runtime_seconds: number;
  calls_used: number;
  /** Fixture-only runs have no paid path, so their AI credit budget is zero. */
  credit_budget: number;
  credits_spent: number;
  runtime_seconds: number;
  active_count: number;
  integration_status: TeamIntegrationStatus;
  last_error: string | null;
  started_at: string;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TeamIntegrationRecord = {
  id: string;
  run_id: string;
  project_id: string;
  user_id: string;
  status: "merged" | "conflict" | "checks_failed";
  contributors: Record<string, string[]>;
  conflict_files: string[];
  checks: TeamCheck[];
  log: string;
  version: number | null;
  error: string | null;
  created_at: string;
};

export type TeamEventRecord = {
  id: string;
  run_id: string;
  task_id: string | null;
  actor: "owner" | "system" | "coordinator";
  kind: string;
  detail: string;
  created_at: string;
};

export type TeamFixtureContext = {
  spec: AppSpec;
  projectName: string;
  integrationStatus: TeamIntegrationStatus;
  integrationChecks: TeamCheck[];
  /** Existing tree, so a repeat run branches from current content instead of
   * pretending every fixed fixture path is always new. */
  currentFiles?: { path: string; content: string }[];
};

export function roleDefinition(role: TeamRole): RoleDefinition {
  return TEAM_ROLES_SPEC[role];
}

export function taskCanUseTool(task: TeamTaskDraft, tool: string): boolean {
  return task.allowed_tools.includes(tool) && roleDefinition(task.role).tools.includes(tool);
}

export function taskCanWritePath(task: Pick<TeamTaskDraft, "role">, path: string): boolean {
  const definition = roleDefinition(task.role);
  if (!definition.canWrite) return false;
  if (!isSafeProjectPath(path)) return false;
  if (path === ".env.example") return false;
  if (path.endsWith(".test.ts") || path.endsWith(".test.tsx")) return false;
  if (path.startsWith("tests/")) return false;
  if (task.role === "frontend" && path.startsWith("app/api/")) return false;
  return definition.writeRoots.some((root) => path.startsWith(root));
}

export function taskScopeProblems(task: TeamTaskDraft, spec: AppSpec): string[] {
  const problems: string[] = [];
  const knownPages = new Set(spec.pages.map((page) => page.path));
  const knownEntities = new Set(spec.entities.map((entity) => entity.name));

  if (task.file_claims.length > TEAM_LIMITS.maxTasks) {
    problems.push("A task cannot claim more files than the task limit.");
  }
  for (const path of task.file_claims) {
    if (!isSafeProjectPath(path)) problems.push(`Unsafe file claim: ${path}`);
    if (!taskCanWritePath(task, path)) {
      problems.push(`${TEAM_ROLE_LABELS[task.role]} cannot own ${path}.`);
    }
  }

  // Coordinators may describe work, but every artifact must point at an
  // approved page or entity. They cannot silently add a new feature.
  for (const input of task.inputs) {
    const page = input.match(/^page:(.+)$/)?.[1];
    const entity = input.match(/^entity:(.+)$/)?.[1];
    if (page && !knownPages.has(page)) problems.push(`Page ${page} is not in the approved specification.`);
    if (entity && !knownEntities.has(entity)) {
      problems.push(`Entity ${entity} is not in the approved specification.`);
    }
  }
  return problems;
}

function coordinatorTask(
  spec: AppSpec,
  final: boolean,
): TeamTaskDraft {
  return {
    role: "coordinator",
    objective: final
      ? "Review the queue and integration evidence, then close the run without expanding scope."
      : "Confirm the approved specification and publish a bounded work queue.",
    inputs: [
      `spec-version:${spec.purpose.length > 0 ? "approved" : "draft"}`,
      ...(final ? ["closeout"] : []),
      ...spec.pages.map((page) => `page:${page.path}`),
      ...spec.entities.map((entity) => `entity:${entity.name}`),
    ],
    allowed_tools: ["read_spec", "queue_tasks", "request_review"],
    expected_artifacts: final
      ? ["Closeout note citing integration and review evidence."]
      : ["Task queue with role ownership, budgets and acceptance checks."],
    acceptance_checks: final
      ? ["Every task is completed or explicitly cancelled.", "Integration evidence is present before closeout."]
      : ["Every work item maps to the approved specification.", "No task has a deployment or external-action tool."],
    file_claims: [],
    budget_seconds: 60,
    budget_calls: 0,
  };
}

/**
 * Builds the complete, bounded queue from one approved spec. There is no API
 * for a coordinator to append an arbitrary task, which is what prevents silent
 * scope expansion.
 */
export function buildTeamPlan(
  spec: AppSpec,
  projectName: string,
  options: { conflictFixture?: boolean } = {},
): TeamTaskDraft[] {
  const dataClaims =
    spec.supabase && spec.entities.length > 0
      ? ["supabase/migrations/0002_team_indexes.sql"]
      : [];

  const drafts: TeamTaskDraft[] = [
    coordinatorTask(spec, false),
    {
      role: "data",
      objective:
        spec.supabase && spec.entities.length > 0
          ? "Add owner-scoped indexes for the approved entities without changing their access rules."
          : "Confirm that the approved specification needs no database change.",
      inputs: spec.entities.map((entity) => `entity:${entity.name}`),
      allowed_tools: ["read_files", "write_files", "run_typecheck", "run_tests"],
      expected_artifacts:
        dataClaims.length > 0
          ? ["A forward-only SQL migration with owner-scoped indexes."]
          : ["A written finding that no schema work is required."],
      acceptance_checks:
        dataClaims.length > 0
          ? ["The migration only indexes approved entities.", "No service-role key or seeded account is introduced."]
          : ["No table is invented outside the approved entities."],
      file_claims: dataClaims,
      budget_seconds: 120,
      budget_calls: 0,
    },
    {
      role: "frontend",
      objective: "Add a small, isolated interface component for the approved app.",
      inputs: [`page:${spec.pages[0]?.path ?? "/"}`],
      allowed_tools: ["read_files", "write_files", "run_typecheck", "run_lint"],
      expected_artifacts: ["components/team-banner.tsx, a component that is not wired into navigation."],
      acceptance_checks: ["The component uses only approved copy.", "No deployment or credential code is added."],
      file_claims: ["components/team-banner.tsx"],
      budget_seconds: 120,
      budget_calls: 0,
    },
    {
      role: "backend",
      objective: "Add a typed application summary derived from the approved specification.",
      inputs: ["spec:purpose", "spec:pages"],
      allowed_tools: ["read_files", "write_files", "run_typecheck", "run_lint", "run_tests"],
      expected_artifacts: ["lib/team-summary.ts with a typed summary function."],
      acceptance_checks: ["The function has no network or credential access.", "Inputs stay within the approved spec."],
      file_claims: ["lib/team-summary.ts"],
      budget_seconds: 120,
      budget_calls: 0,
    },
  ];

  if (options.conflictFixture) {
    drafts.push(
      {
        role: "frontend",
        objective: "Controlled conflict fixture: propose a shared component from the first frontend branch.",
        inputs: ["fixture:overlap"],
        allowed_tools: ["read_files", "write_files", "run_typecheck", "run_lint"],
        expected_artifacts: ["components/team-shared.tsx from the first frontend branch."],
        acceptance_checks: ["Report the overlap instead of overwriting another branch."],
        file_claims: ["components/team-shared.tsx"],
        budget_seconds: 120,
        budget_calls: 0,
      },
      {
        role: "frontend",
        objective: "Controlled conflict fixture: propose the same shared component from a second frontend branch.",
        inputs: ["fixture:overlap"],
        allowed_tools: ["read_files", "write_files", "run_typecheck", "run_lint"],
        expected_artifacts: ["components/team-shared.tsx from the second frontend branch."],
        acceptance_checks: ["Report the overlap instead of overwriting another branch."],
        file_claims: ["components/team-shared.tsx"],
        budget_seconds: 120,
        budget_calls: 0,
      },
    );
  }

  drafts.push(
    {
      role: "qa",
      objective: "Run acceptance and regression checks against the integrated project and report evidence.",
      inputs: ["integration:required", ...spec.acceptance_checks.slice(0, 5)],
      allowed_tools: ["read_files", "run_tests", "report_findings"],
      expected_artifacts: ["Test evidence with pass/fail results, including any skipped check."],
      acceptance_checks: ["Tests are run after integration.", "A failed check is reported, not hidden."],
      file_claims: [],
      budget_seconds: 180,
      budget_calls: 0,
    },
    {
      role: "security",
      objective: "Review the integrated files for obvious secret and deployment-safety issues and propose corrections.",
      inputs: ["integration:required", "review:not-a-complete-audit"],
      allowed_tools: ["read_files", "run_lint", "report_findings"],
      expected_artifacts: ["A short findings list, labelled as a pattern review rather than a complete audit."],
      acceptance_checks: ["No secret value is reproduced.", "Deployment credentials are not requested or used."],
      file_claims: [],
      budget_seconds: 120,
      budget_calls: 0,
    },
    coordinatorTask(spec, true),
  );

  if (drafts.length > TEAM_LIMITS.maxTasks) {
    throw new Error(`A team run cannot exceed ${TEAM_LIMITS.maxTasks} tasks.`);
  }

  return drafts.map((draft) => {
    const problems = taskScopeProblems(draft, spec);
    if (problems.length > 0) throw new Error(problems.join(" "));
    return draft;
  });
}

function isFinalCoordinator(task: TeamTaskRecord, tasks: TeamTaskRecord[]): boolean {
  if (task.role !== "coordinator") return false;
  return task.position === Math.max(...tasks.map((item) => item.position));
}

function firstCoordinatorDone(tasks: TeamTaskRecord[]): boolean {
  const first = tasks
    .filter((task) => task.role === "coordinator")
    .sort((a, b) => a.position - b.position)[0];
  return first?.status === "completed";
}

export function canTaskRun(
  task: TeamTaskRecord,
  tasks: TeamTaskRecord[],
  integrationStatus: TeamIntegrationStatus,
): boolean {
  if (task.status !== "queued") return false;

  if (isFinalCoordinator(task, tasks)) {
    const unfinished = tasks.some(
      (other) =>
        other.id !== task.id &&
        other.status !== "completed" &&
        other.status !== "cancelled",
    );
    return integrationStatus === "merged" && !unfinished;
  }

  if (task.role === "coordinator") return true;
  if (task.role === "qa" || task.role === "security") {
    return integrationStatus === "merged";
  }
  return firstCoordinatorDone(tasks);
}

/**
 * A later task cannot claim a path already owned by an earlier task. This is
 * deliberately position-aware: the queue has one declared owner per file, and
 * the later task becomes blocked for an explicit human decision.
 */
export function findFileClaimConflicts(
  task: TeamTaskRecord,
  tasks: TeamTaskRecord[],
): { path: string; owner: TeamTaskRecord }[] {
  const conflicts: { path: string; owner: TeamTaskRecord }[] = [];
  for (const other of tasks) {
    if (other.id === task.id) continue;
    if (other.status === "cancelled" || other.status === "failed") continue;
    const earlier = other.position < task.position;
    const active = other.status === "running" || other.status === "completed" || other.status === "awaiting_review";
    if (!earlier && !active) continue;
    for (const path of task.file_claims) {
      if (other.file_claims.includes(path)) conflicts.push({ path, owner: other });
    }
  }
  return conflicts;
}

export type RunnableSelection = {
  runnable: TeamTaskRecord[];
  blocked: { task: TeamTaskRecord; conflicts: { path: string; owner: TeamTaskRecord }[] }[];
};

export function selectRunnableTasks(
  tasks: TeamTaskRecord[],
  maxAgents: number,
  integrationStatus: TeamIntegrationStatus,
): RunnableSelection {
  const ordered = [...tasks].sort((a, b) => a.position - b.position);
  const runnable: TeamTaskRecord[] = [];
  const blocked: RunnableSelection["blocked"] = [];
  const slots = Math.max(0, Math.min(maxAgents, TEAM_LIMITS.maxAgents));

  for (const task of ordered) {
    if (runnable.length >= slots) break;
    if (!canTaskRun(task, tasks, integrationStatus)) continue;
    const conflicts = findFileClaimConflicts(task, tasks);
    if (conflicts.length > 0) {
      blocked.push({ task, conflicts });
      continue;
    }
    runnable.push(task);
  }

  return { runnable, blocked };
}

function fixtureFile(path: string, content: string, current: Map<string, string>): TeamBranchFile {
  return { path, content, base_content: current.get(path) ?? null };
}

export function runFixtureTask(
  task: TeamTaskRecord,
  context: TeamFixtureContext,
): { status: Exclude<TeamTaskStatus, "queued" | "running">; output: TeamTaskOutput; branch_files: TeamBranchFile[]; blocker?: string; error?: string } {
  const definition = roleDefinition(task.role);
  if (task.role === "qa" || task.role === "security" || task.role === "coordinator") {
    if (definition.canWrite && task.branch_files.length > 0) {
      return { status: "failed", output: { summary: "This role cannot write files." }, branch_files: [], error: "Role permission violation." };
    }
  }

  if (task.role === "coordinator") {
    if (task.inputs.includes("closeout")) {
      return {
        status: "awaiting_review",
        output: {
          summary: "Closeout note: all queue items are complete or explicitly cancelled; integration and review evidence are attached.",
          evidence: ["The coordinator cannot add scope during closeout."],
        },
        branch_files: [],
      };
    }
    return {
      status: "completed",
      output: {
        summary: `Queue derived from the approved specification (${context.spec.pages.length} pages, ${context.spec.entities.length} entities). No scope was added.`,
        evidence: ["Coordinator only read the specification and queue."],
      },
      branch_files: [],
    };
  }

  if (task.role === "qa") {
    if (context.integrationStatus !== "merged") {
      return {
        status: "blocked",
        output: { summary: "QA waits for the controlled integration step." },
        branch_files: [],
        blocker: "Integration has not completed.",
      };
    }
    const failed = context.integrationChecks.filter((check) => check.status === "failed" || check.status === "timed_out");
    return {
      status: "awaiting_review",
      output: {
        summary: failed.length === 0
          ? `Integration checks passed: ${context.integrationChecks.map((check) => check.label).join(", ") || "no runner checks were recorded"}.`
          : `${failed.length} integration check(s) failed; the failure is reported rather than hidden.`,
        checks: context.integrationChecks,
        evidence: context.integrationChecks.map((check) => `${check.label}: ${check.status}`),
      },
      branch_files: [],
    };
  }

  if (task.role === "security") {
    const findings: string[] = [];
    const scan = context.spec.env_vars.filter((name) => name.includes("SERVICE_ROLE") || name.includes("SECRET"));
    if (scan.length > 0) findings.push(`Sensitive environment-variable names are present: ${scan.join(", ")}.`);
    findings.push("Pattern review only: this is not a complete security audit.");
    return {
      status: "awaiting_review",
      output: {
        summary: findings.length === 1
          ? "No obvious secret or deployment pattern was found. This is not a complete audit."
          : `${findings.length - 1} issue(s) need review. This is not a complete audit.`,
        findings,
        evidence: ["Read-only review; no deployment credentials or external actions were used."],
      },
      branch_files: [],
    };
  }

  const current = new Map((context.currentFiles ?? []).map((file) => [file.path, file.content]));
  if (task.role === "frontend") {
    const content = `export function TeamBanner() {\n  return (\n    <aside aria-label="Agent team fixture" className="rounded-xl border border-slate-200 p-4 text-sm text-slate-700">\n      Built from the approved specification for ${context.projectName.replace(/[{}<>]/g, "")}.\n    </aside>\n  );\n}\n`;
    const path = task.file_claims[0] ?? "components/team-banner.tsx";
    if (!taskCanWritePath(task, path)) {
      return { status: "failed", output: { summary: "Path is outside this role's ownership." }, branch_files: [], error: `Refused path ${path}` };
    }
    return {
      status: "completed",
      output: { summary: `Frontend branch adds ${path} only.`, evidence: ["File claim respected."] },
      branch_files: [fixtureFile(path, content, current)],
    };
  }

  if (task.role === "backend") {
    const path = task.file_claims[0] ?? "lib/team-summary.ts";
    if (!taskCanWritePath(task, path)) {
      return { status: "failed", output: { summary: "Path is outside this role's ownership." }, branch_files: [], error: `Refused path ${path}` };
    }
    const content = `export type TeamSummary = {\n  purpose: string;\n  pages: number;\n  entities: number;\n};\n\nexport function teamSummary(): TeamSummary {\n  return { purpose: ${JSON.stringify(context.spec.purpose)}, pages: ${context.spec.pages.length}, entities: ${context.spec.entities.length} };\n}\n`;
    return {
      status: "completed",
      output: { summary: `Backend branch adds ${path} only.`, evidence: ["No network or credential access."] },
      branch_files: [fixtureFile(path, content, current)],
    };
  }

  if (task.role === "data") {
    if (task.file_claims.length === 0) {
      return {
        status: "completed",
        output: { summary: "No database change is required by this approved specification.", evidence: ["No schema was invented."] },
        branch_files: [],
      };
    }
    const path = task.file_claims[0];
    if (!taskCanWritePath(task, path)) {
      return { status: "failed", output: { summary: "Path is outside this role's ownership." }, branch_files: [], error: `Refused path ${path}` };
    }
    const indexes = context.spec.entities
      .map((entity) => `create index if not exists ${entity.name}_team_owner_idx on public.${entity.name} (user_id);`)
      .join("\n");
    const content = `-- Controlled agent-team fixture. Forward-only and owner-scoped.\n${indexes}\n`;
    return {
      status: "completed",
      output: { summary: `Data branch adds ${path} for approved entities only.`, evidence: ["No credentials or production connection used."] },
      branch_files: [fixtureFile(path, content, current)],
    };
  }

  return {
    status: "failed",
    output: { summary: "Unknown role." },
    branch_files: [],
    error: "Unknown role.",
  };
}

export type MergeResult = {
  ok: boolean;
  files: { path: string; content: string }[];
  conflicts: string[];
  contributors: Record<string, string[]>;
};

/**
 * Controlled integration. Branches are applied together, not one at a time, so
 * a stale base or two owners of one path are refused instead of overwritten.
 */
export function mergeTeamBranches(
  tasks: TeamTaskRecord[],
  currentFiles: { path: string; content: string }[],
): MergeResult {
  const current = new Map(currentFiles.map((file) => [file.path, file.content]));
  const merged = new Map(current);
  const owners = new Map<string, TeamTaskRecord[]>();
  const conflicts: string[] = [];

  for (const task of tasks) {
    if (!IMPLEMENTATION_ROLES.includes(task.role)) continue;
    if (task.status !== "completed") continue;
    for (const file of task.branch_files) {
      if (!isSafeProjectPath(file.path) || !taskCanWritePath(task, file.path)) {
        conflicts.push(`${file.path}: ${TEAM_ROLE_LABELS[task.role]} may not write this path.`);
        continue;
      }
      const existing = current.get(file.path);
      if (file.base_content === null && existing !== undefined) {
        conflicts.push(`${file.path}: already exists; refusing to overwrite it.`);
        continue;
      }
      if (file.base_content !== null && existing !== file.base_content) {
        conflicts.push(`${file.path}: changed since this branch started.`);
        continue;
      }
      const previousOwners = owners.get(file.path) ?? [];
      if (previousOwners.length > 0) {
        conflicts.push(`${file.path}: claimed by ${previousOwners.map((item) => TEAM_ROLE_LABELS[item.role]).join(" and ")}.`);
        continue;
      }
      owners.set(file.path, [task]);
      merged.set(file.path, file.content);
    }
  }

  const contributors: Record<string, string[]> = {};
  for (const [path, taskList] of owners) {
    contributors[path] = taskList.map((task) => task.role);
  }

  if (conflicts.length > 0) {
    return { ok: false, files: currentFiles, conflicts, contributors };
  }

  return {
    ok: true,
    files: [...merged.entries()]
      .map(([path, content]) => ({ path, content }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    conflicts: [],
    contributors,
  };
}

export function attributionSummary(tasks: TeamTaskRecord[], contributors: Record<string, string[]>): string {
  const roles = [...new Set(tasks
    .filter((task) => task.status === "completed" && IMPLEMENTATION_ROLES.includes(task.role))
    .map((task) => task.role))];
  const files = Object.keys(contributors).length;
  return `Agent team merge (fixture mode): ${roles.map((role) => TEAM_ROLE_LABELS[role]).join(", ") || "no code roles"}; ${files} file(s) attributed.`;
}

export function limitReason(run: Pick<TeamRunRecord, "calls_used" | "max_calls" | "started_at" | "max_runtime_seconds">, now = Date.now()): string | null {
  if (run.max_calls > 0 && run.calls_used >= run.max_calls) {
    return `The configured AI-call limit (${run.max_calls}) has been reached.`;
  }
  const started = Date.parse(run.started_at);
  if (Number.isFinite(started) && now - started >= run.max_runtime_seconds * 1000) {
    return `The configured runtime limit (${run.max_runtime_seconds}s) has been reached.`;
  }
  return null;
}

export function teamStatusLabel(status: TeamTaskStatus): string {
  return status === "awaiting_review" ? "Awaiting review" : status[0].toUpperCase() + status.slice(1);
}
