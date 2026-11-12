"use client";

import { useActionState } from "react";
import { idleBuildState } from "@/lib/action-state";
import {
  approveGithubIssueAction,
  cancelGithubIssueAction,
  draftGithubIssueAction,
  sendGithubIssueAction,
} from "@/lib/actions/github-issues";
import type { GithubConnectionOption } from "@/lib/data/github-issues";
import {
  GITHUB_RECORD_KIND_LABELS,
  type GithubRecordKind,
} from "@/lib/connectors/github-issues";
import {
  cardClass,
  inputClass,
  labelClass,
  primaryButton,
  quietButton,
  secondaryButton,
} from "@/lib/styles";

function Note({ state }: { state: { status: string; message?: string; link?: string } }) {
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
      {state.link ? (
        <>
          {" "}
          <a href={state.link} className="underline" rel="noreferrer noopener" target="_blank">
            Open the issue
          </a>
          .
        </>
      ) : null}
    </p>
  );
}

export function DraftGithubIssueForm({
  workspaceId,
  connections,
  records,
}: {
  workspaceId: string;
  connections: GithubConnectionOption[];
  records: { kind: GithubRecordKind; id: string; label: string }[];
}) {
  const [state, action] = useActionState(draftGithubIssueAction, idleBuildState);
  const active = connections.filter((connection) => connection.status === "active");

  if (active.length === 0) {
    return (
      <section aria-labelledby="draft-heading" className={`mt-6 ${cardClass}`}>
        <h2 id="draft-heading" className="text-lg font-bold">
          Connect GitHub first
        </h2>
        <p className="mt-1 text-sm text-muted">
          This connector uses your own GitHub connection from an app project. Connect
          GitHub in a project&apos;s connections page, then come back here. Nothing can be
          sent without it.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="draft-heading" className={`mt-6 ${cardClass}`}>
      <h2 id="draft-heading" className="text-lg font-bold">
        Turn a record into an issue
      </h2>
      <p className="mt-1 text-sm text-muted">
        The issue text is derived from the record you pick, then shown exactly as it
        will be sent. Approval comes after you read it.
      </p>

      <form action={action} className="mt-4 grid gap-4">
        <input type="hidden" name="workspace_id" value={workspaceId} />

        <div>
          <label className={labelClass} htmlFor="github_record">
            Record
          </label>
          <select id="github_record" name="record_id" className={`${inputClass} mt-1`} required>
            <option value="">Choose a record</option>
            {records.map((record) => (
              <option key={`${record.kind}:${record.id}`} value={record.id}>
                {GITHUB_RECORD_KIND_LABELS[record.kind]} — {record.label.slice(0, 70)}
              </option>
            ))}
          </select>
          <select
            name="record_kind"
            aria-label="Record kind"
            className={`${inputClass} mt-2`}
            defaultValue="mission"
          >
            {(Object.keys(GITHUB_RECORD_KIND_LABELS) as GithubRecordKind[]).map((kind) => (
              <option key={kind} value={kind}>
                {GITHUB_RECORD_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="github_connection">
            GitHub connection
          </label>
          <select
            id="github_connection"
            name="connection_id"
            className={`${inputClass} mt-1`}
            required
          >
            {active.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.account_label || "GitHub account"}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="github_repository">
            Repository (owner/name)
          </label>
          <input
            id="github_repository"
            name="repository"
            className={`${inputClass} mt-1`}
            placeholder="your-org/your-repository"
            required
          />
        </div>

        <div>
          <button type="submit" className={primaryButton}>
            Draft the issue
          </button>
        </div>
        <Note state={state} />
      </form>
    </section>
  );
}

export function GithubIssueActions({
  workspaceId,
  requestId,
  status,
}: {
  workspaceId: string;
  requestId: string;
  status: string;
}) {
  const [approveState, approveAction] = useActionState(
    approveGithubIssueAction,
    idleBuildState,
  );
  const [sendState, sendAction] = useActionState(sendGithubIssueAction, idleBuildState);
  const [cancelState, cancelAction] = useActionState(
    cancelGithubIssueAction,
    idleBuildState,
  );

  const closed = status === "sent" || status === "cancelled" || status === "sending";

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        <form action={approveAction}>
          <input type="hidden" name="workspace_id" value={workspaceId} />
          <input type="hidden" name="request_id" value={requestId} />
          <button type="submit" className={secondaryButton} disabled={status !== "draft"}>
            Approve this exact content
          </button>
        </form>

        <form action={sendAction}>
          <input type="hidden" name="workspace_id" value={workspaceId} />
          <input type="hidden" name="request_id" value={requestId} />
          <button type="submit" className={primaryButton} disabled={closed}>
            Create the issue on GitHub
          </button>
        </form>

        <form action={cancelAction}>
          <input type="hidden" name="workspace_id" value={workspaceId} />
          <input type="hidden" name="request_id" value={requestId} />
          <button type="submit" className={quietButton} disabled={closed}>
            Cancel
          </button>
        </form>
      </div>
      <Note state={approveState} />
      <Note state={sendState} />
      <Note state={cancelState} />
    </div>
  );
}
