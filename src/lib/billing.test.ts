import { describe, it, expect } from "vitest";
import {
  isActiveStatus,
  effectiveTier,
  isPaidTier,
  isComped,
  hasCompGrant,
  daysUntilTrim,
  pricingCta,
  lookupKey,
  tiersWithPrices,
  paidTiersVisible,
  priceFor,
  formatPrice,
  isComingSoon,
  annualMonthlyEquivalent,
  annualDiscountPercent,
  type StripePrice,
} from "./billing";

const price = (tier: string, interval: "monthly" | "annual", unitAmount: number): StripePrice => ({
  tier,
  interval,
  lookupKey: `${tier}_${interval}`,
  priceId: `price_${tier}_${interval}`,
  unitAmount,
  currency: "usd",
});

describe("isActiveStatus", () => {
  it("treats active / trialing / past_due as granting access", () => {
    expect(isActiveStatus("active")).toBe(true);
    expect(isActiveStatus("trialing")).toBe(true);
    expect(isActiveStatus("past_due")).toBe(true);
  });
  it("treats everything else (and null) as inactive", () => {
    expect(isActiveStatus("canceled")).toBe(false);
    expect(isActiveStatus("incomplete")).toBe(false);
    expect(isActiveStatus("unpaid")).toBe(false);
    expect(isActiveStatus(null)).toBe(false);
    expect(isActiveStatus(undefined)).toBe(false);
  });
});

describe("effectiveTier", () => {
  it("returns the tier when the subscription is active", () => {
    expect(effectiveTier({ tier: "pro", status: "active" })).toBe("pro");
    expect(effectiveTier({ tier: "plus", status: "trialing" })).toBe("plus");
  });
  it("falls back to free when inactive or missing", () => {
    expect(effectiveTier({ tier: "pro", status: "canceled" })).toBe("free");
    expect(effectiveTier(null)).toBe("free");
    expect(effectiveTier(undefined)).toBe("free");
  });
});

describe("isPaidTier", () => {
  it("is true for anything but free", () => {
    expect(isPaidTier("free")).toBe(false);
    expect(isPaidTier("plus")).toBe(true);
    expect(isPaidTier("pro")).toBe(true);
  });
});

describe("isComped", () => {
  const NOW = Date.UTC(2026, 5, 17); // fixed clock for the date-window checks
  const future = new Date(NOW + 86_400_000).toISOString();
  const past = new Date(NOW - 86_400_000).toISOString();

  it("is true for an active paid tier with no Stripe id, still in window", () => {
    expect(isComped({ tier: "premium", status: "active", stripe_subscription_id: null, current_period_end: future }, NOW)).toBe(true);
  });
  it("treats a no-end-date comp as open-ended", () => {
    expect(isComped({ tier: "premium", status: "active", stripe_subscription_id: null, current_period_end: null }, NOW)).toBe(true);
  });
  it("is false once the comp window has passed", () => {
    expect(isComped({ tier: "premium", status: "active", stripe_subscription_id: null, current_period_end: past }, NOW)).toBe(false);
  });
  it("is false for a Stripe-managed subscription (not a comp)", () => {
    expect(isComped({ tier: "premium", status: "active", stripe_subscription_id: "sub_123", current_period_end: future }, NOW)).toBe(false);
  });
  it("is false for free, inactive, or missing rows", () => {
    expect(isComped({ tier: "free", status: "active", stripe_subscription_id: null, current_period_end: future }, NOW)).toBe(false);
    expect(isComped({ tier: "premium", status: "canceled", stripe_subscription_id: null, current_period_end: future }, NOW)).toBe(false);
    expect(isComped(null, NOW)).toBe(false);
    expect(isComped(undefined, NOW)).toBe(false);
  });
});

describe("hasCompGrant", () => {
  it("is true for a paid-tier row with no Stripe id — active or lapsed", () => {
    expect(hasCompGrant({ tier: "premium", stripe_subscription_id: null })).toBe(true);
  });
  it("is false for a Stripe-backed row or a free/empty row", () => {
    expect(hasCompGrant({ tier: "premium", stripe_subscription_id: "sub_1" })).toBe(false);
    expect(hasCompGrant({ tier: "free", stripe_subscription_id: null })).toBe(false);
    expect(hasCompGrant(null)).toBe(false);
    expect(hasCompGrant(undefined)).toBe(false);
  });
});

describe("daysUntilTrim", () => {
  const NOW = Date.UTC(2026, 5, 17);
  it("rounds up whole days remaining", () => {
    expect(daysUntilTrim(new Date(NOW + 5 * 86_400_000 + 1000).toISOString(), NOW)).toBe(6);
    expect(daysUntilTrim(new Date(NOW + 86_400_000).toISOString(), NOW)).toBe(1);
  });
  it("clamps to 0 once the date has passed, and is null without a date", () => {
    expect(daysUntilTrim(new Date(NOW - 86_400_000).toISOString(), NOW)).toBe(0);
    expect(daysUntilTrim(null, NOW)).toBeNull();
    expect(daysUntilTrim(undefined, NOW)).toBeNull();
  });
});

describe("pricingCta", () => {
  const base = { signedIn: true, cloudEnabled: true, currentTier: "free", purchasable: true };

  it("shows nothing when signed out, cloud disabled, or no slug", () => {
    expect(pricingCta({ ...base, slug: "plus", signedIn: false })).toBe("none");
    expect(pricingCta({ ...base, slug: "plus", cloudEnabled: false })).toBe("none");
    expect(pricingCta({ ...base, slug: undefined })).toBe("none");
  });

  it("marks the user's current tier as current", () => {
    expect(pricingCta({ ...base, slug: "free", currentTier: "free" })).toBe("current");
    expect(pricingCta({ ...base, slug: "pro", currentTier: "pro" })).toBe("current");
  });

  it("offers an upgrade for any purchasable paid tier (slug-agnostic)", () => {
    expect(pricingCta({ ...base, slug: "plus", currentTier: "free", purchasable: true })).toBe("upgrade");
    expect(pricingCta({ ...base, slug: "premium", currentTier: "free", purchasable: true })).toBe("upgrade");
    expect(pricingCta({ ...base, slug: "premium", currentTier: "premium", purchasable: true })).toBe("current");
  });

  it("keeps a paid tier non-actionable (Coming soon) when no Stripe Price is set", () => {
    expect(pricingCta({ ...base, slug: "pro", currentTier: "free", purchasable: false })).toBe("none");
  });

  it("never offers an upgrade to the free-online card", () => {
    expect(pricingCta({ ...base, slug: "free", currentTier: "pro" })).toBe("none");
  });

  it("routes paid→paid changes to the portal (manage), not a new checkout", () => {
    // On a paid tier, both an up- and a down-grade must go through the portal so
    // we never create a second, double-billed Stripe subscription.
    expect(pricingCta({ ...base, slug: "premium", currentTier: "plus", purchasable: true })).toBe("manage");
    expect(pricingCta({ ...base, slug: "plus", currentTier: "premium", purchasable: true })).toBe("manage");
  });

  it("still keeps an unconfigured paid tier non-actionable even when on a paid tier", () => {
    expect(pricingCta({ ...base, slug: "pro", currentTier: "plus", purchasable: false })).toBe("none");
  });

  it("shows no CTA on native (Android) — purchases are web-only, even for would-be upgrades/current", () => {
    expect(pricingCta({ ...base, slug: "plus", currentTier: "free", purchasable: true, native: true })).toBe("none");
    expect(pricingCta({ ...base, slug: "plus", currentTier: "plus", purchasable: true, native: true })).toBe("none");
    expect(pricingCta({ ...base, slug: "premium", currentTier: "plus", purchasable: true, native: true })).toBe("none");
  });
});

describe("lookupKey", () => {
  it("joins tier + interval the way Stripe lookup_keys are named", () => {
    expect(lookupKey("plus", "monthly")).toBe("plus_monthly");
    expect(lookupKey("pro", "annual")).toBe("pro_annual");
  });
});

describe("tiersWithPrices", () => {
  it("collects the distinct tiers that have a price", () => {
    const prices = [price("plus", "monthly", 100), price("plus", "annual", 1000), price("pro", "monthly", 1000)];
    expect(tiersWithPrices(prices)).toEqual(new Set(["plus", "pro"]));
  });
  it("is empty for no prices", () => {
    expect(tiersWithPrices([]).size).toBe(0);
  });
});

describe("paidTiersVisible (no-Stripe failback)", () => {
  it("is false when unconfigured, configured-but-empty, or null", () => {
    expect(paidTiersVisible(null)).toBe(false);
    expect(paidTiersVisible({ configured: false, prices: [] })).toBe(false);
    expect(paidTiersVisible({ configured: false, prices: [price("plus", "monthly", 100)] })).toBe(false);
    expect(paidTiersVisible({ configured: true, prices: [] })).toBe(false);
  });
  it("is true only when configured with at least one price", () => {
    expect(paidTiersVisible({ configured: true, prices: [price("plus", "monthly", 100)] })).toBe(true);
  });
});

describe("priceFor", () => {
  const prices = [price("plus", "monthly", 100), price("plus", "annual", 1000)];
  it("matches on tier + interval", () => {
    expect(priceFor(prices, "plus", "annual")?.unitAmount).toBe(1000);
  });
  it("returns undefined when the interval isn't priced", () => {
    expect(priceFor(prices, "pro", "monthly")).toBeUndefined();
  });
});

describe("isComingSoon", () => {
  it("flags the on-hold tiers (premium + the AI pro tier) as not-yet-purchasable", () => {
    expect(isComingSoon("pro")).toBe(true);
    expect(isComingSoon("premium")).toBe(true);
  });
  it("treats the launch tiers as available", () => {
    expect(isComingSoon("free")).toBe(false);
    expect(isComingSoon("plus")).toBe(false);
  });
});

describe("annualMonthlyEquivalent", () => {
  it("spreads an annual price across 12 months", () => {
    expect(annualMonthlyEquivalent(12000)).toBe(1000);
  });
  it("is null for a missing amount", () => {
    expect(annualMonthlyEquivalent(null)).toBeNull();
    expect(annualMonthlyEquivalent(undefined)).toBeNull();
  });
});

describe("annualDiscountPercent", () => {
  it("reports the saving versus 12× the monthly price", () => {
    // $10/mo = $120/yr; an $99/yr annual plan saves ~17.5% → rounds to 18.
    expect(annualDiscountPercent(1000, 9900)).toBe(18);
    // Exactly two months free → ~16.67% → 17.
    expect(annualDiscountPercent(1000, 10000)).toBe(17);
  });
  it("is null when there's no saving or an amount is missing", () => {
    expect(annualDiscountPercent(1000, 12000)).toBeNull(); // same as monthly
    expect(annualDiscountPercent(1000, 13000)).toBeNull(); // more expensive
    expect(annualDiscountPercent(null, 9900)).toBeNull();
    expect(annualDiscountPercent(1000, null)).toBeNull();
    expect(annualDiscountPercent(0, 9900)).toBeNull();
  });
});

describe("formatPrice", () => {
  it("drops cents for whole amounts and keeps them otherwise", () => {
    expect(formatPrice(100, "usd")).toBe("$1");
    expect(formatPrice(1099, "usd")).toBe("$10.99");
  });
  it("returns empty string for null (metered) amounts", () => {
    expect(formatPrice(null, "usd")).toBe("");
  });
});
