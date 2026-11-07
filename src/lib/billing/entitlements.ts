import type { Session } from "@/lib/auth";
import type { BillingGrant } from "@/lib/billing/offers";

/**
 * The database checks the signed-in user and expiry; this helper never trusts a
 * browser-supplied grant. A missing migration or database error is treated as
 * "not entitled", which is the safe direction for every gate.
 */
export async function hasBillingGrant(
  session: Session,
  grant: BillingGrant,
): Promise<boolean> {
  const { data, error } = await session.supabase.rpc("billing_has_grant", {
    p_grant: grant,
  });

  if (error) {
    console.error("billing_has_grant failed:", error.message);
    return false;
  }

  return data === true;
}
