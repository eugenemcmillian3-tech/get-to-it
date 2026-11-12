import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  DraftGithubIssueForm,
  GithubIssueActions,
} from "@/components/github-issue-forms";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import {
  GITHUB_NOTES,
  GITHUB_RECORD_KIND_LABELS,
  GITHUB_STATUS_LABELS,
  type GithubStatus,
} from "@/lib/connectors/github-issues";
import { listGithubIssues } from "@/lib/data/github-issues";
import { getIdentity } from "@/lib/identity";
import { cardClass, chipClass } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Connectors — GET TO IT" };

export default async function ConnectorsPage({
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
    listGithubIssues(session, workspaceId),
  ]);
  if (!list) notFound();

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-4xl px-5 pb-16 pt-6">
        <Link href={`/workspace/${workspaceId}`} className="text-sm text-muted underline">
          Back to the workspace
        </Link>

        <h1 className="mt-3 text-3xl font-black tracking-tight">GitHub issue handoff</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          One connector, one workflow: an approved GET TO IT record becomes an issue in a
          repository you choose. {GITHUB_NOTES.exclusions}
        </p>

        <ul className="mt-4 grid gap-2 text-sm text-muted">
          <li>{GITHUB_NOTES.approval}</li>
          <li>{GITHUB_NOTES.duplicates}</li>
          <li>{GITHUB_NOTES.transport}</li>
        </ul>

        <DraftGithubIssueForm
          workspaceId={workspaceId}
          connections={list.connections}
          records={list.records}
        />

        <section aria-labelledby="requests-heading" className="mt-10">
          <h2 id="requests-heading" className="text-xl font-bold">
            Issue requests
          </h2>
          {list.requests.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              No issue has been drafted from this workspace yet.
            </p>
          ) : (
            <ul className="mt-3 grid gap-3">
              {list.requests.map((request) => {
                const events = list.events.filter(
                  (event) => event.request_id === request.id,
                );
                return (
                  <li key={request.id} className={cardClass}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="text-base font-bold">
                        {GITHUB_RECORD_KIND_LABELS[request.record_kind]} →{" "}
                        {request.repository}
                      </h3>
                      <span className={chipClass}>
                        {GITHUB_STATUS_LABELS[request.status as GithubStatus]}
                      </span>
                    </div>

                    <p className="mt-2 text-sm font-medium">{request.title}</p>
                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-xl bg-paper p-3 text-xs text-muted">
                      {request.body}
                    </pre>
                    <p className="mt-2 text-xs text-muted">
                      Fingerprint {request.fingerprint.slice(0, 12)} · attempts{" "}
                      {request.attempt_count}
                      {request.issue_url ? (
                        <>
                          {" · "}
                          <a
                            href={request.issue_url}
                            className="underline"
                            rel="noreferrer noopener"
                            target="_blank"
                          >
                            Issue #{request.issue_number}
                          </a>
                        </>
                      ) : null}
                    </p>
                    {request.error_message ? (
                      <p className="mt-1 text-xs font-semibold text-red-800">
                        {request.error_message}
                      </p>
                    ) : null}

                    <GithubIssueActions
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
