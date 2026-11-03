"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/lib/action-state";
import { getSession } from "@/lib/auth";
import { feedbackSchema, firstErrorMessage, readText } from "@/lib/validation";

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";

/**
 * Stores one piece of feedback.
 *
 * It is written to `public.feedback` and nowhere else: no task, goal, plan or
 * AI request is touched, and nothing is sent to a third party.
 */
export async function submitFeedbackAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const parsed = feedbackSchema.safeParse({
    area: readText(formData, "area") || "other",
    message: readText(formData, "message"),
    contact_ok: readText(formData, "contact_ok") === "true",
  });

  if (!parsed.success) {
    return { status: "error", message: firstErrorMessage(parsed.error) };
  }

  const { error } = await session.supabase.from("feedback").insert({
    user_id: session.user.id,
    area: parsed.data.area,
    message: parsed.data.message,
    contact_ok: parsed.data.contact_ok,
  });

  if (error) {
    console.error("submitFeedbackAction failed:", error.message);
    return {
      status: "error",
      message:
        "We couldn't save that. Your words are still in the box — try again.",
    };
  }

  revalidatePath("/dashboard");

  return {
    status: "success",
    message: "Thank you — that's saved for the person building GET TO IT.",
    nonce: Date.now(),
  };
}
