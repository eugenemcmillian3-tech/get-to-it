import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../src/app/api/preview/selftest/route";

const URL_SELFTEST = "https://app.example/api/preview/selftest";

function call(headers: Record<string, string> = {}, query = "") {
  return POST(new Request(`${URL_SELFTEST}${query}`, { method: "POST", headers }));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sandbox self-test route", () => {
  it("is disabled when no self-test token is configured", async () => {
    vi.stubEnv("PREVIEW_SELFTEST_TOKEN", "");
    const response = await call();
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("disabled");
  });

  it("refuses a wrong bearer token", async () => {
    vi.stubEnv("PREVIEW_SELFTEST_TOKEN", "a-long-enough-self-test-token");
    const response = await call({ authorization: "Bearer not-the-token" });
    expect(response.status).toBe(401);
  });

  it("refuses a missing authorization header", async () => {
    vi.stubEnv("PREVIEW_SELFTEST_TOKEN", "a-long-enough-self-test-token");
    const response = await call();
    expect(response.status).toBe(401);
  });

  it("rejects a malformed project id before touching anything", async () => {
    vi.stubEnv("PREVIEW_SELFTEST_TOKEN", "a-long-enough-self-test-token");
    const response = await call({ authorization: "Bearer a-long-enough-self-test-token" }, "?project=not-a-uuid");
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("UUID");
  });

  it("reports unconfigured sandboxes instead of running anything", async () => {
    vi.stubEnv("PREVIEW_SELFTEST_TOKEN", "a-long-enough-self-test-token");
    vi.stubEnv("RENDER_API_KEY", "");
    vi.stubEnv("RENDER_WORKSPACE_ID", "");
    const response = await call({ authorization: "Bearer a-long-enough-self-test-token" });
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("not configured");
  });

  it("never echoes the token or the Render key in a refusal", async () => {
    vi.stubEnv("PREVIEW_SELFTEST_TOKEN", "self-test-token-value-1234");
    vi.stubEnv("RENDER_API_KEY", "rnd_should_never_appear");
    vi.stubEnv("RENDER_WORKSPACE_ID", "");
    const response = await call({ authorization: "Bearer wrong-token-value-5678" });
    const text = await response.text();
    expect(text).not.toContain("self-test-token-value-1234");
    expect(text).not.toContain("rnd_should_never_appear");
  });
});
