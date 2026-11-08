/**
 * Phase 34 — mission control, as pure rules.
 *
 * A mission connects one human-defined outcome to existing projects,
 * deliverables, dependencies, accountable people, bounded agent jobs, review
 * dates and resource limits. This module only models the contract; the database
 * migration enforces the same rules under RLS and the page renders them.
 *
 * Ground rules encoded here:
 *   * A plan is a suggestion. Dependencies are finish-to-start assumptions, not
 *     a guaranteed schedule, and every order needs a person to approve it.
 *   * Work cannot start before its dependencies complete. A failed dependency
 *     pauses downstream jobs; cancellation propagates and keeps completed
 *     artifacts.
 *   * Mission limits apply in addition to project limits. The effective limit is
 *     the smaller remaining allowance, never the larger one.
 *   * External writes and deployments need a separate human approval. A
 *     requester cannot approve their own request, and an agent can never approve
 *     its own permission increase.
 *   * Progress is by deliverable. There is no person ranking, surveillance score
 *     or composite productivity number.
 */

import { z } from "zod";
import type { WorkspaceRole } from "@/lib/types";

export const MISSION_CONTROL_LIMITS = {
  minParallelJobs: 1,
  maxParallelJobs: 4,
  minAgentJobs: 1,
  maxAgentJobs: 24,
  minRuntimeSeconds: 60,
  maxRuntimeSeconds: 1800,
  maxAgentCalls: 24,
} as const;

export const MISSION_MILESTONE_STATUSES = [
  "planned",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
] as const;
export type MissionMilestoneStatus = (typeof MISSION_MILESTONE_STATUSES)[number];

export const MISSION_JOB_STATUSES = [
  "queued",
  "running",
  "blocked",
  "awaiting_review",
  "completed",
  "failed",
  "cancelled",
] as const;
export type MissionJobStatus = (typeof MISSION_JOB_STATUSES)[number];

export const MISSION_JOB_ROLES = [
  "coordinator",
  "frontend",
  "backend",
  "data",
  "qa",
  "security",
] as const;
export type MissionJobRole = (typeof MISSION_JOB_ROLES)[number];

export const MISSION_APPROVAL_KINDS = [
  "scope_change",
  "external_write",
  "deployment",
  "permission_increase",
] as const;
export type MissionApprovalKind = (typeof MISSION_APPROVAL_KINDS)[number];

export const MISSION_APPROVAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
] as const;
export type MissionApprovalStatus = (typeof MISSION_APPROVAL_STATUSES)[number];

export type MissionControlLimits = {
  max_parallel_jobs: number;
  max_agent_jobs: number;
  max_runtime_seconds: number;
  max_agent_calls: number;
};

export type MissionProjectLink = {
  id: string;
  mission_id: string;
  workspace_id: string;
  project_id: string;
  label: string;
  linked_by: string | null;
  created_at: string;
};

export type MissionMilestone = {
  id: string;
  mission_id: string;
  workspace_id: string;
  title: string;
  description: string;
  owner_id: string | null;
  due_at: string | null;
  review_at: string | null;
  status: MissionMilestoneStatus;
  position: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type MissionMilestoneDependency = {
  id: string;
  mission_id: string;
  workspace_id: string;
  milestone_id: string;
  depends_on_id: string;
  created_by: string | null;
  created_at: string;
};

export type MissionAgentJob = {
  id: string;
  mission_id: string;
  workspace_id: string;
  project_id: string;
  milestone_id: string | null;
  source_task_id: string | null;
  title: string;
  objective: string;
  role: MissionJobRole;
  status: MissionJobStatus;
  dedupe_key: string;
  budget_seconds: number;
  budget_calls: number;
  calls_used: number;
  runtime_seconds: number;
  attempts: number;
  output: unknown | null;
  blocker: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type MissionJobDependency = {
  id: string;
  mission_id: string;
  workspace_id: string;
  job_id: string;
  depends_on_job_id: string;
  created_by: string | null;
  created_at: string;
};

export type MissionApproval = {
  id: string;
  mission_id: string;
  workspace_id: string;
  kind: MissionApprovalKind;
  summary: string;
  scope: string;
  requested_by: string | null;
  requested_by_kind: "human" | "agent";
  status: MissionApprovalStatus;
  decided_by: string | null;
  decided_at: string | null;
  note: string;
  created_by: string | null;
  created_at: string;
};

export const PLAN_NOTE =
  "This is a dependency-aware suggestion, not a guaranteed schedule. The order assumes every dependency is finish-to-start, that parallel items do not share an unresolved decision or file, and that a person reviews the plan before work starts.";

export const MISSION_CONTROL_NOTES = {
  noAutoCreate:
    "Projects are linked explicitly. Mission control never creates a project, task or agent job on its own.",
  noGuarantee:
    "Dates are review points and planning targets, not promises. No schedule or delivery date is guaranteed.",
  humanAuthority:
    "A named person owns each decision. Disagreement stays visible, scope changes need a separate decision, and external writes or deployment need their own approval.",
  noRanking:
    "Progress is shown by deliverable and by completed work. There is no person ranking, surveillance score or productivity league table.",
  cancellation:
    "Cancelling a job never deletes a completed artifact. Downstream jobs are paused or cancelled with the reason recorded.",
} as const;

export function canManageMissionControl(role: WorkspaceRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function milestoneStatusLabel(status: MissionMilestoneStatus): string {
  switch (status) {
    case "planned":
      return "Planned";
    case "in_progress":
      return "In progress";
    case "blocked":
      return "Blocked";
    case "done":
      return "Done";
    case "cancelled":
      return "Cancelled";
  }
}

export function jobStatusLabel(status: MissionJobStatus): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "blocked":
      return "Blocked";
    case "awaiting_review":
      return "Awaiting review";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

export function approvalKindLabel(kind: MissionApprovalKind): string {
  switch (kind) {
    case "scope_change":
      return "Scope change";
    case "external_write":
      return "External write";
    case "deployment":
      return "Deployment";
    case "permission_increase":
      return "Permission increase";
  }
}

export function approvalKindNote(kind: MissionApprovalKind): string {
  switch (kind) {
    case "scope_change":
      return "Adds or changes what the mission includes. Approval records the decision only.";
    case "external_write":
      return "Would write outside this app. A separate approval is required before any external action.";
    case "deployment":
      return "Would deploy. This record is approval only; no deployment is performed here.";
    case "permission_increase":
      return "Would widen an agent's tools or limits. An agent cannot request and approve this itself.";
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function normalizeMissionLimits(
  input: Partial<MissionControlLimits> | null | undefined,
): MissionControlLimits {
  return {
    max_parallel_jobs: clamp(
      Number(input?.max_parallel_jobs ?? 2),
      MISSION_CONTROL_LIMITS.minParallelJobs,
      MISSION_CONTROL_LIMITS.maxParallelJobs,
    ),
    max_agent_jobs: clamp(
      Number(input?.max_agent_jobs ?? 12),
      MISSION_CONTROL_LIMITS.minAgentJobs,
      MISSION_CONTROL_LIMITS.maxAgentJobs,
    ),
    max_runtime_seconds: clamp(
      Number(input?.max_runtime_seconds ?? 900),
      MISSION_CONTROL_LIMITS.minRuntimeSeconds,
      MISSION_CONTROL_LIMITS.maxRuntimeSeconds,
    ),
    max_agent_calls: clamp(
      Number(input?.max_agent_calls ?? 12),
      0,
      MISSION_CONTROL_LIMITS.maxAgentCalls,
    ),
  };
}

/** Mission limits are additional, so the smaller remaining value always wins. */
export function effectiveLimit(projectLimit: number, missionLimit: number): number {
  return Math.max(0, Math.min(projectLimit, missionLimit));
}

export type MissionPlanInput = {
  milestones: Pick<MissionMilestone, "id" | "title" | "status" | "owner_id" | "position" | "review_at">[];
  dependencies: Pick<MissionMilestoneDependency, "milestone_id" | "depends_on_id">[];
  jobs?: Pick<MissionAgentJob, "id" | "title" | "milestone_id" | "status" | "dedupe_key" | "project_id" | "budget_seconds" | "budget_calls">[];
  limits?: Partial<MissionControlLimits>;
  projectCount?: number;
};

export type MissionPlan = {
  cycle: boolean;
  cycleIds: string[];
  sequence: { id: string; title: string; order: number; wave: number }[];
  parallelGroups: string[][];
  missingDecisions: string[];
  resourceConflicts: string[];
  reviewPoints: { id: string; title: string; reviewAt: string }[];
  assumptions: string[];
  guaranteed: false;
  note: string;
};

/**
 * Builds a dependency-aware order using only the recorded graph. Missing
 * dependencies, cycles, unowned deliverables and resource conflicts are reported
 * instead of being smoothed over.
 */
export function buildMissionPlan(input: MissionPlanInput): MissionPlan {
  const limits = normalizeMissionLimits(input.limits);
  const milestones = input.milestones.filter((item) => item.status !== "cancelled");
  const byId = new Map(milestones.map((item) => [item.id, item]));
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  const missingDecisions: string[] = [];
  const resourceConflicts: string[] = [];

  for (const milestone of milestones) {
    indegree.set(milestone.id, 0);
    dependents.set(milestone.id, []);
    if (milestone.owner_id === null && milestone.status !== "done") {
      missingDecisions.push(`“${milestone.title}” has no accountable owner.`);
    }
    if (milestone.review_at === null && milestone.status !== "done") {
      missingDecisions.push(`“${milestone.title}” has no review date.`);
    }
  }

  for (const dependency of input.dependencies) {
    if (!byId.has(dependency.milestone_id) || !byId.has(dependency.depends_on_id)) {
      resourceConflicts.push(
        "A dependency points at a deliverable that is not part of this mission.",
      );
      continue;
    }
    indegree.set(dependency.milestone_id, (indegree.get(dependency.milestone_id) ?? 0) + 1);
    dependents.get(dependency.depends_on_id)?.push(dependency.milestone_id);
  }

  const remaining = [...milestones].sort(
    (a, b) => a.position - b.position || a.title.localeCompare(b.title),
  );
  const sequence: MissionPlan["sequence"] = [];
  const waves: string[][] = [];
  const waveOf = new Map<string, number>();
  let processed = 0;

  while (processed < milestones.length) {
    const ready = remaining.filter((milestone) => (indegree.get(milestone.id) ?? 0) === 0);
    if (ready.length === 0) break;

    const wave = waves.length;
    waves.push(ready.map((milestone) => milestone.id));
    for (const milestone of ready) {
      sequence.push({
        id: milestone.id,
        title: milestone.title,
        order: sequence.length + 1,
        wave,
      });
      waveOf.set(milestone.id, wave);
      processed += 1;
    }

    for (const milestone of ready) {
      remaining.splice(remaining.indexOf(milestone), 1);
      for (const dependent of dependents.get(milestone.id) ?? []) {
        indegree.set(dependent, Math.max(0, (indegree.get(dependent) ?? 1) - 1));
      }
    }
  }

  const cycleIds = remaining.map((milestone) => milestone.id);
  const cycle = cycleIds.length > 0;
  if (cycle) {
    resourceConflicts.push("The dependency graph contains a cycle. No reliable order can be suggested.");
  }

  for (const group of waves) {
    const jobs = (input.jobs ?? []).filter(
      (job) => job.milestone_id !== null && group.includes(job.milestone_id) && job.status !== "cancelled",
    );
    if (jobs.length > limits.max_parallel_jobs) {
      resourceConflicts.push(
        `Parallel group ${waves.indexOf(group) + 1} has ${jobs.length} jobs but the mission allows ${limits.max_parallel_jobs} at once.`,
      );
    }
    const seconds = jobs.reduce((total, job) => total + job.budget_seconds, 0);
    if (seconds > limits.max_runtime_seconds) {
      resourceConflicts.push(
        `Parallel group ${waves.indexOf(group) + 1} requests ${seconds}s of agent runtime against a ${limits.max_runtime_seconds}s mission limit.`,
      );
    }
    const calls = jobs.reduce((total, job) => total + job.budget_calls, 0);
    if (calls > limits.max_agent_calls) {
      resourceConflicts.push(
        `Parallel group ${waves.indexOf(group) + 1} requests ${calls} agent calls against a ${limits.max_agent_calls}-call mission limit.`,
      );
    }
  }

  const activeJobs = (input.jobs ?? []).filter((job) => job.status !== "cancelled");
  if (activeJobs.length > limits.max_agent_jobs) {
    resourceConflicts.push(
      `The mission has ${activeJobs.length} jobs but its limit is ${limits.max_agent_jobs}.`,
    );
  }

  const dedupe = new Map<string, number>();
  for (const job of activeJobs) {
    const key = `${job.project_id}:${job.dedupe_key}`;
    dedupe.set(key, (dedupe.get(key) ?? 0) + 1);
  }
  for (const [key, count] of dedupe) {
    if (count > 1) {
      resourceConflicts.push(`Duplicate work is assigned ${count} times for ${key}.`);
    }
  }

  for (const job of input.jobs ?? []) {
    if (job.milestone_id === null && job.status !== "cancelled") {
      missingDecisions.push(`“${job.title}” is not attached to a deliverable.`);
    }
  }

  if ((input.projectCount ?? 0) === 0) {
    missingDecisions.push("No existing project is linked yet. Link one explicitly; nothing is created automatically.");
  }

  const reviewPoints = milestones
    .filter((milestone) => milestone.review_at !== null)
    .map((milestone) => ({
      id: milestone.id,
      title: milestone.title,
      reviewAt: milestone.review_at as string,
    }))
    .sort((a, b) => a.reviewAt.localeCompare(b.reviewAt));

  return {
    cycle,
    cycleIds,
    sequence,
    parallelGroups: waves,
    missingDecisions,
    resourceConflicts,
    reviewPoints,
    assumptions: [
      "Every dependency is treated as finish-to-start.",
      "Deliverables in the same parallel group do not share an unresolved decision, file or owner.",
      "Budget figures are the requested caps, not a forecast of actual use.",
      "A person must review the order, the owners and the review dates before any job starts.",
    ],
    guaranteed: false,
    note: PLAN_NOTE,
  };
}

export type JobStartCheck = {
  ok: boolean;
  code?:
    | "forbidden"
    | "not-active"
    | "not-queued"
    | "dependency-pending"
    | "dependency-failed"
    | "duplicate-work"
    | "mission-concurrency"
    | "mission-job-limit"
    | "mission-call-limit"
    | "mission-runtime-limit";
  message?: string;
};

export type JobStartContext = {
  job: Pick<
    MissionAgentJob,
    "id" | "status" | "project_id" | "dedupe_key" | "budget_seconds" | "budget_calls"
  > & { milestone_id: string | null };
  jobs: Pick<
    MissionAgentJob,
    "id" | "status" | "project_id" | "dedupe_key" | "budget_seconds" | "budget_calls" | "runtime_seconds"
  >[];
  jobDependencies: Pick<MissionJobDependency, "job_id" | "depends_on_job_id">[];
  milestones: Pick<MissionMilestone, "id" | "status">[];
  milestoneDependencies: Pick<MissionMilestoneDependency, "milestone_id" | "depends_on_id">[];
  missionStatus: "draft" | "active" | "closed";
  limits: Partial<MissionControlLimits>;
  role: WorkspaceRole | null | undefined;
};

export function jobStartProblem(context: JobStartContext): JobStartCheck {
  if (!canManageMissionControl(context.role)) {
    return { ok: false, code: "forbidden", message: "Only an owner or admin can start jobs." };
  }
  if (context.missionStatus !== "active") {
    return { ok: false, code: "not-active", message: "Start the mission before running jobs." };
  }
  if (context.job.status !== "queued" && context.job.status !== "blocked") {
    return { ok: false, code: "not-queued", message: "That job is not waiting to start." };
  }

  const jobStatus = new Map(context.jobs.map((job) => [job.id, job.status]));
  const dependencies = context.jobDependencies.filter((dependency) => dependency.job_id === context.job.id);
  if (dependencies.some((dependency) => ["failed", "cancelled"].includes(jobStatus.get(dependency.depends_on_job_id) ?? ""))) {
    return {
      ok: false,
      code: "dependency-failed",
      message: "A job dependency failed or was cancelled. Downstream work stays paused.",
    };
  }
  if (dependencies.some((dependency) => jobStatus.get(dependency.depends_on_job_id) !== "completed")) {
    return {
      ok: false,
      code: "dependency-pending",
      message: "Wait for every job dependency to complete before starting this job.",
    };
  }

  const milestoneStatus = new Map(context.milestones.map((milestone) => [milestone.id, milestone.status]));
  const milestoneDependencies = context.job.milestone_id
    ? context.milestoneDependencies.filter((dependency) => dependency.milestone_id === context.job.milestone_id)
    : [];
  if (milestoneDependencies.some((dependency) => ["blocked", "cancelled"].includes(milestoneStatus.get(dependency.depends_on_id) ?? ""))) {
    return {
      ok: false,
      code: "dependency-failed",
      message: "A milestone dependency is blocked or cancelled. The job stays paused.",
    };
  }
  if (milestoneDependencies.some((dependency) => milestoneStatus.get(dependency.depends_on_id) !== "done")) {
    return {
      ok: false,
      code: "dependency-pending",
      message: "Wait for every milestone dependency to finish before starting this job.",
    };
  }

  if (
    context.jobs.some(
      (job) =>
        job.id !== context.job.id &&
        job.project_id === context.job.project_id &&
        job.dedupe_key === context.job.dedupe_key &&
        ["queued", "running", "blocked", "awaiting_review"].includes(job.status),
    )
  ) {
    return {
      ok: false,
      code: "duplicate-work",
      message: "The same work is already assigned in this mission. Do not duplicate it across agents.",
    };
  }

  const limits = normalizeMissionLimits(context.limits);
  const running = context.jobs.filter((job) => job.status === "running").length;
  if (running >= limits.max_parallel_jobs) {
    return {
      ok: false,
      code: "mission-concurrency",
      message: `The mission allows ${limits.max_parallel_jobs} running job(s) at once.`,
    };
  }

  const active = context.jobs.filter((job) => job.status !== "cancelled");
  if (active.length > limits.max_agent_jobs) {
    return {
      ok: false,
      code: "mission-job-limit",
      message: `The mission allows ${limits.max_agent_jobs} jobs in total.`,
    };
  }

  const calls = active.reduce((total, job) => total + job.budget_calls, 0);
  if (calls + context.job.budget_calls > limits.max_agent_calls) {
    return {
      ok: false,
      code: "mission-call-limit",
      message: `The mission allows ${limits.max_agent_calls} agent calls in total.`,
    };
  }

  const runtime = active.reduce(
    (total, job) => total + job.runtime_seconds + (job.status === "running" ? job.budget_seconds : 0),
    0,
  );
  if (runtime + context.job.budget_seconds > limits.max_runtime_seconds) {
    return {
      ok: false,
      code: "mission-runtime-limit",
      message: `The mission allows ${limits.max_runtime_seconds}s of agent runtime in total.`,
    };
  }

  return { ok: true };
}

export function selectRunnableJobs(context: {
  jobs: JobStartContext["job"][];
  allJobs: JobStartContext["jobs"];
  jobDependencies: JobStartContext["jobDependencies"];
  milestones: JobStartContext["milestones"];
  milestoneDependencies: JobStartContext["milestoneDependencies"];
  missionStatus: JobStartContext["missionStatus"];
  limits: JobStartContext["limits"];
  role: WorkspaceRole | null | undefined;
}): string[] {
  const runnable: string[] = [];
  for (const job of context.jobs) {
    const check = jobStartProblem({
      job,
      jobs: context.allJobs,
      jobDependencies: context.jobDependencies,
      milestones: context.milestones,
      milestoneDependencies: context.milestoneDependencies,
      missionStatus: context.missionStatus,
      limits: context.limits,
      role: context.role,
    });
    if (check.ok) runnable.push(job.id);
  }
  return runnable;
}

export function downstreamJobIds(
  rootId: string,
  dependencies: Pick<MissionJobDependency, "job_id" | "depends_on_job_id">[],
): Set<string> {
  const result = new Set<string>();
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const dependency of dependencies) {
      if (dependency.depends_on_job_id === current && !result.has(dependency.job_id)) {
        result.add(dependency.job_id);
        queue.push(dependency.job_id);
      }
    }
  }
  return result;
}

export type JobTransition = { id: string; status: MissionJobStatus; reason: string };

export function cancelDownstream(
  rootId: string,
  jobs: Pick<MissionAgentJob, "id" | "status">[],
  dependencies: Pick<MissionJobDependency, "job_id" | "depends_on_job_id">[],
): JobTransition[] {
  const downstream = downstreamJobIds(rootId, dependencies);
  return jobs
    .filter(
      (job) =>
        downstream.has(job.id) &&
        ["queued", "running", "blocked", "awaiting_review"].includes(job.status),
    )
    .map((job) => ({
      id: job.id,
      status: "cancelled" as const,
      reason: "Cancelled because an upstream job was cancelled.",
    }));
}

export function failDownstream(
  rootId: string,
  jobs: Pick<MissionAgentJob, "id" | "status">[],
  dependencies: Pick<MissionJobDependency, "job_id" | "depends_on_job_id">[],
): JobTransition[] {
  const downstream = downstreamJobIds(rootId, dependencies);
  return jobs
    .filter(
      (job) =>
        downstream.has(job.id) &&
        ["queued", "running", "blocked", "awaiting_review"].includes(job.status),
    )
    .map((job) => ({
      id: job.id,
      status: "blocked" as const,
      reason: "Paused because an upstream dependency failed.",
    }));
}

export function completedArtifacts(
  jobs: Pick<MissionAgentJob, "id" | "output" | "status">[],
): { id: string; output: unknown }[] {
  return jobs
    .filter((job) => job.status === "completed" && job.output !== null)
    .map((job) => ({ id: job.id, output: job.output }));
}

export function recoverRunningJobs(
  jobs: Pick<MissionAgentJob, "id" | "status" | "started_at" | "output">[],
  options: { now: Date; maxRuntimeSeconds: number },
): JobTransition[] {
  const cutoff = options.now.getTime() - options.maxRuntimeSeconds * 1000;
  return jobs
    .filter(
      (job) =>
        job.status === "running" &&
        job.started_at !== null &&
        Date.parse(job.started_at) < cutoff,
    )
    .map((job) => ({
      id: job.id,
      status: "blocked" as const,
      reason:
        "Recovered after exceeding the mission runtime limit. Inspect before retrying; the saved output was kept.",
    }));
}

export type ApprovalProblem = {
  ok: boolean;
  code?:
    | "forbidden"
    | "not-pending"
    | "self-approval"
    | "agent-approval"
    | "invalid-kind";
  message?: string;
};

export function approvalProblem(input: {
  approval: Pick<MissionApproval, "kind" | "status" | "requested_by" | "requested_by_kind">;
  actorId: string;
  actorRole: WorkspaceRole | null | undefined;
  actorKind?: "human" | "agent";
}): ApprovalProblem {
  if (!canManageMissionControl(input.actorRole)) {
    return {
      ok: false,
      code: "forbidden",
      message: "Only an owner or admin can decide this approval.",
    };
  }
  if (input.approval.status !== "pending") {
    return { ok: false, code: "not-pending", message: "That approval was already decided." };
  }
  if ((input.actorKind ?? "human") === "agent") {
    return {
      ok: false,
      code: "agent-approval",
      message: "An agent cannot approve a request or widen its own permissions.",
    };
  }
  if (
    input.approval.requested_by !== null &&
    input.approval.requested_by === input.actorId
  ) {
    return {
      ok: false,
      code: "self-approval",
      message: "A separate person must decide this request. You cannot approve your own request.",
    };
  }
  if (!MISSION_APPROVAL_KINDS.includes(input.approval.kind)) {
    return { ok: false, code: "invalid-kind", message: "That approval kind is not available." };
  }
  return { ok: true };
}

export type DeliverableProgress = {
  id: string;
  title: string;
  status: MissionMilestoneStatus;
  ownerId: string | null;
  totalJobs: number;
  completedJobs: number;
  blockedJobs: number;
};

export type MissionDashboard = {
  deliverables: DeliverableProgress[];
  overall: { deliverablesDone: number; deliverablesTotal: number; jobsDone: number; jobsTotal: number };
  blockedDependencies: {
    milestoneId: string;
    milestoneTitle: string;
    dependsOnId: string;
    dependsOnTitle: string;
    dependencyStatus: MissionMilestoneStatus;
  }[];
  pendingApprovals: MissionApproval[];
  unresolvedDisagreements: { id: string; title: string; dissent: string }[];
  resourceUse: {
    runningJobs: number;
    activeJobs: number;
    runtimeSeconds: number;
    callsUsed: number;
    limits: MissionControlLimits;
  };
  testEvidence: { jobId: string; title: string; summary: string }[];
  upcomingReviews: { kind: "mission" | "milestone"; id: string; title: string; date: string }[];
};

export function evidenceSummary(output: unknown): string | null {
  if (output === null || output === undefined) return null;
  if (typeof output === "string") {
    const trimmed = output.trim();
    return trimmed === "" ? null : trimmed.slice(0, 500);
  }
  if (typeof output === "object" && !Array.isArray(output)) {
    const record = output as Record<string, unknown>;
    for (const key of ["test_evidence", "tests", "evidence", "summary", "checks"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim() !== "") return value.trim().slice(0, 500);
      if (Array.isArray(value)) {
        const text = value
          .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
          .join("; ")
          .trim();
        if (text !== "") return text.slice(0, 500);
      }
    }
  }
  try {
    return JSON.stringify(output).slice(0, 500);
  } catch {
    return null;
  }
}

export function missionDashboard(input: {
  mission: { id: string; title: string; review_at: string | null; limits: MissionControlLimits };
  milestones: MissionMilestone[];
  milestonesDependencies: MissionMilestoneDependency[];
  jobs: MissionAgentJob[];
  approvals: MissionApproval[];
  decisions: { id: string; title: string; dissent: string | null }[];
  today: string;
}): MissionDashboard {
  const activeMilestones = input.milestones.filter((milestone) => milestone.status !== "cancelled");
  const deliverables = activeMilestones
    .slice()
    .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title))
    .map((milestone) => {
      const jobs = input.jobs.filter((job) => job.milestone_id === milestone.id);
      return {
        id: milestone.id,
        title: milestone.title,
        status: milestone.status,
        ownerId: milestone.owner_id,
        totalJobs: jobs.length,
        completedJobs: jobs.filter((job) => job.status === "completed").length,
        blockedJobs: jobs.filter((job) => job.status === "blocked").length,
      };
    });

  const blockedDependencies: MissionDashboard["blockedDependencies"] = [];
  for (const dependency of input.milestonesDependencies) {
    const milestone = input.milestones.find((item) => item.id === dependency.milestone_id);
    const dependsOn = input.milestones.find((item) => item.id === dependency.depends_on_id);
    if (!milestone || !dependsOn) continue;
    if (["blocked", "cancelled"].includes(dependsOn.status)) {
      blockedDependencies.push({
        milestoneId: milestone.id,
        milestoneTitle: milestone.title,
        dependsOnId: dependsOn.id,
        dependsOnTitle: dependsOn.title,
        dependencyStatus: dependsOn.status,
      });
    }
  }

  const activeJobs = input.jobs.filter((job) => job.status !== "cancelled");
  const testEvidence = input.jobs
    .map((job) => {
      const summary = evidenceSummary(job.output);
      return summary === null
        ? null
        : { jobId: job.id, title: job.title, summary };
    })
    .filter((item): item is { jobId: string; title: string; summary: string } => item !== null);

  const upcomingReviews: MissionDashboard["upcomingReviews"] = [];
  if (input.mission.review_at && input.mission.review_at >= input.today) {
    upcomingReviews.push({
      kind: "mission",
      id: input.mission.id,
      title: input.mission.title,
      date: input.mission.review_at,
    });
  }
  for (const milestone of input.milestones) {
    if (milestone.review_at && milestone.review_at >= input.today) {
      upcomingReviews.push({
        kind: "milestone",
        id: milestone.id,
        title: milestone.title,
        date: milestone.review_at,
      });
    }
  }
  upcomingReviews.sort((a, b) => a.date.localeCompare(b.date));

  return {
    deliverables,
    overall: {
      deliverablesDone: deliverables.filter((item) => item.status === "done").length,
      deliverablesTotal: deliverables.length,
      jobsDone: input.jobs.filter((job) => job.status === "completed").length,
      jobsTotal: input.jobs.filter((job) => job.status !== "cancelled").length,
    },
    blockedDependencies,
    pendingApprovals: input.approvals.filter((approval) => approval.status === "pending"),
    unresolvedDisagreements: input.decisions
      .filter((decision) => decision.dissent !== null && decision.dissent.trim() !== "")
      .map((decision) => ({
        id: decision.id,
        title: decision.title,
        dissent: decision.dissent as string,
      })),
    resourceUse: {
      runningJobs: input.jobs.filter((job) => job.status === "running").length,
      activeJobs: activeJobs.length,
      runtimeSeconds: activeJobs.reduce((total, job) => total + job.runtime_seconds, 0),
      callsUsed: activeJobs.reduce((total, job) => total + job.calls_used, 0),
      limits: input.mission.limits,
    },
    testEvidence,
    upcomingReviews,
  };
}

export const missionLimitsSchema = z.object({
  workspace_id: z.string().uuid(),
  mission_id: z.string().uuid(),
  max_parallel_jobs: z.coerce.number().int().min(1).max(4),
  max_agent_jobs: z.coerce.number().int().min(1).max(24),
  max_runtime_seconds: z.coerce.number().int().min(60).max(1800),
  max_agent_calls: z.coerce.number().int().min(0).max(24),
});

export const missionMilestoneSchema = z.object({
  workspace_id: z.string().uuid(),
  mission_id: z.string().uuid(),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(2000),
  owner_id: z.string().trim(),
  due_at: z.string().trim(),
  review_at: z.string().trim(),
  position: z.coerce.number().int().min(0).max(99),
});

export const missionMilestoneDependencySchema = z.object({
  workspace_id: z.string().uuid(),
  mission_id: z.string().uuid(),
  milestone_id: z.string().uuid(),
  depends_on_id: z.string().uuid(),
});

export const missionAgentJobSchema = z.object({
  workspace_id: z.string().uuid(),
  mission_id: z.string().uuid(),
  project_id: z.string().uuid(),
  milestone_id: z.string().trim(),
  source_task_id: z.string().trim(),
  title: z.string().trim().min(3).max(200),
  objective: z.string().trim().min(5).max(1000),
  role: z.enum(MISSION_JOB_ROLES),
  budget_seconds: z.coerce.number().int().min(10).max(300),
  budget_calls: z.coerce.number().int().min(0).max(4),
  dedupe_key: z.string().trim().min(1).max(160),
});

export const missionJobDependencySchema = z.object({
  workspace_id: z.string().uuid(),
  mission_id: z.string().uuid(),
  job_id: z.string().uuid(),
  depends_on_job_id: z.string().uuid(),
});

export const missionApprovalSchema = z.object({
  workspace_id: z.string().uuid(),
  mission_id: z.string().uuid(),
  kind: z.enum(MISSION_APPROVAL_KINDS),
  summary: z.string().trim().min(5).max(500),
  scope: z.string().trim().min(5).max(2000),
});

export const missionApprovalDecisionSchema = z.object({
  workspace_id: z.string().uuid(),
  mission_id: z.string().uuid(),
  approval_id: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  note: z.string().trim().max(1000),
});
