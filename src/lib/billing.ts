// Pure subscription/billing logic + row shapes (no Supabase import, so it's
// unit-testable and safe to pull into any component). The Supabase I/O lives in
// billingClient.ts.

export interface SubscriptionTierRow {
  tier: string;
  label: string;
  price_cents: number;
  /** The tier's single pooled cloud-storage budget in bytes (docs + logs + snapshots). */
  total_bytes: number;
  ai_credits: number;
  stripe_price_id: string | null;
  sort_order: number;
}

export interface UserSubscriptionRow {
  user_id: string;
  tier: string;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end?: boolean;
  billing_interval?: string | null;
  grace_until?: string | null;
  /** Set for Stripe-managed subscriptions; NULL for admin comps. */
  stripe_subscription_id?: string | null;
}

// Paid plans bill either monthly or annually. The slug encodes both halves of a
// Stripe lookup_key: `${tier}_${interval}` (e.g. "pro_annual").
export type BillingInterval = "monthly" | "annual";

/** A live Stripe Price for one (tier × interval), as returned by stripe-prices. */
export interface StripePrice {
  tier: string;
  interval: BillingInterval;
  lookupKey: string;
  priceId: string;
  /** Amount in the currency's minor unit (cents); null for metered prices. */
  unitAmount: number | null;
  currency: string;
}

/** The pricing-catalogue response: whether Stripe is wired up + its live prices. */
export interface StripeConfig {
  configured: boolean;
  prices: StripePrice[];
}

/** The Stripe lookup_key for a tier + interval. */
export function lookupKey(tier: string, interval: BillingInterval): string {
  return `${tier}_${interval}`;
}

/** The set of tiers that have at least one purchasable price configured. */
export function tiersWithPrices(prices: StripePrice[]): Set<string> {
  return new Set(prices.map((p) => p.tier));
}

/**
 * Whether the paid tiers should be shown at all. The failback when Stripe isn't
 * wired up (no secret key / no prices) is to surface only the free cards — paid
 * tiers are hidden entirely, not shown as "coming soon".
 */
export function paidTiersVisible(config: StripeConfig | null | undefined): boolean {
  return !!config?.configured && (config?.prices.length ?? 0) > 0;
}

/** Find the live price for a tier + interval, if configured. */
export function priceFor(
  prices: StripePrice[],
  tier: string,
  interval: BillingInterval,
): StripePrice | undefined {
  return prices.find((p) => p.tier === tier && p.interval === interval);
}

/** Format a minor-unit amount as a localized currency string (no trailing .00). */
export function formatPrice(unitAmount: number | null | undefined, currency: string): string {
  if (unitAmount == null) return "";
  const major = unitAmount / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
      maximumFractionDigits: Number.isInteger(major) ? 0 : 2,
    }).format(major);
  } catch {
    return `${major}`;
  }
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

/**
 * Whether the user is on an admin **comp** (complimentary) rather than a paid
 * Stripe subscription. Mirrors the server `user_tier()` comp branch: an active
 * paid tier with no `stripe_subscription_id`, still within its granted window
 * (an open-ended comp has no `current_period_end`). A comp has no Stripe
 * customer, so the billing-portal actions must be hidden for it.
 */
export function isComped(
  sub: Pick<UserSubscriptionRow, "tier" | "status" | "stripe_subscription_id" | "current_period_end"> | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!sub || !isActiveStatus(sub.status) || !isPaidTier(sub.tier)) return false;
  if (sub.stripe_subscription_id) return false; // Stripe-managed — not a comp
  if (!sub.current_period_end) return true; // open-ended comp
  return new Date(sub.current_period_end).getTime() > now;
}

// Tiers that exist but aren't yet self-service purchasable — shown as
// "Coming soon" and never selectable for checkout (the create-checkout-session
// edge function rejects them too). They're hidden from the pricing UI entirely
// (not shown as teasers — keeps the choice count low at launch). They can still
// be granted manually (e.g. comping a tester) by creating the subscription in
// Stripe, which the webhook honours. Keep this in sync with
// create-checkout-session's COMING_SOON set.
export const COMING_SOON_TIERS = new Set<string>(["premium", "pro"]);

export function isComingSoon(tier: string): boolean {
  return COMING_SOON_TIERS.has(tier);
}

// Human-readable storage budget per tier, for the sign-up UI where the live
// subscription_tiers catalogue isn't readable yet (the user is signed out). Must
// stay in sync with subscription_tiers.total_bytes in the DB.
export const TIER_STORAGE_LABEL: Record<string, string> = {
  free: "50 MB",
  plus: "10 GB",
  premium: "100 GB",
  pro: "500 GB",
};

// Display name per tier slug, for dropdowns / summaries.
export const TIER_DISPLAY_LABEL: Record<string, string> = {
  free: "Free",
  plus: "Plus",
  premium: "Premium",
  pro: "Pro",
};

/** The monthly-equivalent cost (minor units) of an annual price — annual / 12. */
export function annualMonthlyEquivalent(annualUnitAmount: number | null | undefined): number | null {
  if (annualUnitAmount == null) return null;
  return annualUnitAmount / 12;
}

/**
 * The discount (whole %) an annual plan gives versus paying monthly for a year,
 * i.e. how much cheaper 1× annual is than 12× monthly. Returns null when either
 * amount is missing or the annual price isn't actually cheaper.
 */
export function annualDiscountPercent(
  monthlyUnitAmount: number | null | undefined,
  annualUnitAmount: number | null | undefined,
): number | null {
  if (monthlyUnitAmount == null || annualUnitAmount == null || monthlyUnitAmount <= 0) return null;
  const yearlyAtMonthly = monthlyUnitAmount * 12;
  const saved = yearlyAtMonthly - annualUnitAmount;
  if (saved <= 0) return null;
  return Math.round((saved / yearlyAtMonthly) * 100);
}

export type PricingCtaKind = "none" | "current" | "manage" | "upgrade";

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
 * "Coming soon" badge). "manage" routes through the billing portal instead of a
 * new Checkout Session.
 */
export function pricingCta(i: PricingCtaInput): PricingCtaKind {
  if (!i.slug || !i.cloudEnabled || !i.signedIn) return "none";
  if (i.slug === i.currentTier) return "current";
  if (i.slug === "free") return "none";
  if (!i.purchasable) return "none";
  // A user already on a paid tier must NOT start a fresh Checkout for another
  // paid tier — that would create a second, parallel Stripe subscription and
  // double-bill them. Plan changes (up or down) go through the billing portal,
  // which swaps the plan on the existing subscription. Only an upgrade from free
  // starts a new Checkout Session.
  return isPaidTier(i.currentTier) ? "manage" : "upgrade";
}
