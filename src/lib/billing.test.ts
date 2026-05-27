import { describe, it, expect } from "vitest";
import {
  isActiveStatus,
  effectiveTier,
  isPaidTier,
  pricingCta,
  lookupKey,
  tiersWithPrices,
  paidTiersVisible,
  priceFor,
  formatPrice,
  isComingSoon,
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
  it("flags the AI (pro) tier as not-yet-purchasable", () => {
    expect(isComingSoon("pro")).toBe(true);
  });
  it("treats the other tiers as available", () => {
    expect(isComingSoon("free")).toBe(false);
    expect(isComingSoon("plus")).toBe(false);
    expect(isComingSoon("premium")).toBe(false);
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
