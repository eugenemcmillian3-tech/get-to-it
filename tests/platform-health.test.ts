import { describe, expect, it } from "vitest";
import { planPlatformRecovery, selfHealingEnabled } from "@/lib/platform-health";

describe("platform self-healing policy", () => {
  it("recovers abandoned work only when the database is reachable", () => {
    expect(
      planPlatformRecovery({ configuration: "configured", database: "ok", model_provider: "configured" }),
    ).toMatchObject({ action: "recover_stale_work", severity: "ok" });
  });

  it("escalates instead of pretending to repair a database outage", () => {
    expect(
      planPlatformRecovery({ configuration: "configured", database: "unavailable", model_provider: "configured" }),
    ).toMatchObject({ action: "escalate", severity: "critical" });
  });

  it("escalates missing platform configuration", () => {
    expect(
      planPlatformRecovery({ configuration: "missing", database: "ok", model_provider: "missing" }),
    ).toMatchObject({ action: "escalate", severity: "critical" });
  });

  it("keeps recovery available without a model provider", () => {
    expect(
      planPlatformRecovery({ configuration: "configured", database: "ok", model_provider: "missing" }).reason,
    ).toContain("OLLAMA_API_KEY");
  });

  it("can be disabled without removing the secret", () => {
    expect(selfHealingEnabled("false")).toBe(false);
    expect(selfHealingEnabled("true")).toBe(true);
    expect(selfHealingEnabled(undefined)).toBe(true);
  });
});
