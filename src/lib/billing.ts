// Pure subscription/billing logic + row shapes (no Supabase import, so it's
// unit-testable and safe to pull into any component). The Supabase I/O lives in
// billingClient.ts.

export interface SubscriptionTierRow {
  tier: string;
  label: string;
  price_cents: number;
  logs_bytes: number;
  doc_bytes: number;
  ai_credits: number;
  stripe_price_id: string | null;
  sort_order: number;
}

export interface UserSubscriptionRow {
  user_id: string;
  tier: string;
  status: string;
  current_period_end: string | null;
}

// A subscription grants its tier only while the status is one of these; anything
// else (canceled, incomplete, unpaid…) falls back to free. Mirrors the server's
// user_tier() definition so client display and server enforcement agree.
export const ACTIVE_STATUSES = ["active", "trialing", "past_due"] as const;

export function isActiveStatus(status: string | null | undefined): boolean {
  return !!status && (ACTIVE_STATUSES as readonly string[]).includes(status);
}

/** The tier a subscription row actually entitles the user to right now. */
export function effectiveTier(
  sub: Pick<UserSubscriptionRow, "tier" | "status"> | null | undefined,
): string {
  return sub && isActiveStatus(sub.status) ? sub.tier : "free";
}

export function isPaidTier(tier: string): boolean {
  return tier !== "free";
}

export type PricingCtaKind = "none" | "current" | "upgrade";

export interface PricingCtaInput {
  /** The card's tier slug ('free' | 'plus' | 'pro'); undefined for the offline card. */
  slug?: string;
  signedIn: boolean;
  cloudEnabled: boolean;
  /** The user's effective tier. */
  currentTier: string;
  /** Whether this tier has a Stripe Price configured (purchasable). */
  purchasable: boolean;
}

/**
 * Which call-to-action a pricing card should show. Pure so it can be unit-tested.
 * "none" means render no button (informational only — e.g. signed out, the free
 * tiers, or a paid tier whose Stripe Price isn't configured yet, which keeps the
 * "Coming soon" badge).
 */
export function pricingCta(i: PricingCtaInput): PricingCtaKind {
  if (!i.slug || !i.cloudEnabled || !i.signedIn) return "none";
  if (i.slug === i.currentTier) return "current";
  if (i.slug === "free") return "none";
  return i.purchasable ? "upgrade" : "none";
}
