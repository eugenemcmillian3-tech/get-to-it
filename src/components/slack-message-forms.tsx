"use client";

import { useActionState } from "react";
import { idleBuildState } from "@/lib/action-state";
import {
  approveSlackMessageAction,
  cancelSlackMessageAction,
  draftSlackMessageAction,
  sendSlackMessageAction,
} from "@/lib/actions/slack-messages";
import type { SlackConnectionOption } from "@/lib/data/slack-messages";
import {
  SLACK_RECORD_KIND_LABELS,
  type SlackRecordKind,
} from "@/lib/connectors/slack-messages";
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
            Open the message
          </a>
          .
        </>
      ) : null}
    </p>
  );
}

export function DraftSlackMessageForm({
  workspaceId,
  connections,
  records,
}: {
  workspaceId: string;
  connections: SlackConnectionOption[];
  records: { kind: SlackRecordKind; id: string; label: string }[];
}) {
  const [state, action] = useActionState(draftSlackMessageAction, idleBuildState);
  const active = connections.filter((connection) => connection.status === "active");

  if (active.length === 0) {
    return (
      <section aria-labelledby="slack-draft-heading" className={`mt-6 ${cardClass}`}>
        <h2 id="slack-draft-heading" className="text-lg font-bold">
          Connect Slack first
        </h2>
        <p className="mt-1 text-sm text-muted">
          This connector uses your own Slack connection from an app project. Connect
          Slack in a project&apos;s connections page, grant the send-message tool, then
          come back here. Nothing can be posted without it.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="slack-draft-heading" className={`mt-6 ${cardClass}`}>
      <h2 id="slack-draft-heading" className="text-lg font-bold">
        Turn a record into a milestone summary
      </h2>
      <p className="mt-1 text-sm text-muted">
        The message is derived from the record, then shown exactly as it will be posted.
        The channel is checked through your connection before the draft is saved.
      </p>

      <form action={action} className="mt-4 grid gap-4">
        <input type="hidden" name="workspace_id" value={workspaceId} />

        <div>
          <label className={labelClass} htmlFor="slack_record">
            Record
          </label>
          <select id="slack_record" name="record_id" className={`${inputClass} mt-1`} required>
            <option value="">Choose a record</option>
            {records.map((record) => (
              <option key={`${record.kind}:${record.id}`} value={record.id}>
                {SLACK_RECORD_KIND_LABELS[record.kind]} — {record.label.slice(0, 70)}
              </option>
            ))}
          </select>
          <select
            name="record_kind"
            aria-label="Record kind"
            className={`${inputClass} mt-2`}
            defaultValue="mission"
          >
            {(Object.keys(SLACK_RECORD_KIND_LABELS) as SlackRecordKind[]).map((kind) => (
              <option key={kind} value={kind}>
                {SLACK_RECORD_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="slack_connection">
            Slack connection
          </label>
          <select
            id="slack_connection"
            name="connection_id"
            className={`${inputClass} mt-1`}
            required
          >
            {active.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.account_label || "Slack workspace"}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="slack_channel">
            Channel id
          </label>
          <input
            id="slack_channel"
            name="channel"
            className={`${inputClass} mt-1`}
            placeholder="C0123456789"
            required
          />
          <p className="mt-1 text-xs text-muted">
            Public channels start with C, private ones with G. The connection must already
            be able to see the channel.
          </p>
        </div>

        <div>
          <button type="submit" className={primaryButton}>
            Draft the message
          </button>
        </div>
        <Note state={state} />
      </form>
    </section>
  );
}

export function SlackMessageActions({
  workspaceId,
  requestId,
  status,
}: {
  workspaceId: string;
  requestId: string;
  status: string;
}) {
  const [approveState, approveAction] = useActionState(
    approveSlackMessageAction,
    idleBuildState,
  );
  const [sendState, sendAction] = useActionState(sendSlackMessageAction, idleBuildState);
  const [cancelState, cancelAction] = useActionState(
    cancelSlackMessageAction,
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
            Post the message to Slack
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
