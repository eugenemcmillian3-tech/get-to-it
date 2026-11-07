"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleFormState } from "@/lib/action-state";
import {
  addWorkspaceCommentAction,
  createWorkspaceAction,
  createWorkspaceGoalAction,
  createWorkspaceTaskAction,
  deleteWorkspaceAction,
  inviteWorkspaceMemberAction,
  leaveWorkspaceAction,
  removeWorkspaceMemberAction,
  respondToWorkspaceInvitationAction,
  setMemberRoleAction,
  setNotificationPrefsAction,
  sharePersonalGoalAction,
  updateWorkspaceSettingsAction,
  updateWorkspaceTaskAction,
} from "@/lib/actions/workspaces";
import {
  COPY_CONFIRMATION_HELP,
  COPY_CONFIRMATION_LABEL,
  NOTIFICATION_CHANNEL_NOTE,
  WORKSPACE_COMMENT_MAX,
  WORKSPACE_DESCRIPTION_MAX,
  WORKSPACE_GOAL_TITLE_MAX,
  WORKSPACE_NAME_MAX,
  WORKSPACE_TASK_TITLE_MAX,
  canAssignTask,
  sortMembers,
} from "@/lib/workspaces";
import {
  cardClass,
  dangerButton,
  focusRing,
  hintClass,
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
} from "@/lib/styles";
import { TASK_STATUSES, TASK_STATUS_LABELS, type WorkspaceMember, type WorkspaceRole, type WorkspaceTask } from "@/lib/types";

type AssigneeMember = Pick<WorkspaceMember, "user_id" | "display_name" | "status" | "role">;

function Message({ state }: { state: { status: string; message?: string } }) {
  if (!state.message) return null;
  return (
    <p
      role={state.status === "error" ? "alert" : "status"}
      aria-live="polite"
      className={state.status === "error" ? "text-sm text-danger" : "text-sm text-mint"}
    >
      {state.message}
    </p>
  );
}

export function WorkspaceCreateForm() {
  const [state, formAction] = useActionState(createWorkspaceAction, idleFormState);

  return (
    <details className={`${cardClass} group`}>
      <summary
        className={`flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg text-base font-semibold ${focusRing}`}
      >
        <span>Create a workspace</span>
        <span aria-hidden="true" className="text-xl leading-none text-muted transition group-open:rotate-45">
          +
        </span>
      </summary>

      <form action={formAction} className="mt-5 space-y-4">
        <div>
          <label className={labelClass} htmlFor="workspace-name">
            Workspace name
          </label>
          <input
            id="workspace-name"
            name="name"
            required
            maxLength={WORKSPACE_NAME_MAX}
            placeholder="e.g. The launch crew"
            className={`mt-1.5 ${inputClass}`}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="workspace-description">
            What is it for? <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id="workspace-description"
            name="description"
            rows={2}
            maxLength={WORKSPACE_DESCRIPTION_MAX}
            placeholder="A sentence the other members will see."
            className={`mt-1.5 ${inputClass}`}
          />
        </div>

        <Message state={state} />

        <SubmitButton pendingLabel="Creating…" className={primaryButton}>
          Create workspace
        </SubmitButton>
      </form>
    </details>
  );
}

export function WorkspaceSettingsForm({
  workspaceId,
  name,
  description,
}: {
  workspaceId: string;
  name: string;
  description: string | null;
}) {
  const [state, formAction] = useActionState(updateWorkspaceSettingsAction, idleFormState);

  return (
    <form action={formAction} className="mt-3 space-y-4">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <div>
        <label className={labelClass} htmlFor="settings-name">
          Name
        </label>
        <input
          id="settings-name"
          name="name"
          required
          maxLength={WORKSPACE_NAME_MAX}
          defaultValue={name}
          className={`mt-1.5 ${inputClass}`}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="settings-description">
          Description
        </label>
        <textarea
          id="settings-description"
          name="description"
          rows={2}
          maxLength={WORKSPACE_DESCRIPTION_MAX}
          defaultValue={description ?? ""}
          className={`mt-1.5 ${inputClass}`}
        />
      </div>
      <Message state={state} />
      <SubmitButton pendingLabel="Saving…" className={secondaryButton}>
        Save workspace settings
      </SubmitButton>
    </form>
  );
}

export function WorkspaceInviteForm({ workspaceId }: { workspaceId: string }) {
  const [state, formAction] = useActionState(inviteWorkspaceMemberAction, idleFormState);

  return (
    <form action={formAction} className="mt-3 space-y-3">
      <input type="hidden" name="workspace_id" value={workspaceId} />

      <div>
        <label className={labelClass} htmlFor="invite-email">
          Their email address
        </label>
        <input
          id="invite-email"
          name="invitee_email"
          type="email"
          required
          maxLength={254}
          autoComplete="off"
          placeholder="them@example.com"
          className={`mt-1.5 ${inputClass}`}
        />
        <p className={hintClass}>
          Used only to decide who may accept. We don&apos;t look up whether it has an
          account, and we never send email — you pass the link on yourself.
        </p>
      </div>

      <div>
        <label className={labelClass} htmlFor="invite-role">
          Role
        </label>
        <select id="invite-role" name="role" defaultValue="member" className={`mt-1.5 ${inputClass}`}>
          <option value="member">Member — participates in shared work</option>
          <option value="admin">Admin — manages shared goals and assignments</option>
        </select>
      </div>

      <SubmitButton pendingLabel="Creating…" className={primaryButton}>
        Create invitation link
      </SubmitButton>

      <Message state={state} />

      {state.link ? (
        <div className="rounded-xl border border-line bg-paper p-3">
          <label className={labelClass} htmlFor="invite-link">
            Invitation link
          </label>
          <input
            id="invite-link"
            readOnly
            value={state.link}
            onFocus={(event) => event.currentTarget.select()}
            className={`mt-1.5 ${inputClass} font-mono text-xs`}
          />
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Single use, expires in seven days, addressed to that email address only.
          </p>
        </div>
      ) : null}
    </form>
  );
}

export function InvitationLinkField({
  invitationId,
  link,
}: {
  invitationId: string;
  link: string;
}) {
  const inputId = `invitation-link-${invitationId}`;
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setStatus("copied");
    } catch {
      const input = document.getElementById(inputId);
      if (input instanceof HTMLInputElement) {
        input.focus();
        input.select();
      }
      setStatus("failed");
    }
  }

  return (
    <div className="mt-2">
      <label className={labelClass} htmlFor={inputId}>
        Invitation link
      </label>
      <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
        <input
          id={inputId}
          readOnly
          value={link}
          onFocus={(event) => event.currentTarget.select()}
          className={`${inputClass} font-mono text-xs`}
        />
        <button
          type="button"
          onClick={copyLink}
          className={`${secondaryButton} whitespace-nowrap`}
        >
          {status === "copied" ? "Copied" : status === "failed" ? "Select the link" : "Copy link"}
        </button>
      </div>
      {status === "failed" ? (
        <p role="alert" className="mt-1 text-xs text-danger">
          Copying was blocked. The link is selected so you can copy it manually.
        </p>
      ) : null}
    </div>
  );
}

export function InvitationResponseForm({ token }: { token: string }) {
  const [state, formAction] = useActionState(
    respondToWorkspaceInvitationAction,
    idleFormState,
  );

  return (
    <form action={formAction} className="mt-4 space-y-3">
      <input type="hidden" name="token" value={token} />
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          name="intent"
          value="accept"
          className={primaryButton}
        >
          Join this workspace
        </button>
        <button
          type="submit"
          name="intent"
          value="decline"
          className={secondaryButton}
        >
          Decline
        </button>
      </div>
      <Message state={state} />
    </form>
  );
}

export function NotificationPrefsForm({
  workspaceId,
  prefs,
}: {
  workspaceId: string;
  prefs: { notify_assignments: boolean; notify_comments: boolean; notify_membership: boolean };
}) {
  const [state, formAction] = useActionState(setNotificationPrefsAction, idleFormState);

  return (
    <form action={formAction} className="mt-3 space-y-3">
      <input type="hidden" name="workspace_id" value={workspaceId} />

      <ul className="space-y-2">
        <PrefToggle
          id="notify_assignments"
          defaultChecked={prefs.notify_assignments}
          title="Assignments"
          description="When a task is assigned to you."
        />
        <PrefToggle
          id="notify_comments"
          defaultChecked={prefs.notify_comments}
          title="Comments"
          description="When someone comments on a task you are assigned or created."
        />
        <PrefToggle
          id="notify_membership"
          defaultChecked={prefs.notify_membership}
          title="Membership and roles"
          description="When your role changes or someone joins or leaves."
        />
      </ul>

      <p className="text-xs leading-relaxed text-muted">{NOTIFICATION_CHANNEL_NOTE}</p>

      <Message state={state} />
      <SubmitButton pendingLabel="Saving…" className={secondaryButton}>
        Save notification preferences
      </SubmitButton>
    </form>
  );
}

function PrefToggle({
  id,
  defaultChecked,
  title,
  description,
}: {
  id: string;
  defaultChecked: boolean;
  title: string;
  description: string;
}) {
  return (
    <li className="rounded-xl border border-line bg-paper p-3">
      <div className="flex items-start gap-3">
        <input
          id={id}
          name={id}
          type="checkbox"
          defaultChecked={defaultChecked}
          className={`mt-0.5 size-4 shrink-0 cursor-pointer accent-[var(--color-brand)] ${focusRing}`}
        />
        <div>
          <label htmlFor={id} className="cursor-pointer text-sm font-semibold">
            {title}
          </label>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">{description}</p>
        </div>
      </div>
    </li>
  );
}

export function ShareGoalForm({ workspaceId }: { workspaceId: string }) {
  const [state, formAction] = useActionState(createWorkspaceGoalAction, idleFormState);

  return (
    <details className="mt-3 rounded-xl border border-line bg-paper p-3">
      <summary className={`cursor-pointer text-sm font-semibold ${focusRing}`}>
        Create a shared goal from scratch
      </summary>
      <form action={formAction} className="mt-3 space-y-3">
        <input type="hidden" name="workspace_id" value={workspaceId} />
        <div>
          <label className={labelClass} htmlFor="shared-goal-title">
            Goal title
          </label>
          <input
            id="shared-goal-title"
            name="title"
            required
            maxLength={WORKSPACE_GOAL_TITLE_MAX}
            placeholder="Ship the launch page"
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="shared-goal-outcome">
            Desired outcome
          </label>
          <textarea
            id="shared-goal-outcome"
            name="desired_outcome"
            required
            rows={3}
            maxLength={2000}
            placeholder="What does done look like for the team?"
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <Message state={state} />
        <SubmitButton pendingLabel="Creating…" className={secondaryButton}>
          Create shared goal
        </SubmitButton>
      </form>
    </details>
  );
}

export function CopyPersonalGoalForm({
  workspaceId,
  candidates,
}: {
  workspaceId: string;
  candidates: { id: string; title: string; desired_outcome: string }[];
}) {
  const [state, formAction] = useActionState(sharePersonalGoalAction, idleFormState);

  if (candidates.length === 0) {
    return (
      <p className="mt-3 rounded-xl border border-dashed border-line p-3 text-sm leading-relaxed text-muted">
        You have no active personal goals to copy. Nothing personal is ever added
        to a workspace unless you choose it here.
      </p>
    );
  }

  return (
    <form action={formAction} className="mt-3 space-y-3 rounded-xl border border-line bg-paper p-3">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <p className="text-sm font-semibold">Copy one of your personal goals in</p>
      <p className="text-xs leading-relaxed text-muted">
        This creates a separate workspace goal. Your personal goal stays private
        and unchanged.
      </p>

      <div>
        <label className={labelClass} htmlFor="copy-source">
          Personal goal
        </label>
        <select id="copy-source" name="goal_id" required className={`mt-1.5 ${inputClass}`}>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.title}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-start gap-3">
        <input
          id="confirm_copy"
          name="confirm_copy"
          type="checkbox"
          required
          className={`mt-0.5 size-4 shrink-0 cursor-pointer accent-[var(--color-brand)] ${focusRing}`}
        />
        <div>
          <label htmlFor="confirm_copy" className="cursor-pointer text-sm font-semibold">
            {COPY_CONFIRMATION_LABEL}
          </label>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            {COPY_CONFIRMATION_HELP}
          </p>
        </div>
      </div>

      <Message state={state} />
      <SubmitButton pendingLabel="Copying…" className={secondaryButton}>
        Copy into this workspace
      </SubmitButton>
    </form>
  );
}

export function WorkspaceTaskForm({
  workspaceId,
  goalId,
  members,
  myId,
  myRole,
}: {
  workspaceId: string;
  goalId: string;
  members: AssigneeMember[];
  myId: string;
  myRole: WorkspaceRole;
}) {
  const [state, formAction] = useActionState(createWorkspaceTaskAction, idleFormState);
  const active = sortMembers(members.filter((member) => member.status === "active"));
  const canAssignOthers = canAssignTask(myRole, myId, "someone-else");

  return (
    <form action={formAction} className="mt-3 space-y-3">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="goal_id" value={goalId} />

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div>
          <label className={labelClass} htmlFor="new-shared-task">
            New task
          </label>
          <input
            id="new-shared-task"
            name="title"
            required
            maxLength={WORKSPACE_TASK_TITLE_MAX}
            placeholder="A step someone could pick up"
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="new-shared-assignee">
            Assign to
          </label>
          <select
            id="new-shared-assignee"
            name="assignee_id"
            defaultValue=""
            className={`mt-1.5 ${inputClass}`}
          >
            <option value="">Unassigned</option>
            {active
              .filter((member) => canAssignOthers || member.user_id === myId)
              .map((member) => (
                <option key={member.user_id} value={member.user_id}>
                  {member.display_name}
                  {member.user_id === myId ? " (you)" : ""}
                </option>
              ))}
          </select>
        </div>
      </div>

      {!canAssignOthers ? (
        <p className="text-xs leading-relaxed text-muted">
          As a member you can add work and take it on yourself; an owner or admin
          assigns it to other people.
        </p>
      ) : null}

      <Message state={state} />
      <SubmitButton pendingLabel="Adding…" className={primaryButton}>
        Add task
      </SubmitButton>
    </form>
  );
}

export function WorkspaceTaskEditForm({
  workspaceId,
  goalId,
  task,
  members,
  myId,
  myRole,
  canEdit,
}: {
  workspaceId: string;
  goalId: string;
  task: WorkspaceTask;
  members: AssigneeMember[];
  myId: string;
  myRole: WorkspaceRole;
  canEdit: boolean;
}) {
  const [state, formAction] = useActionState(updateWorkspaceTaskAction, idleFormState);

  if (!canEdit) return null;

  const active = sortMembers(members.filter((member) => member.status === "active"));
  const canAssignOthers = canAssignTask(myRole, myId, "someone-else");

  return (
    <form action={formAction} className="mt-2 space-y-2 rounded-xl bg-paper p-3">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="goal_id" value={goalId} />
      <input type="hidden" name="task_id" value={task.id} />

      <div>
        <label className="sr-only" htmlFor={`task-title-${task.id}`}>
          Task name
        </label>
        <input
          id={`task-title-${task.id}`}
          name="title"
          defaultValue={task.title}
          required
          maxLength={WORKSPACE_TASK_TITLE_MAX}
          className={inputClass}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="text-xs font-semibold text-muted" htmlFor={`task-status-${task.id}`}>
            Status
          </label>
          <select
            id={`task-status-${task.id}`}
            name="status"
            defaultValue={task.status}
            className={`mt-1 ${inputClass}`}
          >
            {TASK_STATUSES.map((status) => (
              <option key={status} value={status}>
                {TASK_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold text-muted" htmlFor={`task-assignee-${task.id}`}>
            Assignee
          </label>
          <select
            id={`task-assignee-${task.id}`}
            name="assignee_id"
            defaultValue={task.assignee_id ?? ""}
            className={`mt-1 ${inputClass}`}
          >
            <option value="">Unassigned</option>
            {active
              .filter((member) => canAssignOthers || member.user_id === myId)
              .map((member) => (
                <option key={member.user_id} value={member.user_id}>
                  {member.display_name}
                  {member.user_id === myId ? " (you)" : ""}
                </option>
              ))}
          </select>
        </div>
      </div>

      <Message state={state} />
      <SubmitButton pendingLabel="Saving…" className={secondaryButton}>
        Save task
      </SubmitButton>
    </form>
  );
}

export function WorkspaceCommentForm({
  workspaceId,
  goalId,
  taskId,
}: {
  workspaceId: string;
  goalId: string;
  taskId: string;
}) {
  const [state, formAction] = useActionState(addWorkspaceCommentAction, idleFormState);

  return (
    <form action={formAction} className="mt-2 space-y-2">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="goal_id" value={goalId} />
      <input type="hidden" name="task_id" value={taskId} />
      <label className="sr-only" htmlFor={`comment-${taskId}`}>
        Comment
      </label>
      <textarea
        id={`comment-${taskId}`}
        name="body"
        rows={2}
        required
        maxLength={WORKSPACE_COMMENT_MAX}
        placeholder="A question, a decision, where you got to…"
        className={inputClass}
      />
      <Message state={state} />
      <SubmitButton pendingLabel="Posting…" className={secondaryButton}>
        Post comment
      </SubmitButton>
    </form>
  );
}

export function MemberRoleForm({
  workspaceId,
  member,
}: {
  workspaceId: string;
  member: AssigneeMember;
}) {
  const [state, formAction] = useActionState(setMemberRoleAction, idleFormState);

  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="user_id" value={member.user_id} />
      <label className="sr-only" htmlFor={`role-${member.user_id}`}>
        Role for {member.display_name}
      </label>
      <select
        id={`role-${member.user_id}`}
        name="role"
        defaultValue={member.role}
        className={`${inputClass} max-w-[10rem]`}
      >
        <option value="member">Member</option>
        <option value="admin">Admin</option>
        <option value="owner">Owner (transfers ownership)</option>
      </select>
      <button type="submit" className={secondaryButton}>
        Change role
      </button>
      <Message state={state} />
    </form>
  );
}

export function RemoveMemberForm({
  workspaceId,
  member,
}: {
  workspaceId: string;
  member: AssigneeMember;
}) {
  const [state, formAction] = useActionState(removeWorkspaceMemberAction, idleFormState);

  return (
    <details className="mt-2">
      <summary className={`cursor-pointer text-xs font-semibold text-danger ${focusRing}`}>
        Remove from workspace
      </summary>
      <form action={formAction} className="mt-2 space-y-2 rounded-xl border border-danger/30 bg-danger/5 p-3">
        <input type="hidden" name="workspace_id" value={workspaceId} />
        <input type="hidden" name="user_id" value={member.user_id} />
        <p className="text-xs leading-relaxed">
          Access is revoked on their next request. Their assignments are cleared;
          their comments and anything they created stay with the workspace.
        </p>
        <input type="hidden" name="confirm_remove" value="on" />
        <SubmitButton pendingLabel="Removing…" className={dangerButton}>
          Remove {member.display_name}
        </SubmitButton>
        <Message state={state} />
      </form>
    </details>
  );
}

export function LeaveWorkspaceForm({ workspaceId }: { workspaceId: string }) {
  const [state, formAction] = useActionState(leaveWorkspaceAction, idleFormState);

  return (
    <details className="mt-3">
      <summary className={`cursor-pointer text-sm font-semibold text-danger ${focusRing}`}>
        Leave this workspace
      </summary>
      <form action={formAction} className="mt-2 space-y-3 rounded-xl border border-danger/30 bg-danger/5 p-3">
        <input type="hidden" name="workspace_id" value={workspaceId} />
        <p className="text-xs leading-relaxed">
          You lose access immediately. Your assignments are cleared, your comments
          stay, and anything you created stays with the workspace. You can only
          come back with a new invitation.
        </p>
        <Message state={state} />
        <SubmitButton pendingLabel="Leaving…" className={dangerButton}>
          Leave workspace
        </SubmitButton>
      </form>
    </details>
  );
}

export function DeleteWorkspaceForm({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName: string;
}) {
  const [state, formAction] = useActionState(deleteWorkspaceAction, idleFormState);

  return (
    <details className="mt-3">
      <summary className={`cursor-pointer text-sm font-semibold text-danger ${focusRing}`}>
        Delete this workspace
      </summary>
      <form action={formAction} className="mt-2 space-y-3 rounded-xl border border-danger/30 bg-danger/5 p-3">
        <input type="hidden" name="workspace_id" value={workspaceId} />
        <input type="hidden" name="workspace_name" value={workspaceName} />
        <p className="text-xs leading-relaxed">
          This removes the workspace and everything shared inside it: goals, tasks,
          comments, notifications and the activity log. Nobody&apos;s personal
          records are affected.
        </p>
        <label className="block text-xs font-semibold" htmlFor="confirm-name">
          Type “{workspaceName}” to confirm
        </label>
        <input
          id="confirm-name"
          name="confirm_name"
          required
          autoComplete="off"
          className={inputClass}
        />
        <Message state={state} />
        <SubmitButton pendingLabel="Deleting…" className={dangerButton}>
          Delete workspace
        </SubmitButton>
      </form>
    </details>
  );
}
