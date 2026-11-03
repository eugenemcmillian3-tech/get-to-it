/**
 * Server-side wrapper around the database-enforced AI request limits.
 *
 * The counting, the daily allowances and the one-at-a-time rule all live in
 * Postgres (see 0002_phase2_planning.sql). This module only turns the result
 * into something a person can read. It is imported by server actions only.
 */

import type { Session } from "@/lib/auth";
import { creditLimitMessage } from "@/lib/credits/format";

/**
 * Every AI entry point: goal help, goal planning, task-workspace help, learning
 * path generation and step-level learning help.
 */
export type AiRequestKind =
  | "unstuck"
  | "plan"
  | "task_help"
  | "learning"
  | "learning_help"
  | "workflow_draft"
  | "future_paths"
  | "review"
  | "mission_assist"
  | "app_repair";

export type AiReservation = {
  /** Row in public.ai_requests, used to close the request out. */
  id: string;
  /** Requests left today for this person, after this one. */
  remaining: number;
  /** Today's allowance for this person. */
  limit: number;
  /** Credits left after this request was accounted for. */
  balance: number;
  /** True when this request came out of the free daily allowance. */
  free: boolean;
};

export type ReserveOutcome =
  | { ok: true; reservation: AiReservation }
  | { ok: false; message: string };

type ReservePayload = {
  ok?: boolean;
  code?: string;
  request_id?: string;
  remaining?: number;
  limit?: number;
  balance?: number;
  free?: boolean;
};

const UNAVAILABLE =
  "We couldn't start that AI request. Try again in a moment.";

/**
 * Reserves one AI request for this person.
 *
 * A double click loses the race in the database (one in-flight request per
 * user), so the second call comes back with a clear message instead of a
 * second paid request.
 */
export async function reserveAiRequest(
  session: Session,
  kind: AiRequestKind,
  model: string,
): Promise<ReserveOutcome> {
  const { data, error } = await session.supabase.rpc("reserve_ai_request", {
    p_kind: kind,
    p_model: model,
  });

  if (error) {
    console.error("reserveAiRequest failed:", error.message);
    return { ok: false, message: UNAVAILABLE };
  }

  const payload = (data ?? {}) as ReservePayload;

  if (payload.ok === true && typeof payload.request_id === "string") {
    return {
      ok: true,
      reservation: {
        id: payload.request_id,
        remaining: Number(payload.remaining ?? 0),
        limit: Number(payload.limit ?? 0),
        balance: Number(payload.balance ?? 0),
        free: payload.free !== false,
      },
    };
  }

  return { ok: false, message: limitMessage(payload.code, payload.limit) };
}

/**
 * Closes out a reservation. Never throws: the answer matters more.
 *
 * Token counts are whatever the provider reported, or null. They are recorded
 * for accounting; they are never turned into a cost without an owner-entered
 * price. A failed call has its reserved credit released by the database.
 */
export async function finishAiRequest(
  session: Session,
  requestId: string,
  status: "succeeded" | "failed",
  errorCode?: string,
  usage?: { input: number | null; output: number | null },
): Promise<void> {
  const { error } = await session.supabase.rpc("finish_ai_request", {
    p_request_id: requestId,
    p_status: status,
    p_error: errorCode ?? null,
    p_tokens_in: usage?.input ?? null,
    p_tokens_out: usage?.output ?? null,
  });

  if (error) {
    // The reservation expires on its own after a couple of minutes.
    console.error("finishAiRequest failed:", error.message);
  }
}

/**
 * These are request counts. They are not a dollar budget and GET TO IT has no
 * billing: the wording deliberately says requests, not money.
 */
export function limitMessage(code?: string, limit?: number): string {
  const allowance = typeof limit === "number" && limit > 0 ? limit : null;

  switch (code) {
    case "in-flight":
      return "One AI request is already running. Wait for it to finish, then try again.";
    case "user-daily":
      return allowance
        ? `You've used all ${allowance} AI requests for today. Everything else still works — you can write tasks and save work by hand.`
        : "You've used all your AI requests for today. Everything else still works — you can write tasks and save work by hand.";
    case "global-daily":
      return "AI requests are paused for everyone for the rest of today. Your goals and tasks are unaffected.";
    case "needs-credits":
      return creditLimitMessage("needs-credits", limit) || UNAVAILABLE;
    case "unauthenticated":
      return "Your session expired. Sign in again to keep going.";
    default:
      return UNAVAILABLE;
  }
}

/** Small line under an AI control. Null when there is nothing useful to say. */
export function remainingNote(remaining?: number): string | null {
  if (typeof remaining !== "number" || remaining < 0) return null;
  if (remaining === 0) return "No AI requests left today.";
  const noun = remaining === 1 ? "request" : "requests";
  return `${remaining} AI ${noun} left today.`;
}
