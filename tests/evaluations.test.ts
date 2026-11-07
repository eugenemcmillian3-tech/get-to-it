import { describe, expect, it } from "vitest";

import {
  EVAL_CATEGORY_IDS,
  buildCapabilityProfileDrafts,
  buildConfigurationRecommendation,
  checksFor,
  evaluateFixture,
  planEvaluationRuns,
  seedEvaluationConfigurations,
  seedEvaluationTasks,
  type EvalCategory,
  type EvaluationRunRecord,
} from "@/lib/evaluations";
import type { TeamRole } from "@/lib/agent-team";

const configs = seedEvaluationConfigurations();
const tasks = seedEvaluationTasks();

function taskFor(category: EvalCategory, split: "development" | "held_out" = "development") {
  const task = tasks.find((candidate) => candidate.category === category && candidate.split === split);
  if (!task) throw new Error(`missing seeded task for ${category}`);
  return task;
}

function run(
  id: string,
  configId: string,
  category: EvalCategory,
  status: "passed" | "failed" | "errored",
): Pick<EvaluationRunRecord, "id" | "config_id" | "category" | "status"> {
  return { id, config_id: configId, category, status };
}

describe("evaluation workspace fixtures", () => {
  it("seeds every initial category with separate development and held-out tasks", () => {
    const categories = new Set(tasks.map((task) => task.category));
    expect([...categories].sort()).toEqual([...EVAL_CATEGORY_IDS].sort());

    const development = tasks.filter((task) => task.split === "development");
    const heldOut = tasks.filter((task) => task.split === "held_out");
    expect(development.length).toBe(EVAL_CATEGORY_IDS.length);
    expect(heldOut.length).toBeGreaterThan(0);
    expect(development.every((task) => heldOut.every((other) => other.title !== task.title))).toBe(true);

    for (const task of tasks) {
      expect(task.acceptance_checks.length).toBeGreaterThan(0);
      expect(task.expected_output.length).toBeGreaterThan(5);
      expect(task.allowed_tools).toContain("read_files");
      expect(task.runtime_seconds).toBeGreaterThanOrEqual(10);
      expect(task.request_limit).toBeGreaterThanOrEqual(0);
    }
  });

  it("reuses the existing roles and grants each configuration only its role tools", () => {
    expect(configs).toHaveLength(3);
    expect(configs[0].agent_roles).toEqual(["backend"]);
    expect(configs[1].agent_roles).toEqual(["backend", "qa"]);
    expect(configs[2].agent_roles).toContain("coordinator");
    for (const config of configs) {
      expect(config.mode).toBe("fixture");
      expect(config.allowed_tools).toContain("read_files");
    }
  });

  it("returns acceptance checks as copies so task rules cannot be edited in place", () => {
    const first = checksFor("bug_repair");
    first[0].label = "Rewritten by a candidate";
    expect(checksFor("bug_repair")[0].label).not.toBe("Rewritten by a candidate");
  });

  it("records deterministic results separately from AI-judged opinions", () => {
    const task = taskFor("bug_repair");
    const config = configs[2];
    const passingTrial = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].find(
      (trial) => evaluateFixture({ task, config, trial }).status === "passed",
    );
    expect(passingTrial).toBeDefined();

    const result = evaluateFixture({ task, config, trial: passingTrial! });
    expect(result.status).toBe("passed");
    expect(result.completion_status).toBe("completed");
    expect(result.test_results.every((check) => check.deterministic)).toBe(true);
    expect(result.test_results.every((check) => check.status === "passed")).toBe(true);
    expect(result.ai_judgements.every((judgement) => judgement.deterministic === false)).toBe(true);
    expect(result.ai_judgements.every((judgement) => judgement.counted_in_result === false)).toBe(true);
    expect(result.model_configured).toBe(config.model_identifier);
    expect(result.model_reported).toBeNull();
    expect(result.tokens_reported.total).toBe(0);
    expect(result.tokens_reported.reported_by).toBe("fixture");
    expect(result.cost_known_cents).toBe(0);
    expect(result.cost_estimated_cents).toBe(0);
    expect(result.runtime_ms).toBeGreaterThanOrEqual(1);
  });

  it("preserves a failed run and blocked tools when a configuration lacks the required role", () => {
    const result = evaluateFixture({
      task: taskFor("frontend_change"),
      config: configs[0],
      trial: 1,
    });
    expect(result.status).toBe("failed");
    expect(result.completion_status).toBe("failed");
    expect(result.test_results.find((check) => check.id === "routing")?.status).toBe("failed");
    expect(result.tool_calls.every((call) => call.status === "blocked")).toBe(true);
    expect(result.error).toMatch(/required role/i);
  });

  it("repeats trials and exposes variation instead of hiding it", () => {
    const results = Array.from({ length: 14 }, (_, index) =>
      evaluateFixture({
        task: taskFor("bug_repair"),
        config: configs[2],
        trial: index + 1,
      }),
    );
    expect(results.some((result) => result.status === "passed")).toBe(true);
    expect(results.some((result) => result.status === "failed")).toBe(true);
    expect(results.filter((result) => result.status === "failed").length).toBeGreaterThan(0);
  });
});

describe("approved run budget", () => {
  const budget = { approved_runs: 4, used_runs: 0, status: "approved" as const };

  it("refuses every run without an approved budget", () => {
    const plan = planEvaluationRuns({
      tasks: [{ id: "task-1" }],
      configurations: [{ id: "config-1" }, { id: "config-2" }],
      trials: 1,
      existingRuns: [],
      budget: null,
    });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toMatch(/approve a run budget/i);
  });

  it("plans each missing trial and skips evidence that already exists", () => {
    const plan = planEvaluationRuns({
      tasks: [{ id: "task-1" }],
      configurations: [{ id: "config-1" }, { id: "config-2" }],
      trials: 2,
      existingRuns: [{ task_id: "task-1", config_id: "config-1", trial: 1 }],
      budget,
    });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.planned).toEqual([
        { task_id: "task-1", config_id: "config-1", trial: 2 },
        { task_id: "task-1", config_id: "config-2", trial: 1 },
        { task_id: "task-1", config_id: "config-2", trial: 2 },
      ]);
      expect(plan.remaining).toBe(4);
    }
  });

  it("refuses the whole comparison before writing when the budget is short", () => {
    const plan = planEvaluationRuns({
      tasks: [{ id: "task-1" }],
      configurations: [{ id: "config-1" }, { id: "config-2" }],
      trials: 3,
      existingRuns: [],
      budget: { approved_runs: 4, used_runs: 1, status: "approved" },
    });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toMatch(/only 3 remain/i);
  });

  it("requires two configurations and bounded trials", () => {
    expect(
      planEvaluationRuns({
        tasks: [{ id: "task-1" }],
        configurations: [{ id: "config-1" }],
        trials: 1,
        existingRuns: [],
        budget,
      }).ok,
    ).toBe(false);
    expect(
      planEvaluationRuns({
        tasks: [{ id: "task-1" }],
        configurations: [{ id: "config-1" }, { id: "config-2" }],
        trials: 50,
        existingRuns: [],
        budget,
      }).ok,
    ).toBe(false);
  });
});

describe("capability registry", () => {
  it("cites evidence and limitations, and does not invent database evidence", () => {
    const profiles = buildCapabilityProfileDrafts(
      [
        run("ui-1", "config-a", "frontend_change", "passed"),
        run("ui-2", "config-a", "frontend_change", "passed"),
        run("ui-3", "config-a", "frontend_change", "passed"),
        run("bug-1", "config-b", "bug_repair", "failed"),
      ],
      [
        { id: "config-a", label: "Config A" },
        { id: "config-b", label: "Config B" },
      ],
    );
    const ui = profiles.find(
      (profile) => profile.config_id === "config-a" && profile.profile_key === "ui_changes",
    );
    const bugs = profiles.find(
      (profile) => profile.config_id === "config-b" && profile.profile_key === "bounded_bug_repair",
    );
    const database = profiles.find(
      (profile) => profile.config_id === "config-a" && profile.profile_key === "database_changes",
    );

    expect(ui?.evidence_run_ids).toEqual(["ui-1", "ui-2", "ui-3"]);
    expect(ui?.suitable_for.length).toBe(1);
    expect(ui?.label).toContain("Config A");
    expect(ui?.limitations.join(" ")).toMatch(/not a workspace-wide or universal score/i);

    expect(bugs?.evidence_run_ids).toEqual(["bug-1"]);
    expect(bugs?.suitable_for).toEqual([]);
    expect(bugs?.requires_review.join(" ")).toMatch(/person must review/i);

    expect(database?.evidence_run_ids).toEqual([]);
    expect(database?.requires_review.join(" ")).toMatch(/database changes/i);
    expect(database?.summary).toMatch(/no evidence/i);
    expect(profiles.filter((profile) => profile.config_id === "config-a")).toHaveLength(3);
  });
});

describe("approval-gated recommendation", () => {
  const sharedTasks = [
    { id: "task-1", title: "One" },
    { id: "task-2", title: "Two" },
  ];
  const baseConfig = {
    agent_roles: ["backend"] as TeamRole[],
    routing: { mode: "single_agent" },
    prompt_version: "v1",
    version: 1,
  };

  it("recommends a better shared-task configuration without applying it", () => {
    const recommendation = buildConfigurationRecommendation(
      sharedTasks,
      [
        { id: "single", label: "Single backend", ...baseConfig },
        { id: "team", label: "Scoped team", ...baseConfig, agent_roles: ["coordinator", "backend", "qa"] },
      ],
      [
        { id: "r1", task_id: "task-1", config_id: "single", status: "failed" },
        { id: "r2", task_id: "task-2", config_id: "single", status: "failed" },
        { id: "r3", task_id: "task-1", config_id: "team", status: "passed" },
        { id: "r4", task_id: "task-2", config_id: "team", status: "passed" },
      ],
    );

    expect(recommendation).not.toBeNull();
    expect(recommendation?.config_diff.automatic_application).toBe(false);
    expect(recommendation?.config_diff.to).toMatchObject({ id: "team" });
    expect(recommendation?.rollback.configuration_id).toBe("single");
    expect(String(recommendation?.rollback.instructions)).toMatch(/production routing is unchanged/i);
    expect(recommendation?.rationale).toMatch(/not a universal score/i);
  });

  it("does not recommend from unshared, incomplete or insufficient evidence", () => {
    expect(
      buildConfigurationRecommendation(
        sharedTasks,
        [
          { id: "single", label: "Single backend", ...baseConfig },
          { id: "team", label: "Scoped team", ...baseConfig, agent_roles: ["coordinator", "backend", "qa"] },
        ],
        [{ id: "r1", task_id: "task-1", config_id: "single", status: "passed" }],
      ),
    ).toBeNull();

    expect(
      buildConfigurationRecommendation(
        sharedTasks,
        [
          { id: "single", label: "Single backend", ...baseConfig },
          { id: "team", label: "Scoped team", ...baseConfig, agent_roles: ["coordinator", "backend", "qa"] },
        ],
        [
          { id: "r1", task_id: "task-1", config_id: "single", status: "passed" },
          { id: "r2", task_id: "task-2", config_id: "single", status: "passed" },
          { id: "r3", task_id: "task-1", config_id: "team", status: "passed" },
          { id: "r4", task_id: "task-1", config_id: "team", status: "passed" },
        ],
      ),
    ).toBeNull();
  });
});
