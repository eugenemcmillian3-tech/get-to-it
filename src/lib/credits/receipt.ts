/**
 * Purchase receipts.
 *
 * Resend over one HTTP POST, no dependency. A missing key or a missing address is
 * a skip, never an error: a receipt is a courtesy, and a mail failure must not
 * turn a successful payment into a webhook retry.
 *
 * The webhook only calls this after the database has granted credits, and the
 * caller passes a stable payment id so Resend can drop a duplicate send.
 */

export const DEFAULT_RECEIPT_SENDER = "no-reply@mail.network-x-ai.win";

export type ReceiptInput = {
  email: string | null;
  paymentId: string;
  credits: number;
  amountCents: number | null;
  currency: string | null;
  receiptUrl: string | null;
};

export type ReceiptResult =
  | { sent: true; id: string | null }
  | { sent: false; reason: string };

export function receiptSender(): string {
  return process.env.RESEND_FROM?.trim() || DEFAULT_RECEIPT_SENDER;
}

export function hasResendKey(): boolean {
  return (process.env.RESEND_API_KEY ?? "").trim().length > 0;
}

/** Public site origin for policy links, or null when it is not configured. */
function siteOrigin(): string | null {
  const value = process.env.APP_ORIGIN?.trim().replace(/\/+$/, "");
  return value ? value : null;
}

/** Money for display only; the authoritative amounts stay in the database. */
export function formatReceiptAmount(
  amountCents: number | null,
  currency: string | null,
): string | null {
  if (amountCents === null || !Number.isFinite(amountCents)) return null;
  const code = (currency ?? "usd").toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
    }).format(amountCents / 100);
  } catch {
    return `${(amountCents / 100).toFixed(2)} ${code}`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildPurchaseReceipt(input: ReceiptInput): {
  subject: string;
  text: string;
  html: string;
} {
  const amount = formatReceiptAmount(input.amountCents, input.currency);
  const base = siteOrigin();
  const refundsUrl = base ? `${base}/refunds` : null;
  const termsUrl = base ? `${base}/terms` : null;

  const lines = [
    `Thanks for buying ${input.credits} credits.`,
    "",
    amount ? `Paid: ${amount}` : null,
    `Order: ${input.paymentId}`,
    input.receiptUrl ? `Card receipt: ${input.receiptUrl}` : null,
    "",
    `The ${input.credits} credits are on your account now.`,
    "",
    "Unused credits are refundable within 30 days; spent credits are not." +
      (refundsUrl ? ` The full policy is at ${refundsUrl}.` : ""),
    termsUrl ? `Terms: ${termsUrl}` : null,
    "",
    "Questions: reply to this email, or use the support form on the Plans page.",
  ].filter((line): line is string => line !== null);

  const rows: Array<[string, string]> = [
    ["Credits", String(input.credits)],
    ["Paid", amount ?? "—"],
    ["Order", input.paymentId],
  ];
  if (input.receiptUrl) rows.push(["Card receipt", input.receiptUrl]);

  const html = [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.5;color:#111">',
    `<h1 style="font-size:20px;margin:0 0 12px">Your ${input.credits} credits</h1>`,
    `<p style="margin:0 0 16px">Payment received. The credits are on your account now.</p>`,
    '<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:14px">',
    ...rows.map(
      ([label, value]) =>
        `<tr><td style="color:#555">${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`,
    ),
    "</table>",
    '<p style="margin:16px 0 0;font-size:13px;color:#555">Unused credits are refundable within 30 days; spent credits are not.' +
      (refundsUrl
        ? ` <a href="${escapeHtml(refundsUrl)}">Refund policy</a>.`
        : "") +
      "</p>",
    '<p style="margin:8px 0 0;font-size:13px;color:#555">Questions? Reply to this email, or use the support form on the Plans page.</p>',
    "</div>",
  ].join("");

  return {
    subject: `Your GET TO IT receipt — ${input.credits} credits`,
    text: `${lines.join("\n")}\n`,
    html,
  };
}

export async function sendPurchaseReceipt(
  input: ReceiptInput,
): Promise<ReceiptResult> {
  const email = input.email?.trim();
  if (!email) return { sent: false, reason: "no-address" };
  if (!hasResendKey()) return { sent: false, reason: "no-key" };

  const { subject, text, html } = buildPurchaseReceipt(input);
  const base = (process.env.RESEND_API_BASE ?? "https://api.resend.com").replace(
    /\/+$/,
    "",
  );

  try {
    const response = await fetch(`${base}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${(process.env.RESEND_API_KEY ?? "").trim()}`,
        "Content-Type": "application/json",
        // One receipt per payment, even if the webhook is retried.
        "Idempotency-Key": `receipt-${input.paymentId}`,
      },
      body: JSON.stringify({
        from: receiptSender(),
        to: [email],
        subject,
        text,
        html,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) return { sent: false, reason: `status-${response.status}` };

    const payload = (await response.json().catch(() => null)) as {
      id?: unknown;
    } | null;

    return {
      sent: true,
      id: typeof payload?.id === "string" ? payload.id : null,
    };
  } catch {
    return { sent: false, reason: "network" };
  }
}
