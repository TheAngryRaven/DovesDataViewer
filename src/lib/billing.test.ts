import { describe, it, expect } from "vitest";
import { isActiveStatus, effectiveTier, isPaidTier, pricingCta } from "./billing";

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

  it("offers an upgrade for a purchasable paid tier above the current one", () => {
    expect(pricingCta({ ...base, slug: "plus", currentTier: "free", purchasable: true })).toBe("upgrade");
  });

  it("keeps a paid tier non-actionable (Coming soon) when no Stripe Price is set", () => {
    expect(pricingCta({ ...base, slug: "pro", currentTier: "free", purchasable: false })).toBe("none");
  });

  it("never offers an upgrade to the free-online card", () => {
    expect(pricingCta({ ...base, slug: "free", currentTier: "pro" })).toBe("none");
  });
});
