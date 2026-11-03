"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  commitImportAction,
  exportCsvAction,
  exportJsonAction,
  previewImportAction,
  type ExportPayload,
} from "@/lib/actions/export";
import { idleImportState } from "@/lib/action-state";
import {
  EXPORT_DATASETS,
  EXPORT_VERSION,
  type ExportDatasetId,
} from "@/lib/export";
import {
  IMPORT_CONFIRMATION,
  IMPORT_SCOPE_NOTE,
  MAX_IMPORT_BYTES,
  type ImportPreview,
} from "@/lib/import";
import {
  cardClass,
  chipClass,
  dangerButton,
  hintClass,
  inputClass,
  labelClass,
  primaryButton,
  quietButton,
  secondaryButton,
} from "@/lib/styles";

function download(payload: ExportPayload): void {
  if (!payload.ok || !payload.content || !payload.filename) return;
  const blob = new Blob([payload.content], { type: payload.mime ?? "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = payload.filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function ExportPanel() {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function run(key: string, action: () => Promise<ExportPayload>) {
    setBusy(key);
    setFailed(false);
    setMessage(null);
    try {
      const result = await action();
      if (result.ok) {
        download(result);
        setMessage(result.message);
      } else {
        setFailed(true);
        setMessage(result.message);
      }
    } catch {
      setFailed(true);
      setMessage("The download could not be prepared. Nothing was exported.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={`${cardClass} space-y-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">Export</h2>
        <span className={chipClass}>Format version {EXPORT_VERSION}</span>
      </div>

      <p className="text-sm leading-relaxed text-muted">
        One JSON file holds everything listed below. CSVs are per dataset, so a
        spreadsheet gets one table at a time. Both are generated on the server
        from your own rows and downloaded straight to this browser.
      </p>

      <button
        type="button"
        onClick={() => run("json", exportJsonAction)}
        disabled={busy !== null}
        className={primaryButton}
      >
        {busy === "json" ? "Preparing…" : "Download JSON export"}
      </button>

      <div>
        <h3 className="text-sm font-bold">CSV downloads</h3>
        <ul className="mt-2 space-y-2">
          {EXPORT_DATASETS.map((dataset) => (
            <li
              key={dataset.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-paper p-3"
            >
              <div>
                <p className="text-sm font-semibold">{dataset.label}</p>
                <p className="text-xs text-muted">{dataset.description}</p>
              </div>
              <button
                type="button"
                onClick={() =>
                  run(dataset.id, () => exportCsvAction(dataset.id as ExportDatasetId))
                }
                disabled={busy !== null}
                className={secondaryButton}
              >
                {busy === dataset.id ? "Preparing…" : `Download ${dataset.file}`}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {message ? (
        <p
          role={failed ? "alert" : "status"}
          className={failed ? "text-sm text-danger" : "text-sm text-mint"}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}

function Rejections({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: { kind: string; label: string; reason: string }[];
  tone: "warning" | "danger";
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h4 className="text-sm font-bold">{title}</h4>
      <ul className="mt-1 space-y-1 text-xs leading-relaxed">
        {rows.map((row, index) => (
          <li key={`${row.kind}-${row.label}-${index}`} className="flex gap-2">
            <span
              className={
                tone === "danger"
                  ? "shrink-0 font-semibold text-danger"
                  : "shrink-0 font-semibold text-muted"
              }
            >
              {row.label}
            </span>
            <span className="text-muted">{row.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PreviewBody({ preview }: { preview: ImportPreview }) {
  return (
    <div className="space-y-3 rounded-xl border border-line bg-paper p-3">
      <div>
        <h3 className="text-sm font-bold">Preview</h3>
        <p className="mt-1 text-sm text-muted">
          {preview.counts.goals} goals · {preview.counts.tasks} tasks ·{" "}
          {preview.counts.saved_results} saved results · {preview.counts.reflections}{" "}
          reflections
          {preview.counts.preferences > 0 ? " · preferences" : ""}
          {preview.exportedAt
            ? ` · exported ${preview.exportedAt.slice(0, 10)}`
            : ""}
        </p>
      </div>

      {preview.goals.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {preview.goals.map((goal, index) => (
            <li key={`${goal.title}-${index}`} className="flex flex-wrap gap-2">
              <span className="font-semibold">{goal.title}</span>
              <span className="text-xs text-muted">
                {goal.taskCount} {goal.taskCount === 1 ? "task" : "tasks"}
                {goal.savedResults > 0 ? `, ${goal.savedResults} saved` : ""}
                {goal.alreadyExists ? " — a goal with this title already exists" : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <Rejections title="Skipped, not overwritten" rows={preview.skipped} tone="warning" />
      <Rejections title="Rejected records" rows={preview.rejected} tone="danger" />
      <Rejections title="Notes" rows={preview.warnings} tone="warning" />
    </div>
  );
}

export function ImportPanel() {
  const [previewState, previewAction] = useActionState(previewImportAction, idleImportState);
  const [commitState, commitAction] = useActionState(commitImportAction, idleImportState);

  const [payload, setPayload] = useState("");
  const [filename, setFilename] = useState("");
  const [readError, setReadError] = useState<string | null>(null);
  const [skipExisting, setSkipExisting] = useState(true);
  const [replacePreferences, setReplacePreferences] = useState(false);

  async function chooseFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setReadError(null);

    if (!file) {
      setPayload("");
      setFilename("");
      return;
    }

    if (file.size > MAX_IMPORT_BYTES) {
      setPayload("");
      setFilename("");
      setReadError(
        `That file is larger than the ${Math.round(MAX_IMPORT_BYTES / 1_000_000)} MB import limit.`,
      );
      return;
    }

    const text = await file.text();
    setPayload(text);
    setFilename(file.name);
  }

  const preview = previewState.status === "preview" ? previewState.preview : undefined;
  const canConfirm =
    Boolean(preview) &&
    Boolean(previewState.planHash) &&
    commitState.status !== "imported";

  return (
    <div className={`${cardClass} space-y-4`}>
      <h2 className="text-lg font-bold">Import</h2>
      <p className="text-sm leading-relaxed text-muted">{IMPORT_SCOPE_NOTE}</p>

      <div>
        <label className={labelClass} htmlFor="import-file">
          GET TO IT JSON export
        </label>
        <input
          id="import-file"
          type="file"
          accept="application/json,.json"
          onChange={chooseFile}
          className={`mt-1.5 ${inputClass}`}
        />
        <p className={hintClass}>
          Only the documented GET TO IT export (format version {EXPORT_VERSION})
          is accepted. CSV files are for reading, not importing.
        </p>
        {readError ? (
          <p role="alert" className="mt-2 text-sm text-danger">
            {readError}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={skipExisting}
            onChange={(event) => setSkipExisting(event.target.checked)}
            className="mt-1"
          />
          <span>
            Skip goals whose title already exists
            <span className="block text-xs text-muted">
              Import is additive. Unticking adds a second goal with the same
              title; no existing goal or task is ever edited.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={replacePreferences}
            onChange={(event) => setReplacePreferences(event.target.checked)}
            className="mt-1"
          />
          <span>
            Replace my saved preferences with the file&apos;s
            <span className="block text-xs text-muted">
              Without this, existing preferences are left untouched and reported
              as skipped.
            </span>
          </span>
        </label>
      </div>

      <form action={previewAction} className="space-y-2">
        <input type="hidden" name="payload" value={payload} />
        <input type="hidden" name="filename" value={filename} />
        {skipExisting ? <input type="hidden" name="skip_existing" value="on" /> : null}
        {replacePreferences ? (
          <input type="hidden" name="replace_preferences" value="on" />
        ) : null}
        <button type="submit" disabled={!payload} className={secondaryButton}>
          Preview import
        </button>
        {previewState.message ? (
          <p
            role={previewState.status === "error" ? "alert" : "status"}
            className={
              previewState.status === "error" ? "text-sm text-danger" : "text-sm text-mint"
            }
          >
            {previewState.message}
          </p>
        ) : null}
      </form>

      {preview ? (
        <>
          <PreviewBody preview={preview} />
          <form action={commitAction} className="space-y-3">
            <input type="hidden" name="payload" value={payload} />
            <input type="hidden" name="filename" value={filename} />
            <input type="hidden" name="plan_hash" value={previewState.planHash ?? ""} />
            {skipExisting ? <input type="hidden" name="skip_existing" value="on" /> : null}
            {replacePreferences ? (
              <input type="hidden" name="replace_preferences" value="on" />
            ) : null}

            <div>
              <label className={labelClass} htmlFor="import-confirm">
                Type {IMPORT_CONFIRMATION} to confirm
              </label>
              <input
                id="import-confirm"
                name="confirm"
                autoComplete="off"
                className={`mt-1.5 ${inputClass}`}
              />
            </div>

            <button type="submit" disabled={!canConfirm} className={dangerButton}>
              Import this data
            </button>
            <p className="text-xs leading-relaxed text-muted">
              The confirmation is tied to this preview. Changing the file or the
              options afterwards is refused rather than imported.
            </p>
          </form>
        </>
      ) : null}

      {commitState.message ? (
        <p
          role={commitState.status === "error" ? "alert" : "status"}
          className={
            commitState.status === "error" ? "text-sm text-danger" : "text-sm text-mint"
          }
        >
          {commitState.message}
        </p>
      ) : null}

      {commitState.status === "imported" ? (
        <p className="text-sm">
          <Link href="/dashboard" className={quietButton}>
            Open your goals
          </Link>
        </p>
      ) : null}
    </div>
  );
}
