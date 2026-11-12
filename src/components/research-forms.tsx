"use client";

import { useActionState } from "react";
import { idleResearchState } from "@/lib/action-state";
import {
  addResearchFindingAction,
  addResearchSourceAction,
  cancelResearchMissionAction,
  completeResearchMissionAction,
  createResearchMissionAction,
  planResearchTasksAction,
  proposeResearchExperimentAction,
  seedSyntheticResearchAction,
} from "@/lib/actions/research";
import type { ResearchOrchestrationOption } from "@/lib/data/research";
import type { ResearchHypothesis } from "@/lib/research-missions";
import {
  FINDING_LABELS,
  FINDING_LABEL_LABELS,
  RESEARCH_FUNCTION_LABELS,
  RESEARCH_SPECIALIST_FUNCTIONS,
  RESEARCH_TOOLS,
  RESEARCH_SOURCE_KINDS,
  RESEARCH_SOURCE_KIND_LABELS,
  REQUIRED_SOURCE_TIERS,
  REQUIRED_SOURCE_TIER_LABELS,
  SOURCE_STANCES,
  SOURCE_STANCE_LABELS,
  SOURCE_TIERS,
  SOURCE_TIER_LABELS,
  STATEMENT_KINDS,
  STATEMENT_KIND_LABELS,
} from "@/lib/research-missions";
import {
  cardClass,
  focusRing,
  hintClass,
  inputClass,
  labelClass,
  primaryButton,
  quietButton,
  secondaryButton,
} from "@/lib/styles";

function Note({ state }: { state: { status: string; message?: string } }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <p
      role="status"
      className={`mt-3 rounded-xl border px-3 py-2 text-sm ${
        state.status === "error"
          ? "border-red-300 bg-red-50 text-red-800"
          : "border-emerald-300 bg-emerald-50 text-emerald-900"
      }`}
    >
      {state.message}
    </p>
  );
}

const TOOL_LABELS: Record<string, string> = {
  read_workspace_records: "Read workspace records",
  read_project_files: "Read project files",
  read_web_page: "Read a web page",
  run_read_only_query: "Run a read-only query",
  build_sandbox_prototype: "Build a sandbox prototype",
  draft_document: "Draft a document",
};

export function CreateResearchMissionForm({
  workspaceId,
  orchestrations,
}: {
  workspaceId: string;
  orchestrations: ResearchOrchestrationOption[];
}) {
  const [state, action] = useActionState(createResearchMissionAction, idleResearchState);

  return (
    <section aria-labelledby="contract-heading" className={`mt-6 ${cardClass}`}>
      <h2 id="contract-heading" className="text-lg font-bold">
        Write a research contract
      </h2>
      <p className="mt-1 text-sm text-muted">
        A mission is bounded before any work starts: the question, what is out of
        scope, the competing explanations, the source quality you will accept, and
        the limits it stops at.
      </p>

      <form action={action} className="mt-4 grid gap-4">
        <input type="hidden" name="workspace_id" value={workspaceId} />

        <div>
          <label className={labelClass} htmlFor="question">
            Research question
          </label>
          <input
            id="question"
            name="question"
            className={`${inputClass} mt-1`}
            placeholder="Does a 320 px viewport change whether people finish the weekly review?"
            maxLength={300}
            required
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="scope">
            Scope, including what is out of scope
          </label>
          <textarea
            id="scope"
            name="scope"
            className={`${inputClass} mt-1 min-h-[70px]`}
            maxLength={2000}
            required
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="existing_evidence">
            Existing evidence
          </label>
          <textarea
            id="existing_evidence"
            name="existing_evidence"
            className={`${inputClass} mt-1 min-h-[60px]`}
            maxLength={4000}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="hypothesis_1">
              Leading hypothesis
            </label>
            <textarea
              id="hypothesis_1"
              name="hypothesis_1"
              className={`${inputClass} mt-1`}
              maxLength={1000}
              required
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="hypothesis_2">
              Competing hypothesis
            </label>
            <textarea
              id="hypothesis_2"
              name="hypothesis_2"
              className={`${inputClass} mt-1`}
              maxLength={1000}
              required
            />
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="hypothesis_3">
            Another competing explanation (optional)
          </label>
          <input
            id="hypothesis_3"
            name="hypothesis_3"
            className={`${inputClass} mt-1`}
            maxLength={1000}
          />
        </div>

        <fieldset>
          <legend className={labelClass}>Allowed tools</legend>
          <p className={hintClass}>
            Outreach and publishing are never available to a research mission.
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {RESEARCH_TOOLS.map((tool) => (
              <label key={tool} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="allowed_tools"
                  value={tool}
                  defaultChecked={tool.startsWith("read_") || tool === "draft_document"}
                  className={focusRing}
                />
                {TOOL_LABELS[tool] ?? tool}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="required_source_tier">
              Required source quality
            </label>
            <select
              id="required_source_tier"
              name="required_source_tier"
              className={`${inputClass} mt-1`}
              defaultValue="primary"
            >
              {REQUIRED_SOURCE_TIERS.map((tier) => (
                <option key={tier} value={tier}>
                  {REQUIRED_SOURCE_TIER_LABELS[tier]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="orchestration_id">
              Orchestration that runs it (optional)
            </label>
            <select
              id="orchestration_id"
              name="orchestration_id"
              className={`${inputClass} mt-1`}
              defaultValue=""
            >
              <option value="">No orchestration linked</option>
              {orchestrations.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.goal.slice(0, 70)} ({entry.status})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {[
            ["task_budget", "Task budget", 6, 1, 12],
            ["agent_budget", "Agent budget", 4, 1, 6],
            ["retry_budget", "Retries", 1, 0, 3],
          ].map(([name, label, value, min, max]) => (
            <div key={String(name)}>
              <label className={labelClass} htmlFor={String(name)}>
                {label}
              </label>
              <input
                id={String(name)}
                name={String(name)}
                type="number"
                min={Number(min)}
                max={Number(max)}
                defaultValue={Number(value)}
                className={`${inputClass} mt-1`}
              />
            </div>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="spend_ceiling_cents">
              Spending ceiling (cents)
            </label>
            <input
              id="spend_ceiling_cents"
              name="spend_ceiling_cents"
              type="number"
              min={10}
              max={20000}
              defaultValue={200}
              className={`${inputClass} mt-1`}
            />
            <p className={hintClass}>Shared across the whole mission, in credits of 10 cents.</p>
          </div>
          <div>
            <label className={labelClass} htmlFor="time_ceiling_minutes">
              Time ceiling (minutes)
            </label>
            <input
              id="time_ceiling_minutes"
              name="time_ceiling_minutes"
              type="number"
              min={15}
              max={10080}
              defaultValue={120}
              className={`${inputClass} mt-1`}
            />
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="stop_condition_1">
            Stop conditions
          </label>
          <input
            id="stop_condition_1"
            name="stop_condition_1"
            className={`${inputClass} mt-1`}
            defaultValue="Stop when the spend ceiling is reached."
            maxLength={300}
          />
          <input
            name="stop_condition_2"
            aria-label="Second stop condition"
            className={`${inputClass} mt-2`}
            defaultValue="Stop when two verified sources contradict and nothing resolves it."
            maxLength={300}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="checkpoint_1">
            Human review checkpoints
          </label>
          <input
            id="checkpoint_1"
            name="checkpoint_1"
            className={`${inputClass} mt-1`}
            defaultValue="A person reviews the source list before synthesis."
            maxLength={300}
          />
          <input
            name="checkpoint_2"
            aria-label="Second checkpoint"
            className={`${inputClass} mt-2`}
            defaultValue="A person approves any proposed experiment before it becomes a record."
            maxLength={300}
          />
        </div>

        <div>
          <button type="submit" className={primaryButton}>
            Create the research contract
          </button>
        </div>
        <Note state={state} />
      </form>
    </section>
  );
}

export function SeedSyntheticMissionForm({ workspaceId }: { workspaceId: string }) {
  const [state, action] = useActionState(seedSyntheticResearchAction, idleResearchState);

  return (
    <section aria-labelledby="synthetic-heading" className={`mt-6 ${cardClass}`}>
      <h2 id="synthetic-heading" className="text-lg font-bold">
        Run a synthetic mission
      </h2>
      <p className="mt-1 text-sm text-muted">
        Synthetic data only: four sources with provenance, one of them contradicting,
        and one deliberately unsupported conclusion that the database must refuse.
      </p>
      <form action={action} className="mt-3">
        <input type="hidden" name="workspace_id" value={workspaceId} />
        <button type="submit" className={secondaryButton}>
          Create the synthetic mission
        </button>
        <Note state={state} />
      </form>
    </section>
  );
}

export function AddSourceForm({
  workspaceId,
  missionId,
  hypotheses,
}: {
  workspaceId: string;
  missionId: string;
  hypotheses: ResearchHypothesis[];
}) {
  const [state, action] = useActionState(addResearchSourceAction, idleResearchState);

  return (
    <form action={action} className={`mt-4 grid gap-3 ${cardClass}`}>
      <h3 className="text-base font-bold">Record a source</h3>
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="mission_id" value={missionId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="source_title">
            Title
          </label>
          <input id="source_title" name="title" className={`${inputClass} mt-1`} required />
        </div>
        <div>
          <label className={labelClass} htmlFor="source_locator">
            Where it came from
          </label>
          <input
            id="source_locator"
            name="locator"
            className={`${inputClass} mt-1`}
            placeholder="URL, dataset row, file path"
            required
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={labelClass} htmlFor="source_stance">
            Stance
          </label>
          <select id="source_stance" name="stance" className={`${inputClass} mt-1`}>
            {SOURCE_STANCES.map((stance) => (
              <option key={stance} value={stance}>
                {SOURCE_STANCE_LABELS[stance]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="source_kind_of_statement">
            Statement kind
          </label>
          <select
            id="source_kind_of_statement"
            name="statement_kind"
            className={`${inputClass} mt-1`}
          >
            {STATEMENT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {STATEMENT_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="source_tier">
            Quality
          </label>
          <select id="source_tier" name="source_tier" className={`${inputClass} mt-1`}>
            {SOURCE_TIERS.map((tier) => (
              <option key={tier} value={tier}>
                {SOURCE_TIER_LABELS[tier]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="source_kind">
            Source kind
          </label>
          <select id="source_kind" name="source_kind" className={`${inputClass} mt-1`}>
            {RESEARCH_SOURCE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {RESEARCH_SOURCE_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="source_hypothesis">
            Hypothesis it bears on
          </label>
          <select
            id="source_hypothesis"
            name="hypothesis_id"
            className={`${inputClass} mt-1`}
            defaultValue=""
          >
            <option value="">Not tied to one</option>
            {hypotheses.map((hypothesis) => (
              <option key={hypothesis.id} value={hypothesis.id}>
                {hypothesis.statement.slice(0, 60)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="source_excerpt">
          What it says
        </label>
        <textarea
          id="source_excerpt"
          name="excerpt"
          className={`${inputClass} mt-1 min-h-[70px]`}
          maxLength={4000}
        />
        <p className={hintClass}>
          A quotation needs at least ten characters of the source&apos;s own words.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="verified" value="yes" className={focusRing} />
        I re-read the original and it says what is recorded here
      </label>

      <div>
        <button type="submit" className={secondaryButton}>
          Record source
        </button>
        <Note state={state} />
      </div>
    </form>
  );
}

export function AddFindingForm({
  workspaceId,
  missionId,
  hypotheses,
}: {
  workspaceId: string;
  missionId: string;
  hypotheses: ResearchHypothesis[];
}) {
  const [state, action] = useActionState(addResearchFindingAction, idleResearchState);

  return (
    <form action={action} className={`mt-4 grid gap-3 ${cardClass}`}>
      <h3 className="text-base font-bold">Record a finding</h3>
      <p className="text-sm text-muted">
        Separating an observation from an inference from a proposal is the point.
        A discovery needs a verified supporting source and no verified contradiction.
      </p>
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="mission_id" value={missionId} />

      <div>
        <label className={labelClass} htmlFor="finding_claim">
          The claim
        </label>
        <textarea
          id="finding_claim"
          name="claim"
          className={`${inputClass} mt-1 min-h-[60px]`}
          maxLength={2000}
          required
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={labelClass} htmlFor="finding_label">
            What kind of claim
          </label>
          <select id="finding_label" name="label" className={`${inputClass} mt-1`}>
            {FINDING_LABELS.map((label) => (
              <option key={label} value={label}>
                {FINDING_LABEL_LABELS[label]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="finding_author">
            Written by
          </label>
          <select id="finding_author" name="author_role" className={`${inputClass} mt-1`}>
            {RESEARCH_SPECIALIST_FUNCTIONS.map((role) => (
              <option key={role} value={role}>
                {RESEARCH_FUNCTION_LABELS[role]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="finding_hypothesis">
            Hypothesis
          </label>
          <select
            id="finding_hypothesis"
            name="hypothesis_id"
            className={`${inputClass} mt-1`}
            defaultValue=""
          >
            <option value="">Not tied to one</option>
            {hypotheses.map((hypothesis) => (
              <option key={hypothesis.id} value={hypothesis.id}>
                {hypothesis.statement.slice(0, 60)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="verify" value="yes" className={focusRing} />
        Independently verified by a different specialist function
      </label>

      <div>
        <label className={labelClass} htmlFor="finding_verifier">
          Verifier, when verified
        </label>
        <select
          id="finding_verifier"
          name="verifier_role"
          className={`${inputClass} mt-1`}
          defaultValue="evidence_verifier"
        >
          {RESEARCH_SPECIALIST_FUNCTIONS.map((role) => (
            <option key={role} value={role}>
              {RESEARCH_FUNCTION_LABELS[role]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <button type="submit" className={secondaryButton}>
          Record finding
        </button>
        <Note state={state} />
      </div>
    </form>
  );
}

export function MissionControlForms({
  workspaceId,
  missionId,
  hasExperiment,
  closed,
  orchestrationId,
}: {
  workspaceId: string;
  missionId: string;
  hasExperiment: boolean;
  closed: boolean;
  orchestrationId: string | null;
}) {
  const [planState, planAction] = useActionState(
    planResearchTasksAction,
    idleResearchState,
  );
  const [proposeState, proposeAction] = useActionState(
    proposeResearchExperimentAction,
    idleResearchState,
  );
  const [completeState, completeAction] = useActionState(
    completeResearchMissionAction,
    idleResearchState,
  );
  const [cancelState, cancelAction] = useActionState(
    cancelResearchMissionAction,
    idleResearchState,
  );

  return (
    <section aria-labelledby="mission-actions" className={`mt-6 ${cardClass}`}>
      <h2 id="mission-actions" className="text-lg font-bold">
        The next step
      </h2>
      <p className="mt-1 text-sm text-muted">
        A proposal becomes an ordinary Phase 35 experiment record in draft. It still
        needs its own review, consent and approval before anyone takes part.
      </p>

      <div className="mt-3 flex flex-wrap gap-3">
        <form action={planAction}>
          <input type="hidden" name="workspace_id" value={workspaceId} />
          <input type="hidden" name="mission_id" value={missionId} />
          <button
            type="submit"
            className={secondaryButton}
            disabled={!orchestrationId || closed}
          >
            {orchestrationId
              ? "Add the research plan to the orchestration"
              : "Link an orchestration to plan tasks"}
          </button>
        </form>

        <form action={proposeAction}>
          <input type="hidden" name="workspace_id" value={workspaceId} />
          <input type="hidden" name="mission_id" value={missionId} />
          <button type="submit" className={primaryButton} disabled={hasExperiment || closed}>
            {hasExperiment ? "Experiment already proposed" : "Propose this experiment"}
          </button>
        </form>

        <form action={completeAction}>
          <input type="hidden" name="workspace_id" value={workspaceId} />
          <input type="hidden" name="mission_id" value={missionId} />
          <button type="submit" className={secondaryButton} disabled={closed}>
            Close the mission
          </button>
        </form>

        <form action={cancelAction}>
          <input type="hidden" name="workspace_id" value={workspaceId} />
          <input type="hidden" name="mission_id" value={missionId} />
          <button type="submit" className={quietButton} disabled={closed}>
            Cancel and stop the orchestration
          </button>
        </form>
      </div>

      <Note state={planState} />
      <Note state={proposeState} />
      <Note state={completeState} />
      <Note state={cancelState} />
    </section>
  );
}
