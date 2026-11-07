import type { Session } from "@/lib/auth";
import { DataError } from "@/lib/data/goals";
import type {
  AppCustomDomain,
  BillingEntitlement,
  BillingOffer,
  BillingPurchase,
  SupportRequest,
} from "@/lib/types";

const LOAD_ERROR =
  "We couldn't load your paid offers just now. Refresh the page to try again.";

export type BillingOverview = {
  offers: BillingOffer[];
  purchases: BillingPurchase[];
  entitlements: BillingEntitlement[];
  supportRequests: SupportRequest[];
  domains: AppCustomDomain[];
  workspaces: { id: string; name: string }[];
  projects: { id: string; name: string }[];
};

export async function getBillingOverview(session: Session): Promise<BillingOverview> {
  const { supabase } = session;

  const [offersResult, purchasesResult, entitlementsResult, supportResult, domainsResult, membershipsResult, projectsResult] =
    await Promise.all([
      supabase
        .from("billing_offers")
        .select(
          "slug, label, description, price_cents, currency, quantity_label, min_quantity, max_quantity, seat_based, grants, duration_days, sort_order",
        )
        .eq("active", true)
        .order("sort_order", { ascending: true }),
      supabase
        .from("billing_purchases")
        .select(
          "id, offer_slug, quantity, amount_cents, currency, status, workspace_id, project_id, receipt_url, paid_at, refunded_at, created_at",
        )
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("billing_entitlements")
        .select(
          "id, offer_slug, grants, quantity, workspace_id, project_id, status, starts_at, expires_at, created_at",
        )
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("support_requests")
        .select("id, subject, body, status, priority, created_at")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("app_custom_domains")
        .select("id, project_id, domain, status, detail, created_at")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", session.user.id)
        .eq("role", "owner")
        .eq("status", "active"),
      supabase
        .from("app_projects")
        .select("id, name")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

  for (const result of [
    offersResult,
    purchasesResult,
    entitlementsResult,
    supportResult,
    domainsResult,
    membershipsResult,
    projectsResult,
  ]) {
    if (result.error) {
      console.error("getBillingOverview failed:", result.error.message);
      throw new DataError(LOAD_ERROR);
    }
  }

  const workspaceIds = ((membershipsResult.data ?? []) as { workspace_id: string }[]).map(
    (row) => row.workspace_id,
  );
  const workspacesResult = workspaceIds.length
    ? await supabase
        .from("workspaces")
        .select("id, name")
        .in("id", workspaceIds)
        .order("name", { ascending: true })
    : { data: [] as { id: string; name: string }[], error: null };

  if (workspacesResult.error) {
    console.error("getBillingOverview workspaces failed:", workspacesResult.error.message);
    throw new DataError(LOAD_ERROR);
  }

  return {
    offers: (offersResult.data ?? []) as BillingOffer[],
    purchases: (purchasesResult.data ?? []) as BillingPurchase[],
    entitlements: (entitlementsResult.data ?? []) as BillingEntitlement[],
    supportRequests: (supportResult.data ?? []) as SupportRequest[],
    domains: (domainsResult.data ?? []) as AppCustomDomain[],
    workspaces: (workspacesResult.data ?? []) as { id: string; name: string }[],
    projects: (projectsResult.data ?? []) as { id: string; name: string }[],
  };
}

/** Active grants for display; the database still checks expiry on every gate. */
export function activeGrants(
  entitlements: BillingEntitlement[],
  now: Date = new Date(),
): Set<string> {
  const grants = new Set<string>();
  for (const entitlement of entitlements) {
    if (entitlement.status !== "active") continue;
    if (entitlement.expires_at && new Date(entitlement.expires_at) <= now) continue;
    for (const grant of entitlement.grants) grants.add(grant);
  }
  return grants;
}
