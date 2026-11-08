"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleMissionState, type MissionState } from "@/lib/action-state";
import {
  addJobDependencyAction,
  addMilestoneDependencyAction,
  cancelAgentJobAction,
  cancelMissionJobsAction,
  claimAgentJobAction,
  createAgentJobAction,
  createMilestoneAction,
  decideMissionApprovalAction,
  finishAgentJobAction,
  linkMissionProjectAction,
  requestMissionApprovalAction,
  setMilestoneStatusAction,
  unlinkMissionProjectAction,
  updateMissionLimitsAction,
} from "@/lib/actions/mission-control";
import {
  MISSION_APPROVAL_KINDS,
  MISSION_JOB_ROLES,
  approvalKindLabel,
  approvalKindNote,
  jobStatusLabel,
  milestoneStatusLabel,
  type MissionAgentJob,
  type MissionApproval,
  type MissionMilestone,
} from "@/lib/mission-control";
import {
  cardClass,
  hintClass,
  inputClass,
  labelClass,
  quietButton,
  secondaryButton,
} from "@/lib/styles";
import type { Mission, WorkspaceMember } from "@/lib/types";
import type {
  MissionControlProjectSummary,
  MissionControlTask,
} from "@/lib/data/mission-control";

function StateNote({ state }: { state: MissionState }) {
  if (state.status === "error") return <span className="text-danger">{state.message}</span>;
  if (state.status === "success") return <span className="text-mint">{state.message}</span>;
  return null;
}

export function MissionLimitsForm({ mission }: { mission: Mission }) {
  const [state, formAction] = useActionState(updateMissionLimitsAction, idleMissionState);

  return (
    <form action={formAction} className={cardClass}>
      <h2 className="text-lg font-bold">Mission limits</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        These limits apply in addition to each project&apos;s own limits. The smaller
        remaining allowance wins, never the larger one.
      </p>
      <input type="hidden" name="workspace_id" value={mission.workspace_id} />
      <input type="hidden" name="mission_id" value={mission.id} />

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="mc-parallel">
            Running jobs at once
          </label>
          <input
            id="mc-parallel"
            name="max_parallel_jobs"
            type="number"
            min={1}
            max={4}
            defaultValue={mission.max_parallel_jobs}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="mc-jobs">
            Jobs in total
          </label>
          <input
            id="mc-jobs"
            name="max_agent_jobs"
            type="number"
            min={1}
            max={24}
            defaultValue={mission.max_agent_jobs}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="mc-runtime">
            Runtime seconds
          </label>
          <input
            id="mc-runtime"
            name="max_runtime_seconds"
            type="number"
            min={60}
            max={1800}
            defaultValue={mission.max_runtime_seconds}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="mc-calls">
            Agent calls
          </label>
          <input
            id="mc-calls"
            name="max_agent_calls"
            type="number"
            min={0}
            max={24}
            defaultValue={mission.max_agent_calls}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <SubmitButton className={secondaryButton} pendingLabel="Saving limits…">
          Save mission limits
        </SubmitButton>
        <StateNote state={state} />
      </div>
    </form>
  );
}

export function LinkProjectForm({
  missionId,
  workspaceId,
  projects,
}: {
  missionId: string;
  workspaceId: string;
  projects: MissionControlProjectSummary[];
}) {
  const [state, formAction] = useActionState(linkMissionProjectAction, idleMissionState);

  if (projects.length === 0) {
    return (
      <p className={`${cardClass} text-sm text-muted`}>
        Every project you can access is already linked, or you have no projects yet.
        Mission control never creates one automatically.
      </p>
    );
  }

  return (
    <form action={formAction} className={cardClass}>
      <h3 className="text-sm font-bold">Link an existing project</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Linking records an explicit relationship. It does not create tasks, change
        project access or start work.
      </p>
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="mission_id" value={missionId} />
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div>
          <label className={labelClass} htmlFor="mc-project">
            Project
          </label>
          <select id="mc-project" name="project_id" className={`mt-1.5 ${inputClass}`}>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="mc-project-label">
            Mission label (optional)
          </label>
          <input
            id="mc-project-label"
            name="label"
            maxLength={160}
            placeholder="e.g. Public website"
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <SubmitButton className={secondaryButton} pendingLabel="Linking…">
          Link project
        </SubmitButton>
      </div>
      <p className="mt-3 text-sm">
        <StateNote state={state} />
      </p>
    </form>
  );
}

export function UnlinkProjectButton({
  missionId,
  workspaceId,
  linkId,
}: {
  missionId: string;
  workspaceId: string;
  linkId: string;
}) {
  const [state, formAction] = useActionState(unlinkMissionProjectAction, idleMissionState);
  return (
    <form action={formAction} className="mt-2">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="mission_id" value={missionId} />
      <input type="hidden" name="link_id" value={linkId} />
      <SubmitButton className={quietButton} pendingLabel="Unlinking…">
        Unlink
      </SubmitButton>
      <span className="ml-2 text-xs">
        <StateNote state={state} />
      </span>
    </form>
  );
}

export function MilestoneForm({
  missionId,
  workspaceId,
  members,
  nextPosition,
}: {
  missionId: string;
  workspaceId: string;
  members: WorkspaceMember[];
  nextPosition: number;
}) {
  const [state, formAction] = useActionState(createMilestoneAction, idleMissionState);

  return (
    <form action={formAction} className={cardClass}>
      <h3 className="text-sm font-bold">Add a deliverable</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        A deliverable is what the mission is trying to produce. Its owner is
        accountable for the decision, not for a productivity score.
      </p>
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="mission_id" value={missionId} />
      <input type="hidden" name="position" value={nextPosition} />

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="mc-milestone-title">
            Deliverable
          </label>
          <input
            id="mc-milestone-title"
            name="title"
            required
            minLength={3}
            maxLength={200}
            placeholder="e.g. Public website ready for pilot"
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="mc-milestone-description">
            What does done mean?
          </label>
          <textarea
            id="mc-milestone-description"
            name="description"
            rows={2}
            maxLength={2000}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="mc-milestone-owner">
            Accountable owner
          </label>
          <select id="mc-milestone-owner" name="owner_id" className={`mt-1.5 ${inputClass}`}>
            <option value="">Unassigned — show as a missing decision</option>
            {members.map((member) => (
              <option key={member.user_id} value={member.user_id}>
                {member.display_name || "Workspace member"} ({member.role})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="mc-milestone-review">
            Review date
          </label>
          <input
            id="mc-milestone-review"
            name="review_at"
            type="date"
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="mc-milestone-due">
            Planning target
          </label>
          <input
            id="mc-milestone-due"
            name="due_at"
            type="date"
            className={`mt-1.5 ${inputClass}`}
          />
          <p className={hintClass}>A target, not a guaranteed date.</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <SubmitButton className={secondaryButton} pendingLabel="Adding…">
          Add deliverable
        </SubmitButton>
        <StateNote state={state} />
      </div>
    </form>
  );
}

export function MilestoneStatusForm({
  missionId,
  workspaceId,
  milestone,
}: {
  missionId: string;
  workspaceId: string;
  milestone: MissionMilestone;
}) {
  const [state, formAction] = useActionState(setMilestoneStatusAction, idleMissionState);
  return (
    <form action={formAction} className="mt-3 flex flex-wrap items-end gap-2">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="mission_id" value={missionId} />
      <input type="hidden" name="milestone_id" value={milestone.id} />
      <div>
        <label className={labelClass} htmlFor={`mc-status-${milestone.id}`}>
          Status
        </label>
        <select
          id={`mc-status-${milestone.id}`}
          name="status"
          defaultValue={milestone.status}
          className={`mt-1 ${inputClass}`}
        >
          {(["planned", "in_progress", "blocked", "done", "cancelled"] as const).map((status) => (
            <option key={status} value={status}>
              {milestoneStatusLabel(status)}
            </option>
          ))}
        </select>
      </div>
      <SubmitButton className={quietButton} pendingLabel="Saving…">
        Update
      </SubmitButton>
      <span className="text-xs">
        <StateNote state={state} />
      </span>
    </form>
  );
}

export function MilestoneDependencyForm({
  missionId,
  workspaceId,
  milestones,
}: {
  missionId: string;
  workspaceId: string;
  milestones: MissionMilestone[];
}) {
  const [state, formAction] = useActionState(addMilestoneDependencyAction, idleMissionState);
  if (milestones.length < 2) return null;

  return (
    <form action={formAction} className={`${cardClass} mt-3`}>
      <h3 className="text-sm font-bold">Add a dependency</h3>
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="mission_id" value={missionId} />
      <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div>
          <label className={labelClass} htmlFor="mc-dep-milestone">
            This deliverable
          </label>
          <select id="mc-dep-milestone" name="milestone_id" className={`mt-1.5 ${inputClass}`}>
            {milestones.map((milestone) => (
              <option key={milestone.id} value={milestone.id}>
                {milestone.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="mc-dep-on">
            depends on
          </label>
          <select id="mc-dep-on" name="depends_on_id" className={`mt-1.5 ${inputClass}`}>
            {milestones.map((milestone) => (
              <option key={milestone.id} value={milestone.id}>
                {milestone.title}
              </option>
            ))}
          </select>
        </div>
        <SubmitButton className={secondaryButton} pendingLabel="Adding…">
          Add dependency
        </SubmitButton>
      </div>
      <p className="mt-2 text-sm">
        <StateNote state={state} />
      </p>
    </form>
  );
}

export function AgentJobForm({
  missionId,
  workspaceId,
  projects,
  tasks,
  milestones,
}: {
  missionId: string;
  workspaceId: string;
  projects: { link: { project_id: string; label: string }; name: string | null }[];
  tasks: MissionControlTask[];
  milestones: MissionMilestone[];
}) {
  const [state, formAction] = useActionState(createAgentJobAction, idleMissionState);
  if (projects.length === 0) {
    return (
      <p className={`${cardClass} mt-3 text-sm text-muted`}>
        Link a project before assigning agent work. No job was created.
      </p>
    );
  }

  return (
    <form action={formAction} className={`${cardClass} mt-3`}>
      <h3 className="text-sm font-bold">Assign an agent job</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        This attaches mission work to the existing project queue. It does not write
        project files, deploy or approve anything.
      </p>
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="mission_id" value={missionId} />

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="mc-job-project">
            Project
          </label>
          <select id="mc-job-project" name="project_id" className={`mt-1.5 ${inputClass}`}>
            {projects.map((project) => (
              <option key={project.link.project_id} value={project.link.project_id}>
                {project.name ?? project.link.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="mc-job-milestone">
            Deliverable
          </label>
          <select id="mc-job-milestone" name="milestone_id" className={`mt-1.5 ${inputClass}`}>
            <option value="">Unassigned — flagged as a missing decision</option>
            {milestones.map((milestone) => (
              <option key={milestone.id} value={milestone.id}>
                {milestone.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="mc-job-source">
            Existing project task (optional)
          </label>
          <select id="mc-job-source" name="source_task_id" className={`mt-1.5 ${inputClass}`}>
            <option value="">No linked task</option>
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title} ({task.status})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="mc-job-role">
            Agent role
          </label>
          <select id="mc-job-role" name="role" className={`mt-1.5 ${inputClass}`}>
            {MISSION_JOB_ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="mc-job-title">
            Job title
          </label>
          <input
            id="mc-job-title"
            name="title"
            required
            minLength={3}
            maxLength={200}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="mc-job-objective">
            Objective and expected artifact
          </label>
          <textarea
            id="mc-job-objective"
            name="objective"
            rows={2}
            required
            minLength={5}
            maxLength={1000}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="mc-job-dedupe">
            Deduplication key
          </label>
          <input
            id="mc-job-dedupe"
            name="dedupe_key"
            required
            maxLength={160}
            placeholder="e.g. publish-pilot-docs"
            className={`mt-1.5 ${inputClass}`}
          />
          <p className={hintClass}>The same key cannot be assigned twice in one mission.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass} htmlFor="mc-job-seconds">
              Seconds
            </label>
            <input
              id="mc-job-seconds"
              name="budget_seconds"
              type="number"
              min={10}
              max={300}
              defaultValue={120}
              className={`mt-1.5 ${inputClass}`}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="mc-job-calls">
              Calls
            </label>
            <input
              id="mc-job-calls"
              name="budget_calls"
              type="number"
              min={0}
              max={4}
              defaultValue={0}
              className={`mt-1.5 ${inputClass}`}
            />
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <SubmitButton className={secondaryButton} pendingLabel="Queueing…">
          Queue job
        </SubmitButton>
        <StateNote state={state} />
      </div>
    </form>
  );
}

export function JobDependencyForm({
  missionId,
  workspaceId,
  jobs,
}: {
  missionId: string;
  workspaceId: string;
  jobs: MissionAgentJob[];
}) {
  const [state, formAction] = useActionState(addJobDependencyAction, idleMissionState);
  if (jobs.length < 2) return null;
  return (
    <form action={formAction} className={`${cardClass} mt-3`}>
      <h3 className="text-sm font-bold">Add a job dependency</h3>
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="mission_id" value={missionId} />
      <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div>
          <label className={labelClass} htmlFor="mc-job-dep">
            This job
          </label>
          <select id="mc-job-dep" name="job_id" className={`mt-1.5 ${inputClass}`}>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="mc-job-dep-on">
            depends on
          </label>
          <select id="mc-job-dep-on" name="depends_on_job_id" className={`mt-1.5 ${inputClass}`}>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.title}
              </option>
            ))}
          </select>
        </div>
        <SubmitButton className={secondaryButton} pendingLabel="Adding…">
          Add job dependency
        </SubmitButton>
      </div>
      <p className="mt-2 text-sm">
        <StateNote state={state} />
      </p>
    </form>
  );
}

export function JobActions({
  missionId,
  workspaceId,
  job,
}: {
  missionId: string;
  workspaceId: string;
  job: MissionAgentJob;
}) {
  const [claimState, claimAction] = useActionState(claimAgentJobAction, idleMissionState);
  const [finishState, finishAction] = useActionState(finishAgentJobAction, idleMissionState);
  const [cancelState, cancelAction] = useActionState(cancelAgentJobAction, idleMissionState);
  const terminal = ["completed", "cancelled"].includes(job.status);

  return (
    <div className="mt-3 space-y-2 border-t border-line pt-3">
      {!terminal && !["running", "awaiting_review"].includes(job.status) ? (
        <form action={claimAction}>
          <input type="hidden" name="workspace_id" value={workspaceId} />
          <input type="hidden" name="mission_id" value={missionId} />
          <input type="hidden" name="job_id" value={job.id} />
          <SubmitButton className={secondaryButton} pendingLabel="Starting…">
            Start job
          </SubmitButton>
          <span className="ml-2 text-xs">
            <StateNote state={claimState} />
          </span>
        </form>
      ) : null}

      {!terminal ? (
        <form action={finishAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="workspace_id" value={workspaceId} />
          <input type="hidden" name="mission_id" value={missionId} />
          <input type="hidden" name="job_id" value={job.id} />
          <div className="min-w-[14rem] flex-1">
            <label className={labelClass} htmlFor={`mc-note-${job.id}`}>
              Test evidence or artifact note
            </label>
            <input
              id={`mc-note-${job.id}`}
              name="note"
              maxLength={1000}
              className={`mt-1 ${inputClass}`}
              placeholder="What was checked, and where is the artifact?"
            />
          </div>
          <button
            type="submit"
            name="status"
            value="completed"
            className={secondaryButton}
          >
            Complete
          </button>
          <button
            type="submit"
            name="status"
            value="failed"
            className={quietButton}
          >
            Mark failed
          </button>
          <span className="text-xs">
            <StateNote state={finishState} />
          </span>
        </form>
      ) : null}

      {job.status !== "completed" && job.status !== "cancelled" ? (
        <form action={cancelAction}>
          <input type="hidden" name="workspace_id" value={workspaceId} />
          <input type="hidden" name="mission_id" value={missionId} />
          <input type="hidden" name="job_id" value={job.id} />
          <SubmitButton className={quietButton} pendingLabel="Cancelling…">
            Cancel job
          </SubmitButton>
          <span className="ml-2 text-xs">
            <StateNote state={cancelState} />
          </span>
        </form>
      ) : null}

      <p className="text-xs text-muted">
        Current status: {jobStatusLabel(job.status)}. Budget {job.budget_seconds}s /{" "}
        {job.budget_calls} calls; used {job.runtime_seconds}s / {job.calls_used} calls.
        {job.status === "completed" ? " A completed artifact is preserved and cannot be cancelled." : ""}
      </p>
    </div>
  );
}

export function CancelMissionJobsForm({
  missionId,
  workspaceId,
}: {
  missionId: string;
  workspaceId: string;
}) {
  const [state, formAction] = useActionState(cancelMissionJobsAction, idleMissionState);
  return (
    <form action={formAction} className="mt-3">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="mission_id" value={missionId} />
      <SubmitButton className={secondaryButton} pendingLabel="Cancelling…">
        Cancel all unfinished jobs
      </SubmitButton>
      <span className="ml-2 text-xs">
        <StateNote state={state} />
      </span>
    </form>
  );
}

export function ApprovalRequestForm({
  missionId,
  workspaceId,
}: {
  missionId: string;
  workspaceId: string;
}) {
  const [state, formAction] = useActionState(requestMissionApprovalAction, idleMissionState);
  return (
    <form action={formAction} className={cardClass}>
      <h3 className="text-sm font-bold">Request a separate approval</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Scope changes, external writes and deployments are escalated here. A
        different owner or admin must decide, and an approval performs no action.
      </p>
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="mission_id" value={missionId} />
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="mc-approval-kind">
            Kind
          </label>
          <select id="mc-approval-kind" name="kind" className={`mt-1.5 ${inputClass}`}>
            {MISSION_APPROVAL_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {approvalKindLabel(kind)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="mc-approval-summary">
            Summary
          </label>
          <input
            id="mc-approval-summary"
            name="summary"
            required
            minLength={5}
            maxLength={500}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="mc-approval-scope">
            Exactly what would change
          </label>
          <textarea
            id="mc-approval-scope"
            name="scope"
            rows={2}
            required
            minLength={5}
            maxLength={2000}
            className={`mt-1.5 ${inputClass}`}
          />
          <p className={hintClass}>
            {MISSION_APPROVAL_KINDS.map((kind) => `${approvalKindLabel(kind)}: ${approvalKindNote(kind)}`).join(" ")}
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <SubmitButton className={secondaryButton} pendingLabel="Requesting…">
          Request approval
        </SubmitButton>
        <StateNote state={state} />
      </div>
    </form>
  );
}

export function ApprovalDecisionForm({
  missionId,
  workspaceId,
  approval,
}: {
  missionId: string;
  workspaceId: string;
  approval: MissionApproval;
}) {
  const [state, formAction] = useActionState(decideMissionApprovalAction, idleMissionState);
  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-end gap-2 border-t border-line pt-2">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="mission_id" value={missionId} />
      <input type="hidden" name="approval_id" value={approval.id} />
      <div className="min-w-[12rem] flex-1">
        <label className={labelClass} htmlFor={`mc-approval-note-${approval.id}`}>
          Decision note
        </label>
        <input
          id={`mc-approval-note-${approval.id}`}
          name="note"
          maxLength={1000}
          className={`mt-1 ${inputClass}`}
        />
      </div>
      <button type="submit" name="decision" value="approved" className={secondaryButton}>
        Approve
      </button>
      <button type="submit" name="decision" value="rejected" className={quietButton}>
        Reject
      </button>
      <span className="text-xs">
        <StateNote state={state} />
      </span>
    </form>
  );
}
