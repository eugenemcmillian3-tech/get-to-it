import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DraftSlackMessageForm, SlackMessageActions } from "@/components/slack-message-forms";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import {
  SLACK_NOTES,
  SLACK_RECORD_KIND_LABELS,
  SLACK_STATUS_LABELS,
  type SlackStatus,
} from "@/lib/connectors/slack-messages";
import { listSlackMessages } from "@/lib/data/slack-messages";
import { getIdentity } from "@/lib/identity";
import { cardClass, chipClass } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Slack summaries — GET TO IT" };

export default async function SlackConnectorPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const session = await requireSession();
  const [identity, list] = await Promise.all([
    getIdentity(session),
    listSlackMessages(session, workspaceId),
  ]);
  if (!list) notFound();

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-4xl px-5 pb-16 pt-6">
        <Link href={`/workspace/${workspaceId}/connectors`} className="text-sm text-muted underline">
          Back to connectors
        </Link>

        <h1 className="mt-3 text-3xl font-black tracking-tight">Slack milestone summaries</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          One record, one channel, one message. {SLACK_NOTES.exclusions}
        </p>

        <ul className="mt-4 grid gap-2 text-sm text-muted">
          <li>{SLACK_NOTES.approval}</li>
          <li>{SLACK_NOTES.channel}</li>
          <li>{SLACK_NOTES.duplicates}</li>
          <li>{SLACK_NOTES.scopes}</li>
        </ul>

        <DraftSlackMessageForm
          workspaceId={workspaceId}
          connections={list.connections}
          records={list.records}
        />

        <section aria-labelledby="slack-requests-heading" className="mt-10">
          <h2 id="slack-requests-heading" className="text-xl font-bold">
            Message requests
          </h2>
          {list.requests.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              No summary has been drafted from this workspace yet.
            </p>
          ) : (
            <ul className="mt-3 grid gap-3">
              {list.requests.map((request) => {
                const events = list.events.filter((event) => event.request_id === request.id);
                return (
                  <li key={request.id} className={cardClass}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="text-base font-bold">
                        {SLACK_RECORD_KIND_LABELS[request.record_kind]} → #
                        {request.channel_label || request.channel}
                      </h3>
                      <span className={chipClass}>
                        {SLACK_STATUS_LABELS[request.status as SlackStatus]}
                      </span>
                    </div>

                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-xl bg-paper p-3 text-xs text-muted">
                      {request.text}
                    </pre>
                    <p className="mt-2 text-xs text-muted">
                      Channel {request.channel} · fingerprint {request.fingerprint.slice(0, 12)} ·
                      attempts {request.attempt_count}
                      {request.message_ts ? ` · posted at ${request.message_ts}` : ""}
                      {request.permalink ? (
                        <>
                          {" · "}
                          <a
                            href={request.permalink}
                            className="underline"
                            rel="noreferrer noopener"
                            target="_blank"
                          >
                            Open in Slack
                          </a>
                        </>
                      ) : null}
                    </p>
                    {request.error_message ? (
                      <p className="mt-1 text-xs font-semibold text-red-800">
                        {request.error_message}
                      </p>
                    ) : null}

                    <SlackMessageActions
                      workspaceId={workspaceId}
                      requestId={request.id}
                      status={request.status}
                    />

                    {events.length > 0 ? (
                      <ul className="mt-3 grid gap-1 text-xs text-muted">
                        {events.map((event) => (
                          <li key={event.id}>
                            {event.kind}
                            {event.detail ? ` — ${event.detail}` : ""}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
