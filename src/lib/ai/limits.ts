/**
 * Server-side wrapper around the database-enforced AI request limits.
 *
 * The counting, the daily allowances and the one-at-a-time rule all live in
 * Postgres (see 0002_phase2_planning.sql). This module only turns the result
 * into something a person can read. It is imported by server actions only.
 */

import type { Session } from "@/lib/auth";
import { creditLimitMessage } from "@/lib/credits/format";
import {
  AI_OPERATION_CREDIT_COSTS,
  operationChargeLabel,
  type AiOperation,
} from "@/lib/credits/pricing";

/**
 * Every AI entry point: goal help, goal planning, task-workspace help, learning
 * path generation and step-level learning help.
 */
export type AiRequestKind = AiOperation;

export type AiReservation = {
  /** Row in public.ai_requests, used to close the request out. */
  id: string;
  /** Requests left today for this person, after this one. */
  remaining: number;
  /** Today's allowance for this person. */
  limit: number;
  /** Credits left after this request was accounted for. */
  balance: number;
  /** Credits reserved for this operation. */
  credits: number;
  /** Kept for older responses; the free allowance is disabled. */
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
  credits?: number;
  budget_remaining?: number | null;
  budget?: number;
  spent?: number;
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
  budget?: { kind: "workflow" | "build" | "swarm"; id: string },
): Promise<ReserveOutcome> {
  const { data, error } = await session.supabase.rpc("reserve_ai_request", {
    p_kind: kind,
    p_model: model,
    p_budget_kind: budget?.kind ?? null,
    p_budget_id: budget?.id ?? null,
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
        credits: Number(payload.credits ?? AI_OPERATION_CREDIT_COSTS[kind]),
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
 * There is no free allowance. Each operation has a fixed credit price, shown
 * in both credits and dollars before the request starts.
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
      return creditLimitMessage("needs-credits") || UNAVAILABLE;
    case "budget-exhausted":
      return "This run has reached its approved credit budget. No further AI work was started.";
    case "invalid-budget":
      return "That AI budget isn't available. Refresh and try again.";
    case "unauthenticated":
      return "Your session expired. Sign in again to keep going.";
    default:
      return UNAVAILABLE;
  }
}

/** Small line under an AI control: the exact operation estimate in credits and dollars. */
export function remainingNote(kind: AiRequestKind = "unstuck"): string | null {
  return `This request: ${operationChargeLabel(kind)}. A failed request releases it.`;
}
