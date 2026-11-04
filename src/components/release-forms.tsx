"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleBuildState, type BuildState } from "@/lib/action-state";
import {
  addReleaseCheckAction,
  approveIncidentRecoveryAction,
  captureReleaseAction,
  disableReleaseAutomationAction,
  prepareIncidentRecoveryAction,
  proposeIncidentDiagnosisAction,
  recordSmokeResultAction,
  runReleaseChecksAction,
  saveReleaseAutomationAction,
} from "@/lib/actions/releases";
import {
  dangerButton,
  hintClass,
  inputClass,
  labelClass,
  primaryButton,
  quietButton,
  secondaryButton,
} from "@/lib/styles";

function Note({ state, idle }: { state: BuildState; idle?: string }) {
  if (state.status === "error") return <span className="text-danger" role="alert">{state.message}</span>;
  if (state.status === "success") return <span className="text-mint">{state.message}</span>;
  return idle ? <span className="text-muted">{idle}</span> : null;
}

export function CaptureReleaseForm({ projectId }: { projectId: string }) {
  const [state, action] = useActionState(captureReleaseAction, idleBuildState);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="project_id" value={projectId} />
      <SubmitButton className={primaryButton} pendingLabel="Assembling evidence…">
        Capture release evidence
      </SubmitButton>
      <p className="text-xs text-muted">
        Captures the current pinned source version, matching deployment, merged changes and redacted error evidence. It does not deploy anything.
      </p>
      <Note state={state} idle="No release evidence captured in this session." />
    </form>
  );
}

export function AddReleaseCheckForm({ projectId }: { projectId: string }) {
  const [state, action] = useActionState(addReleaseCheckAction, idleBuildState);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="project_id" value={projectId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Name
          <input name="name" required maxLength={80} className={`${inputClass} mt-1`} placeholder="Home page" />
        </label>
        <label className={labelClass}>
          Kind
          <select name="kind" defaultValue="health" className={`${inputClass} mt-1`}>
            <option value="health">Health check</option>
            <option value="route">Selected route</option>
            <option value="error_rate">Error-rate observation</option>
            <option value="smoke">Functional smoke test</option>
          </select>
        </label>
        <label className={labelClass}>
          Relative route
          <input name="target" defaultValue="/" maxLength={1000} className={`${inputClass} mt-1`} placeholder="/ or /health" />
          <span className={hintClass}>Used by health and route checks. Full URLs are refused.</span>
        </label>
        <label className={labelClass}>
          Expected HTTP status
          <input name="expected_status" type="number" min={100} max={599} defaultValue={200} className={`${inputClass} mt-1`} />
        </label>
        <label className={labelClass}>
          Error threshold (24 hours)
          <input name="max_errors" type="number" min={0} max={1000} defaultValue={0} className={`${inputClass} mt-1`} />
        </label>
      </div>
      <label className={labelClass}>
        Functional smoke steps
        <textarea name="instructions" rows={3} maxLength={4000} className={`${inputClass} mt-1`} placeholder="Only needed for a functional smoke test: what a person should do and observe." />
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input name="destructive" type="checkbox" className="mt-1" />
        <span>
          This check writes or deletes data.
          <span className="mt-1 block text-xs text-muted">Destructive checks are skipped against production by default; this phase never runs them automatically.</span>
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton className={secondaryButton} pendingLabel="Saving…">Add check</SubmitButton>
        <span className="text-sm"><Note state={state} /></span>
      </div>
    </form>
  );
}

export function RunReleaseChecksForm({
  projectId,
  releaseId,
  disabled,
}: {
  projectId: string;
  releaseId: string;
  disabled?: boolean;
}) {
  const [state, action] = useActionState(runReleaseChecksAction, idleBuildState);
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="release_id" value={releaseId} />
      <SubmitButton className={secondaryButton} pendingLabel="Observing…" disabled={disabled}>
        Run configured checks
      </SubmitButton>
      <p className="text-xs text-muted">
        Unauthenticated GETs use no account and write no production data. Missing or unsafe checks are recorded as skipped, never passed.
      </p>
      <p className="text-xs"><Note state={state} /></p>
    </form>
  );
}

export function RecordSmokeForm({
  projectId,
  releaseId,
  configId,
  name,
}: {
  projectId: string;
  releaseId: string;
  configId: string;
  name: string;
}) {
  const [state, action] = useActionState(recordSmokeResultAction, idleBuildState);
  return (
    <form action={action} className="mt-3 space-y-2 rounded-xl border border-line p-3">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="release_id" value={releaseId} />
      <input type="hidden" name="config_id" value={configId} />
      <p className="text-sm font-semibold">Record functional smoke result: {name}</p>
      <div className="flex flex-wrap gap-3">
        <label className="text-sm">
          <input type="radio" name="result" value="passed" defaultChecked /> Passed
        </label>
        <label className="text-sm">
          <input type="radio" name="result" value="failed" /> Failed
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" name="synthetic" defaultChecked /> Synthetic account
        </label>
      </div>
      <label className={labelClass}>
        What was exercised and observed
        <textarea name="detail" rows={2} required maxLength={2000} className={`${inputClass} mt-1`} />
      </label>
      <SubmitButton className={secondaryButton} pendingLabel="Recording…">Record manual result</SubmitButton>
      <p className="text-xs"><Note state={state} /></p>
    </form>
  );
}

export function IncidentDiagnosisForm({ projectId, incidentId }: { projectId: string; incidentId: string }) {
  const [state, action] = useActionState(proposeIncidentDiagnosisAction, idleBuildState);
  return (
    <form action={action} className="mt-3 space-y-2">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="incident_id" value={incidentId} />
      <label className={labelClass}>
        Hypothesis (not a root cause)
        <textarea name="hypothesis" rows={2} required maxLength={2000} className={`${inputClass} mt-1`} />
      </label>
      <label className={labelClass}>
        Evidence supporting the hypothesis
        <textarea name="support" rows={2} required maxLength={2000} className={`${inputClass} mt-1`} />
      </label>
      <SubmitButton className={secondaryButton} pendingLabel="Recording hypothesis…">Propose diagnosis</SubmitButton>
      <p className="text-xs text-muted">The dashboard never records a confirmed root cause from this form.</p>
      <p className="text-xs"><Note state={state} /></p>
    </form>
  );
}

export function PrepareRecoveryForm({
  projectId,
  incidentId,
  databaseRecoverySuggested,
}: {
  projectId: string;
  incidentId: string;
  databaseRecoverySuggested: boolean;
}) {
  const [state, action] = useActionState(prepareIncidentRecoveryAction, idleBuildState);
  return (
    <form action={action} className="mt-3 space-y-2">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="incident_id" value={incidentId} />
      <label className={labelClass}>
        Recovery kind
        <select name="kind" defaultValue="patch" className={`${inputClass} mt-1`}>
          <option value="patch">Prepare an application patch</option>
          <option value="code_rollback">Application code rollback</option>
          <option value="config_rollback">Configuration rollback</option>
          <option value="database_recovery">Database recovery</option>
        </select>
      </label>
      <p className="text-xs text-muted">
        These are distinct. {databaseRecoverySuggested ? "This release has migration requirements; database recovery must be planned separately. " : ""}
        A code rollback does not reverse a destructive migration.
      </p>
      <SubmitButton className={dangerButton} pendingLabel="Preparing plan…">Prepare plan and request approval</SubmitButton>
      <p className="text-xs"><Note state={state} /></p>
    </form>
  );
}

export function ApproveRecoveryForm({ projectId, incidentId }: { projectId: string; incidentId: string }) {
  const [state, action] = useActionState(approveIncidentRecoveryAction, idleBuildState);
  return (
    <form action={action} className="mt-3 space-y-2">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="incident_id" value={incidentId} />
      <label className={labelClass}>
        Type <code>APPROVE</code> to approve the prepared plan
        <input name="confirmation" autoComplete="off" required className={`${inputClass} mt-1 max-w-xs`} />
      </label>
      <SubmitButton className={dangerButton} pendingLabel="Approving…">Approve prepared recovery</SubmitButton>
      <p className="text-xs text-muted">Approval records human consent only. It does not execute a rollback.</p>
      <p className="text-xs"><Note state={state} /></p>
    </form>
  );
}

export function AutomationForm({
  projectId,
  enabled,
  conditions,
  limitations,
}: {
  projectId: string;
  enabled: boolean;
  conditions: string[];
  limitations: string;
}) {
  const [state, action] = useActionState(saveReleaseAutomationAction, idleBuildState);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="project_id" value={projectId} />
      <label className="flex items-start gap-2 text-sm font-semibold">
        <input name="auto_rollback_enabled" type="checkbox" defaultChecked={enabled} className="mt-1" />
        <span>
          Enable automatic rollback
          <span className="mt-1 block text-xs font-normal text-muted">
            Off by default. Enabling records conditions and limitations; no rollback runs from this form.
          </span>
        </span>
      </label>
      <label className={labelClass}>
        Explicit conditions, one per line
        <textarea
          name="conditions"
          rows={3}
          maxLength={3000}
          defaultValue={conditions.join("\n")}
          className={`${inputClass} mt-1`}
          placeholder={"A configured health check fails twice\nA production deployment is affected"}
        />
      </label>
      <label className={labelClass}>
        Known limitations
        <textarea
          name="limitations"
          rows={3}
          maxLength={4000}
          defaultValue={limitations}
          className={`${inputClass} mt-1`}
          placeholder="What this automatic rollback cannot reverse or detect."
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton className={secondaryButton} pendingLabel="Saving automation…">Save automation setting</SubmitButton>
        <span className="text-sm"><Note state={state} /></span>
      </div>
    </form>
  );
}

export function DisableAutomationForm({ projectId }: { projectId: string }) {
  const [state, action] = useActionState(disableReleaseAutomationAction, idleBuildState);
  return (
    <form action={action} className="mt-2">
      <input type="hidden" name="project_id" value={projectId} />
      <button type="submit" className={quietButton}>Disable automatic rollback now</button>
      {state.status === "error" ? <p className="text-xs text-danger" role="alert">{state.message}</p> : null}
      {state.status === "success" ? <p className="text-xs text-mint">{state.message}</p> : null}
    </form>
  );
}
