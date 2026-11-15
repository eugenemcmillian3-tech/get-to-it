/**
 * Customer-facing credit copy. Pure strings, so the server pages, client forms
 * and tests all describe the owner exemption the same way.
 */

import { formatCredits, formatUsd } from "./format";
import {
  CREDIT_VALUE_CENTS,
  CREDIT_VALUE_LABEL,
  operationChargeLabel,
} from "./pricing";

/** Shown instead of a price when the database says the account is the owner. */
export const OWNER_NO_CHARGE = "no charge on your owner account";

/** Price phrase for an AI control, or the owner exemption. */
export function aiChargeLabel(kind: string, owner: boolean | undefined): string {
  return owner ? OWNER_NO_CHARGE : operationChargeLabel(kind);
}

/** The status chips at the top of the credits page. */
export function creditStatusChips(owner: boolean, balance: number): string[] {
  if (owner) {
    return ["Owner account", "AI requests are not charged", "Test mode"];
  }

  return [
    `${formatCredits(balance)} left`,
    `${formatUsd(balance * CREDIT_VALUE_CENTS)} value`,
    `${CREDIT_VALUE_LABEL} per credit`,
    "Test mode",
  ];
}

/** Intro paragraph on the credits page. */
export function creditsIntro(owner: boolean): string {
  return owner
    ? "Your owner account is exempt from AI charges. AI requests still run one at a time, and the results are recorded below like any other request."
    : `AI work is prepaid. There is no free plan and no trial: new accounts start with zero credits, and each credit is worth ${CREDIT_VALUE_LABEL}. Add credits before starting AI work.`;
}

/** Balance caveat under the status chips. */
export function creditsAccessNote(owner: boolean): string {
  return owner
    ? "Nothing is charged to this account and no purchase is needed. AI requests are still limited to one in flight at a time so a double click cannot start two calls."
    : "At zero credits, new paid AI work is blocked. Your existing results, account settings and billing history stay available. Nothing is charged automatically, and no free AI or sample output is substituted.";
}
