import crypto from "node:crypto";

/**
 * Webhook signing and verification.
 *
 * The signature covers the exact bytes sent, prefixed with the timestamp, so a
 * receiver can reject stale requests. Delivery ids are stable, which lets a
 * receiver discard a duplicate at-least-once delivery.
 */

export const WEBHOOK_TOLERANCE_SECONDS = 300;

export type WebhookEnvelope = {
  id: string;
  type: "build.completed" | "build.failed";
  created_at: string;
  data: Record<string, unknown>;
};

export function signWebhook(
  secret: string,
  timestamp: number,
  rawBody: string,
): string {
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

export function webhookHeaders(input: {
  secret: string;
  deliveryId: string;
  event: string;
  rawBody: string;
  timestamp?: number;
}): Record<string, string> {
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);
  return {
    "content-type": "application/json",
    "user-agent": "gettoit-webhooks/1",
    "x-gettoit-event": input.event,
    "x-gettoit-delivery": input.deliveryId,
    "x-gettoit-signature": signWebhook(input.secret, timestamp, input.rawBody),
  };
}

/**
 * Verifies `t=<unix>,v1=<hex>`. Rejects a missing header, a stale timestamp and
 * a wrong signature. Accepts more than one v1 value so a rotation can overlap.
 */
export function verifyWebhookSignature(input: {
  secret: string;
  header: string | null;
  rawBody: string;
  toleranceSeconds?: number;
  nowMs?: number;
}): boolean {
  if (!input.header) return false;
  const parts = input.header.split(",").map((part) => part.trim());
  const timestampPart = parts.find((part) => part.startsWith("t="));
  const signatures = parts
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3));
  if (!timestampPart || signatures.length === 0) return false;

  const timestamp = Number(timestampPart.slice(2));
  if (!Number.isInteger(timestamp) || timestamp <= 0) return false;

  const tolerance = input.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS;
  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - timestamp) > tolerance) return false;

  const expected = crypto
    .createHmac("sha256", input.secret)
    .update(`${timestamp}.${input.rawBody}`)
    .digest();

  return signatures.some((signature) => {
    if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
    const provided = Buffer.from(signature, "hex");
    return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
  });
}

export function webhookEnvelope(input: {
  deliveryId: string;
  event: "build.completed" | "build.failed";
  payload: Record<string, unknown>;
  createdAt?: string;
}): WebhookEnvelope {
  return {
    id: input.deliveryId,
    type: input.event,
    created_at: input.createdAt ?? new Date().toISOString(),
    data: input.payload,
  };
}
