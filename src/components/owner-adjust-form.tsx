"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleFormState } from "@/lib/action-state";
import { adjustCreditsAction } from "@/lib/actions/owner";
import { focusRing, inputClass, labelClass, secondaryButton } from "@/lib/styles";

/** Manual adjustment with a required note. Server-side ownership check. */
export function OwnerAdjustForm() {
  const [state, formAction] = useActionState(adjustCreditsAction, idleFormState);

  return (
    <form action={formAction} className="mt-3 space-y-3">
      <div>
        <label className={labelClass} htmlFor="owner-email">
          Person&apos;s email
        </label>
        <input
          id="owner-email"
          name="email"
          type="email"
          required
          className={`mt-1.5 ${inputClass}`}
          placeholder="someone@example.com"
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="owner-delta">
          Credits to add or remove
        </label>
        <input
          id="owner-delta"
          name="delta"
          type="number"
          required
          step={1}
          min={-10000}
          max={10000}
          className={`mt-1.5 ${inputClass}`}
          placeholder="5 or -5"
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="owner-note">
          Note
        </label>
        <input
          id="owner-note"
          name="note"
          required
          maxLength={500}
          className={`mt-1.5 ${inputClass}`}
          placeholder="Support ticket 123: refunded a failed purchase"
        />
      </div>

      {state.message ? (
        <p
          role={state.status === "error" ? "alert" : "status"}
          aria-live="polite"
          className={state.status === "error" ? "text-sm text-danger" : "text-sm text-mint"}
        >
          {state.message}
        </p>
      ) : null}

      <SubmitButton pendingLabel="Saving…" className={`${secondaryButton} ${focusRing}`}>
        Record adjustment
      </SubmitButton>
    </form>
  );
}
