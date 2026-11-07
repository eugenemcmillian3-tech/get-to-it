"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleBuildState, type BuildState } from "@/lib/action-state";
import {
  approveModernizationAction,
  importAppAction,
  proposeModernizationAction,
  runImportBaselineAction,
  saveImportMapAction,
} from "@/lib/actions/app-import";
import { IMPORT_LIMITS, IMPORT_OBJECTIVES } from "@/lib/app-import-constants";
import type { AppMap } from "@/lib/app-import";
import { inputClass, primaryButton, secondaryButton } from "@/lib/styles";
import type { GitHubImportSource } from "@/lib/data/app-import";

function Note({ state }: { state: BuildState }) {
  if (state.status === "error") {
    return <span className="text-sm text-danger" role="alert">{state.message}</span>;
  }
  if (state.status === "success") {
    return (
      <span className="text-sm text-mint">
        {state.message}
        {state.link ? <> <a href={state.link} target="_blank" rel="noreferrer noopener" className="underline">Open</a></> : null}
      </span>
    );
  }
  return <span className="text-sm text-muted">Nothing has been imported or changed yet.</span>;
}

export function ImportAppForm({ sources }: { sources: GitHubImportSource[] }) {
  const [state, action] = useActionState(importAppAction, idleBuildState);
  return (
    <form action={action} encType="multipart/form-data" className="space-y-4">
      <label className="block text-sm font-semibold">
        Import name (optional)
        <input name="name" maxLength={80} className={`${inputClass} mt-1`} placeholder="Derived from the repository or package name" />
      </label>

      <div className="rounded-xl border border-line bg-paper/60 p-3">
        <p className="text-sm font-semibold">Upload a project archive</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          A .zip up to {Math.floor(IMPORT_LIMITS.maxArchiveBytes / 1024 / 1024)} MB. The selected text must fit{" "}
          {IMPORT_LIMITS.maxFiles} files and {IMPORT_LIMITS.maxTotalChars.toLocaleString()} characters. Secret and
          instruction files are excluded. No install script or project code is run.
        </p>
        <input
          type="file"
          name="archive"
          accept=".zip,application/zip"
          className="mt-2 block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-brand-soft file:px-3 file:py-2 file:text-sm file:font-semibold file:text-ink"
        />
        <div className="mt-3">
          <SubmitButton className={primaryButton} pendingLabel="Inspecting archive…" name="source" value="archive">
            Import ZIP archive
          </SubmitButton>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-paper/60 p-3">
        <p className="text-sm font-semibold">Use an authorized GitHub repository</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Reuse an encrypted GitHub connection from one of your projects. The token is used server-side only and is
          copied to the imported project so the existing connection workflow keeps working.
        </p>
        {sources.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            No connected GitHub repositories were found. Connect one from a project&apos;s Connections page first, or use a ZIP.
          </p>
        ) : (
          <label className="mt-2 block text-sm font-semibold">
            Repository
            <select name="connection_id" className={`${inputClass} mt-1`} defaultValue={sources[0]?.connectionId}>
              {sources.map((source) => (
                <option key={source.connectionId} value={source.connectionId}>
                  {source.repository}@{source.branch} — {source.projectName}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="mt-3">
          <SubmitButton
            className={secondaryButton}
            pendingLabel="Downloading and inspecting…"
            name="source"
            value="git"
            disabled={sources.length === 0}
          >
            Import from GitHub
          </SubmitButton>
        </div>
      </div>

      <p className="text-xs leading-relaxed text-muted">
        Initial inspection is static. Repository instructions, comments and README text are treated as untrusted data,
        never as platform instructions. Importing does not grant deployment, credential or tool-install permission.
      </p>
      <Note state={state} />
    </form>
  );
}

export function ImportMapEditor({ projectId, map }: { projectId: string; map: AppMap }) {
  const [state, action] = useActionState(saveImportMapAction, idleBuildState);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="project_id" value={projectId} />
      <label className="block text-sm font-semibold">
        Application map JSON
        <textarea
          name="map_json"
          required
          rows={18}
          defaultValue={JSON.stringify(map, null, 2)}
          spellCheck={false}
          className={`${inputClass} mt-1 font-mono text-xs`}
        />
      </label>
      <p className="text-xs leading-relaxed text-muted">
        Edit the working map directly. Keep each finding&apos;s <code>basis</code> as inspected or inferred, and keep
        file paths linked to the source. Saving does not change app files.
      </p>
      <SubmitButton className={secondaryButton} pendingLabel="Saving map…">Save application map</SubmitButton>
      <p><Note state={state} /></p>
    </form>
  );
}

export function ImportBaselineForm({ projectId }: { projectId: string }) {
  const [state, action] = useActionState(runImportBaselineAction, idleBuildState);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="project_id" value={projectId} />
      <SubmitButton className={secondaryButton} pendingLabel="Running in the sandbox…">
        Run baseline checks
      </SubmitButton>
      <p className="text-xs leading-relaxed text-muted">
        Runs the existing isolated sandbox checks against the imported files. Those failures are recorded as
        pre-existing and will not be attributed to a later proposal.
      </p>
      <Note state={state} />
    </form>
  );
}

export function ModernizationForm({ projectId, hasBaseline }: { projectId: string; hasBaseline: boolean }) {
  const [state, action] = useActionState(proposeModernizationAction, idleBuildState);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="project_id" value={projectId} />
      <label className="block text-sm font-semibold">
        One bounded objective
        <select name="objective" className={`${inputClass} mt-1`} defaultValue="mobile">
          {IMPORT_OBJECTIVES.map((objective) => (
            <option key={objective.id} value={objective.id}>{objective.label}</option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-semibold">
        What exactly should change?
        <textarea
          name="request"
          required
          minLength={5}
          maxLength={2000}
          rows={4}
          className={`${inputClass} mt-1`}
          placeholder="Improve the shared navigation so it remains usable at a narrow viewport."
        />
      </label>
      <p className="text-xs leading-relaxed text-muted">
        The proposal lists affected files, compatibility concerns, acceptance checks and a reversal plan. It does not
        rewrite the app. Handing it to the existing change review requires a separate approval.
      </p>
      <SubmitButton className={primaryButton} pendingLabel="Producing bounded proposal…" disabled={!hasBaseline}>
        Propose one bounded change
      </SubmitButton>
      {!hasBaseline ? <p className="text-sm text-muted">Run and record a baseline first.</p> : null}
      <Note state={state} />
    </form>
  );
}

export function ApproveModernizationForm({ projectId, modernizationId }: { projectId: string; modernizationId: string }) {
  const [state, action] = useActionState(approveModernizationAction, idleBuildState);
  return (
    <form action={action} className="mt-3 space-y-2 border-t border-line pt-3">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="modernization_id" value={modernizationId} />
      <SubmitButton className={secondaryButton} pendingLabel="Creating change review…">
        Approve proposal and open change review
      </SubmitButton>
      <p className="text-xs leading-relaxed text-muted">
        This only creates a Phase 25 change request. The change still needs plan approval, an isolated patch, checks,
        preview and diff review. No push or deployment happens here.
      </p>
      <Note state={state} />
    </form>
  );
}
