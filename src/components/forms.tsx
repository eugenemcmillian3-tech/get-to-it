"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleFormState } from "@/lib/action-state";
import { createGoalAction, deleteGoalAction } from "@/lib/actions/goals";
import { createTaskAction, updateTaskAction } from "@/lib/actions/tasks";
import { TIME_AVAILABLE_OPTIONS } from "@/lib/constants";
import { formatMinutes } from "@/lib/format";
import { TEMPLATE_CATEGORIES } from "@/lib/templates/library";
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
import { TASK_STATUSES, TASK_STATUS_LABELS, type Task } from "@/lib/types";

function ErrorLine({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
      {message}
    </p>
  );
}

export function CreateGoalForm({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [state, formAction] = useActionState(createGoalAction, idleFormState);

  return (
    <details open={defaultOpen} className={`${cardClass} group`}>
      <summary
        className={`flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg text-base font-semibold ${focusRing}`}
      >
        <span>Add a goal</span>
        <span aria-hidden="true" className="text-xl leading-none text-muted transition group-open:rotate-45">
          +
        </span>
      </summary>

      <form action={formAction} className="mt-5 space-y-4">
        <div>
          <label className={labelClass} htmlFor="goal-title">
            Goal title
          </label>
          <input
            id="goal-title"
            name="title"
            required
            maxLength={160}
            placeholder="Finish my portfolio site"
            className={`mt-1.5 ${inputClass}`}
          />
          <p className={hintClass}>Short and specific. “Finish” is easier to act on than “work on”.</p>
        </div>

        <div>
          <label className={labelClass} htmlFor="goal-outcome">
            Desired outcome
          </label>
          <textarea
            id="goal-outcome"
            name="desired_outcome"
            required
            rows={3}
            maxLength={2000}
            placeholder="What does done look like?"
            className={`mt-1.5 ${inputClass}`}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="goal-category">
              Category <span className="font-normal text-muted">(optional)</span>
            </label>
            <select
              id="goal-category"
              name="category"
              defaultValue=""
              className={`mt-1.5 ${inputClass}`}
            >
              <option value="">No category</option>
              {TEMPLATE_CATEGORIES.map((entry) => (
                <option key={entry.slug} value={entry.slug}>
                  {entry.label}
                </option>
              ))}
            </select>
            <p className={hintClass}>Used to filter your list later.</p>
          </div>

          <div>
            <label className={labelClass} htmlFor="goal-deadline">
              Deadline <span className="font-normal text-muted">(optional)</span>
            </label>
            <input
              id="goal-deadline"
              name="deadline"
              type="date"
              className={`mt-1.5 ${inputClass}`}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="goal-time">
              Time available today
            </label>
            <select
              id="goal-time"
              name="time_available_minutes"
              defaultValue="30"
              className={`mt-1.5 ${inputClass}`}
            >
              {TIME_AVAILABLE_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {formatMinutes(minutes)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="goal-blocker">
            What&apos;s stopping you?{" "}
            <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id="goal-blocker"
            name="blocker"
            rows={2}
            maxLength={2000}
            placeholder="e.g. I don't know where to start"
            className={`mt-1.5 ${inputClass}`}
          />
          <p className={hintClass}>Naming it makes it easier to plan around.</p>
        </div>

        <ErrorLine message={state.status === "error" ? state.message : undefined} />

        <SubmitButton pendingLabel="Creating your goal…">Create goal</SubmitButton>
      </form>
    </details>
  );
}

export function AddTaskForm({ goalId }: { goalId: string }) {
  const [state, formAction] = useActionState(createTaskAction, idleFormState);
  const formRef = useRef<HTMLFormElement>(null);
  const nonce = state.nonce;
  const status = state.status;

  useEffect(() => {
    if (status === "success") formRef.current?.reset();
  }, [nonce, status]);

  const message = state.message;
  const messageClass =
    state.status === "error" ? "text-sm text-danger" : "text-sm text-mint";

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <input type="hidden" name="goal_id" value={goalId} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="new-task-title" className="sr-only">
          New task
        </label>
        <input
          id="new-task-title"
          name="title"
          required
          maxLength={200}
          placeholder="Add a next step you could start today…"
          className={inputClass}
        />
        <SubmitButton
          pendingLabel="Adding…"
          className={`${primaryButton} shrink-0 sm:w-auto`}
        >
          Add task
        </SubmitButton>
      </div>
      {message ? (
        <p
          role={state.status === "error" ? "alert" : "status"}
          aria-live="polite"
          className={messageClass}
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}

export function TaskEditForm({ goalId, task }: { goalId: string; task: Task }) {
  const [state, formAction] = useActionState(updateTaskAction, idleFormState);

  return (
    <details className="mt-1">
      <summary
        className={`inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg py-1 text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
      >
        Edit task
      </summary>
      <form action={formAction} className="mt-3 space-y-3 rounded-xl bg-paper p-3">
        <input type="hidden" name="goal_id" value={goalId} />
        <input type="hidden" name="task_id" value={task.id} />

        <div>
          <label className={labelClass} htmlFor={`task-title-${task.id}`}>
            Task name
          </label>
          <input
            id={`task-title-${task.id}`}
            name="title"
            defaultValue={task.title}
            required
            maxLength={200}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor={`task-status-${task.id}`}>
            Status
          </label>
          <select
            id={`task-status-${task.id}`}
            name="status"
            defaultValue={task.status}
            className={`mt-1.5 ${inputClass}`}
          >
            {TASK_STATUSES.map((status) => (
              <option key={status} value={status}>
                {TASK_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>

        {state.message ? (
          <p
            role={state.status === "error" ? "alert" : "status"}
            aria-live="polite"
            className={
              state.status === "error" ? "text-sm text-danger" : "text-sm text-mint"
            }
          >
            {state.message}
          </p>
        ) : null}

        <SubmitButton pendingLabel="Saving…" className={secondaryButton}>
          Save task
        </SubmitButton>
      </form>
    </details>
  );
}

export function DeleteGoalForm({
  goalId,
  goalTitle,
}: {
  goalId: string;
  goalTitle: string;
}) {
  const [state, formAction] = useActionState(deleteGoalAction, idleFormState);
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className={`inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-danger/40 px-4 text-sm font-semibold text-danger transition hover:bg-danger/5 ${focusRing}`}
      >
        Delete this goal
      </button>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="goal_id" value={goalId} />
      <p role="alert" className="text-sm font-medium text-danger">
        Delete “{goalTitle}” and every task and saved result inside it? This
        can&apos;t be undone.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <SubmitButton pendingLabel="Deleting…" className={dangerButton}>
          Yes, delete permanently
        </SubmitButton>
        <button
          type="button"
          autoFocus
          onClick={() => setConfirming(false)}
          className={secondaryButton}
        >
          Keep goal
        </button>
      </div>
      <ErrorLine message={state.status === "error" ? state.message : undefined} />
    </form>
  );
}
