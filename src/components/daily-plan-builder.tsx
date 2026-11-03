"use client";

import { useActionState, useMemo, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import {
  idleDailyPlanState,
  type DailyPlanState,
} from "@/lib/action-state";
import { saveDailyPlanAction } from "@/lib/actions/daily-plan";
import { formatMinutes } from "@/lib/format";
import {
  selectDailyTasks,
  selectionTotal,
  sessionExplanation,
  taskSizeExplanation,
} from "@/lib/preferences";
import {
  chipClass,
  hintClass,
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
} from "@/lib/styles";
import type {
  DailyPlan,
  DailyPlanCandidate,
  UserPreferences,
} from "@/lib/types";

const TIME_CHOICES = [...new Set<number>([5, 10, 15, 20, 25, 30, 45, 60, 90, 120, 180, 240])].sort(
  (a, b) => a - b,
);

/**
 * The daily plan builder.
 *
 * Selection is browser state until the person approves it. Approving stores an
 * approved selection only: no task is started, completed, moved or treated as
 * abandoned, and an overrun needs the explicit confirmation box.
 */
export function DailyPlanBuilder({
  candidates,
  day,
  existingPlan,
  preferences,
  defaultMinutes,
}: {
  candidates: DailyPlanCandidate[];
  day: string;
  existingPlan: DailyPlan | null;
  preferences: UserPreferences;
  defaultMinutes: number;
}) {
  const [state, formAction] = useActionState(
    saveDailyPlanAction,
    idleDailyPlanState,
  );
  const [minutes, setMinutes] = useState<number>(
    existingPlan?.minutes_available ?? defaultMinutes,
  );
  const [selected, setSelected] = useState<string[]>(
    existingPlan?.task_ids.filter((id) =>
      candidates.some((task) => task.id === id),
    ) ?? [],
  );
  const [overConfirmed, setOverConfirmed] = useState(false);

  const chosen = useMemo(
    () => candidates.filter((task) => selected.includes(task.id)),
    [candidates, selected],
  );
  const totals = selectionTotal(chosen);
  const over = totals.totalMinutes > minutes;

  const reasons = [
    sessionExplanation(preferences),
    taskSizeExplanation(preferences),
  ].filter((reason): reason is string => reason !== null);

  function toggle(id: string) {
    setOverConfirmed(false);
    setSelected((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  }

  function suggest() {
    const selection = selectDailyTasks(candidates, minutes, preferences);
    setSelected(selection.selected.map((task) => task.id));
    setOverConfirmed(false);
  }

  const grouped = useMemo(() => {
    const groups = new Map<string, DailyPlanCandidate[]>();
    for (const task of candidates) {
      const list = groups.get(task.goal_title) ?? [];
      list.push(task);
      groups.set(task.goal_title, list);
    }
    return [...groups.entries()];
  }, [candidates]);

  return (
    <div className="space-y-4">
      <form
        action={formAction}
        className="rounded-2xl border border-line bg-card p-4 sm:p-5"
      >
        <input type="hidden" name="day" value={day} />
        <input
          type="hidden"
          name="task_ids_json"
          value={JSON.stringify(selected)}
        />
        <input
          type="hidden"
          name="allow_over_limit"
          value={over && overConfirmed ? "true" : "false"}
        />

        <div className="flex flex-wrap items-end gap-3">
          <div className="sm:max-w-48">
            <label className={labelClass} htmlFor="plan-minutes">
              Time you have today
            </label>
            <select
              id="plan-minutes"
              name="minutes"
              value={minutes}
              onChange={(event) => {
                setMinutes(Number(event.target.value));
                setOverConfirmed(false);
              }}
              className={`mt-1.5 ${inputClass}`}
            >
              {TIME_CHOICES.map((choice) => (
                <option key={choice} value={choice}>
                  {formatMinutes(choice)}
                </option>
              ))}
            </select>
          </div>

          <button type="button" onClick={suggest} className={secondaryButton}>
            Suggest a selection
          </button>
        </div>

        {reasons.length > 0 ? (
          <ul className="mt-3 space-y-1">
            {reasons.map((reason) => (
              <li key={reason} className="text-sm text-muted">
                {reason}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted">
            Suggestions use the time you choose. Add preferences in Settings to
            tailor the size of the steps.
          </p>
        )}

        {candidates.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-line p-4 text-sm text-muted">
            There are no open tasks to plan from. Add a goal and a task first,
            or restart an archived goal from your dashboard.
          </p>
        ) : (
          <fieldset className="mt-4">
            <legend className={labelClass}>Choose tasks</legend>
            <p className={hintClass}>
              Only open tasks from active goals. Completed and archived work is
              not offered.
            </p>

            <div className="mt-3 space-y-4">
              {grouped.map(([goalTitle, tasks]) => (
                <div key={goalTitle}>
                  <p className="text-xs font-bold uppercase tracking-[0.15em] text-muted">
                    {goalTitle}
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {tasks.map((task) => (
                      <li key={task.id}>
                        <label className="flex items-start gap-2 rounded-lg px-1 py-1.5 text-sm leading-relaxed hover:bg-brand-soft/40">
                          <input
                            type="checkbox"
                            checked={selected.includes(task.id)}
                            onChange={() => toggle(task.id)}
                            className="mt-0.5 h-4 w-4"
                          />
                          <span className="flex-1">{task.title}</span>
                          <span className={chipClass}>
                            {task.estimated_minutes
                              ? formatMinutes(task.estimated_minutes)
                              : "No estimate"}
                          </span>
                          {task.status === "in_progress" ? (
                            <span className={chipClass}>In progress</span>
                          ) : null}
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </fieldset>
        )}

        <div aria-live="polite" className="mt-4 rounded-xl border border-line bg-paper p-3 text-sm">
          <p className="font-semibold">
            {selected.length} selected · {formatMinutes(totals.totalMinutes)}{" "}
            estimated
            {totals.unknownEstimates > 0
              ? ` · ${totals.unknownEstimates} without an estimate`
              : ""}
          </p>
          <p className="mt-1 text-muted">
            {formatMinutes(minutes)} available.
            {over
              ? " This is more than the time you chose."
              : " This fits the time you chose."}
          </p>
        </div>

        {over ? (
          <label className="mt-3 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm leading-relaxed">
            <input
              type="checkbox"
              checked={overConfirmed}
              onChange={(event) => setOverConfirmed(event.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              I know this is more than {formatMinutes(minutes)}. Approve it
              anyway — nothing is moved or marked abandoned either way.
            </span>
          </label>
        ) : null}

        <p aria-live="polite" className="mt-3 min-h-5 text-sm">
          {state.status === "error" ? (
            <span className="text-danger">{state.message}</span>
          ) : state.status === "warning" ? (
            <span className="text-danger">{state.message}</span>
          ) : state.status === "saved" ? (
            <span className="text-mint">{state.message}</span>
          ) : (
            <span className="text-muted">
              Approving stores the selection for today. Your tasks stay exactly
              as they are.
            </span>
          )}
        </p>

        <SubmitButton
          pendingLabel="Approving…"
          className={`${primaryButton} mt-3 sm:w-auto`}
          disabled={
            selected.length === 0 || (over && !overConfirmed)
          }
        >
          Approve this plan
        </SubmitButton>
      </form>

      <ApprovedPlan
        existingPlan={existingPlan}
        state={state}
        candidates={candidates}
      />
    </div>
  );
}

function ApprovedPlan({
  existingPlan,
  state,
  candidates,
}: {
  existingPlan: DailyPlan | null;
  state: DailyPlanState;
  candidates: DailyPlanCandidate[];
}) {
  const plan = state.status === "saved" && state.plan ? state.plan : existingPlan;
  if (!plan) return null;

  const byId = new Map(candidates.map((task) => [task.id, task]));

  return (
    <section className="rounded-2xl border border-mint/30 bg-mint-soft p-4 sm:p-5">
      <h2 className="text-lg font-bold">Approved for {plan.day}</h2>
      <p className="mt-1 text-sm text-muted">
        About {formatMinutes(plan.total_minutes)} of estimated work
        {plan.unknown_estimates > 0
          ? `, plus ${plan.unknown_estimates} without an estimate`
          : ""}
        {plan.over_limit ? " — approved with more time than available." : "."}
      </p>

      <ul className="mt-3 space-y-1.5">
        {plan.task_ids.map((id) => {
          const task = byId.get(id);
          return (
            <li key={id} className="text-sm">
              {task ? (
                <>
                  <span className="font-medium">{task.title}</span>
                  <span className="text-muted"> · {task.goal_title}</span>
                </>
              ) : (
                <span className="text-muted">
                  A task that has since been completed or removed.
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-xs leading-relaxed text-muted">
        This is a selection, not a schedule. Tasks you didn&apos;t pick are
        unchanged and still in your list.
      </p>
    </section>
  );
}
