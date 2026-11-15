"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleAuthState } from "@/lib/action-state";
import {
  sendEmailCodeAction,
  verifyEmailCodeAction,
} from "@/lib/actions/auth";
import { hintClass, inputClass, labelClass, secondaryButton } from "@/lib/styles";

/**
 * Passwordless email-code sign-in.
 *
 * The request response never says whether an account exists. The person can
 * request a fresh six-digit code and then verify it; Supabase applies its own
 * expiry and rate limits, and the session is set by the server action.
 */
export function EmailCodeForm({ nextPath }: { nextPath?: string }) {
  const [email, setEmail] = useState("");
  const [codeRequested, setCodeRequested] = useState(false);
  const [requestState, requestAction] = useActionState(
    sendEmailCodeAction,
    idleAuthState,
  );
  const [verifyState, verifyAction] = useActionState(
    verifyEmailCodeAction,
    idleAuthState,
  );

  const showCode = codeRequested || verifyState.status !== "idle";

  return (
    <section className="mt-7 border-t border-line pt-6" aria-labelledby="email-code-heading">
      <h2 id="email-code-heading" className="text-base font-bold">
        Email me a sign-in code
      </h2>
      <p className={`mt-1 ${hintClass}`}>
        No password needed. We&apos;ll email a one-time code that expires in ten
        minutes.
      </p>

      <form
        action={requestAction}
        className="mt-4 space-y-3"
        onSubmit={() => setCodeRequested(true)}
      >
        <div>
          <label className={labelClass} htmlFor="code-email">
            Email
          </label>
          <input
            id="code-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className={`mt-1.5 ${inputClass}`}
          />
        </div>

        {requestState.message ? (
          <p
            role={requestState.status === "error" ? "alert" : "status"}
            aria-live="polite"
            className={
              requestState.status === "error"
                ? "rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger"
                : "rounded-xl border border-mint/40 bg-mint-soft px-3 py-2 text-sm text-mint"
            }
          >
            {requestState.message}
          </p>
        ) : null}

        <SubmitButton pendingLabel="Sending your code…" className={`${secondaryButton} w-full`}>
          Email me a code
        </SubmitButton>
      </form>

      {showCode ? (
        <form action={verifyAction} className="mt-4 space-y-3">
          {nextPath ? <input type="hidden" name="next" value={nextPath} /> : null}
          <input type="hidden" name="email" value={email} />

          <div>
            <label className={labelClass} htmlFor="code-token">
              Email code
            </label>
            <input
              id="code-token"
              name="token"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6,10}"
              maxLength={10}
              required
              aria-describedby="code-token-hint"
              className={`mt-1.5 ${inputClass}`}
            />
            <p id="code-token-hint" className={hintClass}>
              Check the email sent to {email || "your address"}.
            </p>
          </div>

          {verifyState.message ? (
            <p
              role={verifyState.status === "error" ? "alert" : "status"}
              aria-live="polite"
              className={
                verifyState.status === "error"
                  ? "rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger"
                  : "rounded-xl border border-mint/40 bg-mint-soft px-3 py-2 text-sm text-mint"
              }
            >
              {verifyState.message}
            </p>
          ) : null}

          <SubmitButton pendingLabel="Checking your code…" className="w-full">
            Verify code and sign in
          </SubmitButton>
        </form>
      ) : null}
    </section>
  );
}
