"use client";

import { useActionState, useEffect, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleAuthState } from "@/lib/action-state";
import {
  sendEmailCodeAction,
  verifyEmailCodeAction,
} from "@/lib/actions/auth";
import { hintClass, inputClass, labelClass, secondaryButton } from "@/lib/styles";

const RESEND_SECONDS = 60;

/**
 * Passwordless email-code sign-in.
 *
 * The request response never says whether an account exists. The person can
 * request a fresh one-time code and then verify it; Supabase applies its own
 * expiry and rate limits, and the session is set by the server action.
 */
export function EmailCodeForm({ nextPath }: { nextPath?: string }) {
  const [email, setEmail] = useState("");
  const [codeRequested, setCodeRequested] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [requestState, requestAction] = useActionState(
    sendEmailCodeAction,
    idleAuthState,
  );
  const [verifyState, verifyAction] = useActionState(
    verifyEmailCodeAction,
    idleAuthState,
  );

  const showCode = codeRequested || verifyState.status !== "idle";

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => {
      setCooldown((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

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
        onSubmit={() => {
          setCodeRequested(true);
          setCooldown(RESEND_SECONDS);
        }}
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

        <SubmitButton
          pendingLabel="Sending your code…"
          className={`${secondaryButton} w-full`}
          disabled={cooldown > 0}
        >
          Email me a code
        </SubmitButton>
      </form>

      {requestState.status === "success" ? (
        <div className="mt-3 rounded-xl border border-line bg-paper/60 px-3 py-2 text-sm text-ink-soft">
          <p>
            Check {email || "your inbox"} and the spam or promotions folder. The
            sender is “Get To It”.
          </p>
          <p className="mt-1">
            Use the newest code. It is 6–10 digits and expires in ten minutes.
            Older codes may stop working.
          </p>
        </div>
      ) : null}

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
              Enter the 6–10 digit code sent to {email || "your address"}. If it
              is not there, check spam or promotions.
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

      {showCode ? (
        <div className="mt-4 border-t border-line pt-3">
          <form
            action={requestAction}
            onSubmit={() => setCooldown(RESEND_SECONDS)}
          >
            <input type="hidden" name="email" value={email} />
            <button
              type="submit"
              disabled={cooldown > 0}
              className={`${secondaryButton} w-full`}
            >
              {cooldown > 0
                ? `Resend code in ${cooldown}s`
                : "Resend code"}
            </button>
          </form>
          <p className={`mt-2 text-center ${hintClass}`} aria-live="polite">
            {cooldown > 0
              ? `You can request another code in ${cooldown} seconds.`
              : "Use the newest email. If it does not arrive, resend once."}
          </p>
        </div>
      ) : null}
    </section>
  );
}
