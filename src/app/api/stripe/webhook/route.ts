import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { factsFromEvent, getWebhookSecret, parseStripeEvent, verifyStripeSignature } from "@/lib/credits/stripe";
import { getSupabaseSettings } from "@/lib/supabase/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe webhook.
 *
 * Three gates: the signature must verify against the raw body, the body must
 * parse, and the database must accept the event id exactly once. Credits are
 * granted here and only here — the browser's success redirect is not evidence
 * of payment.
 *
 * A 2xx response means "we have this event". A 5xx makes Stripe retry, which is
 * safe because ingestion is idempotent; an ambiguous database failure is
 * therefore retried, but never a payment action on its own.
 */
export async function POST(request: Request) {
  const secret = getWebhookSecret();
  const rpcToken = process.env.CREDIT_RPC_TOKEN;
  const settings = getSupabaseSettings();

  if (!secret || !rpcToken || !settings) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Payments are not fully configured on this deployment. Add STRIPE_WEBHOOK_SECRET and CREDIT_RPC_TOKEN.",
      },
      { status: 503 },
    );
  }

  const payload = await request.text();
  const header = request.headers.get("stripe-signature");

  if (!verifyStripeSignature({ payload, header, secret })) {
    return NextResponse.json(
      { ok: false, error: "Signature verification failed." },
      { status: 400 },
    );
  }

  const event = parseStripeEvent(payload);
  if (!event) {
    return NextResponse.json(
      { ok: false, error: "That event is not readable." },
      { status: 400 },
    );
  }

  const facts = factsFromEvent(event);

  const supabase = createClient(settings.url, settings.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc("credit_handle_event", {
    p_token: rpcToken,
    p_event_id: event.id,
    p_type: event.type,
    p_session_id: facts.sessionId,
    p_provider_payment_id: facts.providerPaymentId,
    p_receipt_url: facts.receiptUrl,
  });

  if (error) {
    console.error("credit_handle_event failed:", error.message);
    // 500 so Stripe retries; the event id makes the retry harmless.
    return NextResponse.json(
      { ok: false, error: "The event could not be recorded yet." },
      { status: 500 },
    );
  }

  // Paid offers are fulfilled by the same verified event. The offer's
  // metadata is how a billing checkout is told apart from a credit purchase.
  // Refunds are sent too, because a billing purchase has to be revoked; the
  // billing function ignores unknown providers and payments.
  const object = event.data.object;
  const metadata = (object.metadata ?? {}) as Record<string, unknown>;
  const purchaseId = typeof metadata.purchase_id === "string" ? metadata.purchase_id : null;
  const isBillingEvent = Boolean(purchaseId) || event.type === "charge.refunded";

  if (isBillingEvent) {
    const { data: billingData, error: billingError } = await supabase.rpc(
      "billing_handle_event",
      {
        p_token: rpcToken,
        p_event_id: event.id,
        p_type: event.type,
        p_session_id: facts.sessionId,
        p_provider_payment_id: facts.providerPaymentId,
        p_receipt_url: facts.receiptUrl,
      },
    );

    if (billingError) {
      console.error("billing_handle_event failed:", billingError.message);
      return NextResponse.json(
        { ok: false, error: "The offer event could not be recorded yet." },
        { status: 500 },
      );
    }

    const billingResult = (billingData ?? {}) as { ok?: boolean; code?: string };
    if (billingResult.ok === false && billingResult.code === "unauthorized") {
      return NextResponse.json(
        { ok: false, error: "That webhook token is not accepted." },
        { status: 401 },
      );
    }

    return NextResponse.json({ ok: true, result: data, offer: billingData });
  }

  const result = (data ?? {}) as { ok?: boolean; code?: string };

  if (result.ok === false && result.code === "unauthorized") {
    console.error("credit_handle_event rejected the configured token");
    return NextResponse.json(
      { ok: false, error: "That webhook token is not accepted." },
      { status: 401 },
    );
  }

  // A refund that would leave a negative balance needs a person. Acknowledge it
  // so it is not retried forever; it is parked in payment_events as failed.
  return NextResponse.json({ ok: true, result: data });
}
