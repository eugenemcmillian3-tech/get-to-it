import type { Session } from "@/lib/auth";
import type {
  AiUsageRow,
  CreditLedgerEntry,
  CreditPack,
  CreditPayment,
  CreditSummary,
  OwnerMetrics,
} from "@/lib/types";

export type CreditOverview = {
  summary: CreditSummary;
  packs: CreditPack[];
  payments: CreditPayment[];
  ledger: CreditLedgerEntry[];
  usage: AiUsageRow[];
};

const EMPTY_SUMMARY: CreditSummary = {
  balance: 0,
  free_used_today: 0,
  free_limit: 0,
  free_remaining: 0,
  credits_spent_total: 0,
  is_owner: false,
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Everything the credits page needs, in one request-scoped pass. All of it is
 * scoped to this person by both the query and row level security.
 */
export async function getCreditOverview(session: Session): Promise<CreditOverview> {
  const { supabase } = session;

  const [summaryResult, packsResult, paymentsResult, ledgerResult, usageResult] =
    await Promise.all([
      supabase.rpc("my_credits"),
      supabase
        .from("credit_packs")
        .select("slug, credits, amount_cents, currency, label, sort_order")
        .eq("active", true)
        .order("sort_order", { ascending: true }),
      supabase
        .from("credit_payments")
        .select(
          "id, pack_slug, credits, amount_cents, currency, status, receipt_url, created_at, refunded_at",
        )
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("credit_ledger")
        .select("id, delta, reason, note, created_at")
        .order("created_at", { ascending: false })
        .limit(25),
      supabase
        .from("ai_requests")
        .select(
          "id, kind, model, status, error_code, credits_charged, tokens_in, tokens_out, started_at",
        )
        .order("started_at", { ascending: false })
        .limit(10),
    ]);

  const summaryPayload = (summaryResult.data ?? {}) as Partial<CreditSummary> & {
    ok?: boolean;
  };

  return {
    summary: summaryPayload.ok === true
      ? {
          balance: Number(summaryPayload.balance ?? 0),
          free_used_today: Number(summaryPayload.free_used_today ?? 0),
          free_limit: Number(summaryPayload.free_limit ?? 0),
          free_remaining: Number(summaryPayload.free_remaining ?? 0),
          credits_spent_total: Number(summaryPayload.credits_spent_total ?? 0),
          is_owner: summaryPayload.is_owner === true,
        }
      : EMPTY_SUMMARY,
    packs: asArray<CreditPack>(packsResult.data),
    payments: asArray<CreditPayment>(paymentsResult.data),
    ledger: asArray<CreditLedgerEntry>(ledgerResult.data),
    usage: asArray<AiUsageRow>(usageResult.data),
  };
}

export async function isOwner(session: Session): Promise<boolean> {
  const { data, error } = await session.supabase.rpc("app_is_owner");
  if (error) return false;
  return data === true;
}

/**
 * Aggregate numbers only. No task titles, notes or saved work reach this call,
 * by design: the dashboard is for running the service, not reading people's
 * work.
 */
export async function getOwnerMetrics(
  session: Session,
): Promise<OwnerMetrics | null> {
  const { data, error } = await session.supabase.rpc("owner_metrics");
  if (error) {
    console.error("owner_metrics failed:", error.message);
    return null;
  }

  const payload = (data ?? {}) as { ok?: boolean; metrics?: OwnerMetrics };
  if (payload.ok !== true || !payload.metrics) return null;
  return payload.metrics;
}
