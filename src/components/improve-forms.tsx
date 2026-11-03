"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleBuildState, type BuildState } from "@/lib/action-state";
import {
  approveChangePlanAction,
  clarifyChangeAction,
  createChangeAction,
  createSkillAction,
  deleteMemoryAction,
  enableObservabilityAction,
  implementChangeAction,
  logErrorAction,
  mergeChangeAction,
  proposeRepairAction,
  rejectChangeAction,
  reviewChangeAction,
  saveMemoryAction,
  seedMemoryAction,
  testChangeAction,
} from "@/lib/actions/improvements";
import { CHANGE_KINDS, CHANGE_KIND_LABELS, MEMORY_KINDS, MEMORY_KIND_LABELS } from "@/lib/improvements";
import { dangerButton, inputClass, primaryButton, secondaryButton } from "@/lib/styles";
import type { AppChangeRequest, AppErrorEvent, ProjectMemoryRecord } from "@/lib/types";

function Note({ state }: { state: BuildState }) {
  if (state.status === "error") return <span className="text-sm text-danger" role="alert">{state.message}</span>;
  if (state.status === "success") {
    return (
      <span className="text-sm text-mint">
        {state.message}
        {state.link ? <> <a href={state.link} target="_blank" rel="noreferrer noopener" className="underline">Open preview</a></> : null}
      </span>
    );
  }
  return <span className="text-sm text-muted">Nothing has been written.</span>;
}

export function ChangeRequestForm({ projectId }: { projectId: string }) {
  const [state, action] = useActionState(createChangeAction, idleBuildState);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="project_id" value={projectId} />
      <label className="block text-sm font-semibold">
        Change category
        <select name="kind" className={`${inputClass} mt-1`} defaultValue="dashboard">
          {CHANGE_KINDS.map((kind) => <option key={kind} value={kind}>{CHANGE_KIND_LABELS[kind]}</option>)}
        </select>
      </label>
      <label className="block text-sm font-semibold">
        What should change?
        <textarea name="request" required maxLength={2000} rows={4} className={`${inputClass} mt-1`} placeholder="Add a dashboard showing the next useful step and recent work." />
      </label>
      <label className="block text-sm font-semibold">
        Clarification or extra constraints (optional)
        <textarea name="answers" maxLength={2000} rows={2} className={`${inputClass} mt-1`} />
      </label>
      <label className="block text-sm font-semibold">
        Automation level
        <select name="automation_level" className={`${inputClass} mt-1`} defaultValue="2">
          <option value="1">1 — Suggest only</option>
          <option value="2">2 — Prepare patch and preview</option>
          <option value="3">3 — Run approved bounded maintenance job</option>
        </select>
      </label>
      <SubmitButton className={primaryButton} pendingLabel="Inspecting the project…">Create change request</SubmitButton>
      <Note state={state} />
    </form>
  );
}

export function ClarifyChangeForm({ projectId, change }: { projectId: string; change: AppChangeRequest }) {
  const [state, action] = useActionState(clarifyChangeAction, idleBuildState);
  return (
    <form action={action} className="mt-3 space-y-2 border-t border-line pt-3">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="change_id" value={change.id} />
      <label className="block text-sm font-semibold">
        Answer the clarification questions
        <textarea name="answers" required rows={2} className={`${inputClass} mt-1`} />
      </label>
      <SubmitButton className={secondaryButton} pendingLabel="Proposing…">Propose bounded plan</SubmitButton>
      <Note state={state} />
    </form>
  );
}

export function ChangeControls({
  projectId,
  change,
  canReview,
}: {
  projectId: string;
  change: AppChangeRequest;
  canReview: boolean;
}) {
  const [approveState, approveAction] = useActionState(approveChangePlanAction, idleBuildState);
  const [implementState, implementAction] = useActionState(implementChangeAction, idleBuildState);
  const [testState, testAction] = useActionState(testChangeAction, idleBuildState);
  const [reviewState, reviewAction] = useActionState(reviewChangeAction, idleBuildState);
  const [mergeState, mergeAction] = useActionState(mergeChangeAction, idleBuildState);
  const [rejectState, rejectAction] = useActionState(rejectChangeAction, idleBuildState);
  return (
    <div className="mt-3 space-y-2 border-t border-line pt-3">
      {change.status === "proposed" ? (
        <form action={approveAction}>
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="change_id" value={change.id} />
          <SubmitButton className={primaryButton} pendingLabel="Approving plan…">Approve bounded plan</SubmitButton>
          <p className="mt-1"><Note state={approveState} /></p>
        </form>
      ) : null}
      {change.status === "approved" && change.automation_level >= 2 ? (
        <form action={implementAction}>
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="change_id" value={change.id} />
          <SubmitButton className={secondaryButton} pendingLabel="Preparing isolated patch…">Prepare isolated patch</SubmitButton>
          <p className="mt-1"><Note state={implementState} /></p>
        </form>
      ) : null}
      {["implemented", "tested", "preview_ready"].includes(change.status) ? (
        <form action={testAction}>
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="change_id" value={change.id} />
          <SubmitButton className={secondaryButton} pendingLabel="Testing in isolation…">Test and preview patch</SubmitButton>
          <p className="mt-1"><Note state={testState} /></p>
        </form>
      ) : null}
      {change.status === "preview_ready" && canReview ? (
        <form action={reviewAction}>
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="change_id" value={change.id} />
          <SubmitButton className={primaryButton} pendingLabel="Recording review…">Approve diff for merge</SubmitButton>
          <p className="mt-1"><Note state={reviewState} /></p>
        </form>
      ) : null}
      {change.status === "reviewed" ? (
        <form action={mergeAction}>
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="change_id" value={change.id} />
          <SubmitButton className={primaryButton} pendingLabel="Merging source snapshot…">Merge as new reversible version</SubmitButton>
          <p className="mt-1"><Note state={mergeState} /></p>
        </form>
      ) : null}
      {["clarifying", "proposed", "approved", "implemented", "tested", "preview_ready", "reviewed"].includes(change.status) ? (
        <form action={rejectAction}>
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="change_id" value={change.id} />
          <SubmitButton className={dangerButton} pendingLabel="Rejecting…">Reject change</SubmitButton>
          <p className="mt-1"><Note state={rejectState} /></p>
        </form>
      ) : null}
    </div>
  );
}

export function MemoryForm({ projectId }: { projectId: string }) {
  const [state, action] = useActionState(saveMemoryAction, idleBuildState);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="project_id" value={projectId} />
      <label className="block text-sm font-semibold">
        Category
        <select name="kind" className={`${inputClass} mt-1`} defaultValue="architecture">
          {MEMORY_KINDS.map((kind) => <option key={kind} value={kind}>{MEMORY_KIND_LABELS[kind]}</option>)}
        </select>
      </label>
      <label className="block text-sm font-semibold">Title<input name="title" required maxLength={120} className={`${inputClass} mt-1`} /></label>
      <label className="block text-sm font-semibold">Record<textarea name="body" required maxLength={4000} rows={3} className={`${inputClass} mt-1`} /></label>
      <SubmitButton className={secondaryButton} pendingLabel="Saving…">Save memory</SubmitButton>
      <p className="text-xs text-muted">Never put a token, password, connection string or environment value here.</p>
      <Note state={state} />
    </form>
  );
}

export function SeedMemoryForm({ projectId }: { projectId: string }) {
  const [state, action] = useActionState(seedMemoryAction, idleBuildState);
  return (
    <form action={action}>
      <input type="hidden" name="project_id" value={projectId} />
      <SubmitButton className={secondaryButton} pendingLabel="Saving starter records…">Seed from current project</SubmitButton>
      <p className="mt-1"><Note state={state} /></p>
    </form>
  );
}

export function DeleteMemoryForm({ projectId, record }: { projectId: string; record: ProjectMemoryRecord }) {
  const [state, action] = useActionState(deleteMemoryAction, idleBuildState);
  return (
    <form action={action} className="mt-2">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="id" value={record.id} />
      <SubmitButton className={dangerButton} pendingLabel="Deleting…">Delete record</SubmitButton>
      <p className="mt-1"><Note state={state} /></p>
    </form>
  );
}

export function SkillForm({ projectId, change }: { projectId: string; change: AppChangeRequest }) {
  const [state, action] = useActionState(createSkillAction, idleBuildState);
  return (
    <form action={action} className="mt-3 space-y-2 border-t border-line pt-3">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="change_id" value={change.id} />
      <label className="block text-sm font-semibold">Skill name<input name="name" required maxLength={80} className={`${inputClass} mt-1`} /></label>
      <label className="block text-sm font-semibold">Purpose<textarea name="purpose" required maxLength={500} rows={2} className={`${inputClass} mt-1`} /></label>
      <label className="block text-sm font-semibold">Inputs, one per line<textarea name="inputs" rows={2} className={`${inputClass} mt-1`} /></label>
      <label className="block text-sm font-semibold">Expected outputs, one per line<textarea name="outputs" rows={2} className={`${inputClass} mt-1`} /></label>
      <label className="block text-sm font-semibold">Known limitations, one per line<textarea name="limitations" rows={2} className={`${inputClass} mt-1`} /></label>
      <SubmitButton className={secondaryButton} pendingLabel="Saving verified skill…">Save reusable skill</SubmitButton>
      <p className="text-xs text-muted">A skill records a verified procedure. It cannot grant deploy, credential or tool-install permission.</p>
      <Note state={state} />
    </form>
  );
}

export function ObservabilityForm({
  projectId,
  enabled,
  release,
}: {
  projectId: string;
  enabled: boolean;
  release: string;
}) {
  const [state, action] = useActionState(enableObservabilityAction, idleBuildState);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="project_id" value={projectId} />
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" name="enabled" defaultChecked={enabled} /> Enable selected error collection
      </label>
      <label className="block text-sm font-semibold">
        Release label
        <input name="release_label" defaultValue={release} required maxLength={160} className={`${inputClass} mt-1`} />
      </label>
      <SubmitButton className={secondaryButton} pendingLabel="Saving…">Save observability setting</SubmitButton>
      <Note state={state} />
    </form>
  );
}

export function ErrorForm({ projectId, error }: { projectId: string; error: AppErrorEvent }) {
  const [state, action] = useActionState(proposeRepairAction, idleBuildState);
  return (
    <form action={action} className="mt-2">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="error_id" value={error.id} />
      <SubmitButton className={secondaryButton} pendingLabel="Proposing repair…">Propose bounded repair</SubmitButton>
      <p className="mt-1"><Note state={state} /></p>
    </form>
  );
}

export function LogErrorForm({ projectId }: { projectId: string }) {
  const [state, action] = useActionState(logErrorAction, idleBuildState);
  return (
    <form action={action} className="mt-4 space-y-2 border-t border-line pt-4">
      <input type="hidden" name="project_id" value={projectId} />
      <label className="block text-sm font-semibold">
        Selected error message
        <textarea name="message" required maxLength={2000} rows={3} className={`${inputClass} mt-1`} />
      </label>
      <label className="block text-sm font-semibold">
        Selected stack or detail (optional)
        <textarea name="detail" maxLength={12000} rows={3} className={`${inputClass} mt-1`} />
      </label>
      <SubmitButton className={secondaryButton} pendingLabel="Redacting and storing…">Store selected error</SubmitButton>
      <p className="text-xs text-muted">Only paste a selected error. Do not paste a database dump, user rows, tokens or environment values. Emails, ids, IPs, tokens and connection strings are redacted.</p>
      <Note state={state} />
    </form>
  );
}
