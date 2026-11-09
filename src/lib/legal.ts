/**
 * Operator identity for the public legal pages.
 *
 * These are public business details, not secrets, so NEXT_PUBLIC_* is correct.
 * They are read from the environment because the trading name and address are
 * deployment facts, not code. When the address and contact are absent the pages
 * say so plainly instead of inventing a company, an address or an inbox.
 *
 * Set all three in the hosting environment before paid plans are offered.
 */

export const OPERATOR_NAME =
  process.env.NEXT_PUBLIC_LEGAL_OPERATOR_NAME?.trim() || "GET TO IT";

export const OPERATOR_ADDRESS =
  process.env.NEXT_PUBLIC_LEGAL_OPERATOR_ADDRESS?.trim() || "";

/** The published contact inbox, read at call time so callers see the live value. */
export function contactEmail(): string {
  return process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL?.trim() || "";
}

export const CONTACT_EMAIL = contactEmail();

/** True only when a real postal address and a real contact inbox are published. */
export const OPERATOR_DETAILS_PUBLISHED =
  OPERATOR_ADDRESS.length > 0 && CONTACT_EMAIL.length > 0;

/** How to reach a human, as a sentence a page can render. */
export const CONTACT_SENTENCE = CONTACT_EMAIL
  ? `Email ${CONTACT_EMAIL}`
  : "Use the support request form on the Plans page once you are signed in";
