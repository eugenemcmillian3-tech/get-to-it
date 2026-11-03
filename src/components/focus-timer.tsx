"use client";

import { useActionState, useEffect, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleFocusState } from "@/lib/action-state";
import { focusAction } from "@/lib/actions/focus";
import {
  FOCUS_PERSISTENCE_NOTE,
  formatClock,
  formatFocusTotal,
  projectElapsed,
} from "@/lib/focus";
import {
  chipClass,
  hintClass,
  primaryButton,
  secondaryButton,
} from "@/lib/styles";
import type { FocusSnapshot } from "@/lib/types";

/**
 * Optional focus timer for one task.
 *
 * The number on screen ticks, but every recorded total comes back from the
 * server after an action — the browser never reports how long a session ran.
 * Nothing here can complete a task.
 */
export function FocusTimer({
  goalId,
  taskId,
  initial,
}: {
  goalId: string;
  taskId: string;
  initial: FocusSnapshot;
}) {
  const [state, formAction] = useActionState(focusAction, idleFocusState);
  const snapshot = state.snapshot ?? initial;
  const session = snapshot.session;

  const ownSession = session && session.task_id === taskId ? session : null;
  const otherSession = session && session.task_id !== taskId ? session : null;

  const statusLabel = ownSession
    ? ownSession.status === "running"
      ? "Running"
      : "Paused"
    : "Not started";

  return (
    <section
      aria-labelledby="focus-heading"
      className="rounded-2xl border border-line bg-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="focus-heading" className="text-lg font-bold">
          Focus timer{" "}
          <span className="text-sm font-normal text-muted">(optional)</span>
        </h2>
        <span className={chipClass}>{statusLabel}</span>
      </div>

      <p className={hintClass}>
        Time on this task, when you want it. Starting a timer changes nothing
        about the task itself.
      </p>

      <div className="mt-4 flex flex-wrap items-baseline gap-3">
        <FocusClock
          key={`${ownSession?.id ?? "none"}-${ownSession?.status ?? "idle"}-${ownSession?.elapsed_seconds ?? 0}-${state.nonce ?? 0}`}
          baseSeconds={ownSession?.elapsed_seconds ?? 0}
          running={ownSession?.status === "running"}
        />
        <p className="text-sm text-muted">
          {ownSession
            ? ownSession.status === "running"
              ? "Counting on the server's clock."
              : "Paused — nothing is counting right now."
            : "No session yet."}
        </p>
      </div>

      <form action={formAction} className="mt-4 flex flex-wrap gap-2">
        <input type="hidden" name="goal_id" value={goalId} />
        <input type="hidden" name="task_id" value={taskId} />
        {session ? (
          <input type="hidden" name="session_id" value={session.id} />
        ) : null}

        {!session ? (
          <SubmitButton
            name="intent"
            value="start"
            pendingLabel="Starting…"
            className={`${primaryButton} sm:w-auto`}
          >
            Start
          </SubmitButton>
        ) : null}

        {ownSession?.status === "running" ? (
          <SubmitButton
            name="intent"
            value="pause"
            pendingLabel="Pausing…"
            className={`${secondaryButton} sm:w-auto`}
          >
            Pause
          </SubmitButton>
        ) : null}

        {ownSession?.status === "paused" ? (
          <SubmitButton
            name="intent"
            value="resume"
            pendingLabel="Resuming…"
            className={`${secondaryButton} sm:w-auto`}
          >
            Resume
          </SubmitButton>
        ) : null}

        {session ? (
          <SubmitButton
            name="intent"
            value="finish"
            pendingLabel="Finishing…"
            className={`${secondaryButton} sm:w-auto`}
          >
            Finish
          </SubmitButton>
        ) : null}
      </form>

      {otherSession ? (
        <p className="mt-3 rounded-xl border border-brand/30 bg-brand-soft/40 px-3 py-2 text-sm leading-relaxed">
          A session is already open on another task — one at a time. Finish it
          with the button above, then start one here.
        </p>
      ) : null}

      {state.status === "error" && state.message ? (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger"
        >
          {state.message}
        </p>
      ) : null}

      {state.status === "updated" && state.message ? (
        <p aria-live="polite" className="mt-3 text-sm text-mint">
          {state.message}
        </p>
      ) : null}

      <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Today
          </dt>
          <dd className="mt-0.5 font-semibold">
            {formatFocusTotal(snapshot.totals.today_seconds)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            This week
          </dt>
          <dd className="mt-0.5 font-semibold">
            {formatFocusTotal(snapshot.totals.week_seconds)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Recorded in all
          </dt>
          <dd className="mt-0.5 font-semibold">
            {formatFocusTotal(snapshot.totals.total_seconds)}
          </dd>
        </div>
      </dl>

      <p className="mt-4 text-xs leading-relaxed text-muted">
        {FOCUS_PERSISTENCE_NOTE}
      </p>
      <p className="mt-2 text-xs text-muted">
        Time elapsed never completes a task. Only you decide when it&apos;s done.
      </p>
    </section>
  );
}

/** Display only: projects the server's number forward using wall-clock time. */
function FocusClock({
  baseSeconds,
  running,
}: {
  baseSeconds: number;
  running: boolean;
}) {
  const [elapsed, setElapsed] = useState(baseSeconds);

  useEffect(() => {
    if (!running) return;
    const startedAt = Date.now();
    const id = setInterval(() => {
      setElapsed(projectElapsed(baseSeconds, "running", startedAt, Date.now()));
    }, 1000);
    return () => clearInterval(id);
  }, [baseSeconds, running]);

  return (
    <p
      className="font-mono text-4xl font-black tabular-nums tracking-tight"
      aria-label={`Elapsed ${formatClock(elapsed)}`}
    >
      {formatClock(elapsed)}
    </p>
  );
}
