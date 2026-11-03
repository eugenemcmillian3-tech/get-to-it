"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { TaskAiPanel } from "@/components/task-ai-panel";
import { idleFormState } from "@/lib/action-state";
import { reopenTaskAction, saveWorkspaceAction } from "@/lib/actions/tasks";
import { mergeSuggestion } from "@/lib/ai/task-help";
import { MAX_TASK_RESULT_LENGTH } from "@/lib/constants";
import { hintClass, inputClass, labelClass, primaryButton, secondaryButton } from "@/lib/styles";
import type { Task, TaskResult } from "@/lib/types";

export function TaskWorkspace({
  goalId,
  task,
  result,
}: {
  goalId: string;
  task: Task;
  result: TaskResult | null;
}) {
  const initialContent = result?.content ?? "";
  const [content, setContent] = useState(initialContent);
  const [state, formAction] = useActionState(saveWorkspaceAction, idleFormState);
  const [reopenState, reopenFormAction] = useActionState(
    reopenTaskAction,
    idleFormState,
  );

  const savedContent = state.savedContent ?? initialContent;
  const isCompleted = task.status === "completed";

  return (
    <div className="space-y-5">
      <TaskAiPanel
        goalId={goalId}
        taskId={task.id}
        content={content}
        onUseSuggestion={(text) =>
          setContent((current) => mergeSuggestion(current, text))
        }
      />

      <form
        action={formAction}
        className="rounded-2xl border border-line bg-card p-4 sm:p-5"
      >
        <input type="hidden" name="goal_id" value={goalId} />
        <input type="hidden" name="task_id" value={task.id} />

        <label className={labelClass} htmlFor="task-content">
          Notes and results
        </label>
        <p className={hintClass}>
          Drafts, links, decisions, the actual work. Saving keeps it here even
          if you don&apos;t finish today.
        </p>

        <textarea
          id="task-content"
          name="content"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={12}
          maxLength={MAX_TASK_RESULT_LENGTH}
          aria-describedby="save-status"
          placeholder="Start anywhere. Half a sentence is still a start."
          className={`mt-3 min-h-52 font-mono text-sm leading-relaxed ${inputClass}`}
        />

        <p id="save-status" aria-live="polite" className="mt-2 min-h-5 text-sm">
          {state.status === "error" ? (
            <span className="text-danger">{state.message}</span>
          ) : state.status === "success" ? (
            <span className="text-mint">
              {state.message}
              {state.savedAt ? ` Last saved at ${state.savedAt}.` : ""}
            </span>
          ) : content !== savedContent ? (
            <span className="text-muted">Unsaved changes.</span>
          ) : initialContent ? (
            <span className="text-muted">All changes saved.</span>
          ) : (
            <span className="text-muted">Nothing saved yet.</span>
          )}
        </p>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <SubmitButton
            name="intent"
            value="save"
            pendingLabel="Saving…"
            className={`${secondaryButton} sm:w-auto`}
            disabled={content === savedContent}
          >
            Save work
          </SubmitButton>
          <SubmitButton
            name="intent"
            value="complete"
            pendingLabel="Saving…"
            className={`${primaryButton} sm:w-auto`}
            disabled={isCompleted}
          >
            Mark complete
          </SubmitButton>
        </div>
        <p className="mt-3 text-sm text-muted">
          Saving keeps the task open. “Mark complete” is a separate choice, and
          you can undo it.
        </p>
      </form>

      {isCompleted ? (
        <form
          action={reopenFormAction}
          className="rounded-2xl border border-mint/30 bg-mint-soft p-4 sm:p-5"
        >
          <input type="hidden" name="goal_id" value={goalId} />
          <input type="hidden" name="task_id" value={task.id} />
          <p className="text-sm font-semibold text-mint">
            This task is marked complete.
          </p>
          <p className="mt-1 text-sm text-muted">
            If it needs another pass, reopen it — your saved work stays.
          </p>
          <SubmitButton
            pendingLabel="Reopening…"
            className={`${secondaryButton} mt-3 sm:w-auto`}
          >
            Reopen task
          </SubmitButton>
          {reopenState.status === "error" ? (
            <p role="alert" className="mt-2 text-sm text-danger">
              {reopenState.message}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
