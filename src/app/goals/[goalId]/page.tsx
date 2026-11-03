import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddTaskForm, DeleteGoalForm, TaskEditForm } from "@/components/forms";
import { SavePlanAsTemplateForm } from "@/components/goal-template-save-form";
import { PlanPanel } from "@/components/plan-panel";
import { ProgressBar } from "@/components/progress-bar";
import { ReminderCard } from "@/components/reminder-card";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { UnstuckPanel } from "@/components/unstuck-panel";
import { archiveGoalAction, restoreGoalAction } from "@/lib/actions/goals";
import { requireSession } from "@/lib/auth";
import { getGoalDetail } from "@/lib/data/goals";
import { getReminderFor, getReminderSettings } from "@/lib/data/reminders";
import { formatDeadline, formatMinutes } from "@/lib/format";
import { getIdentity } from "@/lib/identity";
import { summarizeTaskStatuses } from "@/lib/progress";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { chipClass, focusRing } from "@/lib/styles";
import { TASK_STATUS_LABELS, type TaskStatus } from "@/lib/types";

export const metadata: Metadata = { title: "Goal — GET TO IT" };

const SECTIONS: { status: TaskStatus }[] = [
  { status: "todo" },
  { status: "in_progress" },
  { status: "completed" },
];

export default async function GoalPage({
  params,
}: {
  params: Promise<{ goalId: string }>;
}) {
  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const session = await requireSession();
  const { goalId } = await params;
  const detail = await getGoalDetail(session, goalId);
  if (!detail) notFound();

  const identity = await getIdentity(session);
  const { goal, tasks } = detail;
  const [reminderSettings, reminder] = await Promise.all([
    getReminderSettings(session),
    getReminderFor(session, { goalId: goal.id }),
  ]);
  const counts = summarizeTaskStatuses(tasks);
  const deadline = formatDeadline(goal.deadline);

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-3xl px-5 pb-16 pt-6">
        <Link
          href="/dashboard"
          className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          ← Back to your goals
        </Link>

        <header className="mt-4">
          <h1 className="text-3xl font-black leading-tight tracking-tight sm:text-4xl">
            {goal.title}
          </h1>
          <p className="mt-3 max-w-xl leading-relaxed text-muted">
            {goal.desired_outcome}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <span className={chipClass}>
              {deadline ? `Due ${deadline}` : "No deadline"}
            </span>
            <span className={chipClass}>
              {formatMinutes(goal.time_available_minutes)} today
            </span>
          </div>

          {goal.archived_at ? (
            <div className="mt-4 rounded-xl border border-line bg-card p-3.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Archived
              </p>
              <p className="mt-1 text-sm leading-relaxed">
                This goal is set aside, not deleted. Everything inside it is
                still here, and you can restore it from your dashboard.
              </p>
            </div>
          ) : null}

          {goal.blocker ? (
            <div className="mt-4 rounded-xl border border-line bg-card p-3.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                What&apos;s been in the way
              </p>
              <p className="mt-1 text-sm leading-relaxed">{goal.blocker}</p>
            </div>
          ) : null}

          <div className="mt-5 rounded-2xl border border-line bg-card p-4">
            <ProgressBar counts={counts} />
          </div>
        </header>

        <section aria-labelledby="tasks-heading" className="mt-8">
          <h2 id="tasks-heading" className="text-xl font-bold">
            Tasks
          </h2>
          <p className="mt-1 text-sm text-muted">
            Small steps, in any order. You decide when one is done.
          </p>

          <PlanPanel goalId={goal.id} />

          <div className="mt-4 rounded-2xl border border-line bg-card p-4">
            <p className="text-sm font-semibold">Learning mode</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              Optional: turn this goal into a short path of explanations,
              practice and small projects, with saved answers and checkpoints
              you approve yourself.
            </p>
            <Link
              href={`/goals/${goal.id}/learn`}
              className={`mt-2 inline-block rounded text-sm font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-ink ${focusRing}`}
            >
              Open learning mode
            </Link>
          </div>

          <div className="mt-4 rounded-2xl border border-line bg-card p-4">
            <p className="text-sm font-semibold">Future paths</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              Optional: explore three plausible futures for a decision in this
              goal, compare their assumptions, and add an action as a task if you
              choose one.
            </p>
            <Link
              href={`/futures?goal=${goal.id}`}
              className={`mt-2 inline-block rounded text-sm font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-ink ${focusRing}`}
            >
              Explore future paths
            </Link>
          </div>

          <div className="mt-4">
            <ReminderCard
              goalId={goal.id}
              reminder={reminder}
              timezone={reminderSettings.timezone}
              remindAt={reminderSettings.remind_at}
              weekdays={reminderSettings.weekdays}
            />
          </div>

          <div className="mt-4 rounded-2xl border border-line bg-card p-4">
            <AddTaskForm goalId={goal.id} />
          </div>

          {tasks.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-line p-6 text-center">
              <p className="font-medium">No tasks yet.</p>
              <p className="mt-1 text-sm text-muted">
                What&apos;s the smallest first step? Ten minutes counts.
              </p>
            </div>
          ) : (
            SECTIONS.map((section) => {
              const sectionTasks = tasks.filter(
                (task) => task.status === section.status,
              );
              if (sectionTasks.length === 0) return null;

              return (
                <section
                  key={section.status}
                  aria-labelledby={`tasks-${section.status}`}
                  className="mt-6"
                >
                  <h3
                    id={`tasks-${section.status}`}
                    className="text-xs font-bold uppercase tracking-[0.15em] text-muted"
                  >
                    {TASK_STATUS_LABELS[section.status]} ({sectionTasks.length})
                  </h3>
                  <ul className="mt-2 space-y-2">
                    {sectionTasks.map((task) => (
                      <li
                        key={task.id}
                        className="rounded-xl border border-line bg-card p-3.5"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <Link
                            href={`/goals/${goal.id}/tasks/${task.id}`}
                            className={`rounded font-medium underline-offset-4 hover:underline ${focusRing} ${
                              task.status === "completed"
                                ? "text-muted line-through"
                                : ""
                            }`}
                          >
                            {task.title}
                          </Link>
                          <span className={chipClass}>
                            {TASK_STATUS_LABELS[task.status]}
                          </span>
                        </div>
                        {task.first_action || task.expected_deliverable || task.estimated_minutes ? (
                          <div className="mt-1.5 space-y-1 text-sm text-muted">
                            {task.estimated_minutes ? (
                              <p>About {formatMinutes(task.estimated_minutes)}</p>
                            ) : null}
                            {task.first_action ? (
                              <p>
                                <span className="font-semibold text-ink">
                                  First action:
                                </span>{" "}
                                {task.first_action}
                              </p>
                            ) : null}
                            {task.expected_deliverable ? (
                              <p>
                                <span className="font-semibold text-ink">
                                  Done when:
                                </span>{" "}
                                {task.expected_deliverable}
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <p className="mt-1 text-sm text-muted">
                            Open the workspace to write and save your work.
                          </p>
                        )}
                        <TaskEditForm goalId={goal.id} task={task} />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })
          )}
        </section>

        <UnstuckPanel goalId={goal.id} />

        <section
          aria-labelledby="settings-heading"
          className="mt-12 border-t border-line pt-6"
        >
          <h2
            id="settings-heading"
            className="text-xs font-bold uppercase tracking-[0.15em] text-muted"
          >
            Goal settings
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted">
              {goal.archived_at
                ? "Archived: it stays out of your default list."
                : "Archive keeps everything and moves it out of your default list."}
            </span>
            <form action={goal.archived_at ? restoreGoalAction : archiveGoalAction}>
              <input type="hidden" name="goal_id" value={goal.id} />
              <button
                type="submit"
                className={`cursor-pointer rounded text-sm font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-ink ${focusRing}`}
              >
                {goal.archived_at ? "Restore this goal" : "Archive this goal"}
              </button>
            </form>
          </div>

          <SavePlanAsTemplateForm
            goalId={goal.id}
            goalTitle={goal.title}
            category={goal.category}
          />

          <p className="mt-6 text-sm text-muted">
            Deleting removes this goal, its tasks, and every saved result.
          </p>
          <div className="mt-3">
            <DeleteGoalForm goalId={goal.id} goalTitle={goal.title} />
          </div>
        </section>
      </main>
    </div>
  );
}
