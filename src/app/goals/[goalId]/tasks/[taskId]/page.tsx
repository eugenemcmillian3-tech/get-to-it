import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FocusTimer } from "@/components/focus-timer";
import { TaskEditForm } from "@/components/forms";
import { ReminderCard } from "@/components/reminder-card";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { TaskWorkspace } from "@/components/task-workspace";
import { requireSession } from "@/lib/auth";
import { getTaskWorkspace } from "@/lib/data/goals";
import { getFocusSnapshot } from "@/lib/data/progress";
import { getReminderFor, getReminderSettings } from "@/lib/data/reminders";
import { formatMinutes } from "@/lib/format";
import { getIdentity } from "@/lib/identity";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { chipClass, focusRing } from "@/lib/styles";
import { TASK_STATUS_LABELS } from "@/lib/types";

export const metadata: Metadata = { title: "Task workspace — GET TO IT" };

export default async function TaskPage({
  params,
}: {
  params: Promise<{ goalId: string; taskId: string }>;
}) {
  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const session = await requireSession();
  const { goalId, taskId } = await params;
  const workspace = await getTaskWorkspace(session, goalId, taskId);
  if (!workspace) notFound();

  const identity = await getIdentity(session);
  const { goal, task, result } = workspace;

  // Timer state, reminder state and settings all come from the database, so a
  // refresh recovers them rather than rebuilding them in the browser.
  const [focus, reminderSettings, reminder] = await Promise.all([
    getFocusSnapshot(session),
    getReminderSettings(session),
    getReminderFor(session, { taskId: task.id, goalId: goal.id }),
  ]);

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-3xl px-5 pb-16 pt-6">
        <Link
          href={`/goals/${goal.id}`}
          className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          ← {goal.title}
        </Link>

        <header className="mt-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={chipClass}>{TASK_STATUS_LABELS[task.status]}</span>
            <span className={chipClass}>Workspace</span>
          </div>
          <h1 className="mt-3 text-2xl font-black leading-tight tracking-tight sm:text-3xl">
            {task.title}
          </h1>
        </header>

        {task.instructions || task.first_action || task.expected_deliverable || task.estimated_minutes ? (
          <section
            aria-labelledby="plan-notes-heading"
            className="mt-4 rounded-2xl border border-brand/30 bg-brand-soft/40 p-4"
          >
            <h2
              id="plan-notes-heading"
              className="text-xs font-bold uppercase tracking-[0.15em] text-muted"
            >
              {task.origin === "ai_plan" ? "From your plan" : "Task notes"}
            </h2>
            {task.estimated_minutes ? (
              <p className="mt-2 text-sm text-muted">
                Estimated {formatMinutes(task.estimated_minutes)}
              </p>
            ) : null}
            {task.instructions ? (
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
                {task.instructions}
              </p>
            ) : null}
            {task.first_action ? (
              <p className="mt-3 text-sm leading-relaxed">
                <span className="font-semibold">First action:</span>{" "}
                {task.first_action}
              </p>
            ) : null}
            {task.expected_deliverable ? (
              <p className="mt-1 text-sm leading-relaxed">
                <span className="font-semibold">Done when:</span>{" "}
                {task.expected_deliverable}
              </p>
            ) : null}
          </section>
        ) : null}

        <div className="mt-4 rounded-2xl border border-line bg-card p-4">
          <p className="text-sm font-semibold">Rename or change status</p>
          <TaskEditForm goalId={goal.id} task={task} />
        </div>

        <div className="mt-5">
          <ReminderCard
            goalId={goal.id}
            taskId={task.id}
            reminder={reminder}
            timezone={reminderSettings.timezone}
            remindAt={reminderSettings.remind_at}
            weekdays={reminderSettings.weekdays}
          />
        </div>

        <div className="mt-5">
          <FocusTimer goalId={goal.id} taskId={task.id} initial={focus} />
        </div>

        <div className="mt-5">
          <TaskWorkspace goalId={goal.id} task={task} result={result} />
        </div>

        <p className="mt-8 text-sm text-muted">
          Your saved work is private to your account. Only you can open this
          task.
        </p>
      </main>
    </div>
  );
}
