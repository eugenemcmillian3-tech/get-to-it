import { describe, expect, it } from "vitest";
import {
  BILLING_NOT_CREDITS,
  BILLING_OFFERS,
  billingOffer,
  offerDurationLabel,
  offerPriceLabel,
} from "@/lib/billing/offers";
import { activeGrants } from "@/lib/data/billing";
import type { BillingEntitlement } from "@/lib/types";

describe("paid offers", () => {
  it("contains exactly the seven product offers and no AI allowance", () => {
    expect(BILLING_OFFERS).toHaveLength(7);
    expect(new Set(BILLING_OFFERS.map((offer) => offer.slug)).size).toBe(7);
    expect(BILLING_NOT_CREDITS.toLowerCase()).toContain("do not add ai credits");
    expect(BILLING_OFFERS.flatMap((offer) => offer.grants)).not.toContain("ai_credits");
  });

  it("keeps seat pricing per seat and makes the owner the first seat", () => {
    const seats = billingOffer("team_seats");
    expect(seats).not.toBeNull();
    expect(seats?.seatBased).toBe(true);
    expect(seats?.minQuantity).toBe(2);
    expect(seats?.maxQuantity).toBe(50);
    expect(offerPriceLabel(seats!.priceCents, 5)).toBe("$95");
  });

  it("fulfils every offer through explicit grants", () => {
    expect(billingOffer("pro")?.grants).toEqual([
      "premium_templates",
      "priority_support",
      "white_label",
      "onboarding",
    ]);
    expect(billingOffer("automation_plus")?.grants).toEqual(["automation_plus"]);
    expect(billingOffer("build_release")?.grants).toEqual(["build_release"]);
    expect(billingOffer("premium_templates")?.grants).toEqual(["premium_templates"]);
    expect(billingOffer("white_label")?.grants).toEqual(["white_label"]);
    expect(billingOffer("priority_support")?.grants).toEqual([
      "priority_support",
      "onboarding",
    ]);
  });

  it("labels one-time and expiring passes honestly", () => {
    expect(offerDurationLabel(30)).toBe("30-day pass, no auto-renew");
    expect(offerDurationLabel(null)).toBe("One-time, no renewal");
    expect(offerPriceLabel(4900)).toBe("$49");
  });

  it("ignores expired and revoked entitlements when showing active grants", () => {
    const now = new Date("2026-11-07T12:00:00Z");
    const base: BillingEntitlement = {
      id: "one",
      offer_slug: "pro",
      grants: ["premium_templates", "white_label"],
      quantity: 1,
      workspace_id: null,
      project_id: null,
      status: "active",
      starts_at: "2026-11-01T12:00:00Z",
      expires_at: "2026-12-01T12:00:00Z",
      created_at: "2026-11-01T12:00:00Z",
    };

    expect([...activeGrants([base], now)]).toEqual(["premium_templates", "white_label"]);
    expect([...activeGrants([{ ...base, expires_at: "2026-11-01T12:00:00Z" }], now)]).toEqual([]);
    expect([...activeGrants([{ ...base, status: "revoked" }], now)]).toEqual([]);
  });
});
