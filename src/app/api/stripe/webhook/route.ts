import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  eventCreatedAt,
  factsFromEvent,
  invoicePaymentId,
  isFullRefund,
  getStripeKey,
  getWebhookSecret,
  parseStripeEvent,
  paymentDetailsFromEvent,
  subscriptionFactsFromEvent,
  verifyStripeSignature,
} from "@/lib/credits/stripe";
import { cancelSubscriptionNow } from "@/lib/billing/stripe";
import { sendPurchaseReceipt } from "@/lib/credits/receipt";
import { getSupabaseSettings } from "@/lib/supabase/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RefundLookup = {
  ok?: boolean;
  code?: string;
  provider_subscription_id?: string | null;
};

/**
 * Stops the Stripe subscription behind a refunded purchase.
 *
 * Revoking the entitlement is not enough: an active Stripe subscription keeps
 * billing a customer who has been refunded, and its next `invoice.paid` would
 * buy the period back. The lookup is by payment id, so a retried delivery
 * repeats the same idempotent cancellation instead of depending on the event
 * having been new.
 */
async function stopRefundedSubscription(input: {
  supabase: SupabaseClient;
  rpcToken: string;
  providerPaymentId: string | null;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  // A credit-pack refund has no billing purchase, so there is nothing to stop.
  if (!input.providerPaymentId) return { ok: true };

  if (!getStripeKey()) {
    console.error(
      "Refund recorded without a usable Stripe key: a refunded subscription may still be active and needs reconciliation.",
    );
    return { ok: true };
  }

  const { data, error } = await input.supabase.rpc(
    "billing_subscription_for_payment",
    {
      p_token: input.rpcToken,
      p_provider_payment_id: input.providerPaymentId,
    },
  );

  if (error) return { ok: false, reason: error.message };

  const lookup = (data ?? {}) as RefundLookup;
  if (lookup.ok === false) {
    return { ok: false, reason: lookup.code ?? "lookup rejected" };
  }
  // Nothing else gates the cancellation: a signed refund must stop billing even
  // if our own bookkeeping has not caught up yet, and Stripe already treats a
  // second cancellation as success.
  if (!lookup.provider_subscription_id) return { ok: true };

  const canceled = await cancelSubscriptionNow(lookup.provider_subscription_id);
  return canceled.ok ? { ok: true } : { ok: false, reason: canceled.message };
}

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

  // `charge.refunded` also fires for a partial refund. Only a fully refunded
  // charge undoes a purchase: revoking access or cancelling a subscription over
  // a goodwill part-refund would take away what the customer kept.
  if (event.type === "charge.refunded" && !isFullRefund(event)) {
    console.info("Partial refund acknowledged without revoking access:", event.id);
    return NextResponse.json({ ok: true, ignored: "partial-refund" });
  }

  const supabase = createClient(settings.url, settings.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const isSubscriptionEvent =
    event.type.startsWith("customer.subscription.") ||
    event.type === "invoice.paid" ||
    event.type === "invoice.payment_failed";

  if (isSubscriptionEvent) {
    const subscription = subscriptionFactsFromEvent(event);
    if (!subscription.subscriptionId) {
      return NextResponse.json({ ok: true, ignored: "missing-subscription" });
    }

    const { data: subscriptionData, error: subscriptionError } = await supabase.rpc(
      "billing_handle_subscription_event",
      {
        p_token: rpcToken,
        p_event_id: event.id,
        p_type: event.type,
        p_subscription_id: subscription.subscriptionId,
        p_customer_id: subscription.customerId,
        p_status: subscription.status,
        p_price_id: subscription.priceId,
        p_quantity: subscription.quantity,
        p_period_start: subscription.periodStart,
        p_period_end: subscription.periodEnd,
        p_cancel_at_period_end: subscription.cancelAtPeriodEnd,
        p_purchase_id: subscription.purchaseId,
        p_event_created: eventCreatedAt(event),
      },
    );

    if (subscriptionError) {
      console.error("billing_handle_subscription_event failed:", subscriptionError.message);
      return NextResponse.json(
        { ok: false, error: "The subscription event could not be recorded yet." },
        { status: 500 },
      );
    }

    const subscriptionResult = (subscriptionData ?? {}) as { ok?: boolean; code?: string };
    if (subscriptionResult.ok === false && subscriptionResult.code === "unauthorized") {
      return NextResponse.json(
        { ok: false, error: "That webhook token is not accepted." },
        { status: 401 },
      );
    }

    // A refund arrives as `charge.refunded` on the invoice's charge, so the
    // subscription records that invoice's payment intent. Without it a refunded
    // subscription could match nothing, because a subscription Checkout session
    // is not guaranteed to carry a payment intent of its own.
    if (event.type === "invoice.paid") {
      const invoicePayment = invoicePaymentId(event);
      if (invoicePayment) {
        const { error: invoiceError } = await supabase.rpc(
          "billing_record_invoice_payment",
          {
            p_token: rpcToken,
            p_subscription_id: subscription.subscriptionId,
            p_provider_payment_id: invoicePayment,
          },
        );

        if (invoiceError) {
          console.error("billing_record_invoice_payment failed:", invoiceError.message);
          // 500 so Stripe retries: both statements are idempotent, and a later
          // refund of this invoice has to be able to find the subscription.
          return NextResponse.json(
            { ok: false, error: "The invoice payment could not be recorded yet." },
            { status: 500 },
          );
        }
      }
    }

    return NextResponse.json({ ok: true, subscription: subscriptionData });
  }

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

    if (event.type === "charge.refunded") {
      const stopped = await stopRefundedSubscription({
        supabase,
        rpcToken,
        providerPaymentId: facts.providerPaymentId,
      });

      if (!stopped.ok) {
        // 500 so Stripe retries. The refund itself is already recorded, and the
        // retry repeats the same lookup, so nothing is granted twice.
        console.error("Refunded subscription was not canceled:", stopped.reason);
        return NextResponse.json(
          {
            ok: false,
            error: "The refund is recorded, but the subscription could not be stopped yet.",
          },
          { status: 500 },
        );
      }
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
  //
  // Only a genuinely granted purchase earns a receipt: a replay returns
  // `duplicate` and a refund grants nothing, so neither sends mail.
  const granted = (data ?? {}) as { granted?: unknown; payment_id?: unknown };
  if (
    result.ok !== false &&
    typeof granted.granted === "number" &&
    granted.granted > 0
  ) {
    const details = paymentDetailsFromEvent(event);
    const receipt = await sendPurchaseReceipt({
      email: details.customerEmail,
      paymentId:
        typeof granted.payment_id === "string" ? granted.payment_id : event.id,
      credits: granted.granted,
      amountCents: details.amountTotal,
      currency: details.currency,
      receiptUrl: facts.receiptUrl,
    });

    if (!receipt.sent) {
      // Deliberately not an error response: the payment is already recorded.
      console.warn(`Purchase receipt not sent: ${receipt.reason}`);
    }
  }

  return NextResponse.json({ ok: true, result: data });
}
