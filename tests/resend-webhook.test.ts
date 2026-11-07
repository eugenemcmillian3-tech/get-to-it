import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GithubAlertError,
  alertForResendEvent,
  parseResendEvent,
  publishResendAlert,
  resendAlertBody,
  verifyResendWebhook,
  type GithubAlertConfig,
} from "@/lib/resend/webhook";

const SECRET = `whsec_${Buffer.from("resend-webhook-test-secret").toString("base64")}`;
const ID = "msg_1";
const NOW = 1_762_300_000;
const BODY = JSON.stringify({
  type: "email.bounced",
  created_at: "2026-11-07T00:00:00.000Z",
  data: {
    email_id: "email_123",
    to: ["private@example.test"],
    subject: "Private subject",
    text: "Private message body",
  },
});

function sign(body = BODY, id = ID, timestamp = NOW, secret = SECRET): string {
  const digest = createHmac("sha256", Buffer.from(secret.slice("whsec_".length), "base64"))
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return `v1,${digest}`;
}

describe("Resend webhook signatures", () => {
  it("accepts a correctly signed, recent delivery", () => {
    expect(
      verifyResendWebhook({
        secret: SECRET,
        id: ID,
        timestamp: String(NOW),
        signature: sign(),
        rawBody: BODY,
        nowMs: NOW * 1000,
      }),
    ).toBe(true);
  });

  it("accepts an overlapping signature during rotation", () => {
    expect(
      verifyResendWebhook({
        secret: SECRET,
        id: ID,
        timestamp: String(NOW),
        signature: `v1,${Buffer.from("bad").toString("base64")} ${sign()}`,
        rawBody: BODY,
        nowMs: NOW * 1000,
      }),
    ).toBe(true);
  });

  it("rejects tampering, stale timestamps, wrong secrets and malformed headers", () => {
    expect(
      verifyResendWebhook({
        secret: SECRET,
        id: ID,
        timestamp: String(NOW),
        signature: sign(),
        rawBody: `${BODY} `,
        nowMs: NOW * 1000,
      }),
    ).toBe(false);
    expect(
      verifyResendWebhook({
        secret: SECRET,
        id: ID,
        timestamp: String(NOW - 301),
        signature: sign(),
        rawBody: BODY,
        nowMs: NOW * 1000,
      }),
    ).toBe(false);
    expect(
      verifyResendWebhook({
        secret: `whsec_${Buffer.from("other-secret").toString("base64")}`,
        id: ID,
        timestamp: String(NOW),
        signature: sign(),
        rawBody: BODY,
        nowMs: NOW * 1000,
      }),
    ).toBe(false);
    expect(
      verifyResendWebhook({
        secret: SECRET,
        id: "",
        timestamp: String(NOW),
        signature: sign(),
        rawBody: BODY,
        nowMs: NOW * 1000,
      }),
    ).toBe(false);
    expect(
      verifyResendWebhook({
        secret: SECRET,
        id: ID,
        timestamp: "later",
        signature: sign(),
        rawBody: BODY,
        nowMs: NOW * 1000,
      }),
    ).toBe(false);
    expect(
      verifyResendWebhook({
        secret: SECRET,
        id: ID,
        timestamp: String(NOW),
        signature: "not-a-signature",
        rawBody: BODY,
        nowMs: NOW * 1000,
      }),
    ).toBe(false);
  });
});

describe("Resend event mapping", () => {
  it("keeps only the alert fields and drops recipient content", () => {
    const event = parseResendEvent(BODY);
    expect(event).toEqual({
      type: "email.bounced",
      createdAt: "2026-11-07T00:00:00.000Z",
      data: { emailId: "email_123" },
    });
    const alert = alertForResendEvent(event!);
    expect(alert).toEqual({
      id: "email_123",
      event: "email.bounced",
      label: "bounced",
      createdAt: "2026-11-07T00:00:00.000Z",
    });
    expect(resendAlertBody(alert!)).not.toContain("private@example.test");
    expect(resendAlertBody(alert!)).not.toContain("Private subject");
    expect(resendAlertBody(alert!)).not.toContain("Private message body");
  });

  it("maps every delivery failure and ignores non-alert events", () => {
    for (const [type, label] of [
      ["email.bounced", "bounced"],
      ["email.complained", "complained"],
      ["email.failed", "failed"],
      ["email.suppressed", "suppressed"],
      ["email.delivery_delayed", "delivery delayed"],
    ]) {
      expect(
        alertForResendEvent({
          type,
          createdAt: "2026-11-07T00:00:00.000Z",
          data: { emailId: "email_123" },
        })?.label,
      ).toBe(label);
    }
    expect(
      alertForResendEvent({
        type: "email.delivered",
        createdAt: "2026-11-07T00:00:00.000Z",
        data: { emailId: "email_123" },
      }),
    ).toBeNull();
  });

  it("rejects unreadable, unsafe and incomplete payloads", () => {
    expect(parseResendEvent("not json")).toBeNull();
    expect(parseResendEvent(JSON.stringify({ type: "email.bounced", data: {} }))).toBeNull();
    expect(
      parseResendEvent(
        JSON.stringify({ type: "email.bounced", data: { email_id: "bad id" } }),
      ),
    ).toBeNull();
    expect(
      parseResendEvent(
        JSON.stringify({ type: "email.bounced", data: { email_id: "email_123" } }),
      )?.createdAt,
    ).toBe("unknown");
  });
});

const CONFIG: GithubAlertConfig = {
  token: "test-token",
  repo: "owner/repo",
  apiBase: "https://github.test",
};

describe("Resend GitHub alert publishing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates one issue and keeps private fields out of it", async () => {
    const posted: { value: Record<string, unknown> | null } = { value: null };
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("/search/issues")) {
        return new Response(JSON.stringify({ total_count: 0 }), { status: 200 });
      }
      posted.value = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ number: 1 }), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await publishResendAlert(
      {
        id: "email_123",
        event: "email.bounced",
        label: "bounced",
        createdAt: "2026-11-07T00:00:00.000Z",
      },
      CONFIG,
    );

    expect(result).toBe("created");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://github.test/repos/owner/repo/issues",
    );
    expect(posted.value?.title).toBe("Resend delivery alert: email_123");
    expect(String(posted.value?.body)).not.toContain("private@example.test");
  });

  it("reports an upstream GitHub failure with only its status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ message: "Forbidden" }), { status: 403 })),
    );

    const failure = await publishResendAlert(
      {
        id: "email_123",
        event: "email.bounced",
        label: "bounced",
        createdAt: "2026-11-07T00:00:00.000Z",
      },
      CONFIG,
    ).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(GithubAlertError);
    expect((failure as GithubAlertError).status).toBe(403);
  });

  it("reuses an existing issue instead of opening another", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ total_count: 1 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await publishResendAlert(
      {
        id: "email_123",
        event: "email.complained",
        label: "complained",
        createdAt: "2026-11-07T00:00:00.000Z",
      },
      CONFIG,
    );

    expect(result).toBe("existing");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
