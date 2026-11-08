import { afterEach, describe, expect, it, vi } from "vitest";
import { cronRequestAuthorized, secretsMatch } from "@/lib/cron-auth";
import { GET as platformHealthRun } from "@/app/api/platform/health/run/route";
import { GET as remindersRun } from "@/app/api/reminders/run/route";

const SECRET = "cron-secret-abc123";

function cronRequest(authorization?: string) {
  return new Request("https://get-to-it.test/api/cron", {
    headers: authorization ? { authorization } : undefined,
  });
}

describe("cron authorization", () => {
  it("accepts the exact bearer secret", () => {
    expect(cronRequestAuthorized(cronRequest(`Bearer ${SECRET}`), SECRET)).toBe(true);
  });

  it("rejects a wrong, truncated, extended or differently-cased secret", () => {
    for (const value of [SECRET.slice(0, -1), `${SECRET}x`, SECRET.toUpperCase(), "wrong", ""]) {
      expect(cronRequestAuthorized(cronRequest(`Bearer ${value}`), SECRET), value).toBe(false);
    }
  });

  it("rejects a missing header, a bare secret and another scheme", () => {
    expect(cronRequestAuthorized(cronRequest(), SECRET)).toBe(false);
    expect(cronRequestAuthorized(cronRequest(SECRET), SECRET)).toBe(false);
    expect(cronRequestAuthorized(cronRequest(`Token ${SECRET}`), SECRET)).toBe(false);
    expect(cronRequestAuthorized(cronRequest("Bearer"), SECRET)).toBe(false);
  });

  it("treats a missing configured secret as a refusal, never as an open door", () => {
    expect(cronRequestAuthorized(cronRequest("Bearer "), undefined)).toBe(false);
    expect(cronRequestAuthorized(cronRequest("Bearer undefined"), undefined)).toBe(false);
    expect(cronRequestAuthorized(cronRequest("Bearer undefined"), "")).toBe(false);
  });

  it("compares by digest, so length never decides the result on its own", () => {
    expect(secretsMatch("a", "a")).toBe(true);
    expect(secretsMatch("a", "b")).toBe(false);
    expect(secretsMatch("short", "a much longer expected secret value")).toBe(false);
    expect(secretsMatch("x".repeat(4096), "x".repeat(4096))).toBe(true);
    expect(secretsMatch("", "")).toBe(true);
  });
});

describe("scheduled routes", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses a wrong bearer secret on both routes", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.stubEnv("PLATFORM_SELF_HEALING", "true");

    for (const handler of [remindersRun, platformHealthRun]) {
      const response = await handler(cronRequest("Bearer not-the-secret"));
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ ok: false });
    }
  });

  it("refuses a request with no Authorization header", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.stubEnv("PLATFORM_SELF_HEALING", "true");

    for (const handler of [remindersRun, platformHealthRun]) {
      expect((await handler(cronRequest())).status).toBe(401);
    }
  });

  it("fails closed with 503 when no secret is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("PLATFORM_SELF_HEALING", "true");

    for (const handler of [remindersRun, platformHealthRun]) {
      expect((await handler(cronRequest(`Bearer ${SECRET}`))).status).toBe(503);
    }
  });
});
