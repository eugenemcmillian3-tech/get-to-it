import { describe, expect, it } from "vitest";
import {
  TEAM_LIMITS,
  TEAM_MAX_CREDITS,
  TEAM_MODEL_CREDITS,
  TEAM_ROLES_SPEC,
  TEAM_ROLE_MODELS,
  attributionSummary,
  buildTeamPlan,
  canTaskRun,
  findFileClaimConflicts,
  limitReason,
  mergeTeamBranches,
  roleDefinition,
  runFixtureTask,
  selectRunnableTasks,
  taskCallsLabel,
  taskCanUseTool,
  taskCanWritePath,
  taskScopeProblems,
  type TeamCheck,
  type TeamTaskDraft,
  type TeamTaskRecord,
} from "@/lib/agent-team";
import { buildSpecDraft, type AppIntakeInput } from "@/lib/app-builder";
import { AI_MODELS } from "@/lib/ai/models";

const INTAKE: AppIntakeInput = {
  name: "Repair log",
  purpose: "Keep a private record of repairs, parts and follow-ups for a small workshop.",
  target_users: "Two workshop volunteers who are comfortable with email but not spreadsheets.",
  workflows: "Log a repair\nTrack parts on order",
  required_pages: "/repairs | Repairs | See every repair\n/parts | Parts | See parts on order",
  entities: "repair: title, notes, status\npart: title, notes, status",
  auth_requirements: "supabase",
  integrations: "",
  design_preferences: "Calm and high contrast.",
  definition_of_done: "A volunteer can log a repair and find it again the same day.",
};

const spec = buildSpecDraft(INTAKE);

function task(
  draft: TeamTaskDraft,
  position: number,
  status: TeamTaskRecord["status"] = "queued",
  extra: Partial<TeamTaskRecord> = {},
): TeamTaskRecord {
  return {
    ...draft,
    id: `task-${position}`,
    run_id: "run-1",
    project_id: "project-1",
    user_id: "user-1",
    position,
    status,
    model: null,
    calls_used: 0,
    attempts: 0,
    retries: 0,
    retry_reason: null,
    branch_files: [],
    changed_files: [],
    output: null,
    blocker: null,
    error: null,
    started_at: null,
    finished_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

function queue(conflictFixture = false): TeamTaskRecord[] {
  return buildTeamPlan(spec, "Repair log", { conflictFixture }).map((draft, index) =>
    task(draft, index),
  );
}

const passingChecks: TeamCheck[] = [
  { name: "typecheck", label: "Typecheck", status: "passed", code: 0, log: "ok" },
  { name: "build", label: "Production build", status: "passed", code: 0, log: "ok" },
];

describe("agent-team plan", () => {
  it("derives a bounded queue from one approved spec with all six roles", () => {
    const tasks = queue();
    expect(tasks.map((item) => item.role)).toEqual([
      "coordinator",
      "data",
      "frontend",
      "backend",
      "qa",
      "security",
      "coordinator",
    ]);
    expect(new Set(tasks.map((item) => item.role))).toEqual(
      new Set(["coordinator", "frontend", "backend", "data", "qa", "security"]),
    );
    expect(tasks.length).toBeLessThanOrEqual(TEAM_LIMITS.maxTasks);
    for (const item of tasks) {
      expect(item.budget_calls).toBe(0);
      expect(item.budget_seconds).toBeLessThanOrEqual(TEAM_LIMITS.maxTaskSeconds);
      expect(item.file_claims.every((path) => taskCanWritePath(item, path))).toBe(true);
      expect(item.allowed_tools).not.toContain("deploy");
      expect(item.allowed_tools).not.toContain("external_action");
    }
  });

  it("does not let a coordinator append an unapproved page or entity", () => {
    const coordinator = queue()[0];
    expect(taskScopeProblems(coordinator, spec)).toEqual([]);
    expect(
      taskScopeProblems(
        { ...coordinator, inputs: ["page:/secret-admin", "entity:private_ledger"] },
        spec,
      ).join(" "),
    ).toContain("not in the approved specification");
  });

  it("enforces role file boundaries and gives the security reviewer no write access", () => {
    expect(taskCanWritePath({ role: "frontend" }, "app/page.tsx")).toBe(true);
    expect(taskCanWritePath({ role: "frontend" }, "app/api/repairs/route.ts")).toBe(false);
    expect(taskCanWritePath({ role: "backend" }, "app/api/repairs/route.ts")).toBe(true);
    expect(taskCanWritePath({ role: "data" }, "supabase/migrations/0002.sql")).toBe(true);
    expect(taskCanWritePath({ role: "security" }, "app/page.tsx")).toBe(false);
    expect(taskCanWritePath({ role: "qa" }, "tests/check.test.ts")).toBe(false);
    expect(taskCanWritePath({ role: "frontend" }, ".env.local")).toBe(false);
    expect(roleDefinition("security").tools).not.toContain("write_files");
    expect(roleDefinition("coordinator").tools).not.toContain("write_files");
    expect(TEAM_ROLES_SPEC.coordinator.canWrite).toBe(false);
    expect(taskCanUseTool(queue()[0], "deploy")).toBe(false);
    expect(taskCanUseTool(queue()[0], "read_spec")).toBe(true);
  });

  it("reports a controlled file-claim conflict instead of overwriting", () => {
    const tasks = queue(true);
    const owners = tasks.filter((item) => item.file_claims.includes("components/team-shared.tsx"));
    const first = owners[0];
    const second = owners[1];
    first.status = "completed";
    second.status = "queued";

    const conflicts = findFileClaimConflicts(second, tasks);
    expect(conflicts.map((item) => item.path)).toContain("components/team-shared.tsx");
    expect(conflicts[0].owner.id).toBe(first.id);
  });
});

describe("agent-team fixtures", () => {
  it("collaborates, merges disjoint branches and preserves attribution", () => {
    const tasks = queue();
    const context = {
      spec,
      projectName: "Repair log",
      integrationStatus: "merged" as const,
      integrationChecks: passingChecks,
    };

    // Initial coordinator and the three code roles run first.
    const coordinator = runFixtureTask(tasks[0], context);
    expect(coordinator.status).toBe("completed");
    tasks[0].status = "completed";

    for (const index of [1, 2, 3]) {
      const result = runFixtureTask(tasks[index], context);
      expect(result.status).toBe("completed");
      tasks[index] = {
        ...tasks[index],
        status: "completed",
        branch_files: result.branch_files,
        changed_files: result.branch_files.map((file) => file.path),
      };
    }

    const merge = mergeTeamBranches(tasks, []);
    expect(merge.ok).toBe(true);
    expect(merge.conflicts).toEqual([]);
    expect(merge.files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        "components/team-banner.tsx",
        "lib/team-summary.ts",
        "supabase/migrations/0002_team_indexes.sql",
      ]),
    );
    expect(attributionSummary(tasks, merge.contributors)).toContain("Frontend agent");
    expect(attributionSummary(tasks, merge.contributors)).toContain("Backend agent");
    expect(merge.contributors["components/team-banner.tsx"]).toEqual(["frontend"]);

    const qa = runFixtureTask(tasks[4], context);
    expect(qa.status).toBe("awaiting_review");
    expect(qa.output.summary).toContain("passed");
    expect(qa.branch_files).toEqual([]);

    const security = runFixtureTask(tasks[5], context);
    expect(security.status).toBe("awaiting_review");
    expect(security.output.findings?.join(" ")).toContain("not a complete security audit");
    expect(security.branch_files).toEqual([]);
  });

  it("blocks QA before integration and blocks closeout until reviews are complete", () => {
    const tasks = queue();
    tasks[0].status = "completed";
    tasks[1].status = "completed";
    tasks[2].status = "completed";
    tasks[3].status = "completed";

    expect(canTaskRun(tasks[4], tasks, "pending")).toBe(false);
    const qa = runFixtureTask(tasks[4], {
      spec,
      projectName: "Repair log",
      integrationStatus: "pending",
      integrationChecks: [],
    });
    expect(qa.status).toBe("blocked");

    tasks[4].status = "awaiting_review";
    tasks[5].status = "awaiting_review";
    expect(canTaskRun(tasks[6], tasks, "merged")).toBe(false);
    tasks[4].status = "completed";
    tasks[5].status = "completed";
    expect(canTaskRun(tasks[6], tasks, "merged")).toBe(true);
  });

  it("stops on stale or overlapping merge input without writing a file", () => {
    const tasks = queue(true);
    const fronts = tasks.filter((item) => item.role === "frontend");
    const front = fronts[0];
    const other = fronts[1];
    front.status = "completed";
    other.status = "completed";
    front.branch_files = [{ path: "components/team-shared.tsx", content: "front", base_content: null }];
    other.branch_files = [{ path: "components/team-shared.tsx", content: "other", base_content: null }];

    const overlap = mergeTeamBranches([front, other], []);
    expect(overlap.ok).toBe(false);
    expect(overlap.conflicts.join(" ")).toContain("claimed by");

    const stale = mergeTeamBranches(
      [{ ...front, branch_files: [{ path: "components/existing.tsx", content: "branch", base_content: "old" }] }],
      [{ path: "components/existing.tsx", content: "changed elsewhere" }],
    );
    expect(stale.ok).toBe(false);
    expect(stale.conflicts.join(" ")).toContain("changed since");
  });

  it("selects no more than the configured concurrency", () => {
    const tasks = queue();
    tasks[0].status = "completed";
    const selection = selectRunnableTasks(tasks, 2, "pending");
    expect(selection.runnable).toHaveLength(2);
    expect(selection.runnable.map((item) => item.position)).toEqual([1, 2]);
    expect(selectRunnableTasks(tasks, 1, "pending").runnable).toHaveLength(1);
    expect(selectRunnableTasks(tasks, TEAM_LIMITS.maxAgents + 20, "pending").runnable.length).toBeLessThanOrEqual(3);
  });

  it("maps all six roles to the six configured Ollama models", () => {
    const models = Object.values(TEAM_ROLE_MODELS);
    expect(models).toHaveLength(6);
    expect(new Set(models).size).toBe(6);
    expect([...models].sort()).toEqual(AI_MODELS.map((model) => model.id).sort());
    expect(TEAM_MODEL_CREDITS).toBe(2);
    expect(TEAM_MAX_CREDITS).toBe(48);
  });

  it("enforces runtime and call limits without a self-retry loop", () => {
    const base = {
      calls_used: 0,
      max_calls: 2,
      started_at: new Date().toISOString(),
      max_runtime_seconds: 60,
    };
    expect(limitReason(base)).toBeNull();
    expect(limitReason({ ...base, calls_used: 2 })).toContain("call limit");
    expect(
      limitReason({ ...base, started_at: new Date(Date.now() - 61_000).toISOString() }),
    ).toContain("runtime limit");
    expect(TEAM_LIMITS.maxAgents).toBe(4);
    expect(TEAM_LIMITS.maxCalls).toBe(24);
  });
});

describe("task call label", () => {
  it("labels a task that made one call", () => {
    expect(taskCallsLabel(1)).toBe("1 model call");
  });

  it("reports a task that needed a retry", () => {
    expect(taskCallsLabel(2)).toBe("2 model calls, 1 retried");
  });

  it("handles a task that made no model calls", () => {
    expect(taskCallsLabel(0)).toBe("no model calls");
  });
});
