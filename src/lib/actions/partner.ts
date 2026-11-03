"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { FormState } from "@/lib/action-state";
import { getSession } from "@/lib/auth";
import { getPartnershipState } from "@/lib/data/partnership";
import {
  cleanShare,
  inviteEmailSchema,
  invitePath,
  messageSchema,
  partnerErrorMessage,
  shareSchema,
  tokenLooksValid,
} from "@/lib/partner";
import { firstErrorMessage, isUuid, readText } from "@/lib/validation";

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";

type RpcPayload = { ok?: boolean; code?: string; token?: string; expires_at?: string };

/**
 * Invite one person.
 *
 * The address is stored on the invitation but never looked up, so this response
 * cannot be used to discover whether an account exists. The token is the only
 * way in, it is single use, and it expires after seven days.
 */
export async function createInvitationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const parsed = inviteEmailSchema.safeParse(readText(formData, "invitee_email"));
  if (!parsed.success) {
    return { status: "error", message: firstErrorMessage(parsed.error) };
  }

  const { data, error } = await session.supabase.rpc(
    "create_partnership_invitation",
    { p_email: parsed.data },
  );

  if (error) {
    console.error("create_partnership_invitation failed:", error.message);
    return { status: "error", message: partnerErrorMessage(undefined) };
  }

  const payload = (data ?? {}) as RpcPayload;
  if (payload.ok !== true || !payload.token) {
    return { status: "error", message: partnerErrorMessage(payload.code) };
  }

  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const link = host
    ? `${protocol}://${host}${invitePath(payload.token)}`
    : invitePath(payload.token);

  revalidatePath("/partner");
  return {
    status: "success",
    message:
      "Invitation ready. Send this link to them yourself — GET TO IT does not send email.",
    link,
    nonce: Date.now(),
  };
}

export async function cancelInvitationAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const invitationId = readText(formData, "invitation_id");
  if (!isUuid(invitationId)) return;

  const { error } = await session.supabase.rpc(
    "cancel_partnership_invitation",
    { p_invitation_id: invitationId },
  );

  if (error) {
    console.error("cancel_partnership_invitation failed:", error.message);
    return;
  }

  revalidatePath("/partner");
}

/**
 * Accept or decline in one submit, because both act on the same token field.
 *
 * The database decides whether the token is usable: unknown, used, expired,
 * declined, or addressed to a different account all return the same answer.
 */
export async function respondToInvitationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const token = readText(formData, "token");
  if (!tokenLooksValid(token)) {
    return { status: "error", message: partnerErrorMessage("invalid-invitation") };
  }

  const declining = readText(formData, "intent") === "decline";

  const { data, error } = await session.supabase.rpc(
    declining ? "decline_partnership_invitation" : "accept_partnership_invitation",
    { p_token: token },
  );

  if (error) {
    console.error("partnership invitation response failed:", error.message);
    return { status: "error", message: partnerErrorMessage(undefined) };
  }

  const payload = (data ?? {}) as RpcPayload;
  if (payload.ok !== true) {
    return { status: "error", message: partnerErrorMessage(payload.code) };
  }

  revalidatePath("/partner");
  redirect("/partner");
}

export async function updateShareAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const state = await getPartnershipState(session);
  if (!state.partnership) {
    return { status: "error", message: partnerErrorMessage("no-partnership") };
  }

  const parsed = shareSchema.safeParse({
    goalTitle: readText(formData, "share_goal_title") === "on",
    completion: readText(formData, "share_completion") === "on",
    milestone: readText(formData, "share_milestone") === "on",
    checkin: readText(formData, "share_checkin") === "on",
    milestoneText: readText(formData, "milestone_text"),
    checkinText: readText(formData, "checkin_text"),
  });

  if (!parsed.success) {
    return { status: "error", message: firstErrorMessage(parsed.error) };
  }

  const cleaned = cleanShare(parsed.data);

  const { data, error } = await session.supabase.rpc("set_partnership_share", {
    p_partnership_id: state.partnership.id,
    p_goal_title: cleaned.goalTitle,
    p_completion: cleaned.completion,
    p_milestone: cleaned.milestone,
    p_checkin: cleaned.checkin,
    p_milestone_text: cleaned.milestoneText ?? "",
    p_checkin_text: cleaned.checkinText ?? "",
  });

  if (error) {
    console.error("set_partnership_share failed:", error.message);
    return { status: "error", message: partnerErrorMessage(undefined) };
  }

  const payload = (data ?? {}) as RpcPayload;
  if (payload.ok !== true) {
    return { status: "error", message: partnerErrorMessage(payload.code) };
  }

  revalidatePath("/partner");
  return {
    status: "success",
    message: "Saved. Everything you left unticked stays private.",
    nonce: Date.now(),
  };
}

export async function sendEncouragementAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const parsed = messageSchema.safeParse({ body: readText(formData, "body") });
  if (!parsed.success) {
    return { status: "error", message: firstErrorMessage(parsed.error) };
  }

  const state = await getPartnershipState(session);
  if (!state.partnership) {
    return { status: "error", message: partnerErrorMessage("no-partnership") };
  }

  const { data, error } = await session.supabase.rpc("send_encouragement", {
    p_partnership_id: state.partnership.id,
    p_body: parsed.data.body,
  });

  if (error) {
    console.error("send_encouragement failed:", error.message);
    return { status: "error", message: partnerErrorMessage(undefined) };
  }

  const payload = (data ?? {}) as RpcPayload & { remaining?: number };
  if (payload.ok !== true) {
    return { status: "error", message: partnerErrorMessage(payload.code) };
  }

  revalidatePath("/partner");
  return {
    status: "success",
    message:
      typeof payload.remaining === "number"
        ? `Sent. ${payload.remaining} left today in this thread.`
        : "Sent.",
    nonce: Date.now(),
  };
}

export async function endPartnershipAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const partnershipId = readText(formData, "partnership_id");
  if (!isUuid(partnershipId)) {
    return { status: "error", message: partnerErrorMessage("no-partnership") };
  }

  const { data, error } = await session.supabase.rpc("end_partnership", {
    p_partnership_id: partnershipId,
  });

  if (error) {
    console.error("end_partnership failed:", error.message);
    return { status: "error", message: partnerErrorMessage(undefined) };
  }

  const payload = (data ?? {}) as RpcPayload;
  if (payload.ok !== true) {
    return { status: "error", message: partnerErrorMessage(payload.code) };
  }

  revalidatePath("/partner");
  redirect("/partner");
}

export async function blockPartnerAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const partnershipId = readText(formData, "partnership_id");
  if (!isUuid(partnershipId)) {
    return { status: "error", message: partnerErrorMessage("no-partnership") };
  }

  const { data, error } = await session.supabase.rpc("block_partner", {
    p_partnership_id: partnershipId,
  });

  if (error) {
    console.error("block_partner failed:", error.message);
    return { status: "error", message: partnerErrorMessage(undefined) };
  }

  const payload = (data ?? {}) as RpcPayload;
  if (payload.ok !== true) {
    return { status: "error", message: partnerErrorMessage(payload.code) };
  }

  revalidatePath("/partner");
  redirect("/partner");
}

export async function reportPartnerAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const partnershipId = readText(formData, "partnership_id");
  if (!isUuid(partnershipId)) {
    return { status: "error", message: partnerErrorMessage("no-partnership") };
  }

  const { data, error } = await session.supabase.rpc("report_partner", {
    p_partnership_id: partnershipId,
    p_reason: readText(formData, "reason"),
    p_note: readText(formData, "note"),
  });

  if (error) {
    console.error("report_partner failed:", error.message);
    return { status: "error", message: partnerErrorMessage(undefined) };
  }

  const payload = (data ?? {}) as RpcPayload;
  if (payload.ok !== true) {
    return { status: "error", message: partnerErrorMessage(payload.code) };
  }

  revalidatePath("/partner");
  return {
    status: "success",
    message:
      "Report saved. It is stored for a person to read — GET TO IT does not run an automated moderation service, so nothing was removed automatically. You can end or block the partnership now.",
    nonce: Date.now(),
  };
}
