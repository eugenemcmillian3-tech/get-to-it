import { describe, expect, it } from "vitest";

import {
  CAPABILITY_DOMAIN_IDS,
  CAPABILITY_DOMAINS,
  CAPABILITY_LIMITS,
  CAPABILITY_NO_SCORE_NOTE,
  capabilityMatrix,
  compareCapabilityVersions,
  compareHumanBaselines,
  contaminationReport,
  datasetFingerprint,
  fixtureSubmission,
  humanBaselineDraft,
  permissionStatement,
  planCapabilityRuns,
  seedCapabilityTasks,
  seedCapabilityVersions,
  summarizeCapabilityByDifficulty,
  summarizeCapabilityByDomain,
  type CapabilityHumanBaselineRecord,
  type CapabilityRunRecord,
} from "@/lib/capability-eval";

const tasks = seedCapabilityTasks();
const versions = seedCapabilityVersions();

let counter = 0;
function run(overrides: Partial<CapabilityRunRecord> = {}): CapabilityRunRecord {
  counter += 1;
  return {
    id: `run-${counter}`,
    eval_id: "eval-1",
    version_id: "v-baseline",
    task_id: "task-1",
    domain: "software_build_repair",
    difficulty: "medium",
    split: "development",
    trial: 1,
    outcome: "verified_success",
    verified_success: true,
    unsupported_claims: 0,
    permission_violations: 0,
    human_interventions: 0,
    recovery_attempts: 0,
    recovery_succeeded: null,
    cost_cents: 0,
    latency_ms: 50,
    failure_category: null,
    scoring_detail: {},
    exposure_count: 1,
    contaminated: false,
    created_at: "2026-11-11T00:00:00.000Z",
    ...overrides,
  };
}

describe("phase 38 capability seeds", () => {
  it("covers all eight domains with development, validation and held-out tasks", () => {
    expect(CAPABILITY_DOMAINS).toHaveLength(8);
    expect(new Set(tasks.map((task) => task.domain)).size).toBe(8);
    for (const domain of CAPABILITY_DOMAIN_IDS) {
      const splits = new Set(tasks.filter((task) => task.domain === domain).map((task) => task.split));
      expect(splits.has("development")).toBe(true);
      expect(splits.has("validation")).toBe(true);
      expect(splits.has("held_out")).toBe(true);
    }
    expect(tasks.every((task) => task.scoring_rubric.pass.length > 0)).toBe(true);
    expect(tasks.every((task) => task.runtime_seconds >= CAPABILITY_LIMITS.minRuntimeSeconds)).toBe(true);
  });

  it("versions a single-model baseline and an orchestrated system, both without autonomy", () => {
    const kinds = versions.map((version) => version.baseline_kind);
    expect(kinds).toContain("single_model_baseline");
    expect(kinds).toContain("orchestrated_system");
    expect(versions.every((version) => version.autonomy_permission === "none")).toBe(true);
    expect(versions.every((version) => version.orchestration_version.length > 0)).toBe(true);
    expect(versions.every((version) => version.prompt_version.length > 0)).toBe(true);
  });

  it("keeps held-out titles distinct from development titles", () => {
    const development = new Set(
      tasks.filter((task) => task.split === "development").map((task) => task.title),
    );
    for (const task of tasks.filter((entry) => entry.split === "held_out")) {
      expect(development.has(task.title)).toBe(false);
    }
  });
});

describe("run planning", () => {
  const taskRows = [
    { id: "t-dev", split: "development" as const },
    { id: "t-held", split: "held_out" as const },
  ];
  const versionRows = [
    { id: "v-base", baseline_kind: "single_model_baseline" as const },
    { id: "v-orch", baseline_kind: "orchestrated_system" as const },
  ];

  it("refuses to plan without both configurations", () => {
    const plan = planCapabilityRuns({
      tasks: taskRows,
      versions: [versionRows[0]],
      trials: 1,
      existingRuns: [],
      includeHeldOut: true,
    });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toMatch(/single-model baseline and an orchestrated system/i);
  });

  it("excludes held-out tasks unless they are explicitly included", () => {
    const plan = planCapabilityRuns({
      tasks: taskRows,
      versions: versionRows,
      trials: 1,
      existingRuns: [],
      includeHeldOut: false,
    });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.planned.every((item) => item.task_id === "t-dev")).toBe(true);
      expect(plan.planned).toHaveLength(2);
    }
  });

  it("skips trials that already exist and keeps trials bounded", () => {
    const plan = planCapabilityRuns({
      tasks: taskRows,
      versions: versionRows,
      trials: 2,
      existingRuns: [{ task_id: "t-dev", version_id: "v-base", trial: 1 }],
      includeHeldOut: false,
    });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.planned).toEqual([
        { task_id: "t-dev", version_id: "v-base", trial: 2 },
        { task_id: "t-dev", version_id: "v-orch", trial: 1 },
        { task_id: "t-dev", version_id: "v-orch", trial: 2 },
      ]);
    }

    expect(
      planCapabilityRuns({
        tasks: taskRows,
        versions: versionRows,
        trials: CAPABILITY_LIMITS.maxTrials + 1,
        existingRuns: [],
        includeHeldOut: false,
      }).ok,
    ).toBe(false);
  });
});

describe("fixture submissions", () => {
  it("is deterministic for the same task, configuration and trial", () => {
    const input = {
      domain: "document_analysis" as const,
      difficulty: "medium" as const,
      split: "development" as const,
      baseline: "single_model_baseline" as const,
      trial: 2,
      humanAssistance: "none" as const,
    };
    expect(fixtureSubmission(input)).toEqual(fixtureSubmission(input));
  });

  it("produces fewer elements on harder tasks and never loses them with hints", () => {
    const easy = fixtureSubmission({
      domain: "quantitative_reasoning",
      difficulty: "easy",
      split: "development",
      baseline: "single_model_baseline",
      trial: 3,
      humanAssistance: "none",
    });
    const hard = fixtureSubmission({
      domain: "quantitative_reasoning",
      difficulty: "hard",
      split: "development",
      baseline: "single_model_baseline",
      trial: 3,
      humanAssistance: "none",
    });
    const hinted = fixtureSubmission({
      domain: "quantitative_reasoning",
      difficulty: "hard",
      split: "development",
      baseline: "single_model_baseline",
      trial: 3,
      humanAssistance: "hints",
    });
    expect(easy.elements.length).toBeGreaterThanOrEqual(hard.elements.length);
    expect(hinted.elements.length).toBeGreaterThanOrEqual(hard.elements.length);
  });

  it("records variable outcomes across trials instead of a constant result", () => {
    const outcomes = new Set(
      Array.from({ length: 12 }, (_, index) =>
        fixtureSubmission({
          domain: "error_recovery",
          difficulty: "medium",
          split: "validation",
          baseline: "orchestrated_system",
          trial: index + 1,
          humanAssistance: "review_only",
        }).elements.length,
      ),
    );
    expect(outcomes.size).toBeGreaterThan(1);
  });
});

describe("reporting", () => {
  it("summarises by domain with claims, interventions, recovery and variability", () => {
    const runs = [
      run({ domain: "error_recovery", outcome: "verified_success", recovery_attempts: 1, recovery_succeeded: true }),
      run({ domain: "error_recovery", outcome: "failed", recovery_attempts: 1, recovery_succeeded: false, unsupported_claims: 2 }),
      run({ domain: "research_synthesis", outcome: "partial_success", human_interventions: 1 }),
    ];
    const byDomain = summarizeCapabilityByDomain(runs);
    const recovery = byDomain.find((row) => row.domain === "error_recovery");
    const research = byDomain.find((row) => row.domain === "research_synthesis");

    expect(byDomain).toHaveLength(8);
    expect(recovery?.trials).toBe(2);
    expect(recovery?.verified).toBe(1);
    expect(recovery?.failed).toBe(1);
    expect(recovery?.unsupported_claims).toBe(2);
    expect(recovery?.recovery_success_rate).toBe(0.5);
    expect(recovery?.variability).toBeGreaterThan(0);
    expect(research?.human_interventions).toBe(1);
    expect(research?.partial_rate).toBe(1);
  });

  it("reports by difficulty and never invents trials for empty domains", () => {
    const rows = summarizeCapabilityByDifficulty([run({ difficulty: "hard" })]);
    expect(rows.map((row) => row.difficulty)).toEqual(["easy", "medium", "hard"]);
    const easy = rows.find((row) => row.difficulty === "easy");
    expect(easy?.trials).toBe(0);
    expect(easy?.verified_rate).toBe(0);
    expect(easy?.recovery_success_rate).toBeNull();
  });

  it("compares versions only on shared tasks with equal trials", () => {
    const versionRows = [
      { id: "v-base", baseline_kind: "single_model_baseline" as const, label: "Baseline" },
      { id: "v-orch", baseline_kind: "orchestrated_system" as const, label: "Orchestrated" },
    ];
    const unequal = compareCapabilityVersions(
      [
        run({ version_id: "v-base", task_id: "t1", outcome: "failed" }),
        run({ version_id: "v-orch", task_id: "t1", outcome: "verified_success" }),
        run({ version_id: "v-orch", task_id: "t1", outcome: "verified_success" }),
      ],
      versionRows,
    );
    expect(unequal.comparable).toBe(false);
    expect(unequal.reason).toMatch(/unequal number of trials/i);

    const comparable = compareCapabilityVersions(
      [
        run({ version_id: "v-base", task_id: "t1", outcome: "failed" }),
        run({ version_id: "v-base", task_id: "t2", outcome: "partial_success" }),
        run({ version_id: "v-orch", task_id: "t1", outcome: "verified_success" }),
        run({ version_id: "v-orch", task_id: "t2", outcome: "verified_success" }),
      ],
      versionRows,
    );
    expect(comparable.comparable).toBe(true);
    expect(comparable.verified_rate_delta).toBeGreaterThan(0);
    expect(comparable.trials_per_version).toBe(2);
  });

  it("flags repeated held-out exposure as contamination", () => {
    const report = contaminationReport([
      run({ split: "held_out", contaminated: true, exposure_count: 2 }),
      run({ split: "held_out" }),
      run({ split: "development" }),
    ]);
    expect(report.contaminated_runs).toHaveLength(1);
    expect(report.clean_held_out_trials).toBe(1);
    expect(report.exposed_held_out_tasks).toEqual(["task-1"]);
  });

  it("builds the task-by-task matrix from recorded evidence only", () => {
    const taskRows = [
      {
        id: "t1",
        title: "One",
        domain: "software_build_repair" as const,
        difficulty: "easy" as const,
        split: "development" as const,
      },
    ];
    const versionRows = [
      {
        id: "v-base",
        label: "Baseline",
        baseline_kind: "single_model_baseline" as const,
      },
    ] as never[];
    const rows = capabilityMatrix(
      taskRows as never[],
      versionRows,
      [run({ task_id: "t1", version_id: "v-base" })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].verified).toBe(1);
    expect(rows[0].trials).toBe(1);
  });
});

describe("human baselines", () => {
  it("refuses a baseline without a documented protocol or measured numbers", () => {
    const short = humanBaselineDraft({
      domain: "research_synthesis",
      protocol_document: "we asked people",
      collected_by: "Researcher",
      sample_size: 5,
      results: { verified_rate: 0.5 },
    });
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.reason).toMatch(/at least 50 characters/i);

    const noNumbers = humanBaselineDraft({
      domain: "research_synthesis",
      protocol_document:
        "Five researchers received the same eight tasks in a fixed order and were scored by two independent reviewers using the stored rubric.",
      collected_by: "Researcher",
      sample_size: 5,
      results: { note: "good" },
    });
    expect(noNumbers.ok).toBe(false);
    if (!noNumbers.ok) expect(noNumbers.reason).toMatch(/numeric result/i);

    const valid = humanBaselineDraft({
      domain: "research_synthesis",
      protocol_document:
        "Five researchers received the same eight tasks in a fixed order and were scored by two independent reviewers using the stored rubric.",
      collected_by: "Researcher",
      sample_size: 5,
      results: { verified_rate: 0.62 },
    });
    expect(valid.ok).toBe(true);
  });

  it("shows no human comparison until a documented baseline exists", () => {
    expect(compareHumanBaselines([]).available).toBe(false);
    expect(compareHumanBaselines([]).reason).toMatch(/no human results were collected/i);

    const baseline = {
      id: "b1",
      eval_id: "e1",
      user_id: "u1",
      domain: "research_synthesis",
      protocol_document:
        "Five researchers received the same eight tasks in a fixed order and were scored by two independent reviewers using the stored rubric.",
      collected_by: "Researcher",
      sample_size: 5,
      results: { verified_rate: 0.62 },
      status: "documented",
      created_at: "2026-11-11T00:00:00.000Z",
    } as CapabilityHumanBaselineRecord;
    expect(compareHumanBaselines([baseline]).available).toBe(true);
    expect(
      compareHumanBaselines([{ ...baseline, status: "retracted" }]).available,
    ).toBe(false);
  });
});

describe("capability is not permission", () => {
  it("keeps the recorded permission regardless of results", () => {
    const statement = permissionStatement({
      label: "Orchestrated system",
      autonomy_permission: "none",
    });
    expect(statement.label).toBe("No autonomous action");
    expect(statement.note).toMatch(/results do not raise it/i);
    expect(statement.note).toMatch(/cannot deploy/i);
  });

  it("pins a dataset fingerprint that changes with the dataset version", () => {
    const fingerprint = datasetFingerprint(tasks);
    expect(datasetFingerprint([...tasks].reverse())).toBe(fingerprint);
    expect(
      datasetFingerprint(tasks.map((task) => ({ ...task, dataset_version: "dataset-v2" }))),
    ).not.toBe(fingerprint);
  });

  it("states plainly that there is no single score and no AGI claim", () => {
    expect(CAPABILITY_NO_SCORE_NOTE).toMatch(/no single capability score/i);
    expect(CAPABILITY_NO_SCORE_NOTE).toMatch(/never claims AGI/i);
  });
});
