"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleBuildState, type BuildState } from "@/lib/action-state";
import {
  advanceTeamAction,
  approveTeamTaskAction,
  cancelTeamAction,
  integrateTeamAction,
  pauseTeamAction,
  reassignTeamTaskAction,
  rejectTeamTaskAction,
  resolveTeamClaimAction,
  resumeTeamAction,
  startTeamAction,
} from "@/lib/actions/app-team";
import type { TeamTaskRecord } from "@/lib/agent-team";
import { dangerButton, primaryButton, secondaryButton } from "@/lib/styles";

function Note({ state, idle }: { state: BuildState; idle?: string }) {
  if (state.status === "error") {
    return (
      <span className="text-danger" role="alert">
        {state.message}
      </span>
    );
  }
  if (state.status === "success") {
    return <span className="text-mint">{state.message}</span>;
  }
  return idle ? <span className="text-muted">{idle}</span> : null;
}

export function StartTeamForm({ projectId }: { projectId: string }) {
  const [state, formAction] = useActionState(startTeamAction, idleBuildState);
  return (
    <form action={formAction}>
      <input type="hidden" name="project_id" value={projectId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm font-medium">
          Maximum agents per advance
          <select
            name="max_agents"
            defaultValue="2"
            className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2"
          >
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
          </select>
        </label>
        <label className="block text-sm font-medium">
          Maximum AI calls
          <input
            type="number"
            name="max_calls"
            min={0}
            max={24}
            defaultValue={0}
            className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2"
          />
        </label>
        <label className="block text-sm font-medium">
          Maximum runtime (seconds)
          <input
            type="number"
            name="max_runtime_seconds"
            min={60}
            max={1800}
            step={30}
            defaultValue={600}
            className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2"
          />
        </label>
      </div>
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input type="checkbox" name="conflict_fixture" className="mt-1" />
        <span>
          Use the controlled conflict fixture: two agents claim the same file, so
          the queue must report a blocker and wait for an explicit resolution.
        </span>
      </label>
      <div className="mt-4">
        <SubmitButton className={primaryButton} pendingLabel="Building the queue…">
          Start controlled team run
        </SubmitButton>
      </div>
      <p className="mt-2 text-sm">
        <Note
          state={state}
          idle="Fixture workers only. No paid model calls, no deployment, no external actions."
        />
      </p>
    </form>
  );
}

export function AdvanceTeamForm({ projectId }: { projectId: string }) {
  const [state, formAction] = useActionState(advanceTeamAction, idleBuildState);
  return (
    <form action={formAction}>
      <input type="hidden" name="project_id" value={projectId} />
      <SubmitButton className={primaryButton} pendingLabel="Advancing bounded tasks…">
        Run next bounded task(s)
      </SubmitButton>
      <p className="mt-2 text-sm">
        <Note state={state} idle="Starts at most the configured number of queued tasks, then stops." />
      </p>
    </form>
  );
}

export function IntegrateTeamForm({
  projectId,
  disabled,
}: {
  projectId: string;
  disabled: boolean;
}) {
  const [state, formAction] = useActionState(integrateTeamAction, idleBuildState);
  return (
    <form action={formAction}>
      <input type="hidden" name="project_id" value={projectId} />
      <SubmitButton className={secondaryButton} pendingLabel="Integrating and checking…" disabled={disabled}>
        Integrate completed branches
      </SubmitButton>
      <p className="mt-2 text-sm">
        <Note
          state={state}
          idle="Applies all completed branches in one controlled step, snapshots a new version, then runs the sandbox checks."
        />
      </p>
    </form>
  );
}

export function RunControlForms({ projectId, status }: { projectId: string; status: string }) {
  const [pauseState, pauseAction] = useActionState(pauseTeamAction, idleBuildState);
  const [resumeState, resumeAction] = useActionState(resumeTeamAction, idleBuildState);
  const [cancelState, cancelAction] = useActionState(cancelTeamAction, idleBuildState);

  return (
    <div className="flex flex-wrap items-start gap-3">
      {status === "paused" ? (
        <form action={resumeAction}>
          <input type="hidden" name="project_id" value={projectId} />
          <SubmitButton className={primaryButton} pendingLabel="Resuming…">Resume run</SubmitButton>
          <p className="mt-2 text-sm"><Note state={resumeState} /></p>
        </form>
      ) : (
        <form action={pauseAction}>
          <input type="hidden" name="project_id" value={projectId} />
          <SubmitButton className={secondaryButton} pendingLabel="Pausing…">Pause run</SubmitButton>
          <p className="mt-2 text-sm"><Note state={pauseState} /></p>
        </form>
      )}
      <form action={cancelAction}>
        <input type="hidden" name="project_id" value={projectId} />
        <SubmitButton className={dangerButton} pendingLabel="Cancelling…">Cancel run and active tasks</SubmitButton>
        <p className="mt-2 text-sm"><Note state={cancelState} /></p>
      </form>
    </div>
  );
}

export function TaskReviewForm({
  projectId,
  task,
  canReassign,
}: {
  projectId: string;
  task: TeamTaskRecord;
  canReassign: boolean;
}) {
  const [approveState, approveAction] = useActionState(approveTeamTaskAction, idleBuildState);
  const [rejectState, rejectAction] = useActionState(rejectTeamTaskAction, idleBuildState);
  const [reassignState, reassignAction] = useActionState(reassignTeamTaskAction, idleBuildState);
  const [resolveState, resolveAction] = useActionState(resolveTeamClaimAction, idleBuildState);

  return (
    <div className="mt-3 space-y-3 border-t border-line pt-3">
      <div className="flex flex-wrap items-start gap-3">
        {task.status === "awaiting_review" ? (
          <form action={approveAction}>
            <input type="hidden" name="project_id" value={projectId} />
            <input type="hidden" name="task_id" value={task.id} />
            <SubmitButton className={primaryButton} pendingLabel="Approving…">Approve output</SubmitButton>
            <p className="mt-1 text-xs"><Note state={approveState} /></p>
          </form>
        ) : null}
        {["blocked", "awaiting_review", "completed"].includes(task.status) ? (
          <form action={rejectAction}>
            <input type="hidden" name="project_id" value={projectId} />
            <input type="hidden" name="task_id" value={task.id} />
            <SubmitButton className={dangerButton} pendingLabel="Rejecting…">Reject branch</SubmitButton>
            <p className="mt-1 text-xs"><Note state={rejectState} /></p>
          </form>
        ) : null}
        {task.status === "blocked" ? (
          <form action={resolveAction}>
            <input type="hidden" name="project_id" value={projectId} />
            <input type="hidden" name="task_id" value={task.id} />
            <SubmitButton className={secondaryButton} pendingLabel="Resolving…">
              Resolve overlap: cancel this branch
            </SubmitButton>
            <p className="mt-1 text-xs"><Note state={resolveState} /></p>
          </form>
        ) : null}
      </div>

      {canReassign && ["queued", "blocked"].includes(task.status) ? (
        <form action={reassignAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="task_id" value={task.id} />
          <label className="text-xs font-medium">
            Reassign to
            <select
              name="role"
              defaultValue={task.role}
              className="mt-1 rounded-lg border border-line bg-paper px-2 py-1 text-sm"
            >
              {[
                ["coordinator", "Coordinator"],
                ["frontend", "Frontend agent"],
                ["backend", "Backend agent"],
                ["data", "Data agent"],
                ["qa", "QA agent"],
                ["security", "Security reviewer"],
              ].map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <SubmitButton className={secondaryButton} pendingLabel="Reassigning…">Reassign</SubmitButton>
          <p className="text-xs"><Note state={reassignState} /></p>
        </form>
      ) : null}
    </div>
  );
}
