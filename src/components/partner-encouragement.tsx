"use client";

import { useActionState, useEffect, useRef } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleFormState } from "@/lib/action-state";
import { sendEncouragementAction } from "@/lib/actions/partner";
import {
  formatMessageTime,
  MESSAGE_DAILY_LIMIT,
  MESSAGE_MAX_LENGTH,
} from "@/lib/partner";
import { hintClass, inputClass, labelClass, secondaryButton } from "@/lib/styles";
import type { EncouragementMessage } from "@/lib/types";

/**
 * One short thread, between the two of you.
 *
 * Text only: no attachments, no feed, no group. Sending is capped by the
 * database (a short pause between messages and a daily count), and the copy
 * says so plainly rather than implying a moderator is watching.
 */
export function PartnerEncouragement({
  partnershipId,
  partnerName,
  myId,
  messages,
}: {
  partnershipId: string;
  partnerName: string;
  myId: string;
  messages: EncouragementMessage[];
}) {
  const [state, formAction] = useActionState(
    sendEncouragementAction,
    idleFormState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const nonce = state.nonce;
  const status = state.status;

  useEffect(() => {
    if (status === "success") formRef.current?.reset();
  }, [nonce, status]);

  return (
    <section aria-labelledby="encouragement-heading" className="mt-8">
      <h2 id="encouragement-heading" className="text-lg font-bold">
        Encouragement
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Short lines only — {MESSAGE_MAX_LENGTH} characters, up to{" "}
        {MESSAGE_DAILY_LIMIT} a day each. No files, no public feed.
      </p>

      {messages.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-line p-4 text-sm text-muted">
          Nothing yet. A single line is enough.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {messages.map((message) => {
            const mine = message.sender_id === myId;
            return (
              <li
                key={message.id}
                className={
                  mine
                    ? "rounded-xl border border-line bg-brand-soft p-3"
                    : "rounded-xl border border-line bg-card p-3"
                }
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {mine ? "You" : partnerName} ·{" "}
                  <span className="font-normal normal-case tracking-normal">
                    {formatMessageTime(message.created_at)}
                  </span>
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">
                  {message.body}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <form ref={formRef} action={formAction} className="mt-4 space-y-3">
        <input type="hidden" name="partnership_id" value={partnershipId} />
        <div>
          <label className={labelClass} htmlFor="encouragement-body">
            Say something short
          </label>
          <textarea
            id="encouragement-body"
            name="body"
            rows={2}
            required
            maxLength={MESSAGE_MAX_LENGTH}
            placeholder="Good luck with the first draft."
            className={`mt-1.5 ${inputClass}`}
          />
          <p className={hintClass}>
            Keep it to the work. Pressure and guilt are not the point.
          </p>
        </div>

        <SubmitButton pendingLabel="Sending…" className={secondaryButton}>
          Send
        </SubmitButton>

        {state.message ? (
          <p
            role={state.status === "error" ? "alert" : "status"}
            aria-live="polite"
            className={
              state.status === "error" ? "text-sm text-danger" : "text-sm text-mint"
            }
          >
            {state.message}
          </p>
        ) : null}
      </form>
    </section>
  );
}
