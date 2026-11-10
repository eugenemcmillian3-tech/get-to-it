import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/health/route";

/**
 * The health endpoint is the one place a deployment can say, unaided, which
 * preview backend its runtime can actually see. These tests keep that signal
 * honest and keep it free of values.
 */

const CLEARED = [
  "PREVIEW_RUNNER_URL",
  "PREVIEW_RUNNER_TOKEN",
  "PREVIEW_SIGNING_SECRET",
  "PREVIEW_PUBLIC_ORIGIN",
  "RENDER_API_KEY",
  "RENDER_WORKSPACE_ID",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
];

function clearEnvironment() {
  for (const key of CLEARED) vi.stubEnv(key, "");
}

async function health() {
  const response = await GET();
  const body = await response.text();
  return { response, body, parsed: JSON.parse(body) as { checks: Record<string, string> } };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("health check preview backend", () => {
  it("says unconfigured when the runtime can see no backend", async () => {
    clearEnvironment();
    const { parsed } = await health();
    expect(parsed.checks.preview_backend).toBe("unconfigured");
  });

  it("says sandbox when the Render key and workspace are both present", async () => {
    clearEnvironment();
    vi.stubEnv("RENDER_API_KEY", "rnd_placeholder_value");
    vi.stubEnv("RENDER_WORKSPACE_ID", "tea-placeholder");
    const { parsed } = await health();
    expect(parsed.checks.preview_backend).toBe("sandbox");
  });

  it("needs both Render values, not just the key", async () => {
    clearEnvironment();
    vi.stubEnv("RENDER_API_KEY", "rnd_placeholder_value");
    const { parsed } = await health();
    expect(parsed.checks.preview_backend).toBe("unconfigured");
  });

  it("prefers a complete local runner and never echoes a value", async () => {
    clearEnvironment();
    vi.stubEnv("PREVIEW_RUNNER_URL", "https://runner.example.com");
    vi.stubEnv("PREVIEW_RUNNER_TOKEN", "runner-token-value-000000000");
    vi.stubEnv("PREVIEW_SIGNING_SECRET", "signing-secret-value-00000000");
    vi.stubEnv("PREVIEW_PUBLIC_ORIGIN", "https://preview.example.com");
    vi.stubEnv("RENDER_API_KEY", "rnd_placeholder_value");
    vi.stubEnv("RENDER_WORKSPACE_ID", "tea-placeholder");

    const { parsed, body } = await health();

    expect(parsed.checks.preview_backend).toBe("runner");
    expect(body).not.toContain("rnd_placeholder_value");
    expect(body).not.toContain("runner.example.com");
    expect(body).not.toContain("runner-token-value-000000000");
    expect(body).not.toContain("signing-secret-value-00000000");
  });
});
