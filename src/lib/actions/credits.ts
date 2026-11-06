"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { FormState } from "@/lib/action-state";
import { getSession } from "@/lib/auth";
import { createCheckoutSession } from "@/lib/credits/stripe";
import { readText } from "@/lib/validation";

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";

type PaymentPayload = {
  ok?: boolean;
  code?: string;
  payment_id?: string;
  credits?: number;
  amount_cents?: number;
  currency?: string;
  label?: string;
};

/**
 * Starts a test-mode checkout.
 *
 * The amount and the credit count come from the database, never from the form:
 * the form only names a pack. The browser redirect after paying is *not* proof
 * of payment — credits are only added by the verified webhook.
 */
export async function startCheckoutAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED, nonce: Date.now() };

  const packSlug = readText(formData, "pack_slug");
  if (!packSlug) {
    return { status: "error", message: "Choose a credit pack first.", nonce: Date.now() };
  }

  const { data, error } = await session.supabase.rpc("create_credit_payment", {
    p_pack_slug: packSlug,
  });

  if (error) {
    console.error("create_credit_payment failed:", error.message);
    return {
      status: "error",
      message: "We couldn't start that purchase. Nothing was charged — try again.",
      nonce: Date.now(),
    };
  }

  const payment = (data ?? {}) as PaymentPayload;

  if (payment.ok !== true || !payment.payment_id) {
    return {
      status: "error",
      message:
        payment.code === "unknown-pack"
          ? "That pack isn't available any more. Pick another one."
          : "We couldn't start that purchase. Nothing was charged — try again.",
      nonce: Date.now(),
    };
  }

  const origin = await requestOrigin();
  const checkout = await createCheckoutSession({
    paymentId: payment.payment_id,
    userId: session.user.id,
    email: session.user.email ?? null,
    packSlug,
    label: payment.label ?? "AI credits",
    credits: Number(payment.credits ?? 0),
    amountCents: Number(payment.amount_cents ?? 0),
    currency: payment.currency ?? "usd",
    successUrl: `${origin}/credits?checkout=done&payment=${payment.payment_id}`,
    cancelUrl: `${origin}/credits?checkout=cancelled`,
  });

  if (!checkout.ok) {
    // The pending row stays visible so it can be canceled from the page.
    revalidatePath("/credits");
    return { status: "error", message: checkout.message, nonce: Date.now() };
  }

  const attached = await session.supabase.rpc("attach_credit_session", {
    p_payment_id: payment.payment_id,
    p_session_id: checkout.sessionId,
  });

  const attachedPayload = (attached.data ?? {}) as { ok?: boolean };
  if (attached.error || attachedPayload.ok !== true) {
    console.error("attach_credit_session failed:", attached.error?.message);
    revalidatePath("/credits");
    return {
      status: "error",
      message:
        "We couldn't record that checkout, so nothing further will happen. Nothing was charged.",
      nonce: Date.now(),
    };
  }

  revalidatePath("/credits");
  redirect(checkout.url);
}

/** Cancels a pending checkout this person started. Never touches paid rows. */
export async function cancelCheckoutAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const paymentId = readText(formData, "payment_id");
  if (!paymentId) return;

  const { error } = await session.supabase.rpc("cancel_credit_payment", {
    p_payment_id: paymentId,
  });

  if (error) {
    console.error("cancel_credit_payment failed:", error.message);
  }

  revalidatePath("/credits");
}

async function requestOrigin(): Promise<string> {
  const headerList = await headers();
  const host =
    headerList.get("x-forwarded-host") ??
    headerList.get("host") ??
    "localhost:3000";
  const proto =
    headerList.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}
