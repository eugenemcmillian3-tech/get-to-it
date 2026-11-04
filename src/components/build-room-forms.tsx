"use client";

import { useEffect } from "react";
import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleBuildState, type BuildState } from "@/lib/action-state";
import {
  addCommentAction,
  addMemberAction,
  agentChangesetAction,
  cancelBuildTaskAction,
  cancelChangesetAction,
  createBuildTaskAction,
  createChangesetAction,
  createShareAction,
  heartbeatAction,
  linkWorkspaceAction,
  mergeChangesetAction,
  rebaseChangesetAction,
  removeMemberAction,
  reviewChangesetAction,
  runChangesetChecksAction,
  submitChangesetAction,
} from "@/lib/actions/build-room";
import type { BuildRoomChangeset, BuildRoomData, BuildRoomMember, BuildRoomTask } from "@/lib/build-room";
import type { MyWorkspace } from "@/lib/data/workspaces";
import {
  cardClass,
  dangerButton,
  hintClass,
  inputClass,
  labelClass,
  primaryButton,
  quietButton,
  secondaryButton,
} from "@/lib/styles";

function StateNote({ state, idle }: { state: BuildState; idle?: string }) {
  if (state.status === "error") return <span className="text-danger" role="alert">{state.message}</span>;
  if (state.status === "success") {
    return (
      <span className="text-mint">
        {state.message}
        {state.link ? <> <a className="underline" href={state.link}>Open share link</a></> : null}
      </span>
    );
  }
  return idle ? <span className="text-muted">{idle}</span> : null;
}

export function PresenceHeartbeat({ projectId }: { projectId: string }) {
  useEffect(() => {
    void heartbeatAction(projectId);
    const timer = window.setInterval(() => void heartbeatAction(projectId), 45_000);
    return () => window.clearInterval(timer);
  }, [projectId]);
  return null;
}

export function LinkWorkspaceForm({
  projectId,
  currentWorkspaceId,
  workspaces,
}: {
  projectId: string;
  currentWorkspaceId: string | null;
  workspaces: MyWorkspace[];
}) {
  const [state, formAction] = useActionState(linkWorkspaceAction, idleBuildState);
  return (
    <form action={formAction} className={cardClass}>
      <h3 className="text-base font-bold">Link a team workspace</h3>
      <p className="mt-1 text-sm text-muted">
        Workspace owners and admins become maintainers; workspace members become contributors. Explicit
        reviewer and viewer grants remain separate.
      </p>
      <input type="hidden" name="project_id" value={projectId} />
      <label className={`${labelClass} mt-3`} htmlFor="room-workspace">Workspace</label>
      <select id="room-workspace" name="workspace_id" defaultValue={currentWorkspaceId ?? ""} className={`mt-1.5 ${inputClass}`} required>
        <option value="" disabled>Choose a workspace</option>
        {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
      </select>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <SubmitButton className={secondaryButton} pendingLabel="Linking…">Link workspace</SubmitButton>
        <p className="text-sm"><StateNote state={state} /></p>
      </div>
    </form>
  );
}

export function AddMemberForm({
  projectId,
  members,
}: {
  projectId: string;
  members: BuildRoomMember[];
}) {
  const [state, formAction] = useActionState(addMemberAction, idleBuildState);
  return (
    <form action={formAction} className={cardClass}>
      <h3 className="text-base font-bold">Grant explicit project access</h3>
      <p className="mt-1 text-sm text-muted">
        External reviewers only receive what is granted here. A removed member loses project access even
        if they remain in the linked workspace.
      </p>
      <input type="hidden" name="project_id" value={projectId} />
      <label className={`${labelClass} mt-3`} htmlFor="room-member">Workspace member</label>
      <input
        id="room-member"
        name="user_id"
        list="room-member-list"
        className={`mt-1.5 ${inputClass}`}
        placeholder="Choose a member or paste their user ID"
        required
      />
      <datalist id="room-member-list">
        {members.filter((member) => member.status === "active").map((member) => (
          <option key={member.user_id} value={member.user_id}>{member.display_name}</option>
        ))}
      </datalist>
      <p className={hintClass}>Only a user ID that already belongs to an account can be granted access.</p>
      <label className={`${labelClass} mt-3`} htmlFor="room-member-role">Project role</label>
      <select id="room-member-role" name="role" className={`mt-1.5 ${inputClass}`} defaultValue="contributor">
        <option value="contributor">Contributor</option>
        <option value="reviewer">Reviewer</option>
        <option value="viewer">Viewer</option>
        <option value="maintainer">Maintainer</option>
      </select>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <SubmitButton className={secondaryButton} pendingLabel="Granting…">Grant access</SubmitButton>
        <p className="text-sm"><StateNote state={state} /></p>
      </div>
    </form>
  );
}

export function RemoveMemberForm({ projectId, member }: { projectId: string; member: BuildRoomMember }) {
  const [state, formAction] = useActionState(removeMemberAction, idleBuildState);
  if (member.role === "owner") return null;
  return (
    <form action={formAction} className="mt-2">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="user_id" value={member.user_id} />
      <button type="submit" className={quietButton} aria-label={`Remove ${member.display_name}`}>Remove access</button>
      {state.status === "error" ? <p className="text-xs text-danger" role="alert">{state.message}</p> : null}
    </form>
  );
}

export function CreateTaskForm({ projectId, members, files }: { projectId: string; members: BuildRoomMember[]; files: BuildRoomData["files"] }) {
  const [state, formAction] = useActionState(createBuildTaskAction, idleBuildState);
  return (
    <form action={formAction} className={cardClass}>
      <h3 className="text-base font-bold">Add a shared task</h3>
      <p className="mt-1 text-sm text-muted">
        Humans and agent roles use one board. Agent scope is limited to existing files, so a job cannot
        silently add a page or feature.
      </p>
      <input type="hidden" name="project_id" value={projectId} />
      <label className={`${labelClass} mt-3`} htmlFor="task-title">Title</label>
      <input id="task-title" name="title" maxLength={200} className={`mt-1.5 ${inputClass}`} required />
      <label className={`${labelClass} mt-3`} htmlFor="task-description">Description</label>
      <textarea id="task-description" name="description" rows={3} maxLength={2000} className={`mt-1.5 ${inputClass}`} />
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="task-kind">Assignee kind</label>
          <select id="task-kind" name="assignee_kind" className={`mt-1.5 ${inputClass}`} defaultValue="human">
            <option value="human">Human</option>
            <option value="agent">Agent</option>
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="task-agent-role">Agent role (if agent)</label>
          <select id="task-agent-role" name="agent_role" className={`mt-1.5 ${inputClass}`} defaultValue="frontend">
            <option value="coordinator">Coordinator</option>
            <option value="frontend">Frontend</option>
            <option value="backend">Backend</option>
            <option value="data">Data</option>
            <option value="qa">QA</option>
            <option value="security">Security reviewer</option>
          </select>
        </div>
      </div>
      <label className={`${labelClass} mt-3`} htmlFor="task-assignee">Human assignee</label>
      <select id="task-assignee" name="assignee_id" className={`mt-1.5 ${inputClass}`}>
        <option value="">Unassigned</option>
        {members.filter((member) => member.status === "active").map((member) => (
          <option key={member.user_id} value={member.user_id}>{member.display_name}</option>
        ))}
      </select>
      <fieldset className="mt-3">
        <legend className={labelClass}>Scope (existing files only)</legend>
        <div className="mt-1 max-h-32 space-y-1 overflow-auto rounded-lg border border-line p-2 text-sm">
          {files.map((file) => (
            <label key={file.path} className="flex gap-2">
              <input type="checkbox" name="scope_paths" value={file.path} />
              <span className="font-mono text-xs">{file.path}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <SubmitButton className={secondaryButton} pendingLabel="Adding…">Add task</SubmitButton>
        <p className="text-sm"><StateNote state={state} /></p>
      </div>
    </form>
  );
}

export function CancelTaskForm({ projectId, task }: { projectId: string; task: BuildRoomTask }) {
  const [state, formAction] = useActionState(cancelBuildTaskAction, idleBuildState);
  if (["done", "cancelled"].includes(task.status)) return null;
  return (
    <form action={formAction} className="mt-2">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="task_id" value={task.id} />
      <button type="submit" className={quietButton}>Cancel queued work</button>
      {state.status === "error" ? <p className="text-xs text-danger" role="alert">{state.message}</p> : null}
    </form>
  );
}

export function CreateChangesetForm({ projectId, files }: { projectId: string; files: BuildRoomData["files"] }) {
  const [state, formAction] = useActionState(createChangesetAction, idleBuildState);
  const first = files[0];
  return (
    <form action={formAction} className={cardClass}>
      <h3 className="text-base font-bold">Start an isolated changeset</h3>
      <p className="mt-1 text-sm text-muted">
        Nothing here reaches the working tree until integration checks pass, a different human approves,
        and a maintainer merges it.
      </p>
      <input type="hidden" name="project_id" value={projectId} />
      <label className={`${labelClass} mt-3`} htmlFor="changeset-title">Title</label>
      <input id="changeset-title" name="title" maxLength={200} className={`mt-1.5 ${inputClass}`} placeholder="Improve the empty state" required />
      <label className={`${labelClass} mt-3`} htmlFor="changeset-description">Description</label>
      <textarea id="changeset-description" name="description" rows={2} maxLength={2000} className={`mt-1.5 ${inputClass}`} />
      <label className={`${labelClass} mt-3`} htmlFor="changeset-path">File path</label>
      <input id="changeset-path" name="path" list="changeset-files" defaultValue={first?.path ?? ""} maxLength={160} className={`mt-1.5 ${inputClass}`} required />
      <datalist id="changeset-files">
        {files.map((file) => <option key={file.path} value={file.path} />)}
      </datalist>
      <label className={`${labelClass} mt-3`} htmlFor="changeset-content">Proposed content</label>
      <textarea id="changeset-content" name="content" rows={10} defaultValue={first?.content ?? ""} className={`mt-1.5 font-mono text-sm ${inputClass}`} required />
      <p className={hintClass}>The changeset stores this path and its own base snapshot. Nothing is executed.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <SubmitButton className={primaryButton} pendingLabel="Creating…">Create changeset</SubmitButton>
        <p className="text-sm"><StateNote state={state} /></p>
      </div>
    </form>
  );
}

export function ChangesetActions({
  projectId,
  changeset,
  role,
  userId,
}: {
  projectId: string;
  changeset: BuildRoomChangeset;
  role: string;
  userId: string;
}) {
  const [submitState, submitAction] = useActionState(submitChangesetAction, idleBuildState);
  const [checkState, checkAction] = useActionState(runChangesetChecksAction, idleBuildState);
  const [reviewState, reviewAction] = useActionState(reviewChangesetAction, idleBuildState);
  const [mergeState, mergeAction] = useActionState(mergeChangesetAction, idleBuildState);
  const [rebaseState, rebaseAction] = useActionState(rebaseChangesetAction, idleBuildState);
  const [cancelState, cancelAction] = useActionState(cancelChangesetAction, idleBuildState);
  const canReview = ["owner", "maintainer", "reviewer"].includes(role) && changeset.author_id !== userId;
  const canMerge = ["owner", "maintainer"].includes(role);
  const canEdit = changeset.author_id === userId || ["owner", "maintainer"].includes(role);

  return (
    <div className="mt-3 space-y-2 border-t border-line pt-3">
      {["draft", "conflict"].includes(changeset.status) && canEdit ? (
        <form action={submitAction}>
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="changeset_id" value={changeset.id} />
          <button type="submit" className={secondaryButton}>Submit for review</button>
          <span className="ml-2 text-xs"><StateNote state={submitState} /></span>
        </form>
      ) : null}
      {canEdit && !["merged", "cancelled"].includes(changeset.status) ? (
        <form action={checkAction}>
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="changeset_id" value={changeset.id} />
          <button type="submit" className={secondaryButton}>Run integration checks</button>
          <span className="ml-2 text-xs"><StateNote state={checkState} /></span>
        </form>
      ) : null}
      {canReview && changeset.status === "in_review" ? (
        <form action={reviewAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="changeset_id" value={changeset.id} />
          <div className="min-w-48 flex-1">
            <label className="text-xs font-semibold" htmlFor={`review-note-${changeset.id}`}>Review note</label>
            <input id={`review-note-${changeset.id}`} name="note" maxLength={2000} className={`mt-1 ${inputClass}`} />
          </div>
          <button type="submit" name="decision" value="approve" className={primaryButton}>Approve</button>
          <button type="submit" name="decision" value="request_changes" className={secondaryButton}>Request changes</button>
          <span className="text-xs"><StateNote state={reviewState} /></span>
        </form>
      ) : null}
      {canMerge && changeset.status === "approved" ? (
        <form action={mergeAction}>
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="changeset_id" value={changeset.id} />
          <button type="submit" className={primaryButton}>Merge tested changeset</button>
          <span className="ml-2 text-xs"><StateNote state={mergeState} /></span>
        </form>
      ) : null}
      {changeset.status === "conflict" && canEdit ? (
        <form action={rebaseAction}>
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="changeset_id" value={changeset.id} />
          <button type="submit" className={secondaryButton}>Rebase onto current files</button>
          <span className="ml-2 text-xs"><StateNote state={rebaseState} /></span>
        </form>
      ) : null}
      {canEdit && !["merged", "cancelled"].includes(changeset.status) ? (
        <form action={cancelAction}>
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="changeset_id" value={changeset.id} />
          <button type="submit" className={dangerButton}>Cancel changeset</button>
          <span className="ml-2 text-xs"><StateNote state={cancelState} /></span>
        </form>
      ) : null}
    </div>
  );
}

export function ImportAgentChangesetForm({ projectId, task }: { projectId: string; task: { id: string; objective: string } }) {
  const [state, formAction] = useActionState(agentChangesetAction, idleBuildState);
  return (
    <form action={formAction} className="mt-2">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="task_id" value={task.id} />
      <button type="submit" className={quietButton} aria-label={`Import agent output: ${task.objective}`}>
        Import as agent changeset
      </button>
      {state.status === "error" ? <p className="text-xs text-danger" role="alert">{state.message}</p> : null}
      {state.status === "success" ? <p className="text-xs text-mint">{state.message}</p> : null}
    </form>
  );
}

export function CommentForm({ projectId, changesetId, filePath }: { projectId: string; changesetId?: string; filePath?: string }) {
  const [state, formAction] = useActionState(addCommentAction, idleBuildState);
  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-end gap-2">
      <input type="hidden" name="project_id" value={projectId} />
      {changesetId ? <input type="hidden" name="changeset_id" value={changesetId} /> : null}
      {filePath ? <input type="hidden" name="file_path" value={filePath} /> : null}
      <div className="min-w-48 flex-1">
        <label className="sr-only" htmlFor={`comment-${changesetId ?? "project"}-${filePath ?? "general"}`}>Comment</label>
        <input
          id={`comment-${changesetId ?? "project"}-${filePath ?? "general"}`}
          name="body"
          maxLength={2000}
          placeholder={filePath ? `Comment on ${filePath}` : "Add a comment"}
          className={inputClass}
        />
      </div>
      <SubmitButton className={secondaryButton} pendingLabel="Saving…">Comment</SubmitButton>
      <span className="text-xs"><StateNote state={state} /></span>
    </form>
  );
}

export function ShareForm({ projectId }: { projectId: string }) {
  const [state, formAction] = useActionState(createShareAction, idleBuildState);
  return (
    <form action={formAction} className={cardClass}>
      <h3 className="text-base font-bold">Create an expiring preview brief</h3>
      <p className="mt-1 text-sm text-muted">
        The link shows the approved specification and project purpose only. It never includes files,
        comments, credentials, environment values or provider tokens.
      </p>
      <input type="hidden" name="project_id" value={projectId} />
      <label className={`${labelClass} mt-3`} htmlFor="share-hours">Lifetime (hours)</label>
      <input id="share-hours" name="hours" type="number" min={1} max={168} defaultValue={24} className={`mt-1.5 ${inputClass}`} required />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <SubmitButton className={secondaryButton} pendingLabel="Creating…">Create share link</SubmitButton>
        <p className="text-sm"><StateNote state={state} /></p>
      </div>
    </form>
  );
}
