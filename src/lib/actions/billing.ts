"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/lib/action-state";
import { getSession } from "@/lib/auth";
import { hasBillingGrant } from "@/lib/billing/entitlements";
import { billingOffer } from "@/lib/billing/offers";
import { createBillingCheckoutSession } from "@/lib/billing/stripe";
import { addVercelDomain } from "@/lib/deploy/providers";
import { connectionAad, decryptSecret, vaultConfigured } from "@/lib/deploy/vault";
import { readText } from "@/lib/validation";

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That app project isn't available to you.";
const VAULT_MISSING =
  "The deployment vault isn't configured, so the Vercel token cannot be used.";

type PurchasePayload = {
  ok?: boolean;
  code?: string;
  purchase_id?: string;
  amount_cents?: number;
  currency?: string;
  label?: string;
  quantity?: number;
};

function fail(message: string): FormState {
  return { status: "error", message, nonce: Date.now() };
}

export async function startBillingCheckoutAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const offerSlug = readText(formData, "offer_slug");
  const offer = billingOffer(offerSlug);
  if (!offer) return fail("That offer isn't available any more.");

  const quantity = Number.parseInt(readText(formData, "quantity") || "1", 10);
  const workspaceId = readText(formData, "workspace_id") || null;
  if (!Number.isInteger(quantity) || quantity < offer.minQuantity || quantity > offer.maxQuantity) {
    return fail(`Choose a quantity between ${offer.minQuantity} and ${offer.maxQuantity}.`);
  }
  if (offer.seatBased && !workspaceId) {
    return fail("Choose the workspace these seats belong to.");
  }

  const { data, error } = await session.supabase.rpc("create_billing_purchase", {
    p_offer_slug: offerSlug,
    p_quantity: quantity,
    p_workspace_id: workspaceId,
    p_project_id: null,
  });

  if (error) {
    console.error("create_billing_purchase failed:", error.message);
    return fail("We couldn't start that purchase. Nothing was charged — try again.");
  }

  const purchase = (data ?? {}) as PurchasePayload;
  if (purchase.ok !== true || !purchase.purchase_id) {
    const messages: Record<string, string> = {
      "unknown-offer": "That offer isn't available any more. Pick another one.",
      "invalid-quantity": "That quantity isn't available for this offer.",
      "not-workspace-owner": "Only the workspace owner can buy seats for it.",
      "workspace-required": "Choose the workspace these seats belong to.",
      "not-project-owner": "That app project isn't available to you.",
    };
    return fail(
      messages[purchase.code ?? ""] ??
        "We couldn't start that purchase. Nothing was charged — try again.",
    );
  }

  const origin = await requestOrigin();
  const checkout = await createBillingCheckoutSession({
    purchaseId: purchase.purchase_id,
    userId: session.user.id,
    email: session.user.email ?? null,
    offerSlug,
    label: purchase.label ?? offer.label,
    quantity,
    amountCents: Number(purchase.amount_cents ?? offer.priceCents * quantity),
    currency: purchase.currency ?? "usd",
    successUrl: `${origin}/billing?checkout=done&purchase=${purchase.purchase_id}`,
    cancelUrl: `${origin}/billing?checkout=cancelled`,
  });

  if (!checkout.ok) {
    revalidatePath("/billing");
    return fail(checkout.message);
  }

  const attached = await session.supabase.rpc("attach_billing_session", {
    p_purchase_id: purchase.purchase_id,
    p_session_id: checkout.sessionId,
  });

  const attachedPayload = (attached.data ?? {}) as { ok?: boolean };
  if (attached.error || attachedPayload.ok !== true) {
    console.error("attach_billing_session failed:", attached.error?.message);
    revalidatePath("/billing");
    return fail("We couldn't record that checkout, so nothing further will happen. Nothing was charged.");
  }

  revalidatePath("/billing");
  redirect(checkout.url);
}

export async function cancelBillingPurchaseAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const purchaseId = readText(formData, "purchase_id");
  if (!purchaseId) return;

  const { error } = await session.supabase.rpc("cancel_billing_purchase", {
    p_purchase_id: purchaseId,
  });
  if (error) console.error("cancel_billing_purchase failed:", error.message);

  revalidatePath("/billing");
}

export async function createSupportRequestAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const subject = readText(formData, "subject").trim();
  const body = readText(formData, "body").trim();
  if (subject.length < 3 || body.length < 3) {
    return fail("Add a subject and a message.");
  }

  const { data, error } = await session.supabase.rpc("create_support_request", {
    p_subject: subject,
    p_body: body,
  });
  if (error) {
    console.error("create_support_request failed:", error.message);
    return fail("We couldn't record that request. Try again.");
  }

  const payload = (data ?? {}) as { ok?: boolean; code?: string };
  if (payload.ok !== true) {
    return fail(
      payload.code === "priority-required"
        ? "Priority support is not active on this account. Buy the pass first."
        : "We couldn't record that request. Try again.",
    );
  }

  revalidatePath("/billing");
  return {
    status: "success",
    message: "Request recorded in the priority queue. It is not a promise of a human response time.",
    nonce: Date.now(),
  };
}

export async function attachCustomDomainAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  if (!vaultConfigured()) return fail(VAULT_MISSING);
  if (!(await hasBillingGrant(session, "white_label"))) {
    return fail("Custom domains are part of the white-label offer. Buy it first.");
  }

  const projectId = readText(formData, "project_id");
  const domain = readText(formData, "domain").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9.-]{2,251}\.[a-z]{2,}$/.test(domain) || domain.includes("..")) {
    return fail("Enter a domain like app.example.com.");
  }

  const { data: project } = await session.supabase
    .from("app_projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (!project) return fail(NOT_AVAILABLE);

  const { data: connection } = await session.supabase
    .from("app_provider_connections_safe")
    .select("external_ref, metadata")
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .eq("provider", "vercel")
    .eq("status", "connected")
    .maybeSingle();
  if (!connection) return fail("Connect Vercel for this app before attaching a domain.");

  const { data: sealed, error: secretError } = await session.supabase.rpc("get_provider_secret", {
    p_project_id: projectId,
    p_provider: "vercel",
  });
  if (secretError || typeof sealed !== "string" || sealed === "") {
    return fail("The Vercel connection isn't available. Reconnect it and try again.");
  }

  const metadata = (connection.metadata ?? {}) as Record<string, unknown>;
  const teamId = typeof metadata.team_id === "string" ? metadata.team_id : null;

  try {
    const token = decryptSecret(sealed, connectionAad(projectId, "vercel"));
    const attached = await addVercelDomain({
      token,
      projectId: connection.external_ref as string,
      teamId,
      domain,
    });

    const { error } = await session.supabase.from("app_custom_domains").insert({
      project_id: projectId,
      user_id: session.user.id,
      domain,
      status: attached.verified ? "active" : "pending",
      detail: attached.detail,
    });
    if (error) {
      console.error("app_custom_domains insert failed:", error.message);
      return fail("Vercel attached the domain, but we couldn't record it. Check Vercel before trying again.");
    }

    revalidatePath("/billing");
    return {
      status: "success",
      message: attached.verified
        ? `${domain} is attached and verified by Vercel.`
        : `${domain} is attached. Add the DNS records Vercel shows for this project; verification is automatic after DNS propagates.`,
      nonce: Date.now(),
    };
  } catch (error) {
    console.error(
      "attachCustomDomainAction failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return fail("Vercel did not attach that domain. Nothing was changed here.");
  }
}

async function requestOrigin(): Promise<string> {
  const headerList = await headers();
  const host =
    headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const proto =
    headerList.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}
