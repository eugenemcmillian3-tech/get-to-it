import { describe, expect, it } from "vitest";
import {
  BILLING_NOT_CREDITS,
  BILLING_OFFERS,
  billingOffer,
  offerDurationLabel,
  offerPriceLabel,
} from "@/lib/billing/offers";
import { subscriptionFactsFromEvent } from "@/lib/credits/stripe";
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

  it("labels recurring and one-time offers honestly", () => {
    expect(offerDurationLabel(30, "subscription", "day", 30)).toBe(
      "Auto-renews every 30 days",
    );
    expect(offerDurationLabel(90, "subscription", "day", 90)).toBe(
      "Auto-renews every 90 days",
    );
    expect(offerDurationLabel(null)).toBe("One-time, no renewal");
    expect(offerPriceLabel(4900)).toBe("$49");
  });

  it("makes the five time-limited offers subscriptions and leaves two one-time", () => {
    expect(
      BILLING_OFFERS.filter((offer) => offer.billingMode === "subscription").map(
        (offer) => offer.slug,
      ),
    ).toEqual([
      "team_seats",
      "pro",
      "automation_plus",
      "build_release",
      "priority_support",
    ]);
    expect(
      BILLING_OFFERS.filter((offer) => offer.billingMode === "one_time").map(
        (offer) => offer.slug,
      ),
    ).toEqual(["premium_templates", "white_label"]);
  });

  it("reads subscription periods and cancellation from Stripe events", () => {
    const facts = subscriptionFactsFromEvent({
      id: "evt_test",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_test",
          customer: "cus_test",
          status: "active",
          cancel_at_period_end: true,
          metadata: { purchase_id: "purchase_test" },
          items: {
            data: [
              {
                price: { id: "price_test" },
                quantity: 3,
                current_period_start: 1_760_000_000,
                current_period_end: 1_762_592_000,
              },
            ],
          },
        },
      },
    });
    expect(facts).toMatchObject({
      subscriptionId: "sub_test",
      customerId: "cus_test",
      status: "active",
      priceId: "price_test",
      quantity: 3,
      cancelAtPeriodEnd: true,
      purchaseId: "purchase_test",
    });
    expect(facts.periodEnd).toBe(new Date(1_762_592_000_000).toISOString());

    const invoice = subscriptionFactsFromEvent({
      id: "evt_invoice",
      type: "invoice.payment_failed",
      data: {
        object: {
          subscription: "sub_test",
          customer: "cus_test",
          lines: {
            data: [
              {
                price: { id: "price_test" },
                quantity: 2,
                period: { start: 1_760_000_000, end: 1_762_592_000 },
              },
            ],
          },
        },
      },
    });
    expect(invoice).toMatchObject({
      subscriptionId: "sub_test",
      status: "past_due",
      quantity: 2,
      cancelAtPeriodEnd: null,
    });
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
