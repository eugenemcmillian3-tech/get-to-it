"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleFuturePathState } from "@/lib/action-state";
import {
  convertActionAction,
  createFuturePathAction,
  deleteFuturePathAction,
  saveRationaleAction,
  updateScenarioAction,
} from "@/lib/actions/futures";
import { AI_MODELS, DEFAULT_AI_MODEL } from "@/lib/ai/models";
import { operationChargeLabel } from "@/lib/credits/pricing";
import {
  ASSUMPTION_BASED_NOTE,
  HORIZONS,
  LIST_FIELD_HINTS,
  LIST_FIELD_LABELS,
  NO_HIGH_STAKES_NOTE,
  NO_PREDICTION_NOTE,
  SCENARIO_KINDS,
  SCENARIO_LABELS,
  SCENARIO_LIST_FIELDS,
  listToLines,
  type ScenarioKind,
} from "@/lib/futures";
import { formatFutureDay } from "@/lib/futures";
import type { FuturePath, FutureScenario } from "@/lib/types";
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

/**
 * The generator. One AI request, and the button says so. The horizon and the
 * labels are inputs, not guesses: nothing about the person is inferred.
 */
export function FuturePathForm({
  goals,
  defaultGoalId,
}: {
  goals: { id: string; title: string }[];
  defaultGoalId: string;
}) {
  const [state, formAction] = useActionState(
    createFuturePathAction,
    idleFuturePathState,
  );
  const [model, setModel] = useState(DEFAULT_AI_MODEL);

  return (
    <form action={formAction} className={`${cardClass} border-brand/30 bg-brand-soft/30`}>
      <h2 className="text-lg font-bold">New future path</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Start from a decision or a goal you already have. Three scenarios come
        back, all editable, and nothing is added to your tasks unless you choose
        an action.
      </p>

      <div className="mt-4 space-y-4">
        <div>
          <label className={labelClass} htmlFor="future-decision">
            Decision or goal
          </label>
          <input
            id="future-decision"
            name="decision"
            required
            maxLength={200}
            placeholder="e.g. whether to take the contract and hire one person"
            className={`mt-1.5 ${inputClass}`}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="future-horizon">
              Time horizon
            </label>
            <select
              id="future-horizon"
              name="horizon"
              defaultValue="1_year"
              className={`mt-1.5 ${inputClass}`}
            >
              {HORIZONS.map((horizon) => (
                <option key={horizon.value} value={horizon.value}>
                  {horizon.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass} htmlFor="future-goal">
              Link to one of your goals (optional)
            </label>
            <select
              id="future-goal"
              name="goal_id"
              defaultValue={defaultGoalId}
              className={`mt-1.5 ${inputClass}`}
            >
              <option value="">No goal — keep it separate</option>
              {goals.map((goal) => (
                <option key={goal.id} value={goal.id}>
                  {goal.title}
                </option>
              ))}
            </select>
            <p className={hintClass}>
              A linked goal is where an approved action becomes a task. It is the
              only access this workspace has to your goals.
            </p>
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="future-success">
            What would success mean to you?
          </label>
          <textarea
            id="future-success"
            name="success_definition"
            required
            rows={2}
            maxLength={1000}
            placeholder="e.g. steady income without losing the work I like"
            className={`mt-1.5 ${inputClass}`}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="future-resources">
              Available resources
            </label>
            <textarea
              id="future-resources"
              name="resources"
              rows={3}
              maxLength={2000}
              placeholder="Time, money, people, skills you already have"
              className={`mt-1.5 ${inputClass}`}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="future-constraints">
              Constraints
            </label>
            <textarea
              id="future-constraints"
              name="constraints"
              rows={3}
              maxLength={2000}
              placeholder="Things you cannot change: caring duties, notice periods, budget"
              className={`mt-1.5 ${inputClass}`}
            />
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="future-uncertainties">
            What are you uncertain about?
          </label>
          <textarea
            id="future-uncertainties"
            name="uncertainties"
            rows={2}
            maxLength={2000}
            placeholder="What you genuinely do not know yet"
            className={`mt-1.5 ${inputClass}`}
          />
        </div>

        <div className="sm:max-w-xs">
          <label className={labelClass} htmlFor="future-model">
            Model
          </label>
          <select
            id="future-model"
            name="model"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            className={`mt-1.5 ${inputClass}`}
          >
            {AI_MODELS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label} — {option.vendor}
              </option>
            ))}
          </select>
          <p className={hintClass}>
            This request: {operationChargeLabel("future_paths")}. The key stays on
            the server.
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-1 rounded-xl border border-line bg-card p-3 text-xs leading-relaxed text-muted">
        <p>{NO_PREDICTION_NOTE}</p>
        <p>{ASSUMPTION_BASED_NOTE}</p>
        <p>{NO_HIGH_STAKES_NOTE}</p>
      </div>

      <p aria-live="polite" className="mt-3 min-h-5 text-sm">
        {state.status === "error" ? (
          <span className="text-danger">{state.message}</span>
        ) : (
          <span className="text-muted">
            Nothing is generated until you press the button.
          </span>
        )}
      </p>

      <SubmitButton pendingLabel="Sketching three scenarios…" className={`${primaryButton} mt-2`}>
        Generate three scenarios
      </SubmitButton>
    </form>
  );
}

/**
 * One editor per scenario. Saving rewrites only this scenario, and every list
 * keeps one item per line. Rewritten lines become the person's own statements.
 */
export function ScenarioEditor({
  pathId,
  scenario,
}: {
  pathId: string;
  scenario: FutureScenario;
}) {
  const [state, formAction] = useActionState(
    updateScenarioAction,
    idleFuturePathState,
  );

  return (
    <details className="mt-4 rounded-xl border border-line bg-paper p-3">
      <summary className="cursor-pointer rounded text-sm font-semibold">
        Edit this scenario
      </summary>
      <p className={`${hintClass} mt-2`}>
        One item per line. Lines you leave exactly as they are keep their label;
        anything you rewrite is saved as something you provided.
      </p>
      <form action={formAction} className="mt-3 space-y-4">
        <input type="hidden" name="path_id" value={pathId} />
        <input type="hidden" name="scenario_id" value={scenario.id} />

        {SCENARIO_LIST_FIELDS.map((field) => (
          <div key={field}>
            <label className={labelClass} htmlFor={`${scenario.id}-${field}`}>
              {LIST_FIELD_LABELS[field]}
            </label>
            <textarea
              id={`${scenario.id}-${field}`}
              name={field}
              rows={4}
              defaultValue={listToLines(scenario[field])}
              className={`mt-1.5 ${inputClass}`}
            />
            <p className={hintClass}>{LIST_FIELD_HINTS[field]}</p>
          </div>
        ))}

        <p aria-live="polite" className="min-h-5 text-sm">
          {state.status === "error" ? (
            <span className="text-danger">{state.message}</span>
          ) : state.status === "success" ? (
            <span className="text-mint">{state.message}</span>
          ) : null}
        </p>

        <SubmitButton pendingLabel="Saving…" className={secondaryButton}>
          Save this scenario
        </SubmitButton>
      </form>
    </details>
  );
}

/**
 * Converts one action into a task. When the path has no goal, the button is
 * replaced by a plain explanation rather than silently doing nothing.
 */
export function ConvertActionButton({
  pathId,
  kind,
  index,
  added,
  canConvert,
}: {
  pathId: string;
  kind: ScenarioKind;
  index: number;
  added: boolean;
  canConvert: boolean;
}) {
  const [state, formAction] = useActionState(
    convertActionAction,
    idleFuturePathState,
  );

  if (added) {
    return (
      <span className="inline-flex items-center rounded-full border border-mint/40 bg-mint/10 px-2.5 py-1 text-xs font-medium text-mint">
        Added to tasks
      </span>
    );
  }

  if (!canConvert) {
    return (
      <span className="text-xs leading-relaxed text-muted">
        Link a goal to add this as a task.
      </span>
    );
  }

  return (
    <form action={formAction} className="inline-flex flex-wrap items-center gap-2">
      <input type="hidden" name="path_id" value={pathId} />
      <input type="hidden" name="scenario_kind" value={kind} />
      <input type="hidden" name="action_index" value={index} />
      <SubmitButton pendingLabel="Adding…" className={quietButton}>
        Add as a task
      </SubmitButton>
      {state.status === "error" ? (
        <span className="text-xs text-danger">{state.message}</span>
      ) : null}
    </form>
  );
}

/** The person's own decision record: optional, editable and clearable. */
export function RationaleForm({ path }: { path: FuturePath }) {
  const [state, formAction] = useActionState(saveRationaleAction, idleFuturePathState);

  return (
    <form action={formAction} className={`${cardClass} mt-4`}>
      <input type="hidden" name="path_id" value={path.id} />
      <h2 className="text-lg font-bold">Your decision</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Optional. Record what you decided and why, and when you want to look at
        it again. Nothing is scheduled or sent.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="future-chosen">
            Scenario you are leaning toward
          </label>
          <select
            id="future-chosen"
            name="chosen_kind"
            defaultValue={path.chosen_kind ?? ""}
            className={`mt-1.5 ${inputClass}`}
          >
            <option value="">No choice saved</option>
            {SCENARIO_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {SCENARIO_LABELS[kind]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="future-review">
            Review this on
          </label>
          <input
            id="future-review"
            name="review_at"
            type="date"
            defaultValue={path.review_at ?? ""}
            className={`mt-1.5 ${inputClass}`}
          />
          {path.review_at ? (
            <p className={hintClass}>
              Currently {formatFutureDay(path.review_at)}. It is a reminder only
              — nothing is sent.
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-4">
        <label className={labelClass} htmlFor="future-rationale">
          Why this choice, and what would change your mind
        </label>
        <textarea
          id="future-rationale"
          name="rationale"
          rows={4}
          maxLength={4000}
          defaultValue={path.rationale ?? ""}
          placeholder="e.g. The contract only makes sense if I can hire by March. If not, I stay solo."
          className={`mt-1.5 ${inputClass}`}
        />
      </div>

      <p aria-live="polite" className="mt-3 min-h-5 text-sm">
        {state.status === "error" ? (
          <span className="text-danger">{state.message}</span>
        ) : state.status === "success" ? (
          <span className="text-mint">{state.message}</span>
        ) : path.rationale_saved_at ? (
          <span className="text-muted">
            Last saved {formatFutureDay(path.rationale_saved_at)}.
          </span>
        ) : null}
      </p>

      <SubmitButton pendingLabel="Saving…" className={secondaryButton}>
        Save decision notes
      </SubmitButton>
    </form>
  );
}

/** Deletes the path only. Converted tasks are ordinary tasks and stay. */
export function DeleteFuturePathForm({ pathId }: { pathId: string }) {
  const [state, formAction] = useActionState(
    deleteFuturePathAction,
    idleFuturePathState,
  );
  const [confirmed, setConfirmed] = useState(false);

  return (
    <details className={`${cardClass} mt-6`}>
      <summary className="cursor-pointer rounded text-sm font-semibold">
        Delete this future path
      </summary>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        This removes the scenarios, the evidence labels and your decision notes.
        Tasks you already added stay in your goal. This cannot be undone.
      </p>
      <form action={formAction} className="mt-3 space-y-3">
        <input type="hidden" name="path_id" value={pathId} />
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-1"
          />
          <span>I understand the scenarios will be deleted.</span>
        </label>
        <SubmitButton className={dangerButton} disabled={!confirmed} pendingLabel="Deleting…">
          Delete future path
        </SubmitButton>
        {state.status === "error" ? (
          <p className="text-sm text-danger">{state.message}</p>
        ) : null}
      </form>
    </details>
  );
}

/** Small link used on a goal page to start a path from that goal. */
export function StartFromGoalLink({ goalId }: { goalId: string }) {
  return (
    <Link
      href={`/futures?goal=${goalId}`}
      className={`mt-2 inline-block rounded text-sm font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-ink`}
    >
      Explore three future paths
    </Link>
  );
}
