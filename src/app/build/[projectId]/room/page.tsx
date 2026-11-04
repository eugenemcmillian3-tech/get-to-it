import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import {
  AddMemberForm,
  CancelTaskForm,
  ChangesetActions,
  CommentForm,
  CreateChangesetForm,
  CreateTaskForm,
  ImportAgentChangesetForm,
  LinkWorkspaceForm,
  PresenceHeartbeat,
  RemoveMemberForm,
  ShareForm,
} from "@/components/build-room-forms";
import {
  BUILD_ROLE_LABELS,
  BUILD_ROLE_NOTES,
  changesetIsStale,
  roleFromWorkspace,
  roleLabel,
  taskStatusLabel,
  type BuildRoomAgentTask,
  type BuildRoomChangeset,
  type BuildRoomComment,
  type BuildRoomTask,
} from "@/lib/build-room";
import { requireSession } from "@/lib/auth";
import { getBuildRoom, listBuildRoomWorkspaces } from "@/lib/data/build-room";
import { getIdentity } from "@/lib/identity";
import { cardClass, chipClass, focusRing, secondaryButton } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { isUuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Build Room — GET TO IT" };

function when(value: string | null): string {
  return value ? value.slice(0, 16).replace("T", " ") : "—";
}

function StatusChip({ children }: { children: React.ReactNode }) {
  return <span className={chipClass}>{children}</span>;
}

function CommentList({ comments, names }: { comments: BuildRoomComment[]; names: Map<string, string> }) {
  if (comments.length === 0) return <p className="mt-2 text-sm text-muted">No comments yet.</p>;
  return (
    <ul className="mt-2 space-y-2">
      {comments.map((comment) => (
        <li key={comment.id} className="rounded-lg border border-line bg-paper p-3 text-sm">
          <p className="text-xs text-muted">
            {names.get(comment.author_id) ?? "A project member"} · {when(comment.created_at)}
            {comment.file_path ? <span className="font-mono"> · {comment.file_path}</span> : null}
          </p>
          <p className="mt-1 whitespace-pre-wrap">{comment.body}</p>
        </li>
      ))}
    </ul>
  );
}

function ChangesetCard({
  projectId,
  changeset,
  role,
  userId,
  comments,
  names,
  reviewNote,
}: {
  projectId: string;
  changeset: BuildRoomChangeset;
  role: string;
  userId: string;
  comments: BuildRoomComment[];
  names: Map<string, string>;
  reviewNote?: string;
}) {
  const stale = changesetIsStale(changeset);
  return (
    <li className={cardClass}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Changeset · base version {changeset.base_version} · author {changeset.author_kind}
            {changeset.agent_role ? ` (${changeset.agent_role})` : ""}
          </p>
          <h3 className="mt-1 text-base font-bold">{changeset.title}</h3>
          <p className="text-xs text-muted">
            {names.get(changeset.author_id) ?? "Project member"} · {when(changeset.created_at)}
          </p>
        </div>
        <StatusChip>{changeset.status.replace(/_/g, " ")}</StatusChip>
      </div>
      {changeset.description ? <p className="mt-2 text-sm text-muted">{changeset.description}</p> : null}
      <p className="mt-2 break-words font-mono text-xs text-muted">
        Files: {changeset.files.map((file) => file.path).join(", ")}
      </p>
      {stale ? (
        <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900" role="status">
          The reviewed content changed. The old approval is stale; a fresh review is required.
        </p>
      ) : null}
      {changeset.conflict_files.length > 0 ? (
        <p className="mt-2 rounded-lg border border-danger/40 bg-danger/5 p-2 text-sm text-danger" role="alert">
          Conflict on {changeset.conflict_files.join(", ")}. Rebase and review again.
        </p>
      ) : null}
      {changeset.status === "in_review" ? (
        <p className="mt-2 text-sm text-muted">Review requested · waiting for a different human reviewer.</p>
      ) : null}
      {reviewNote ? <p className="mt-2 text-sm text-muted">Latest review: {reviewNote}</p> : null}
      {changeset.checks.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs">
          {changeset.checks.map((check) => (
            <li key={check.name} className={check.status === "passed" ? "text-mint" : "text-danger"}>
              {check.label}: {check.status}. {check.log}
            </li>
          ))}
        </ul>
      ) : null}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-medium">Show code diff</summary>
        <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-paper p-2 font-mono text-[11px]">
          {changeset.diff || "No diff recorded."}
        </pre>
      </details>
      <ChangesetActions projectId={projectId} changeset={changeset} role={role} userId={userId} />
      <CommentForm projectId={projectId} changesetId={changeset.id} />
      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-medium">Comment on a changed file</summary>
        <div className="mt-1 space-y-2">
          {changeset.files.map((file) => (
            <CommentForm key={file.path} projectId={projectId} changesetId={changeset.id} filePath={file.path} />
          ))}
        </div>
      </details>
      <CommentList comments={comments} names={names} />
    </li>
  );
}

function HumanTask({ projectId, task, names }: { projectId: string; task: BuildRoomTask; names: Map<string, string> }) {
  return (
    <li className="rounded-lg border border-line bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs text-muted">
            {task.assignee_kind === "agent" ? `Agent · ${task.agent_role ?? "unassigned"}` : `Human · ${task.assignee_id ? names.get(task.assignee_id) ?? "member" : "unassigned"}`}
          </p>
          <p className="mt-1 text-sm font-semibold">{task.title}</p>
          {task.description ? <p className="mt-1 text-xs text-muted">{task.description}</p> : null}
        </div>
        <StatusChip>{taskStatusLabel(task.status)}</StatusChip>
      </div>
      {task.scope_paths.length > 0 ? (
        <p className="mt-1 break-words font-mono text-xs text-muted">Scope: {task.scope_paths.join(", ")}</p>
      ) : null}
      <CancelTaskForm projectId={projectId} task={task} />
    </li>
  );
}

function AgentTask({ projectId, task, canImport }: { projectId: string; task: BuildRoomAgentTask; canImport: boolean }) {
  return (
    <li className="rounded-lg border border-line bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs text-muted">Agent task · {task.role}</p>
          <p className="mt-1 text-sm font-semibold">{task.objective}</p>
          {task.changed_files.length > 0 ? (
            <p className="mt-1 break-words font-mono text-xs text-muted">{task.changed_files.join(", ")}</p>
          ) : null}
        </div>
        <StatusChip>{task.status}</StatusChip>
      </div>
      {canImport && ["completed", "awaiting_review"].includes(task.status) ? (
        <ImportAgentChangesetForm projectId={projectId} task={task} />
      ) : null}
    </li>
  );
}

export default async function BuildRoomPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) notFound();

  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <p className="text-sm text-muted">Sign-in is not configured in this build.</p>
      </main>
    );
  }

  const session = await requireSession();
  const [identity, room, workspaces] = await Promise.all([
    getIdentity(session),
    getBuildRoom(session, projectId),
    listBuildRoomWorkspaces(session),
  ]);
  if (!room) notFound();

  const names = new Map(room.members.map((member) => [member.user_id, member.display_name]));
  for (const member of room.workspaceMembers) {
    if (!names.has(member.user_id)) names.set(member.user_id, member.display_name);
  }
  const canManage = room.permissions.canManageMembers;
  const latestReview = (id: string) => room.reviews.find((review) => review.changeset_id === id);
  const commentsFor = (id: string) => room.comments.filter((comment) => comment.changeset_id === id);
  const generalComments = room.comments.filter((comment) => comment.changeset_id === null);
  const openChangesets = room.changesets.filter((changeset) => !["merged", "cancelled"].includes(changeset.status));
  const closedChangesets = room.changesets.filter((changeset) => ["merged", "cancelled"].includes(changeset.status));
  const agentTasks = room.agentTasks;
  const tasks = room.tasks;

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />
      <PresenceHeartbeat projectId={room.project.id} />
      <main className="mx-auto w-full max-w-6xl px-5 pb-16 pt-6">
        <Link
          href={`/build/${room.project.id}`}
          className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          ← Back to {room.project.name}
        </Link>

        <header className="mt-4">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted">Project Build Room</p>
          <h1 className="mt-1 text-3xl font-black leading-tight tracking-tight sm:text-4xl">{room.project.name}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
            Asynchronous collaboration over the real project: approved specification, task board, isolated
            changesets, review requests, bounded comments, preview and deployment history. There is no
            simultaneous code editing.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <StatusChip>You are {BUILD_ROLE_LABELS[room.role]}</StatusChip>
            <StatusChip>Version {room.project.current_version || "none"}</StatusChip>
            <StatusChip>{room.workspace?.status ?? "No preview workspace"}</StatusChip>
            <StatusChip>{room.presence.length} active presence</StatusChip>
            {room.approvedSpec ? <StatusChip>Spec version {room.approvedSpec.version}</StatusChip> : <StatusChip>Spec not approved</StatusChip>}
          </div>
          <p className="mt-2 text-xs text-muted">{BUILD_ROLE_NOTES[room.role]}</p>
        </header>

        <div className="mt-6 grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          <section aria-labelledby="approved-heading" className={cardClass}>
            <h2 id="approved-heading" className="text-lg font-bold">Approved specification</h2>
            {room.approvedSpec ? (
              <>
                <p className="mt-1 text-sm text-muted">{room.approvedSpec.spec.purpose}</p>
                <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <h3 className="font-semibold">Routes</h3>
                    <ul className="mt-1 space-y-1 text-muted">
                      {room.approvedSpec.spec.pages.map((page) => <li key={page.path}><code className="text-xs">{page.path}</code> {page.title}</li>)}
                    </ul>
                  </div>
                  <div>
                    <h3 className="font-semibold">Data and auth</h3>
                    <ul className="mt-1 space-y-1 text-muted">
                      {room.approvedSpec.spec.entities.map((entity) => <li key={entity.name}><code className="text-xs">{entity.name}</code>: {entity.fields.join(", ")}</li>)}
                      <li>Auth: {room.approvedSpec.spec.supabase ? "Supabase accounts" : "none"}</li>
                    </ul>
                  </div>
                </div>
              </>
            ) : (
              <p className="mt-2 text-sm text-muted">Approve a specification before collaborative changes can be reviewed.</p>
            )}
          </section>

          <section aria-labelledby="preview-heading" className={cardClass}>
            <h2 id="preview-heading" className="text-lg font-bold">Current preview</h2>
            {room.workspace ? (
              <>
                <p className="mt-1 text-sm text-muted">Status: {room.workspace.status}. Expires: {when(room.workspace.expires_at)}.</p>
                {room.workspace.last_error ? <p className="mt-1 text-sm text-danger">{room.workspace.last_error}</p> : null}
              </>
            ) : <p className="mt-1 text-sm text-muted">No isolated preview workspace exists yet.</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href={`/build/${room.project.id}/workspace`} className={secondaryButton}>Open preview workspace</Link>
              <Link href={`/build/${room.project.id}/deploy`} className={secondaryButton}>Deployment history</Link>
            </div>
            <p className="mt-2 text-xs text-muted">Visual browser verification is pending when no browser tooling is available.</p>
          </section>
        </div>

        <section aria-labelledby="members-heading" className="mt-8">
          <h2 id="members-heading" className="text-xl font-bold">People and roles</h2>
          <p className="mt-1 text-sm text-muted">
            Owner, maintainer, contributor, reviewer and viewer. Workspace roles map in; explicit grants
            cover reviewers and viewers. Removing a member revokes project access immediately.
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {room.members.map((member) => (
              <li key={member.user_id} className="rounded-lg border border-line bg-card p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{member.display_name}</span>
                  <span className={chipClass}>{roleLabel(member.role)}</span>
                </div>
                <p className="mt-1 text-xs text-muted">{member.status === "active" ? "Active" : "Access removed"}</p>
                {canManage && member.status === "active" ? <RemoveMemberForm projectId={room.project.id} member={member} /> : null}
              </li>
            ))}
          </ul>
          {canManage ? (
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              <LinkWorkspaceForm projectId={room.project.id} currentWorkspaceId={room.project.workspace_id} workspaces={workspaces} />
              <AddMemberForm
                projectId={room.project.id}
                members={room.workspaceMembers.map((member) => ({
                  user_id: member.user_id,
                  display_name: member.display_name,
                  role: roleFromWorkspace(member.role as "owner" | "admin" | "member"),
                  status: "active" as const,
                }))}
              />
            </div>
          ) : null}
        </section>

        <section aria-labelledby="board-heading" className="mt-8">
          <h2 id="board-heading" className="text-xl font-bold">Shared task board</h2>
          <p className="mt-1 text-sm text-muted">Human assignments and agent assignments share one board. Cancelling a task stops its remaining queued work.</p>
          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="text-sm font-bold">Human and planned work</h3>
              {tasks.length === 0 ? <p className="mt-2 text-sm text-muted">No tasks yet.</p> : (
                <ul className="mt-2 space-y-2">{tasks.map((task) => <HumanTask key={task.id} projectId={room.project.id} task={task} names={names} />)}</ul>
              )}
            </div>
            <div>
              <h3 className="text-sm font-bold">Agent team branches</h3>
              {agentTasks.length === 0 ? <p className="mt-2 text-sm text-muted">No agent tasks yet.</p> : (
                <ul className="mt-2 space-y-2">{agentTasks.map((task) => <AgentTask key={task.id} projectId={room.project.id} task={task} canImport={room.permissions.canMerge} />)}</ul>
              )}
            </div>
          </div>
          {room.permissions.canCreateChanges ? <div className="mt-4"><CreateTaskForm projectId={room.project.id} members={room.members} files={room.files} /></div> : null}
        </section>

        <section aria-labelledby="changes-heading" className="mt-8">
          <h2 id="changes-heading" className="text-xl font-bold">Changesets and reviews</h2>
          <p className="mt-1 text-sm text-muted">
            Contributors work in isolation. A maintainer can merge only after integration checks pass and a
            different human’s approval digest still matches the exact files.
          </p>
          {room.permissions.canCreateChanges ? (
            <div className="mt-3"><CreateChangesetForm projectId={room.project.id} files={room.files} /></div>
          ) : null}
          <div className="mt-4 space-y-3">
            {openChangesets.length === 0 ? <p className="text-sm text-muted">No open changesets.</p> : openChangesets.map((changeset) => (
              <ChangesetCard
                key={changeset.id}
                projectId={room.project.id}
                changeset={changeset}
                role={room.role}
                userId={session.user.id}
                comments={commentsFor(changeset.id)}
                names={names}
                reviewNote={latestReview(changeset.id)?.note || undefined}
              />
            ))}
          </div>
          {closedChangesets.length > 0 ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium">Closed changesets ({closedChangesets.length})</summary>
              <ul className="mt-2 space-y-1 text-sm text-muted">
                {closedChangesets.map((changeset) => <li key={changeset.id}>{changeset.title} · {changeset.status} · {when(changeset.updated_at)}</li>)}
              </ul>
            </details>
          ) : null}
        </section>

        <section aria-labelledby="comments-heading" className="mt-8">
          <h2 id="comments-heading" className="text-xl font-bold">Project comments</h2>
          <CommentList comments={generalComments} names={names} />
          <CommentForm projectId={room.project.id} />
        </section>

        <section aria-labelledby="history-heading" className="mt-8 grid gap-4 lg:grid-cols-2">
          <div className={cardClass}>
            <h2 id="history-heading" className="text-lg font-bold">Build history</h2>
            {room.versions.length === 0 ? <p className="mt-2 text-sm text-muted">No app versions yet.</p> : (
              <ul className="mt-2 space-y-1 text-sm">
                {room.versions.map((version) => <li key={version.version}><span className="font-mono text-xs">v{version.version}</span> · {version.summary} <span className="text-muted">· {when(version.created_at)}</span></li>)}
              </ul>
            )}
          </div>
          <div className={cardClass}>
            <h2 className="text-lg font-bold">Deployment history</h2>
            {room.deployments.length === 0 ? <p className="mt-2 text-sm text-muted">No deployments yet.</p> : (
              <ul className="mt-2 space-y-1 text-sm">
                {room.deployments.map((deployment) => (
                  <li key={deployment.id}>
                    {deployment.target} · {deployment.status} · v{deployment.snapshot_version}
                    {deployment.deployment_url ? <> · <a className="underline" href={deployment.deployment_url}>open</a></> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {room.permissions.canShare ? (
          <section aria-labelledby="share-heading" className="mt-8">
            <h2 id="share-heading" className="text-xl font-bold">Private sharing</h2>
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              <ShareForm projectId={room.project.id} />
              <div className={cardClass}>
                <h3 className="text-base font-bold">Active expiring links</h3>
                {room.shares.length === 0 ? <p className="mt-2 text-sm text-muted">No active share links.</p> : (
                  <ul className="mt-2 space-y-1 text-sm">{room.shares.map((share) => <li key={share.id}>Expires {when(share.expires_at)}</li>)}</ul>
                )}
                <p className="mt-2 text-xs text-muted">No share link grants file, comment, environment or credential access.</p>
              </div>
            </div>
          </section>
        ) : null}

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href={`/build/${room.project.id}/team`} className={secondaryButton}>Agent team</Link>
          <Link href={`/build/${room.project.id}/deploy`} className={secondaryButton}>Deployments</Link>
          <Link href={`/build/${room.project.id}`} className={secondaryButton}>Back to project</Link>
        </div>
      </main>
    </div>
  );
}
