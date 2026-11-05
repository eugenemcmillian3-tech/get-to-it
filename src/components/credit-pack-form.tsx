"use client";

import { useActionState } from "react";
import { idleFormState } from "@/lib/action-state";
import { startCheckoutAction } from "@/lib/actions/credits";
import { formatCredits, formatUsd } from "@/lib/credits/format";
import { CREDIT_VALUE_LABEL } from "@/lib/credits/pricing";
import { cardClass, primaryButton } from "@/lib/styles";
import type { CreditPack } from "@/lib/types";

/**
 * One button per pack. The form only names a pack; the server looks the price
 * and the credit count up, so a tampered form cannot buy 150 credits for $1.
 */
export function CreditPackForm({
  packs,
  enabled,
}: {
  packs: CreditPack[];
  enabled: boolean;
}) {
  const [state, formAction] = useActionState(startCheckoutAction, idleFormState);

  return (
    <form action={formAction}>
      <ul className="mt-3 grid gap-3 sm:grid-cols-3">
        {packs.map((pack) => (
          <li key={pack.slug} className={cardClass}>
            <p className="text-lg font-bold">{formatCredits(pack.credits)}</p>
            <p className="mt-0.5 text-sm text-muted">{formatUsd(pack.amount_cents)}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              {CREDIT_VALUE_LABEL} per credit. AI work uses prepaid credits;
              there is no free plan.
            </p>
            <button
              type="submit"
              name="pack_slug"
              value={pack.slug}
              disabled={!enabled}
              className={`${primaryButton} mt-3 w-full`}
            >
              Buy for {formatUsd(pack.amount_cents)}
            </button>
          </li>
        ))}
      </ul>

      {state.message ? (
        <p
          role={state.status === "error" ? "alert" : "status"}
          aria-live="polite"
          className={`mt-3 text-sm ${state.status === "error" ? "text-danger" : "text-mint"}`}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
