"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleFormState } from "@/lib/action-state";
import { deleteAccountAction } from "@/lib/actions/account";
import { dangerButton, hintClass, inputClass, labelClass, secondaryButton } from "@/lib/styles";

/**
 * Account deletion, behind two deliberate steps and a typed confirmation.
 * The copy states exactly what goes and what stays before anything happens.
 */
export function DeleteAccountCard({ className = "mt-10" }: { className?: string } = {}) {
  const [state, formAction] = useActionState(deleteAccountAction, idleFormState);
  const [open, setOpen] = useState(false);
  const sectionRef = useRef<HTMLElement | null>(null);

  // A link from Settings arrives with #delete-account, but a client-side
  // navigation does not scroll to a fragment on its own, so the card would
  // stay thousands of pixels below the fold. Bring it into view when asked.
  useEffect(() => {
    if (window.location.hash === "#delete-account") {
      sectionRef.current?.scrollIntoView({ block: "start" });
    }
  }, []);

  if (!open) {
    return (
      <section
        id="delete-account" ref={sectionRef}
        aria-labelledby="delete-heading"
        className={className}
      >
        <h2 id="delete-heading" className="text-lg font-bold">
          Delete your account
        </h2>
        <p className={hintClass}>
          You can remove everything whenever you want. Nothing is hidden behind
          a support ticket.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`${secondaryButton} mt-3 text-danger`}
        >
          Delete my account
        </button>
      </section>
    );
  }

  return (
    <section
      id="delete-account" ref={sectionRef}
      aria-labelledby="delete-heading"
      className={className}
    >
      <h2 id="delete-heading" className="text-lg font-bold">
        Delete your account
      </h2>

      <div className="mt-3 rounded-2xl border border-danger/40 bg-danger/5 p-4">
        <p className="text-sm font-semibold text-danger">
          This can&apos;t be undone.
        </p>

        <div className="mt-3 space-y-2 text-sm leading-relaxed">
          <p>
            <span className="font-semibold">Deleted immediately:</span> your
            login, profile, goals, tasks, saved work, focus sessions, weekly
            reflections, plan records and AI request history.
          </p>
          <p>
            <span className="font-semibold">Kept:</span> the daily count of AI
            requests already made stays in the shared counter, so deleting an
            account doesn&apos;t hand an allowance back; and feedback you sent is
            kept without your account attached to it.
          </p>
          <p className="text-muted">
            Any focus session still open is deleted with the rest — finish a
            session first if you want its time counted.
          </p>
        </div>

        <form action={formAction} className="mt-4 space-y-3">
          <div className="sm:max-w-xs">
            <label className={labelClass} htmlFor="delete-confirm">
              Type DELETE to confirm
            </label>
            <input
              id="delete-confirm"
              name="confirm"
              autoComplete="off"
              autoCapitalize="characters"
              placeholder="DELETE"
              className={`mt-1.5 ${inputClass}`}
            />
          </div>

          {state.status === "error" && state.message ? (
            <p role="alert" className="text-sm text-danger">
              {state.message}
            </p>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row">
            <SubmitButton pendingLabel="Deleting…" className={dangerButton}>
              Delete my account permanently
            </SubmitButton>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className={secondaryButton}
            >
              Keep my account
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
