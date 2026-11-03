"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleFormState } from "@/lib/action-state";
import {
  blockPartnerAction,
  endPartnershipAction,
  reportPartnerAction,
} from "@/lib/actions/partner";
import { REPORT_REASONS } from "@/lib/partner";
import {
  dangerButton,
  focusRing,
  hintClass,
  inputClass,
  labelClass,
  secondaryButton,
} from "@/lib/styles";

/**
 * Ending, blocking and reporting.
 *
 * Ending or blocking revokes access immediately: the shared view and the thread
 * stop resolving for both people. A report is stored for a person to read —
 * there is no automated moderation, and the copy says exactly that.
 */
export function PartnerSafety({
  partnershipId,
  partnerName,
}: {
  partnershipId: string;
  partnerName: string;
}) {
  const [endState, endAction] = useActionState(endPartnershipAction, idleFormState);
  const [blockState, blockAction] = useActionState(
    blockPartnerAction,
    idleFormState,
  );
  const [reportState, reportAction] = useActionState(
    reportPartnerAction,
    idleFormState,
  );

  const [confirmEnd, setConfirmEnd] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);

  return (
    <section aria-labelledby="safety-heading" className="mt-10 border-t border-line pt-6">
      <h2
        id="safety-heading"
        className="text-xs font-bold uppercase tracking-[0.15em] text-muted"
      >
        Safety and ending
      </h2>

      <div className="mt-3 space-y-4">
        <div className="rounded-xl border border-line bg-card p-3.5">
          <h3 className="text-sm font-semibold">End this partnership</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Both of you lose access to each other&apos;s shared progress and this
            thread. Nothing of yours is deleted. You can invite someone else
            afterwards.
          </p>

          {confirmEnd ? (
            <form action={endAction} className="mt-3 space-y-2">
              <input type="hidden" name="partnership_id" value={partnershipId} />
              <p role="alert" className="text-sm font-medium text-danger">
                End sharing with {partnerName}?
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <SubmitButton pendingLabel="Ending…" className={dangerButton}>
                  Yes, end it
                </SubmitButton>
                <button
                  type="button"
                  onClick={() => setConfirmEnd(false)}
                  className={secondaryButton}
                >
                  Keep sharing
                </button>
              </div>
              {endState.status === "error" ? (
                <p role="alert" className="text-sm text-danger">
                  {endState.message}
                </p>
              ) : null}
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmEnd(true)}
              className={`mt-3 inline-flex min-h-11 cursor-pointer items-center rounded-xl border border-line px-4 text-sm font-semibold text-ink transition hover:bg-brand-soft ${focusRing}`}
            >
              End partnership
            </button>
          )}
        </div>

        <div className="rounded-xl border border-danger/30 bg-danger/5 p-3.5">
          <h3 className="text-sm font-semibold">Block {partnerName}</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Ends the partnership now and stops either of you inviting the other
            again. Use this if you would rather not be contacted.
          </p>

          {confirmBlock ? (
            <form action={blockAction} className="mt-3 space-y-2">
              <input type="hidden" name="partnership_id" value={partnershipId} />
              <p role="alert" className="text-sm font-medium text-danger">
                Block {partnerName}? This ends the partnership and can&apos;t be
                undone from here.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <SubmitButton pendingLabel="Blocking…" className={dangerButton}>
                  Yes, block
                </SubmitButton>
                <button
                  type="button"
                  onClick={() => setConfirmBlock(false)}
                  className={secondaryButton}
                >
                  Cancel
                </button>
              </div>
              {blockState.status === "error" ? (
                <p role="alert" className="text-sm text-danger">
                  {blockState.message}
                </p>
              ) : null}
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmBlock(true)}
              className={`mt-3 inline-flex min-h-11 cursor-pointer items-center rounded-xl border border-danger/40 px-4 text-sm font-semibold text-danger transition hover:bg-danger/10 ${focusRing}`}
            >
              Block
            </button>
          )}
        </div>

        <div className="rounded-xl border border-line bg-card p-3.5">
          <h3 className="text-sm font-semibold">Report a problem</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Reports are stored and read by a person. There is no automated
            moderation service, so nothing is removed or reviewed automatically.
          </p>

          <form action={reportAction} className="mt-3 space-y-3">
            <input type="hidden" name="partnership_id" value={partnershipId} />
            <div>
              <label className={labelClass} htmlFor="report-reason">
                What happened?
              </label>
              <select
                id="report-reason"
                name="reason"
                defaultValue="harassment"
                className={`mt-1.5 ${inputClass}`}
              >
                {REPORT_REASONS.map((reason) => (
                  <option key={reason.value} value={reason.value}>
                    {reason.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass} htmlFor="report-note">
                Anything else <span className="font-normal text-muted">(optional)</span>
              </label>
              <textarea
                id="report-note"
                name="note"
                rows={2}
                maxLength={500}
                className={`mt-1.5 ${inputClass}`}
              />
              <p className={hintClass}>Up to 500 characters.</p>
            </div>

            <SubmitButton pendingLabel="Sending report…" className={secondaryButton}>
              Send report
            </SubmitButton>

            {reportState.message ? (
              <p
                role={reportState.status === "error" ? "alert" : "status"}
                aria-live="polite"
                className={
                  reportState.status === "error"
                    ? "text-sm text-danger"
                    : "text-sm text-mint"
                }
              >
                {reportState.message}
              </p>
            ) : null}
          </form>
        </div>
      </div>
    </section>
  );
}
