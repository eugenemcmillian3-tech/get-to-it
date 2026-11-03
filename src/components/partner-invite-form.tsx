"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleFormState } from "@/lib/action-state";
import { createInvitationAction } from "@/lib/actions/partner";
import {
  focusRing,
  hintClass,
  inputClass,
  labelClass,
  primaryButton,
} from "@/lib/styles";

/**
 * Invite one person.
 *
 * The address is never checked against existing accounts, and GET TO IT sends
 * no email: the invitation exists as a link the person copies and shares
 * themselves. That is why this response cannot be used to test whether someone
 * has an account.
 */
export function PartnerInviteForm() {
  const [state, formAction] = useActionState(
    createInvitationAction,
    idleFormState,
  );

  return (
    <form action={formAction} className="mt-4 space-y-3">
      <div>
        <label className={labelClass} htmlFor="invite-email">
          Their email address
        </label>
        <input
          id="invite-email"
          name="invitee_email"
          type="email"
          required
          maxLength={254}
          autoComplete="off"
          placeholder="them@example.com"
          className={`mt-1.5 ${inputClass}`}
        />
        <p className={hintClass}>
          Used only to check who may accept. We don&apos;t look up whether it has
          an account, and we never send email — you pass the link on yourself.
        </p>
      </div>

      <SubmitButton pendingLabel="Creating…" className={primaryButton}>
        Create invitation link
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

      {state.link ? (
        <div className="rounded-xl border border-line bg-paper p-3">
          <label className={labelClass} htmlFor="invite-link">
            Invitation link
          </label>
          <input
            id="invite-link"
            readOnly
            value={state.link}
            onFocus={(event) => event.currentTarget.select()}
            className={`mt-1.5 ${inputClass} font-mono text-xs`}
          />
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Single use, expires in seven days. Only the account with that address
            can accept it, so forwarding it to someone else achieves nothing.
          </p>
          <p className={`mt-1 text-xs text-muted ${focusRing}`}>
            Revoke it any time with Cancel below.
          </p>
        </div>
      ) : null}
    </form>
  );
}
