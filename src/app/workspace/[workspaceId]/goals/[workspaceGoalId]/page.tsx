import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import {
  WorkspaceCommentForm,
  WorkspaceTaskEditForm,
  WorkspaceTaskForm,
} from "@/components/workspace-forms";
import {
  archiveWorkspaceGoalAction,
  deleteWorkspaceCommentAction,
  deleteWorkspaceGoalAction,
  deleteWorkspaceTaskAction,
} from "@/lib/actions/workspaces";
import { requireSession } from "@/lib/auth";
import { getWorkspaceGoalDetail } from "@/lib/data/workspaces";
import { getIdentity } from "@/lib/identity";
import { getSupabaseSettings } from "@/lib/supabase/config";
import {
  canDeleteComment,
  canEditTask,
  formatWorkspaceTime,
  memberLabel,
  progressPercent,
} from "@/lib/workspaces";
import {
  cardClass,
  chipClass,
  focusRing,
  quietButton,
  secondaryButton,
} from "@/lib/styles";
import { TASK_STATUS_LABELS, type TaskStatus } from "@/lib/types";

export const metadata: Metadata = { title: "Shared goal — GET TO IT" };

const SECTIONS: TaskStatus[] = ["todo", "in_progress", "completed"];

export default async function WorkspaceGoalPage({
  params,
}: {
  params: Promise<{ workspaceId: string; workspaceGoalId: string }>;
}) {
  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const session = await requireSession();
  const { workspaceId, workspaceGoalId } = await params;
  const [identity, detail] = await Promise.all([
    getIdentity(session),
    getWorkspaceGoalDetail(session, workspaceId, workspaceGoalId),
  ]);
  if (!detail) notFound();

  const { workspace, goal, tasks, comments, members, myRole } = detail;
  const memberById = new Map(members.map((member) => [member.user_id, member]));
  const done = tasks.filter((task) => task.status === "completed").length;
  const percent = progressPercent(done, tasks.length);
  const canManage = myRole === "owner" || myRole === "admin";

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-3xl px-5 pb-16 pt-6">
        <Link
          href={`/workspace/${workspace.id}`}
          className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          ← {workspace.name}
        </Link>

        <header className="mt-4">
          <h1 className="text-3xl font-black leading-tight tracking-tight sm:text-4xl">
            {goal.title}
          </h1>
          <p className="mt-3 max-w-xl leading-relaxed text-muted">
            {goal.desired_outcome}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className={chipClass}>
              {done} of {tasks.length} tasks done
            </span>
            {goal.source_goal_id ? (
              <span className={chipClass}>Copied from a personal goal</span>
            ) : null}
            {goal.archived_at ? <span className={chipClass}>Archived</span> : null}
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label="Goal task completion"
            className="mt-3 h-2 w-full overflow-hidden rounded-full bg-line"
          >
            <div className="h-full rounded-full bg-brand" style={{ width: `${percent}%` }} />
          </div>
        </header>

        <section aria-labelledby="add-task-heading" className="mt-8">
          <h2 id="add-task-heading" className="text-lg font-bold">
            Add work
          </h2>
          <WorkspaceTaskForm
            workspaceId={workspace.id}
            goalId={goal.id}
            members={members}
            myId={session.user.id}
            myRole={myRole}
          />
        </section>

        <section aria-labelledby="tasks-heading" className="mt-8">
          <h2 id="tasks-heading" className="text-lg font-bold">
            Tasks
          </h2>

          {tasks.length === 0 ? (
            <p className="mt-2 rounded-xl border border-dashed border-line p-4 text-sm text-muted">
              No tasks yet. A small, assignable step is a good start.
            </p>
          ) : (
            SECTIONS.map((status) => {
              const sectionTasks = tasks.filter((task) => task.status === status);
              if (sectionTasks.length === 0) return null;

              return (
                <section key={status} aria-labelledby={`tasks-${status}`} className="mt-5">
                  <h3
                    id={`tasks-${status}`}
                    className="text-xs font-bold uppercase tracking-[0.15em] text-muted"
                  >
                    {TASK_STATUS_LABELS[status]} ({sectionTasks.length})
                  </h3>

                  <ul className="mt-2 space-y-3">
                    {sectionTasks.map((task) => {
                      const assignee = task.assignee_id
                        ? memberById.get(task.assignee_id)
                        : undefined;
                      const taskComments = comments.filter(
                        (comment) => comment.task_id === task.id,
                      );
                      const editable = canEditTask(myRole, session.user.id, task);

                      return (
                        <li key={task.id} className={cardClass}>
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <p
                              className={`font-semibold ${
                                task.status === "completed" ? "text-muted line-through" : ""
                              }`}
                            >
                              {task.title}
                            </p>
                            <span className={chipClass}>
                              {TASK_STATUS_LABELS[task.status]}
                            </span>
                          </div>

                          <p className="mt-1 text-xs text-muted">
                            {assignee
                              ? `Assigned to ${memberLabel(assignee)}`
                              : "Unassigned"}
                            {task.completed_at
                              ? ` · completed ${formatWorkspaceTime(task.completed_at)}`
                              : ""}
                          </p>

                          <WorkspaceTaskEditForm
                            workspaceId={workspace.id}
                            goalId={goal.id}
                            task={task}
                            members={members}
                            myId={session.user.id}
                            myRole={myRole}
                            canEdit={editable}
                          />

                          {canManage ? (
                            <form action={deleteWorkspaceTaskAction} className="mt-2">
                              <input type="hidden" name="workspace_id" value={workspace.id} />
                              <input type="hidden" name="goal_id" value={goal.id} />
                              <input type="hidden" name="task_id" value={task.id} />
                              <button type="submit" className={quietButton}>
                                Delete task
                              </button>
                            </form>
                          ) : null}

                          <div className="mt-3 border-t border-line pt-3">
                            <h4 className="text-xs font-bold uppercase tracking-[0.15em] text-muted">
                              Comments ({taskComments.length})
                            </h4>

                            {taskComments.length === 0 ? (
                              <p className="mt-1 text-sm text-muted">No comments yet.</p>
                            ) : (
                              <ul className="mt-2 space-y-2">
                                {taskComments.map((comment) => {
                                  const author = comment.author_id
                                    ? memberById.get(comment.author_id)
                                    : undefined;
                                  const mayDelete = canDeleteComment(
                                    myRole,
                                    session.user.id,
                                    comment.author_id,
                                  );

                                  return (
                                    <li
                                      key={comment.id}
                                      className="rounded-lg bg-paper px-3 py-2"
                                    >
                                      <p className="text-xs font-semibold text-muted">
                                        {author ? memberLabel(author) : "Former member"}
                                        {" · "}
                                        {formatWorkspaceTime(comment.created_at)}
                                      </p>
                                      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">
                                        {comment.body}
                                      </p>
                                      {mayDelete ? (
                                        <form action={deleteWorkspaceCommentAction} className="mt-1">
                                          <input
                                            type="hidden"
                                            name="workspace_id"
                                            value={workspace.id}
                                          />
                                          <input type="hidden" name="goal_id" value={goal.id} />
                                          <input
                                            type="hidden"
                                            name="comment_id"
                                            value={comment.id}
                                          />
                                          <button type="submit" className={quietButton}>
                                            Delete comment
                                          </button>
                                        </form>
                                      ) : null}
                                    </li>
                                  );
                                })}
                              </ul>
                            )}

                            <WorkspaceCommentForm
                              workspaceId={workspace.id}
                              goalId={goal.id}
                              taskId={task.id}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })
          )}
        </section>

        {canManage ? (
          <section aria-labelledby="goal-settings-heading" className="mt-10 border-t border-line pt-6">
            <h2
              id="goal-settings-heading"
              className="text-xs font-bold uppercase tracking-[0.15em] text-muted"
            >
              Shared goal settings
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <form action={archiveWorkspaceGoalAction}>
                <input type="hidden" name="workspace_id" value={workspace.id} />
                <input type="hidden" name="goal_id" value={goal.id} />
                <input
                  type="hidden"
                  name="intent"
                  value={goal.archived_at ? "restore" : "archive"}
                />
                <button type="submit" className={secondaryButton}>
                  {goal.archived_at ? "Restore this goal" : "Archive this goal"}
                </button>
              </form>

              <form action={deleteWorkspaceGoalAction}>
                <input type="hidden" name="workspace_id" value={workspace.id} />
                <input type="hidden" name="goal_id" value={goal.id} />
                <button type="submit" className={quietButton}>
                  Delete this shared goal
                </button>
              </form>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              Deleting removes the shared goal, its tasks and their comments. No
              personal record is affected.
            </p>
          </section>
        ) : null}
      </main>
    </div>
  );
}
