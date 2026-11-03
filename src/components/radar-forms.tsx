"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleRadarState, type RadarState } from "@/lib/action-state";
import {
  addSignalAction,
  createLearningGoalAction,
  createPreparationTaskAction,
  muteTopicAction,
  saveTopicsAction,
  toggleSignalAction,
} from "@/lib/actions/radar";
import {
  MAX_HEADLINE,
  MAX_PLACE,
  MAX_SOURCE_NAME,
  MAX_SOURCE_URL,
  MAX_UNCERTAINTY,
  PROMOTION_NOTE,
  RADAR_TOPICS,
  SIGNAL_KINDS,
  SOURCE_HONESTY_NOTE,
  TOPIC_DETAILS,
  kindNote,
  topicLabel,
} from "@/lib/radar";
import {
  cardClass,
  hintClass,
  inputClass,
  labelClass,
  primaryButton,
  quietButton,
  secondaryButton,
} from "@/lib/styles";
import type { Goal, RadarSignal, RadarTopic, RadarTopicSlug } from "@/lib/types";

function StateNote({ state, idle }: { state: RadarState; idle?: string }) {
  if (state.status === "error") {
    return <span className="text-danger">{state.message}</span>;
  }
  if (state.status === "success") {
    return <span className="text-mint">{state.message}</span>;
  }
  return idle ? <span className="text-muted">{idle}</span> : null;
}

/** Opting in to topics. Nothing is followed until the person saves this form. */
export function TopicForm({ topics }: { topics: RadarTopic[] }) {
  const [state, formAction] = useActionState(saveTopicsAction, idleRadarState);
  const followed = new Set(topics.map((topic) => topic.topic));

  return (
    <form action={formAction} className={cardClass}>
      <fieldset>
        <legend className="text-lg font-bold">Topics you follow</legend>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Off by default. Follow only what you want to think about; you can stop
          at any time. Following a topic starts no monitoring and fetches nothing.
        </p>

        <div className="mt-4 space-y-3">
          {RADAR_TOPICS.map((topic) => (
            <label key={topic.slug} className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                name="topics"
                value={topic.slug}
                defaultChecked={followed.has(topic.slug)}
                className="mt-1"
              />
              <span>
                <span className="font-semibold">{topic.label}</span>
                <span className="block text-muted">{TOPIC_DETAILS[topic.slug]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <p aria-live="polite" className="mt-3 min-h-5 text-sm">
        <StateNote state={state} idle="Your choice is saved only when you press the button." />
      </p>

      <SubmitButton className={primaryButton} pendingLabel="Saving topics…">
        Save topics
      </SubmitButton>
    </form>
  );
}

/** Muting hides a topic's signals without unfollowing or deleting them. */
export function MuteTopicForm({
  topic,
  muted,
}: {
  topic: RadarTopicSlug;
  muted: boolean;
}) {
  const [state, formAction] = useActionState(muteTopicAction, idleRadarState);

  return (
    <form action={formAction} className="inline-flex flex-wrap items-center gap-2">
      <input type="hidden" name="topic" value={topic} />
      <input type="hidden" name="intent" value={muted ? "unmute" : "mute"} />
      <SubmitButton
        className={quietButton}
        pendingLabel={muted ? "Unmuting…" : "Muting…"}
      >
        {muted ? `Unmute ${topicLabel(topic)}` : `Mute ${topicLabel(topic)}`}
      </SubmitButton>
      <span aria-live="polite" className="text-xs">
        <StateNote state={state} />
      </span>
    </form>
  );
}

/** Records one signal the person read. No fetch happens here. */
export function SignalForm({
  topics,
  goals,
  sources,
  today,
}: {
  topics: RadarTopicSlug[];
  goals: Goal[];
  sources: { name: string; url: string }[];
  today: string;
}) {
  const [state, formAction] = useActionState(addSignalAction, idleRadarState);

  if (topics.length === 0) {
    return (
      <div className={cardClass}>
        <h2 className="text-lg font-bold">Add a signal</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Follow at least one topic first. A signal belongs to a topic you chose
          to follow, and the radar stays off until then.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className={cardClass}>
      <h2 className="text-lg font-bold">Add a signal you read</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">{SOURCE_HONESTY_NOTE}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted">{PROMOTION_NOTE}</p>

      <div className="mt-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="radar-topic">
              Topic
            </label>
            <select id="radar-topic" name="topic" className={`mt-1.5 ${inputClass}`}>
              {topics.map((topic) => (
                <option key={topic} value={topic}>
                  {topicLabel(topic)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass} htmlFor="radar-kind">
              What kind of signal is it?
            </label>
            <select id="radar-kind" name="kind" className={`mt-1.5 ${inputClass}`}>
              {SIGNAL_KINDS.map((kind) => (
                <option key={kind.slug} value={kind.slug}>
                  {kind.label}
                </option>
              ))}
            </select>
            <p className={hintClass}>
              Keep the source&rsquo;s own status. An announcement is not a release.
            </p>
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="radar-headline">
            What was reported?
          </label>
          <input
            id="radar-headline"
            name="headline"
            required
            maxLength={MAX_HEADLINE}
            placeholder="e.g. A vendor announced an assistant that drafts invoices"
            className={`mt-1.5 ${inputClass}`}
          />
          <p className={hintClass}>In your own words, in one line.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="radar-source-name">
              Original source
            </label>
            <input
              id="radar-source-name"
              name="source_name"
              required
              list="radar-source-names"
              maxLength={MAX_SOURCE_NAME}
              placeholder="e.g. The publisher's own announcement"
              className={`mt-1.5 ${inputClass}`}
            />
            <datalist id="radar-source-names">
              {sources.map((source) => (
                <option key={`name-${source.name}`} value={source.name} />
              ))}
            </datalist>
          </div>

          <div>
            <label className={labelClass} htmlFor="radar-source-url">
              Link to the source
            </label>
            <input
              id="radar-source-url"
              name="source_url"
              required
              type="url"
              list="radar-source-urls"
              maxLength={MAX_SOURCE_URL}
              placeholder="https://example.org/article"
              className={`mt-1.5 ${inputClass}`}
            />
            <datalist id="radar-source-urls">
              {sources.map((source) => (
                <option key={`url-${source.url}`} value={source.url} />
              ))}
            </datalist>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className={labelClass} htmlFor="radar-published">
              Published on
            </label>
            <input
              id="radar-published"
              name="published_on"
              type="date"
              required
              min="1990-01-01"
              max={today}
              className={`mt-1.5 ${inputClass}`}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="radar-geography">
              Place, if relevant
            </label>
            <input
              id="radar-geography"
              name="geography"
              maxLength={MAX_PLACE}
              placeholder="e.g. United Kingdom"
              className={`mt-1.5 ${inputClass}`}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="radar-sector">
              Sector, if relevant
            </label>
            <input
              id="radar-sector"
              name="sector"
              maxLength={MAX_PLACE}
              placeholder="e.g. Retail"
              className={`mt-1.5 ${inputClass}`}
            />
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="radar-goal">
            Which of your goals might this relate to?
          </label>
          <select id="radar-goal" name="goal_id" className={`mt-1.5 ${inputClass}`}>
            <option value="">No goal — keep it as background</option>
            {goals.map((goal) => (
              <option key={goal.id} value={goal.id}>
                {goal.title}
              </option>
            ))}
          </select>
          <p className={hintClass}>
            Only a goal you wrote. This is used for the explanation, nothing else.
          </p>
        </div>

        <div>
          <label className={labelClass} htmlFor="radar-uncertainty">
            What remains uncertain?
          </label>
          <textarea
            id="radar-uncertainty"
            name="uncertainty"
            rows={3}
            required
            maxLength={MAX_UNCERTAINTY}
            placeholder="e.g. No release date, no price, and no independent test of the claim"
            className={`mt-1.5 ${inputClass}`}
          />
          <p className={hintClass}>Required. A signal without an open question is not a signal.</p>
        </div>
      </div>

      <p aria-live="polite" className="mt-3 min-h-5 text-sm">
        <StateNote state={state} idle="Recording this spends no AI request." />
      </p>

      <SubmitButton className={primaryButton} pendingLabel="Saving signal…">
        Add to the radar
      </SubmitButton>
    </form>
  );
}

function IntentButton({
  signalId,
  intent,
  label,
  pendingLabel,
}: {
  signalId: string;
  intent: "save" | "unsave" | "dismiss" | "restore";
  label: string;
  pendingLabel: string;
}) {
  const [state, formAction] = useActionState(toggleSignalAction, idleRadarState);

  return (
    <form action={formAction} className="inline-flex flex-col gap-1">
      <input type="hidden" name="signal_id" value={signalId} />
      <input type="hidden" name="intent" value={intent} />
      <SubmitButton className={quietButton} pendingLabel={pendingLabel}>
        {label}
      </SubmitButton>
      <span aria-live="polite" className="text-xs">
        <StateNote state={state} />
      </span>
    </form>
  );
}

/** Save for later, dismiss, or bring a dismissed signal back. */
export function SignalControls({
  signal,
  goalTitle,
}: {
  signal: RadarSignal;
  goalTitle: string | null;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
      {signal.saved_at ? (
        <IntentButton
          signalId={signal.id}
          intent="unsave"
          label="Remove from saved"
          pendingLabel="Removing…"
        />
      ) : (
        <IntentButton
          signalId={signal.id}
          intent="save"
          label="Save for later"
          pendingLabel="Saving…"
        />
      )}

      <IntentButton
        signalId={signal.id}
        intent="dismiss"
        label="Dismiss"
        pendingLabel="Dismissing…"
      />

      <a
        href={`/futures${signal.goal_id ? `?goal=${signal.goal_id}` : ""}`}
        className={quietButton}
      >
        Explore with scenario planning
      </a>

      <PrepareForms signal={signal} goalTitle={goalTitle} />
    </div>
  );
}

/** Two separate preparations, each created only by pressing its own button. */
function PrepareForms({
  signal,
  goalTitle,
}: {
  signal: RadarSignal;
  goalTitle: string | null;
}) {
  const [taskState, taskAction] = useActionState(
    createPreparationTaskAction,
    idleRadarState,
  );
  const [goalState, goalAction] = useActionState(
    createLearningGoalAction,
    idleRadarState,
  );

  return (
    <div className="mt-2 w-full space-y-2">
      {signal.experiment_task_id ? (
        <p className="text-xs text-muted">
          A preparation task already exists for this signal
          {signal.goal_id ? (
            <>
              {" "}
              in{" "}
              <a
                href={`/goals/${signal.goal_id}`}
                className="rounded underline decoration-line underline-offset-2 hover:text-ink"
              >
                {goalTitle ?? "your goal"}
              </a>
            </>
          ) : null}
          .
        </p>
      ) : (
        <form action={taskAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="signal_id" value={signal.id} />
          {signal.goal_id ? (
            <input type="hidden" name="goal_id" value={signal.goal_id} />
          ) : (
            <span className="text-xs text-muted">
              Link a goal on the signal before adding preparation work.
            </span>
          )}
          <SubmitButton
            className={secondaryButton}
            pendingLabel="Adding task…"
            disabled={signal.goal_id === null}
          >
            Create a small experiment task
          </SubmitButton>
          <span aria-live="polite" className="text-xs">
            <StateNote state={taskState} />
          </span>
        </form>
      )}

      {signal.learning_goal_id ? (
        <p className="text-xs text-muted">
          A learning goal already exists for this signal.{" "}
          <a
            href={`/goals/${signal.learning_goal_id}`}
            className="rounded underline decoration-line underline-offset-2 hover:text-ink"
          >
            Open it
          </a>
          .
        </p>
      ) : (
        <form action={goalAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="signal_id" value={signal.id} />
          <SubmitButton className={secondaryButton} pendingLabel="Creating goal…">
            Create a learning goal
          </SubmitButton>
          <span aria-live="polite" className="text-xs">
            <StateNote state={goalState} />
          </span>
        </form>
      )}
    </div>
  );
}

export function RestoreSignalForm({ signalId }: { signalId: string }) {
  return (
    <IntentButton
      signalId={signalId}
      intent="restore"
      label="Restore to the radar"
      pendingLabel="Restoring…"
    />
  );
}

/** Small honest line used where a kind needs its own warning. */
export function KindNote({ kind }: { kind: string }) {
  const note = kindNote(kind);
  if (note === "") return null;
  return <p className="mt-1 text-xs leading-relaxed text-muted">{note}</p>;
}
