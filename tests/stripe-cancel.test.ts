import { afterEach, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { cancelSubscriptionNow } from "@/lib/billing/stripe";

/**
 * A refund revokes access, but the Stripe subscription must be ended too or the
 * customer keeps being charged. These tests stub the Stripe API through
 * `STRIPE_API_BASE` and check the request and every reply the helper must treat
 * as "already stopped".
 */

type Stub = {
  base: string;
  requests: Array<{ method: string; url: string }>;
  close: () => Promise<void>;
};

async function startStripeStub(
  status: number,
  body: string,
): Promise<Stub> {
  const requests: Stub["requests"] = [];
  const server = createServer(
    (request: IncomingMessage, response: ServerResponse) => {
      requests.push({ method: request.method ?? "", url: request.url ?? "" });
      response.writeHead(status, { "content-type": "application/json" });
      response.end(body);
    },
  );

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    base: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

const original = {
  base: process.env.STRIPE_API_BASE,
  key: process.env.STRIPE_SECRET_KEY,
  allowLive: process.env.STRIPE_ALLOW_LIVE,
};

afterEach(() => {
  for (const [name, value] of [
    ["STRIPE_API_BASE", original.base],
    ["STRIPE_SECRET_KEY", original.key],
    ["STRIPE_ALLOW_LIVE", original.allowLive],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("canceling a refunded subscription", () => {
  it("deletes the subscription and reports success", async () => {
    const stub = await startStripeStub(200, '{"id":"sub_refunded","status":"canceled"}');
    process.env.STRIPE_API_BASE = stub.base;
    process.env.STRIPE_SECRET_KEY = "sk_test_stub";

    try {
      const result = await cancelSubscriptionNow("sub_refunded");
      expect(result.ok).toBe(true);
      expect(stub.requests).toEqual([
        { method: "DELETE", url: "/v1/subscriptions/sub_refunded" },
      ]);
    } finally {
      await stub.close();
    }
  });

  it("treats an unknown subscription as already stopped", async () => {
    const stub = await startStripeStub(
      404,
      '{"error":{"code":"resource_missing","message":"No such subscription"}}',
    );
    process.env.STRIPE_API_BASE = stub.base;
    process.env.STRIPE_SECRET_KEY = "sk_test_stub";

    try {
      const result = await cancelSubscriptionNow("sub_gone");
      expect(result.ok).toBe(true);
    } finally {
      await stub.close();
    }
  });

  it("treats a second cancellation as already stopped", async () => {
    const stub = await startStripeStub(
      400,
      '{"error":{"code":"subscription_already_canceled","message":"This subscription has already been canceled."}}',
    );
    process.env.STRIPE_API_BASE = stub.base;
    process.env.STRIPE_SECRET_KEY = "sk_test_stub";

    try {
      const result = await cancelSubscriptionNow("sub_done");
      expect(result.ok).toBe(true);
    } finally {
      await stub.close();
    }
  });

  it("reports a real failure so the webhook can ask Stripe to retry", async () => {
    const stub = await startStripeStub(
      500,
      '{"error":{"code":"api_error","message":"Try again later"}}',
    );
    process.env.STRIPE_API_BASE = stub.base;
    process.env.STRIPE_SECRET_KEY = "sk_test_stub";

    try {
      const result = await cancelSubscriptionNow("sub_busy");
      expect(result.ok).toBe(false);
    } finally {
      await stub.close();
    }
  });

  it("does not call Stripe when live payments are blocked", async () => {
    const stub = await startStripeStub(200, "{}");
    process.env.STRIPE_API_BASE = stub.base;
    process.env.STRIPE_SECRET_KEY = "sk_live_stub";
    delete process.env.STRIPE_ALLOW_LIVE;

    try {
      const result = await cancelSubscriptionNow("sub_live");
      expect(result.ok).toBe(false);
      expect(stub.requests).toHaveLength(0);
    } finally {
      await stub.close();
    }
  });
});
