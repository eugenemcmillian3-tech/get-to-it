import { describe, expect, it, vi } from "vitest";
import { GettiClient } from "../sdk/typescript/src/index";

describe("GettiClient base URL", () => {
  it("strips every trailing slash before joining a request path", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        data: { api: "v1", version: "2026-11-01", scopes: [] },
      }),
    );
    const client = new GettiClient({
      apiKey: "gti_test",
      baseUrl: "https://example.test///",
      fetch: fetchImpl as unknown as typeof fetch,
    });

    await client.getServiceInfo();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.test/api/v1",
      expect.objectContaining({ method: "GET" }),
    );
  });
});
