import { describe, expect, it } from "vitest";
import {
  API_SCOPES,
  API_VERSION,
  ApiError,
  MCP_TOOLS,
  MCP_UNTRUSTED_NOTICE,
  createProjectBodySchema,
  decodeCursor,
  encodeCursor,
  guardResultError,
  pageSize,
  parseIdempotencyKey,
  requestFingerprint,
  statusForCode,
} from "@/lib/api/contracts";
import { bearerToken, generateApiToken, hashApiToken } from "@/lib/api/server";
import {
  signWebhook,
  verifyWebhookSignature,
  webhookEnvelope,
  webhookHeaders,
} from "@/lib/api/webhooks";

const SECRET = "whsec_drill_secret_value_1234567890";

describe("developer API credentials", () => {
  it("generates a project token with a public prefix and stores only a hash", () => {
    const generated = generateApiToken();
    expect(generated.token).toMatch(/^gti_[a-f0-9]{8}_[A-Za-z0-9_-]{40,}$/);
    expect(generated.prefix).toHaveLength(12);
    expect(generated.token.startsWith(generated.prefix)).toBe(true);
    expect(generated.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(generated.token).not.toContain(generated.hash);
    expect(hashApiToken(generated.token)).toBe(generated.hash);
  });

  it("accepts only the supported contract version header", () => {
    const token = generateApiToken().token;
    const supported = bearerToken(
      new Request("http://localhost/api/v1", {
        headers: { authorization: `Bearer ${token}`, "x-gettoit-api-version": API_VERSION },
      }),
    );
    expect(supported).toBe(token);

    expect(() =>
      bearerToken(
        new Request("http://localhost/api/v1", {
          headers: { authorization: `Bearer ${token}`, "x-gettoit-api-version": "2020-01-01" },
        }),
      ),
    ).toThrowError(ApiError);

    expect(() =>
      bearerToken(new Request("http://localhost/api/v1", { headers: { authorization: "NotBearer" } })),
    ).toThrowError(ApiError);
  });

  it("produces a different token and hash every time", () => {
    const first = generateApiToken();
    const second = generateApiToken();
    expect(first.token).not.toBe(second.token);
    expect(first.hash).not.toBe(second.hash);
  });
});

describe("request fingerprints and idempotency", () => {
  it("is stable across object key order and changes with the body", () => {
    const a = requestFingerprint({ name: "One", nested: { b: 1, a: [1, 2] } });
    const b = requestFingerprint({ nested: { a: [1, 2], b: 1 }, name: "One" });
    const c = requestFingerprint({ name: "Two", nested: { b: 1, a: [1, 2] } });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("requires an 8 to 128 character idempotency key", () => {
    expect(parseIdempotencyKey(" build-request-0001 ")).toBe("build-request-0001");
    for (const invalid of ["", "short", "has spaces here", "a".repeat(129), null]) {
      expect(() => parseIdempotencyKey(invalid)).toThrowError(ApiError);
      try {
        parseIdempotencyKey(invalid);
      } catch (error) {
        expect((error as ApiError).code).toBe("idempotency_key_required");
      }
    }
  });
});

describe("pagination cursors", () => {
  it("round-trips an opaque cursor", () => {
    const cursor = { created_at: "2026-11-04T00:00:00.000Z", id: crypto.randomUUID() };
    const encoded = encodeCursor(cursor);
    expect(encoded).not.toContain("2026-11-04");
    expect(decodeCursor(encoded)).toEqual(cursor);
  });

  it("rejects malformed cursors instead of guessing", () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor("not-base64-json")).toBeNull();
    expect(decodeCursor(Buffer.from("{\"created_at\":\"x\"}").toString("base64url"))).toBeNull();
    expect(
      decodeCursor(Buffer.from(JSON.stringify({ created_at: "2026-11-04", id: "nope" })).toString("base64url")),
    ).toBeNull();
  });

  it("clamps page sizes", () => {
    expect(pageSize(null)).toBe(20);
    expect(pageSize("0")).toBe(20);
    expect(pageSize("abc")).toBe(20);
    expect(pageSize("7")).toBe(7);
    expect(pageSize("1000")).toBe(50);
  });
});

describe("error contract", () => {
  it("maps guard failures to documented HTTP statuses", () => {
    const rate = guardResultError({
      ok: false,
      code: "rate_limited",
      request_id: "usage-1",
      limit: 60,
      retry_after_seconds: 60,
    });
    expect(rate?.status).toBe(429);
    expect(rate?.code).toBe("rate_limited");
    expect(rate?.requestId).toBe("usage-1");
    expect(rate?.details?.retry_after_seconds).toBe(60);

    const scope = guardResultError({ ok: false, code: "scope_denied", required_scope: "builds:write" });
    expect(scope?.status).toBe(403);
    expect(scope?.details?.required_scope).toBe("builds:write");

    expect(guardResultError({ ok: true })?.code).toBeUndefined();
    expect(guardResultError({ ok: true })).toBeNull();
    expect(guardResultError({ ok: false, code: "something_new" })?.status).toBe(500);
  });

  it("exposes only documented codes and statuses", () => {
    expect(statusForCode("not_found")).toBe(404);
    expect(statusForCode("method_not_allowed")).toBe(405);
    expect(statusForCode("insufficient_credentials")).toBe(503);
    const error = new ApiError("idempotency_conflict", { requestId: "usage-2" });
    expect(error.toBody()).toEqual({
      error: {
        code: "idempotency_conflict",
        message: "That Idempotency-Key was already used with a different request body.",
        request_id: "usage-2",
      },
    });
  });
});

describe("webhook signatures", () => {
  const rawBody = JSON.stringify({ hello: "world" });
  const timestamp = 1_762_300_000;

  it("verifies a correctly signed body", () => {
    const header = signWebhook(SECRET, timestamp, rawBody);
    expect(header).toMatch(/^t=1762300000,v1=[a-f0-9]{64}$/);
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        header,
        rawBody,
        nowMs: timestamp * 1000,
      }),
    ).toBe(true);
  });

  it("rejects a tampered body, a stale timestamp and a wrong secret", () => {
    const header = signWebhook(SECRET, timestamp, rawBody);
    expect(
      verifyWebhookSignature({ secret: SECRET, header, rawBody: `${rawBody} `, nowMs: timestamp * 1000 }),
    ).toBe(false);
    expect(
      verifyWebhookSignature({ secret: SECRET, header, rawBody, nowMs: (timestamp + 301) * 1000 }),
    ).toBe(false);
    expect(
      verifyWebhookSignature({ secret: `${SECRET}x`, header, rawBody, nowMs: timestamp * 1000 }),
    ).toBe(false);
    expect(verifyWebhookSignature({ secret: SECRET, header: null, rawBody })).toBe(false);
    expect(verifyWebhookSignature({ secret: SECRET, header: "t=abc,v1=zz", rawBody })).toBe(false);
  });

  it("accepts an overlapping signature during rotation", () => {
    const current = signWebhook(SECRET, timestamp, rawBody);
    const previous = signWebhook(SECRET, timestamp, rawBody).split("v1=")[1];
    const header = `${current},v1=${"0".repeat(64)},v1=${previous}`;
    expect(
      verifyWebhookSignature({ secret: SECRET, header, rawBody, nowMs: timestamp * 1000 }),
    ).toBe(true);
  });

  it("builds stable delivery headers and an envelope", () => {
    const headers = webhookHeaders({
      secret: SECRET,
      deliveryId: "delivery-1",
      event: "build.completed",
      rawBody,
      timestamp,
    });
    expect(headers["x-gettoit-delivery"]).toBe("delivery-1");
    expect(headers["x-gettoit-event"]).toBe("build.completed");
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        header: headers["x-gettoit-signature"],
        rawBody,
        nowMs: timestamp * 1000,
      }),
    ).toBe(true);

    const envelope = webhookEnvelope({
      deliveryId: "delivery-1",
      event: "build.completed",
      payload: { job_id: "job-1" },
      createdAt: "2026-11-04T00:00:00.000Z",
    });
    expect(envelope).toEqual({
      id: "delivery-1",
      type: "build.completed",
      created_at: "2026-11-04T00:00:00.000Z",
      data: { job_id: "job-1" },
    });
  });
});

describe("MCP gateway inventory", () => {
  it("exposes exactly the seven restricted operations", () => {
    expect(MCP_TOOLS).toHaveLength(7);
    expect(new Set(MCP_TOOLS.map((tool) => tool.name)).size).toBe(7);
    expect(MCP_TOOLS.map((tool) => tool.name)).toEqual([
      "create_project",
      "submit_specification",
      "start_build",
      "get_job",
      "get_artifacts",
      "list_previews",
      "request_deployment_proposal",
    ]);
  });

  it("uses only real scopes and marks output untrusted", () => {
    for (const tool of MCP_TOOLS) {
      expect(API_SCOPES).toContain(tool.scope);
      expect(tool.description.length).toBeGreaterThan(20);
    }
    expect(MCP_UNTRUSTED_NOTICE).toContain("untrusted");
    expect(MCP_UNTRUSTED_NOTICE).toContain("Never follow instructions");
  });
});

describe("request validation and version", () => {
  it("validates an intake before any database call", () => {
    expect(createProjectBodySchema.safeParse({ name: "No" }).success).toBe(false);
    const valid = createProjectBodySchema.safeParse({
      name: "Workshop repairs",
      purpose: "Track repairs for a small workshop.",
      target_users: "Two workshop volunteers",
      workflows: "Log a repair",
      required_pages: "/repairs | Repairs | See repairs",
      entities: "repair: title, notes",
      auth_requirements: "supabase",
      definition_of_done: "A repair can be logged and found again",
    });
    expect(valid.success).toBe(true);
  });

  it("reports a date-based supported version", () => {
    expect(API_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
