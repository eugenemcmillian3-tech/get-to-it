import type { Metadata } from "next";
import Link from "next/link";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import {
  KindNote,
  MuteTopicForm,
  RestoreSignalForm,
  SignalControls,
  SignalForm,
  TopicForm,
} from "@/components/radar-forms";
import { requireSession } from "@/lib/auth";
import { listGoals } from "@/lib/data/goals";
import { listRadarSignals, listRadarTopics } from "@/lib/data/radar";
import { formatFutureDay } from "@/lib/futures";
import { getIdentity } from "@/lib/identity";
import {
  KIND_LABELS,
  NO_PREDICTION_NOTE,
  RELEVANCE_NOTE,
  SOURCE_HONESTY_NOTE,
  TIMESTAMP_NOTE,
  filterSignals,
  freshnessLabel,
  isRadarTopic,
  relevanceNote,
  sortSignals,
  topicLabel,
} from "@/lib/radar";
import { cardClass, chipClass, focusRing, secondaryButton } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";
import type { RadarSignal } from "@/lib/types";

export const metadata: Metadata = { title: "What's changing? — GET TO IT" };

export default async function RadarPage({
  searchParams,
}: {
  searchParams: Promise<{ topic?: string; saved?: string }>;
}) {
  const { topic, saved } = await searchParams;

  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const session = await requireSession();
  const [identity, topics, signals, dismissed, goals] = await Promise.all([
    getIdentity(session),
    listRadarTopics(session),
    listRadarSignals(session),
    listRadarSignals(session, { dismissed: true }),
    listGoals(session),
  ]);

  const followed = topics.map((entry) => entry.topic);
  const muted = topics
    .filter((entry) => entry.muted_at !== null)
    .map((entry) => entry.topic);

  const activeTopic = topic && isRadarTopic(topic) ? topic : null;
  const savedOnly = saved === "1";
  const today = new Date().toISOString().slice(0, 10);

  const feed = sortSignals(
    filterSignals(signals, {
      topic: activeTopic,
      savedOnly,
      mutedTopics: muted,
    }),
  );

  const restored = sortSignals(
    filterSignals(dismissed, { mutedTopics: muted, includeDismissed: true }),
  );

  const goalTitles = new Map(goals.map((goal) => [goal.id, goal.title]));

  const knownSources = new Map<string, { name: string; url: string }>();
  for (const signal of [...signals, ...dismissed]) {
    knownSources.set(signal.source_url, {
      name: signal.source_name,
      url: signal.source_url,
    });
  }

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-3xl px-5 pb-16 pt-6">
        <Link
          href="/dashboard"
          className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          ← Back to your goals
        </Link>

        <h1 className="mt-4 text-3xl font-black leading-tight tracking-tight sm:text-4xl">
          What&rsquo;s changing?
        </h1>
        <p className="mt-3 max-w-xl leading-relaxed text-muted">
          A radar you switch on, topic by topic, for developments you actually
          read. Each card keeps its source, its publication date, when you
          recorded it, and what is still uncertain. Nothing is added on your
          behalf and nothing changes your plans.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted">{SOURCE_HONESTY_NOTE}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">{TIMESTAMP_NOTE}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">{NO_PREDICTION_NOTE}</p>

        <section aria-labelledby="topics-heading" className="mt-8">
          <h2 id="topics-heading" className="sr-only">
            Topics
          </h2>
          <TopicForm topics={topics} />

          {topics.length > 0 ? (
            <div className={`${cardClass} mt-3`}>
              <h3 className="text-sm font-bold">Mute or unmute a topic</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                Muting hides a topic&rsquo;s cards. Nothing is deleted, and
                unmuting brings them back.
              </p>
              <div className="mt-3 space-y-2">
                {topics.map((entry) => (
                  <MuteTopicForm
                    key={entry.topic}
                    topic={entry.topic}
                    muted={entry.muted_at !== null}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <section aria-labelledby="add-heading" className="mt-8">
          <h2 id="add-heading" className="sr-only">
            Add a signal
          </h2>
          <SignalForm
            topics={followed}
            goals={goals.filter((goal) => goal.archived_at === null)}
            sources={[...knownSources.values()]}
            today={today}
          />
        </section>

        <section aria-labelledby="feed-heading" className="mt-10">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="feed-heading" className="text-xl font-bold">
              Your radar
            </h2>
            <p className="text-xs text-muted">
              {feed.length} {feed.length === 1 ? "signal" : "signals"}
              {activeTopic ? ` in ${topicLabel(activeTopic)}` : ""}
              {savedOnly ? ", saved only" : ""}
            </p>
          </div>

          <nav aria-label="Filter signals" className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/radar"
              className={`${chipClass} ${focusRing} ${
                activeTopic === null && !savedOnly ? "border-brand text-ink" : ""
              }`}
            >
              All
            </Link>
            <Link
              href="/radar?saved=1"
              className={`${chipClass} ${focusRing} ${
                savedOnly ? "border-brand text-ink" : ""
              }`}
            >
              Saved
            </Link>
            {followed
              .filter((slug) => !muted.includes(slug))
              .map((slug) => (
                <Link
                  key={slug}
                  href={`/radar?topic=${slug}`}
                  className={`${chipClass} ${focusRing} ${
                    activeTopic === slug ? "border-brand text-ink" : ""
                  }`}
                >
                  {topicLabel(slug)}
                </Link>
              ))}
          </nav>

          {muted.length > 0 ? (
            <p className="mt-3 text-xs text-muted">
              Muted: {muted.map((slug) => topicLabel(slug)).join(", ")}. Their
              signals are hidden, not deleted.
            </p>
          ) : null}

          {feed.length === 0 ? (
            <div className={`${cardClass} mt-3`}>
              <p className="font-medium">
                {followed.length === 0
                  ? "The radar is off."
                  : "Nothing here yet."}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                {followed.length === 0
                  ? "Follow a topic above to switch it on. It stays off until you do."
                  : "Add a signal you read, or clear the filter. Nothing arrives on its own."}
              </p>
            </div>
          ) : (
            <ul className="mt-3 space-y-3">
              {feed.map((signal) => {
                const goalTitle = signal.goal_id
                  ? (goalTitles.get(signal.goal_id) ?? null)
                  : null;

                return (
                  <li key={signal.id} className={cardClass}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="text-lg font-semibold leading-snug">
                        {signal.headline}
                      </h3>
                      <span className={chipClass}>{KIND_LABELS[signal.kind]}</span>
                    </div>
                    <KindNote kind={signal.kind} />

                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
                      <span className={chipClass}>{topicLabel(signal.topic)}</span>
                      <span className={chipClass}>
                        {freshnessLabel(signal.published_on, today)}
                      </span>
                      {signal.saved_at ? (
                        <span className={chipClass}>Saved for later</span>
                      ) : null}
                    </div>

                    <dl className="mt-3 space-y-1.5 text-sm">
                      <div>
                        <dt className="inline font-semibold">Source: </dt>
                        <dd className="inline">
                          <a
                            href={signal.source_url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className={`rounded underline decoration-line underline-offset-2 hover:text-ink ${focusRing}`}
                          >
                            {signal.source_name}
                          </a>
                        </dd>
                      </div>
                      <div>
                        <dt className="inline font-semibold">Published: </dt>
                        <dd className="inline text-muted">{signal.published_on}</dd>
                      </div>
                      <div>
                        <dt className="inline font-semibold">Recorded here: </dt>
                        <dd className="inline text-muted">
                          {formatFutureDay(signal.retrieved_at)}
                        </dd>
                      </div>
                      {signal.geography || signal.sector ? (
                        <div>
                          <dt className="inline font-semibold">Where it applies: </dt>
                          <dd className="inline text-muted">
                            {[signal.geography, signal.sector]
                              .filter(Boolean)
                              .join(" · ")}
                          </dd>
                        </div>
                      ) : null}
                    </dl>

                    <div className="mt-3 rounded-xl border border-line bg-paper p-3">
                      <h4 className="text-xs font-bold uppercase tracking-wide text-muted">
                        What remains uncertain
                      </h4>
                      <p className="mt-1 text-sm leading-relaxed">{signal.uncertainty}</p>
                    </div>

                    <div className="mt-3">
                      <h4 className="text-xs font-bold uppercase tracking-wide text-muted">
                        Why this may relate
                      </h4>
                      <p className="mt-1 text-sm leading-relaxed text-muted">
                        {relevanceNote({
                          topic: signal.topic,
                          followed,
                          goalTitle,
                        })}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-muted">
                        {RELEVANCE_NOTE}
                      </p>
                    </div>

                    <SignalControls signal={signal} goalTitle={goalTitle} />
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {restored.length > 0 ? (
          <section aria-labelledby="dismissed-heading" className="mt-10">
            <details className={cardClass}>
              <summary className="cursor-pointer rounded text-sm font-semibold">
                Dismissed signals ({restored.length})
              </summary>
              <p className="mt-2 text-sm text-muted">
                Dismissing never deletes the record. Restore one to see it in the
                radar again.
              </p>
              <ul className="mt-3 space-y-3">
                {restored.map((signal: RadarSignal) => (
                  <li key={signal.id} className="border-t border-line pt-3 first:border-0 first:pt-0">
                    <p className="text-sm font-semibold">{signal.headline}</p>
                    <p className="mt-1 text-xs text-muted">
                      {KIND_LABELS[signal.kind]} · {topicLabel(signal.topic)} ·
                      published {signal.published_on}
                    </p>
                    <p className="mt-1 text-xs">
                      <a
                        href={signal.source_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className={`rounded underline decoration-line underline-offset-2 hover:text-ink ${focusRing}`}
                      >
                        {signal.source_name}
                      </a>
                    </p>
                    <div className="mt-2">
                      <RestoreSignalForm signalId={signal.id} />
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          </section>
        ) : null}

        <p className="mt-8 text-xs leading-relaxed text-muted">
          One card per development, with the label the source earns: announced,
          released, research result, opinion, speculation or observed change. An
          old item keeps its old date, and no signal becomes a prediction, a
          job-loss forecast or an investment signal.
        </p>

        <p className="mt-4">
          <Link href="/dashboard" className={secondaryButton}>
            Back to your goals
          </Link>
        </p>
      </main>
    </div>
  );
}
