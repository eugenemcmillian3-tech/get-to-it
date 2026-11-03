"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleAuthState } from "@/lib/action-state";
import { signInAction, signUpAction } from "@/lib/actions/auth";
import { hintClass, inputClass, labelClass } from "@/lib/styles";

export function AuthForm({
  mode,
  nextPath,
}: {
  mode: "sign-in" | "sign-up";
  nextPath?: string;
}) {
  const isSignUp = mode === "sign-up";
  const [state, formAction] = useActionState(
    isSignUp ? signUpAction : signInAction,
    idleAuthState,
  );

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {nextPath ? <input type="hidden" name="next" value={nextPath} /> : null}

      {isSignUp ? (
        <div>
          <label className={labelClass} htmlFor="display_name">
            Your name <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="display_name"
            name="display_name"
            type="text"
            autoComplete="name"
            maxLength={80}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
      ) : null}

      <div>
        <label className={labelClass} htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          className={`mt-1.5 ${inputClass}`}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={isSignUp ? 8 : undefined}
          maxLength={72}
          autoComplete={isSignUp ? "new-password" : "current-password"}
          className={`mt-1.5 ${inputClass}`}
        />
        {isSignUp ? <p className={hintClass}>At least 8 characters.</p> : null}
      </div>

      {state.message ? (
        <p
          role={state.status === "error" ? "alert" : "status"}
          aria-live="polite"
          className={
            state.status === "error"
              ? "rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger"
              : "rounded-xl border border-mint/40 bg-mint-soft px-3 py-2 text-sm text-mint"
          }
        >
          {state.message}
        </p>
      ) : null}

      <SubmitButton
        className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold tracking-wide text-white shadow-sm transition hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60"
        pendingLabel={isSignUp ? "Creating your account…" : "Signing you in…"}
      >
        {isSignUp ? "Create account" : "Sign in"}
      </SubmitButton>
    </form>
  );
}
