"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/lib/action-state";
import { getSession } from "@/lib/auth";
import { readText } from "@/lib/validation";

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";

/**
 * Owner-only manual credit adjustment.
 *
 * Ownership is checked inside the database function, so a forged request from
 * a normal account changes nothing. Every adjustment carries a note, and lands
 * in the same append-only ledger as purchases and AI charges.
 */
export async function adjustCreditsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED, nonce: Date.now() };

  const email = readText(formData, "email");
  const note = readText(formData, "note");
  const rawDelta = readText(formData, "delta");

  const delta = Number.parseInt(rawDelta, 10);
  if (!email || !Number.isInteger(delta) || delta === 0) {
    return {
      status: "error",
      message: "Enter the person's email and a non-zero whole number of credits.",
      nonce: Date.now(),
    };
  }

  const { data, error } = await session.supabase.rpc("owner_adjust_credits", {
    p_email: email,
    p_delta: delta,
    p_note: note,
  });

  if (error) {
    console.error("owner_adjust_credits failed:", error.message);
    return {
      status: "error",
      message: "The adjustment failed. Nothing was changed.",
      nonce: Date.now(),
    };
  }

  const payload = (data ?? {}) as { ok?: boolean; code?: string; balance?: number };

  if (payload.ok !== true) {
    const messages: Record<string, string> = {
      "not-owner": "That action isn't available on this account.",
      "bad-delta": "Use a non-zero whole number between -10,000 and 10,000.",
      "note-required": "Write a short note explaining the adjustment.",
      "unknown-account": "No account uses that email.",
      "would-go-negative": "That would take the balance below zero. Nothing was changed.",
    };
    return {
      status: "error",
      message:
        messages[payload.code ?? ""] ?? "The adjustment failed. Nothing was changed.",
      nonce: Date.now(),
    };
  }

  revalidatePath("/owner");

  return {
    status: "success",
    message: `Adjusted. The new balance is ${payload.balance ?? 0} credits.`,
    nonce: Date.now(),
  };
}
