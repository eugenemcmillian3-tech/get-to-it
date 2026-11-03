"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleFormState } from "@/lib/action-state";
import { respondToInvitationAction } from "@/lib/actions/partner";
import {
  hintClass,
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
} from "@/lib/styles";

/**
 * Accept or decline an invitation.
 *
 * When no token is in the URL, the person can paste one — useful if the link
 * was split across messages. Every failure answers the same way, so a wrong
 * account and a dead token are indistinguishable.
 */
export function PartnerJoinActions({ token = "" }: { token?: string }) {
  const [state, formAction] = useActionState(
    respondToInvitationAction,
    idleFormState,
  );

  return (
    <form action={formAction} className="mt-4 space-y-4">
      {token ? (
        <input type="hidden" name="token" value={token} />
      ) : (
        <div>
          <label className={labelClass} htmlFor="join-token">
            Invitation code
          </label>
          <input
            id="join-token"
            name="token"
            required
            autoComplete="off"
            placeholder="Paste the code they sent you"
            className={`mt-1.5 ${inputClass} font-mono text-xs`}
          />
          <p className={hintClass}>The link they shared ends with this code.</p>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <SubmitButton
          name="intent"
          value="accept"
          pendingLabel="Working…"
          className={primaryButton}
        >
          Accept and start sharing
        </SubmitButton>

        <SubmitButton
          name="intent"
          value="decline"
          pendingLabel="Working…"
          className={secondaryButton}
        >
          Decline
        </SubmitButton>
      </div>

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
  );
}
