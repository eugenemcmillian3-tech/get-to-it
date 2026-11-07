import { NextResponse } from "next/server";
import { logOperational, logOperationalError } from "@/lib/log";
import {
  GithubAlertError,
  RESEND_WEBHOOK_MAX_BODY_BYTES,
  alertForResendEvent,
  getGithubAlertConfig,
  getResendWebhookSecret,
  parseResendEvent,
  publishResendAlert,
  verifyResendWebhook,
} from "@/lib/resend/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/**
 * Resend delivery webhook.
 *
 * The signature is verified against the raw body before parsing. Only delivery
 * events that need attention create a GitHub issue; the issue contains an email
 * id, event type and timestamp, never the recipient address or message body.
 *
 * A 2xx response acknowledges the delivery. A missing configuration, invalid
 * signature or GitHub failure is not acknowledged, so Resend can retry.
 */
export async function POST(request: Request) {
  const secret = getResendWebhookSecret();
  const github = getGithubAlertConfig();

  if (!secret || !github) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Resend webhook alerts are not configured. Add RESEND_WEBHOOK_SECRET, GITHUB_ALERT_TOKEN and GITHUB_ALERT_REPO.",
      },
      { status: 503, headers: NO_STORE },
    );
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > RESEND_WEBHOOK_MAX_BODY_BYTES) {
    return NextResponse.json(
      { ok: false, error: "That webhook body is too large." },
      { status: 413, headers: NO_STORE },
    );
  }

  let payload: string;
  try {
    payload = await request.text();
  } catch {
    return NextResponse.json(
      { ok: false, error: "That webhook body could not be read." },
      { status: 400, headers: NO_STORE },
    );
  }

  if (Buffer.byteLength(payload, "utf8") > RESEND_WEBHOOK_MAX_BODY_BYTES) {
    return NextResponse.json(
      { ok: false, error: "That webhook body is too large." },
      { status: 413, headers: NO_STORE },
    );
  }

  const valid = verifyResendWebhook({
    secret,
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
    rawBody: payload,
  });

  if (!valid) {
    logOperationalError("resend_webhook", "bad_signature");
    return NextResponse.json(
      { ok: false, error: "Webhook signature verification failed." },
      { status: 400, headers: NO_STORE },
    );
  }

  const event = parseResendEvent(payload);
  if (!event) {
    logOperationalError("resend_webhook", "invalid_payload");
    return NextResponse.json(
      { ok: false, error: "That webhook event is not readable." },
      { status: 400, headers: NO_STORE },
    );
  }

  const alert = alertForResendEvent(event);
  if (!alert) {
    logOperational("resend_webhook", { outcome: "ignored", event: event.type });
    return NextResponse.json({ ok: true, ignored: true }, { status: 202, headers: NO_STORE });
  }

  try {
    const result = await publishResendAlert(alert, github);
    logOperational("resend_webhook", {
      outcome: result,
      event: event.type,
      email_id: alert.id,
    });
    return NextResponse.json({ ok: true, result }, { status: 202, headers: NO_STORE });
  } catch (error) {
    const reason =
      error instanceof GithubAlertError
        ? `github_${error.status}`
        : error instanceof Error && error.name === "TimeoutError"
          ? "github_timeout"
          : "github_failed";
    logOperationalError("resend_webhook", reason);
    return NextResponse.json(
      { ok: false, error: "The alert could not be published yet.", reason },
      { status: 502, headers: NO_STORE },
    );
  }
}
