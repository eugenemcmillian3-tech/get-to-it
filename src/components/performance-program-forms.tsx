"use client";

import { useActionState, useState } from "react";
import { idleBuildState } from "@/lib/action-state";
import {
  closePerformanceProgramAction,
  recordHumanReferenceAction,
  registerPerformanceProgramAction,
  reviewPerformanceTrialAction,
  runPerformanceTrialsAction,
} from "@/lib/actions/performance-program";
import type { ReviewableTrial } from "@/lib/data/performance-program";
import {
  CLAIM_LABELS,
  CLAIM_NOTES,
  CLAIM_UNITS,
  PERFORMANCE_CLAIMS,
  type FamilyOption,
  type PerformanceClaim,
} from "@/lib/performance-program";
import { cardClass, inputClass, labelClass, primaryButton, quietButton } from "@/lib/styles";

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

const PROTOCOL_FIELDS = [
  {
    name: "inclusionRules",
    label: "Inclusion rules",
    hint: "Which tasks belong to the family, and why.",
    rows: 2,
  },
  {
    name: "exclusionRules",
    label: "Exclusion rules",
    hint: "What is deliberately outside it, so nobody reads the result as broader than it is.",
    rows: 2,
  },
  {
    name: "scoringMethod",
    label: "Scoring method",
    hint: "How a trial becomes pass, partial or fail, and how the mean is computed.",
    rows: 2,
  },
  {
    name: "humanAssistancePolicy",
    label: "Human assistance policy",
    hint: "Whether a person may help, and how that help is recorded against a trial.",
    rows: 2,
  },
  {
    name: "failureCriteria",
    label: "Failure criteria",
    hint: "What counts as a failed experiment, stated before the run.",
    rows: 2,
  },
] as const;

export type RegisterPrefill = {
  question: string;
  inclusionRules: string;
  exclusionRules: string;
  scoringMethod: string;
  humanAssistancePolicy: string;
  failureCriteria: string;
  claimText: string;
  trials: number;
  timeLimitSeconds: number;
  costLimitCents: number;
  maxDisagreements: number;
  minimumEffect: number;
  noninferiorityMargin: number;
};

export function RegisterProgramForm({
  workspaceId,
  families,
  defaultAllFamilies = false,
  defaultClaim,
  prefill,
}: {
  workspaceId: string;
  families: FamilyOption[];
  defaultAllFamilies?: boolean;
  defaultClaim?: PerformanceClaim;
  prefill?: RegisterPrefill;
}) {
  const [state, action] = useActionState(registerPerformanceProgramAction, idleBuildState);
  const [allFamilies, setAllFamilies] = useState(defaultAllFamilies);
  const [familyKey, setFamilyKey] = useState(families[0]?.key ?? "");
  const family = families.find((row) => row.key === familyKey) ?? families[0];
  const [candidatePolicy, setCandidatePolicy] = useState(family?.candidates[0]?.key ?? "");
  const candidates = family?.candidates ?? [];
  const selectedCandidate = candidates.some((row) => row.key === candidatePolicy)
    ? candidatePolicy
    : (candidates[0]?.key ?? "");

  return (
    <section
      id="register-program"
      aria-labelledby="register-program-heading"
      className={`${cardClass} mt-8`}
    >
      <h2 id="register-program-heading" className="text-xl font-bold">
        Register a comparison
      </h2>
      <p className="mt-1 text-sm text-muted">
        Everything below is fixed the moment you register. Trials can only be recorded afterwards,
        and the report derives the claim from those trials — so the claim is decided before the
        numbers exist, not chosen from them.
      </p>

      {prefill ? (
        <p className="mt-3 rounded-xl border border-line bg-card px-3 py-2 text-xs text-muted">
          Prefilled from the comparison you came from. The family set and claim come from the link;
          review every other field and give this comparison its own title before registering.
        </p>
      ) : null}

      <form action={action} className="mt-4 grid gap-4">
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <input
          type="hidden"
          name="scope"
          value={allFamilies ? "all_families" : "one_family"}
        />

        <label className="grid gap-1">
          <span className={labelClass}>Title</span>
          <input name="title" required minLength={5} maxLength={160} className={inputClass} />
        </label>

        <label className="grid gap-1">
          <span className={labelClass}>The question this comparison answers</span>
          <textarea
            name="question"
            required
            minLength={20}
            maxLength={1000}
            rows={2}
            defaultValue={prefill?.question}
            className={inputClass}
          />
        </label>

        <label className="flex items-start gap-2 rounded-xl border border-line p-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={allFamilies}
            onChange={(event) => setAllFamilies(event.target.checked)}
          />
          <span>
            <span className="text-sm font-semibold">Compare every installed family</span>
            <span className="block text-xs text-muted">
              Registers every family installed right now, each with its own tasks, baseline and
              candidate. Results are reported per family and never pooled into one score.
            </span>
          </span>
        </label>

        {allFamilies ? (
          <input type="hidden" name="familyKey" value={families[0]?.key ?? ""} />
        ) : (
          <label className="grid gap-1">
            <span className={labelClass}>Task family</span>
            <select
              name="familyKey"
              className={inputClass}
              value={familyKey}
              onChange={(event) => {
                const next = event.target.value;
                setFamilyKey(next);
                const chosen = families.find((row) => row.key === next);
                setCandidatePolicy(chosen?.candidates[0]?.key ?? "");
              }}
            >
              {families.map((row) => (
                <option key={row.key} value={row.key}>
                  {row.label} · {row.tasks} tasks
                </option>
              ))}
            </select>
            <span className="text-xs text-muted">
              {family?.description} The distribution and its digest are built from the installed
              family, not typed in here.
            </span>
          </label>
        )}

        {PROTOCOL_FIELDS.map((field) => (
          <label key={field.name} className="grid gap-1">
            <span className={labelClass}>{field.label}</span>
            <textarea
              name={field.name}
              required
              rows={field.rows}
              minLength={field.name === "exclusionRules" ? 10 : 20}
              maxLength={2000}
              defaultValue={prefill?.[field.name]}
              className={inputClass}
            />
            <span className="text-xs text-muted">{field.hint}</span>
          </label>
        ))}

        <div className="grid gap-4 sm:grid-cols-2">
          {allFamilies ? (
            <p className="text-sm text-muted sm:col-span-2">
              Baseline and candidate: each installed family&apos;s own shipped and candidate policy.
              {families.map((row) => ` ${row.label}: ${row.baselineLabel} → ${row.candidates[0]?.label ?? ""}.`)}
            </p>
          ) : (
            <>
              <label className="grid gap-1">
                <span className={labelClass}>Baseline</span>
                <input value={family?.baselineLabel ?? ""} readOnly className={inputClass} />
              </label>
              <label className="grid gap-1">
                <span className={labelClass}>Candidate</span>
                <select
                  name="candidatePolicy"
                  className={inputClass}
                  value={selectedCandidate}
                  onChange={(event) => setCandidatePolicy(event.target.value)}
                >
                  {candidates.map((row) => (
                    <option key={row.key} value={row.key}>
                      {row.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <label className="grid gap-1">
            <span className={labelClass}>Trials per task</span>
            <input
              type="number"
              name="trials"
              min={1}
              max={20}
              defaultValue={prefill?.trials ?? 3}
              required
              className={inputClass}
            />
          </label>
          <label className="grid gap-1">
            <span className={labelClass}>Time limit (seconds per trial)</span>
            <input
              type="number"
              name="timeLimitSeconds"
              min={10}
              max={3600}
              defaultValue={prefill?.timeLimitSeconds ?? 120}
              required
              className={inputClass}
            />
          </label>
          <label className="grid gap-1">
            <span className={labelClass}>Cost limit (cents per trial)</span>
            <input
              type="number"
              name="costLimitCents"
              min={0}
              max={100000}
              defaultValue={prefill?.costLimitCents ?? 20}
              required
              className={inputClass}
            />
          </label>
          <label className="grid gap-1">
            <span className={labelClass}>Disagreement allowance</span>
            <input
              type="number"
              name="maxDisagreements"
              min={0}
              max={100}
              defaultValue={prefill?.maxDisagreements ?? 0}
              required
              className={inputClass}
            />
          </label>
        </div>

        <label className="grid gap-1">
          <span className={labelClass}>The one claim this program could support</span>
          <select
            name="supportedClaim"
            className={inputClass}
            defaultValue={defaultClaim ?? "benchmark"}
          >
            {PERFORMANCE_CLAIMS.map((claim) => (
              <option key={claim} value={claim}>
                {CLAIM_LABELS[claim]}
              </option>
            ))}
          </select>
        </label>
        <ul className="grid gap-1 text-xs text-muted">
          {PERFORMANCE_CLAIMS.map((claim) => (
            <li key={claim}>
              <strong>{CLAIM_LABELS[claim]}:</strong> {CLAIM_NOTES[claim]} Minimum effect in{" "}
              {CLAIM_UNITS[claim]}.
            </li>
          ))}
        </ul>

        <label className="grid gap-1">
          <span className={labelClass}>Claim text</span>
          <textarea
            name="claimText"
            required
            minLength={20}
            maxLength={500}
            rows={2}
            defaultValue={prefill?.claimText}
            placeholder="On these twelve authored intents, the candidate reaches the expected tool at least 20% more often than the shipped policy."
            className={inputClass}
          />
          <span className="text-xs text-muted">
            A specific, falsifiable sentence. AGI, superintelligence and singularity claims are
            refused here and cannot be derived from one task family.
          </span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1">
            <span className={labelClass}>Minimum effect</span>
            <input
              type="number"
              name="minimumEffect"
              min={0}
              max={100}
              step="0.01"
              defaultValue={prefill?.minimumEffect ?? 0.2}
              required
              className={inputClass}
            />
          </label>
          <label className="grid gap-1">
            <span className={labelClass}>Non-inferiority margin</span>
            <input
              type="number"
              name="noninferiorityMargin"
              min={0}
              max={1}
              step="0.01"
              defaultValue={prefill?.noninferiorityMargin ?? 0}
              required
              className={inputClass}
            />
            <span className="text-xs text-muted">
              How much score a speed or cost claim may trade away.
            </span>
          </label>
        </div>

        <div>
          <button type="submit" className={primaryButton}>
            Register and freeze the comparison
          </button>
        </div>
        <Note state={state} />
      </form>
    </section>
  );
}

export function RunProgramForm({
  workspaceId,
  programId,
  status,
  hasTrials,
}: {
  workspaceId: string;
  programId: string;
  status: string;
  hasTrials: boolean;
}) {
  const [state, action] = useActionState(runPerformanceTrialsAction, idleBuildState);
  const [closeState, closeAction] = useActionState(closePerformanceProgramAction, idleBuildState);

  return (
    <div className="mt-4">
      {status === "registered" && !hasTrials ? (
        <form action={action}>
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <input type="hidden" name="programId" value={programId} />
          <button type="submit" className={primaryButton}>
            Run the registered trials
          </button>
        </form>
      ) : null}

      {status === "registered" ? (
        <form action={closeAction} className="mt-3">
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <input type="hidden" name="programId" value={programId} />
          <button type="submit" className={quietButton}>
            Close this comparison
          </button>
        </form>
      ) : null}

      <Note state={state} />
      <Note state={closeState} />
    </div>
  );
}

export function HumanReferenceForm({
  workspaceId,
  programId,
  status,
}: {
  workspaceId: string;
  programId: string;
  status: string;
}) {
  const [state, action] = useActionState(recordHumanReferenceAction, idleBuildState);

  if (status === "draft") {
    return <p className="mt-2 text-sm text-muted">Register the comparison first.</p>;
  }

  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-sm font-semibold">
        Document a human reference
      </summary>
      <p className="mt-1 text-xs text-muted">
        Only results that were actually collected, with the conditions recorded. This app never
        invents an expert comparison.
      </p>
      <form action={action} className="mt-3 grid gap-3">
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <input type="hidden" name="programId" value={programId} />

        {[
          ["expertise", "Who took part, and their relevant expertise"],
          ["toolAccess", "What tools they could use"],
          ["conditions", "Working conditions: time, setting, assistance"],
          ["consentBasis", "Consent and privacy basis"],
          ["collectionMethod", "How the results were collected and scored"],
        ].map(([name, label]) => (
          <label key={name} className="grid gap-1">
            <span className={labelClass}>{label}</span>
            <textarea name={name} required rows={2} className={inputClass} />
          </label>
        ))}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1">
            <span className={labelClass}>Participants</span>
            <input type="number" name="participants" min={1} max={1000} defaultValue={1} required className={inputClass} />
          </label>
          <label className="grid gap-1">
            <span className={labelClass}>Tasks attempted</span>
            <input type="number" name="taskCount" min={1} max={1000} defaultValue={12} required className={inputClass} />
          </label>
          <label className="grid gap-1">
            <span className={labelClass}>Passed</span>
            <input type="number" name="passed" min={0} max={1000} defaultValue={0} required className={inputClass} />
          </label>
          <label className="grid gap-1">
            <span className={labelClass}>Mean score (0–1)</span>
            <input type="number" name="meanScore" min={0} max={1} step="0.0001" defaultValue={0} required className={inputClass} />
          </label>
        </div>

        <label className="grid gap-1">
          <span className={labelClass}>Notes</span>
          <input name="notes" className={inputClass} />
        </label>

        <div>
          <button type="submit" className={quietButton}>
            Record the reference
          </button>
        </div>
        <Note state={state} />
      </form>
    </details>
  );
}

export function ReviewTrialForm({
  workspaceId,
  programId,
  trials,
}: {
  workspaceId: string;
  programId: string;
  trials: ReviewableTrial[];
}) {
  const [state, action] = useActionState(reviewPerformanceTrialAction, idleBuildState);

  if (trials.length === 0) {
    return (
      <p className="mt-2 text-sm text-muted">
        Nothing here can be reviewed independently: every recorded trial was entered by you or by
        the person who registered the comparison.
      </p>
    );
  }

  return (
    <form action={action} className="mt-3 grid gap-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="programId" value={programId} />

      <label className="grid gap-1">
        <span className={labelClass}>Trial</span>
        <select name="trialId" className={inputClass} required>
          {trials.map((row) => (
            <option key={row.id} value={row.id}>
              {row.config} · {row.taskKey} · trial {row.trial} · {row.outcome}
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1">
          <span className={labelClass}>Your verdict after rescoring</span>
          <select name="verdict" className={inputClass} defaultValue="agree">
            <option value="agree">Agree with the recorded outcome</option>
            <option value="disagree">Disagree</option>
          </select>
        </label>
        <label className="grid gap-1">
          <span className={labelClass}>What you checked</span>
          <input name="note" required minLength={10} maxLength={500} className={inputClass} />
        </label>
      </div>

      <div>
        <button type="submit" className={quietButton}>
          Record the review mark
        </button>
      </div>
      <Note state={state} />
    </form>
  );
}
