import { describe, expect, it } from "vitest";
import {
  approvalProblem,
  buildMissionPlan,
  cancelDownstream,
  completedArtifacts,
  effectiveLimit,
  evidenceSummary,
  failDownstream,
  jobStartProblem,
  missionDashboard,
  missionLimitsSchema,
  normalizeMissionLimits,
  recoverRunningJobs,
  type MissionAgentJob,
  type MissionApproval,
  type MissionJobDependency,
  type MissionMilestone,
  type MissionMilestoneDependency,
} from "@/lib/mission-control";

function milestone(id: string, overrides: Partial<MissionMilestone> = {}): MissionMilestone {
  return {
    id,
    mission_id: "mission-1",
    workspace_id: "workspace-1",
    title: `Deliverable ${id}`,
    description: "",
    owner_id: "owner-1",
    due_at: "2026-12-01",
    review_at: "2026-11-20",
    status: "planned",
    position: 0,
    created_by: "owner-1",
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

function job(id: string, overrides: Partial<MissionAgentJob> = {}): MissionAgentJob {
  return {
    id,
    mission_id: "mission-1",
    workspace_id: "workspace-1",
    project_id: "project-1",
    milestone_id: "m1",
    source_task_id: null,
    title: `Job ${id}`,
    objective: "Produce a checked artifact.",
    role: "backend",
    status: "queued",
    dedupe_key: `dedupe-${id}`,
    budget_seconds: 120,
    budget_calls: 1,
    calls_used: 0,
    runtime_seconds: 0,
    attempts: 0,
    output: null,
    blocker: null,
    error: null,
    started_at: null,
    finished_at: null,
    created_by: "owner-1",
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

function milestoneDependency(
  milestoneId: string,
  dependsOnId: string,
): MissionMilestoneDependency {
  return {
    id: `${milestoneId}-${dependsOnId}`,
    mission_id: "mission-1",
    workspace_id: "workspace-1",
    milestone_id: milestoneId,
    depends_on_id: dependsOnId,
    created_by: "owner-1",
    created_at: "2026-11-01T00:00:00.000Z",
  };
}

function jobDependency(jobId: string, dependsOnJobId: string): MissionJobDependency {
  return {
    id: `${jobId}-${dependsOnJobId}`,
    mission_id: "mission-1",
    workspace_id: "workspace-1",
    job_id: jobId,
    depends_on_job_id: dependsOnJobId,
    created_by: "owner-1",
    created_at: "2026-11-01T00:00:00.000Z",
  };
}

function approval(overrides: Partial<MissionApproval> = {}): MissionApproval {
  return {
    id: "approval-1",
    mission_id: "mission-1",
    workspace_id: "workspace-1",
    kind: "deployment",
    summary: "Deploy the pilot",
    scope: "Deploy the pilot to the preview hosting project.",
    requested_by: "requester-1",
    requested_by_kind: "human",
    status: "pending",
    decided_by: null,
    decided_at: null,
    note: "",
    created_by: "requester-1",
    created_at: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("mission planning", () => {
  it("orders finish-to-start dependencies and groups parallel work", () => {
    const plan = buildMissionPlan({
      milestones: [
        milestone("m1", { title: "Public website", position: 0 }),
        milestone("m2", { title: "Learning application", position: 1 }),
        milestone("m3", { title: "Pilot feedback", position: 2 }),
      ],
      dependencies: [milestoneDependency("m3", "m1"), milestoneDependency("m3", "m2")],
      projectCount: 2,
      limits: { max_parallel_jobs: 2 },
    });

    expect(plan.cycle).toBe(false);
    expect(plan.sequence.map((item) => item.id)).toEqual(["m1", "m2", "m3"]);
    expect(plan.parallelGroups).toEqual([["m1", "m2"], ["m3"]]);
    expect(plan.note).toContain("not a guaranteed schedule");
    expect(plan.guaranteed).toBe(false);
    expect(plan.assumptions.length).toBeGreaterThan(2);
  });

  it("reports a cycle instead of inventing an order", () => {
    const plan = buildMissionPlan({
      milestones: [milestone("m1"), milestone("m2")],
      dependencies: [milestoneDependency("m1", "m2"), milestoneDependency("m2", "m1")],
      projectCount: 1,
    });

    expect(plan.cycle).toBe(true);
    expect(plan.cycleIds.sort()).toEqual(["m1", "m2"]);
    expect(plan.sequence).toEqual([]);
    expect(plan.resourceConflicts.join(" ")).toContain("cycle");
  });

  it("names missing owners, review dates, unassigned jobs and missing projects", () => {
    const plan = buildMissionPlan({
      milestones: [milestone("m1", { owner_id: null, review_at: null })],
      dependencies: [],
      jobs: [job("j1", { milestone_id: null })],
      projectCount: 0,
    });

    expect(plan.missingDecisions.join(" ")).toContain("no accountable owner");
    expect(plan.missingDecisions.join(" ")).toContain("no review date");
    expect(plan.missingDecisions.join(" ")).toContain("not attached to a deliverable");
    expect(plan.missingDecisions.join(" ")).toContain("No existing project is linked");
    expect(plan.missingDecisions.join(" ")).toContain("nothing is created automatically");
  });

  it("reports parallel resource conflicts against mission limits", () => {
    const plan = buildMissionPlan({
      milestones: [milestone("m1"), milestone("m2")],
      dependencies: [],
      jobs: [
        job("j1", { milestone_id: "m1", budget_seconds: 200, budget_calls: 3 }),
        job("j2", { milestone_id: "m2", budget_seconds: 200, budget_calls: 2 }),
      ],
      projectCount: 1,
      limits: { max_parallel_jobs: 1, max_runtime_seconds: 300, max_agent_calls: 3 },
    });

    expect(plan.resourceConflicts.join(" ")).toContain("2 jobs but the mission allows 1");
    expect(plan.resourceConflicts.join(" ")).toContain("400s of agent runtime");
    expect(plan.resourceConflicts.join(" ")).toContain("5 agent calls");
  });
});

describe("bounded job starts", () => {
  const base = {
    job: job("j1"),
    jobs: [job("j1")],
    jobDependencies: [] as MissionJobDependency[],
    milestones: [milestone("m1", { status: "planned" as const })],
    milestoneDependencies: [] as MissionMilestoneDependency[],
    missionStatus: "active" as const,
    limits: { max_parallel_jobs: 1, max_agent_jobs: 4, max_agent_calls: 4, max_runtime_seconds: 600 },
    role: "owner" as const,
  };

  it("refuses non-managers, inactive missions and non-queued jobs", () => {
    expect(jobStartProblem({ ...base, role: "member" }).code).toBe("forbidden");
    expect(jobStartProblem({ ...base, missionStatus: "draft" }).code).toBe("not-active");
    expect(jobStartProblem({ ...base, job: job("j1", { status: "completed" }) }).code).toBe("not-queued");
  });

  it("waits for job and milestone dependencies", () => {
    const pendingJob = jobStartProblem({
      ...base,
      jobs: [job("j0", { status: "running" }), job("j1")],
      jobDependencies: [jobDependency("j1", "j0")],
    });
    expect(pendingJob.code).toBe("dependency-pending");

    const failedJob = jobStartProblem({
      ...base,
      jobs: [job("j0", { status: "failed" }), job("j1")],
      jobDependencies: [jobDependency("j1", "j0")],
    });
    expect(failedJob.code).toBe("dependency-failed");

    const pendingMilestone = jobStartProblem({
      ...base,
      milestones: [milestone("m0", { status: "planned" }), milestone("m1")],
      milestoneDependencies: [milestoneDependency("m1", "m0")],
    });
    expect(pendingMilestone.code).toBe("dependency-pending");

    const blockedMilestone = jobStartProblem({
      ...base,
      milestones: [milestone("m0", { status: "blocked" }), milestone("m1")],
      milestoneDependencies: [milestoneDependency("m1", "m0")],
    });
    expect(blockedMilestone.code).toBe("dependency-failed");
  });

  it("enforces concurrency, total jobs, calls, runtime and duplicate work", () => {
    expect(
      jobStartProblem({ ...base, jobs: [job("j0", { status: "running" }), job("j1")] }).code,
    ).toBe("mission-concurrency");

    expect(
      jobStartProblem({
        ...base,
        jobs: [job("j1"), job("j2")],
        limits: { max_agent_jobs: 1, max_parallel_jobs: 4, max_agent_calls: 10, max_runtime_seconds: 900 },
      }).code,
    ).toBe("mission-job-limit");

    expect(
      jobStartProblem({
        ...base,
        jobs: [job("j1"), job("j2", { budget_calls: 4 })],
        limits: { max_agent_jobs: 4, max_parallel_jobs: 4, max_agent_calls: 4, max_runtime_seconds: 900 },
      }).code,
    ).toBe("mission-call-limit");

    expect(
      jobStartProblem({
        ...base,
        jobs: [job("j1"), job("j2", { budget_seconds: 500 })],
        limits: { max_agent_jobs: 4, max_parallel_jobs: 4, max_agent_calls: 10, max_runtime_seconds: 100 },
      }).code,
    ).toBe("mission-runtime-limit");

    expect(
      jobStartProblem({
        ...base,
        jobs: [job("j1"), job("j2", { dedupe_key: "dedupe-j1", status: "queued" })],
      }).code,
    ).toBe("duplicate-work");
  });

  it("accepts a ready job inside every limit and uses the smaller limit", () => {
    expect(jobStartProblem(base).ok).toBe(true);
    expect(effectiveLimit(10, 4)).toBe(4);
    expect(effectiveLimit(2, 8)).toBe(2);
    expect(effectiveLimit(-1, 8)).toBe(0);
  });
});

describe("dependency failure and cancellation", () => {
  const jobs = [
    job("j1", { status: "running" }),
    job("j2", { status: "queued" }),
    job("j3", { status: "queued" }),
    job("j4", { status: "completed", output: { test_evidence: "Checks passed." } }),
  ];
  const deps = [jobDependency("j2", "j1"), jobDependency("j3", "j2"), jobDependency("j4", "j1")];

  it("finds transitive downstream jobs", () => {
    expect(cancelDownstream("j1", jobs, deps).map((item) => item.id)).toEqual(["j2", "j3"]);
  });

  it("cancels downstream work without touching completed artifacts", () => {
    const transitions = cancelDownstream("j1", jobs, deps);
    expect(transitions.every((item) => item.status === "cancelled")).toBe(true);
    expect(transitions.map((item) => item.id)).not.toContain("j4");
    expect(completedArtifacts(jobs)).toEqual([
      { id: "j4", output: { test_evidence: "Checks passed." } },
    ]);
  });

  it("pauses downstream work after a dependency fails", () => {
    const transitions = failDownstream("j1", jobs, deps);
    expect(transitions.map((item) => item.id)).toEqual(["j2", "j3"]);
    expect(transitions.every((item) => item.status === "blocked")).toBe(true);
    expect(transitions[0].reason).toContain("upstream dependency failed");
  });

  it("recovers only stale running jobs and keeps their outputs", () => {
    const stale = job("stale", {
      status: "running",
      started_at: "2026-11-01T00:00:00.000Z",
      output: { test_evidence: "Partial result kept." },
    });
    const fresh = job("fresh", {
      status: "running",
      started_at: "2026-11-01T00:09:00.000Z",
    });
    const recovered = recoverRunningJobs([stale, fresh], {
      now: new Date("2026-11-01T00:10:00.000Z"),
      maxRuntimeSeconds: 300,
    });

    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({ id: "stale", status: "blocked" });
    expect(recovered[0].reason).toContain("saved output was kept");
  });
});

describe("human approval separation", () => {
  it("requires a manager and a separate decider", () => {
    expect(
      approvalProblem({ approval: approval(), actorId: "owner-1", actorRole: "member" }).code,
    ).toBe("forbidden");
    expect(
      approvalProblem({
        approval: approval({ requested_by: "owner-1" }),
        actorId: "owner-1",
        actorRole: "owner",
      }).code,
    ).toBe("self-approval");
  });

  it("does not let an agent approve its own permission increase", () => {
    expect(
      approvalProblem({
        approval: approval({ kind: "permission_increase", requested_by_kind: "agent", requested_by: null }),
        actorId: "owner-1",
        actorRole: "owner",
        actorKind: "agent",
      }).code,
    ).toBe("agent-approval");

    expect(
      approvalProblem({
        approval: approval({ kind: "permission_increase", requested_by_kind: "agent", requested_by: null }),
        actorId: "owner-1",
        actorRole: "owner",
      }).ok,
    ).toBe(true);
  });

  it("refuses decided approvals and accepts a human decision on a deployment", () => {
    expect(
      approvalProblem({
        approval: approval({ status: "approved" }),
        actorId: "owner-2",
        actorRole: "admin",
      }).code,
    ).toBe("not-pending");
    expect(
      approvalProblem({ approval: approval(), actorId: "owner-2", actorRole: "admin" }).ok,
    ).toBe(true);
  });
});

describe("mission dashboard", () => {
  it("shows progress by deliverable, blocked dependencies, evidence and disagreements", () => {
    const dashboard = missionDashboard({
      mission: {
        id: "mission-1",
        title: "Launch a community learning service",
        review_at: "2026-12-01",
        limits: normalizeMissionLimits({}),
      },
      milestones: [
        milestone("m0", { title: "Pilot plan", status: "blocked", position: 0 }),
        milestone("m1", { title: "Public website", status: "done", position: 1 }),
        milestone("m2", { title: "Pilot feedback", status: "blocked", position: 2 }),
      ],
      milestonesDependencies: [milestoneDependency("m2", "m0")],
      jobs: [
        job("j1", { milestone_id: "m1", status: "completed", output: { test_evidence: "Route checks passed." } }),
        job("j2", { milestone_id: "m2", status: "blocked" }),
      ],
      approvals: [approval()],
      decisions: [{ id: "d1", title: "Pilot scope", dissent: "One member wanted a smaller pilot." }],
      today: "2026-11-08",
    });

    expect(dashboard.deliverables.map((item) => item.title)).toEqual([
      "Pilot plan",
      "Public website",
      "Pilot feedback",
    ]);
    expect(dashboard.overall.deliverablesDone).toBe(1);
    expect(dashboard.blockedDependencies[0]).toMatchObject({
      milestoneTitle: "Pilot feedback",
      dependsOnTitle: "Pilot plan",
    });
    expect(dashboard.pendingApprovals).toHaveLength(1);
    expect(dashboard.unresolvedDisagreements[0].dissent).toContain("smaller pilot");
    expect(dashboard.testEvidence[0].summary).toBe("Route checks passed.");
    expect(dashboard.upcomingReviews.map((item) => item.date)).toEqual([
      "2026-11-20",
      "2026-11-20",
      "2026-11-20",
      "2026-12-01",
    ]);
    expect(dashboard.resourceUse.limits.max_parallel_jobs).toBe(2);
  });

  it("never computes a person ranking", () => {
    const dashboard = missionDashboard({
      mission: {
        id: "mission-1",
        title: "Mission",
        review_at: null,
        limits: normalizeMissionLimits({}),
      },
      milestones: [milestone("m1", { owner_id: "owner-1" })],
      milestonesDependencies: [],
      jobs: [job("j1", { milestone_id: "m1", status: "completed" })],
      approvals: [],
      decisions: [],
      today: "2026-11-08",
    });

    expect(Object.keys(dashboard)).not.toContain("scores");
    expect(JSON.stringify(dashboard)).not.toContain("productivity");
    expect(dashboard.deliverables[0].ownerId).toBe("owner-1");
  });
});

describe("evidence and validation", () => {
  it("extracts bounded evidence without inventing one", () => {
    expect(evidenceSummary(null)).toBeNull();
    expect(evidenceSummary("  ")).toBeNull();
    expect(evidenceSummary({ test_evidence: "Typecheck passed." })).toBe("Typecheck passed.");
    expect(evidenceSummary({ summary: "Only a summary." })).toBe("Only a summary.");
    expect(evidenceSummary({ unrelated: true })).toBeTypeOf("string");
  });

  it("clamps mission limits to their safe ranges", () => {
    expect(normalizeMissionLimits({ max_parallel_jobs: 99, max_agent_calls: -4 })).toMatchObject({
      max_parallel_jobs: 4,
      max_agent_calls: 0,
    });
    expect(
      missionLimitsSchema.safeParse({
        workspace_id: "0b7f5a4e-3c2d-4f10-9a11-1d2c3b4a5e6f",
        mission_id: "3f2a1b4c-5d6e-4f70-8a91-0b2c3d4e5f60",
        max_parallel_jobs: "2",
        max_agent_jobs: "12",
        max_runtime_seconds: "900",
        max_agent_calls: "12",
      }).success,
    ).toBe(true);
  });
});
