"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/lib/action-state";
import { getSession } from "@/lib/auth";
import { readText } from "@/lib/validation";

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";

/**
 * Deletes the signed-in person's account, and only their own.
 *
 * The database function drops the `auth.users` row, which cascades through
 * goals, tasks, saved work, focus sessions, weekly reflections, plan records
 * and AI request history. Two things deliberately survive: the daily usage
 * ledger (so deleting an account cannot hand the shared allowance back) and any
 * feedback already sent, which is kept without the account attached.
 */
export async function deleteAccountAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const confirmation = readText(formData, "confirm");
  if (confirmation !== "DELETE") {
    return {
      status: "error",
      message: "Type DELETE in the box to confirm. Nothing has been deleted.",
    };
  }

  const { data, error } = await session.supabase.rpc("delete_my_account", {
    p_confirm: confirmation,
  });

  if (error) {
    console.error("deleteAccountAction failed:", error.message);
    return {
      status: "error",
      message:
        "We couldn't delete that account. Nothing has changed — try again, or get in touch.",
    };
  }

  const payload = (data ?? {}) as { ok?: boolean; code?: string };

  if (payload.ok !== true) {
    return {
      status: "error",
      message:
        payload.code === "not-confirmed"
          ? "Type DELETE in the box to confirm. Nothing has been deleted."
          : "We couldn't delete that account. Nothing has changed — try again.",
    };
  }

  // The account is gone; clear the now-useless session cookies.
  try {
    await session.supabase.auth.signOut();
  } catch {
    // A deleted user cannot sign out cleanly; the cookies are cleared below by
    // the redirect to a public page.
  }

  revalidatePath("/", "layout");
  redirect("/?account=deleted");
}
