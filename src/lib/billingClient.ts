// Supabase I/O for subscriptions + billing (Stripe). Pure logic + row shapes
// live in billing.ts.
//
// subscription_tiers / user_subscriptions are not in the generated Database type
// yet (Lovable regenerates `integrations/supabase/types.ts` after the migration
// deploys), so — exactly like cloud-sync's cloudClient.ts — we route those
// tables through an untyped view of the shared client. Checkout/portal go
// through the typed `functions.invoke`.

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type {
  BillingInterval,
  StripeConfig,
  SubscriptionTierRow,
  UserSubscriptionRow,
} from "./billing";

const untyped = supabase as unknown as SupabaseClient;

export async function fetchTiers(): Promise<SubscriptionTierRow[]> {
  const { data, error } = await untyped
    .from("subscription_tiers")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`Failed to load tiers: ${error.message}`);
  return (data ?? []) as SubscriptionTierRow[];
}

export async function fetchMySubscription(userId: string): Promise<UserSubscriptionRow | null> {
  const { data, error } = await untyped
    .from("user_subscriptions")
    .select("user_id, tier, status, current_period_end, cancel_at_period_end, billing_interval, grace_until")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load subscription: ${error.message}`);
  return (data ?? null) as UserSubscriptionRow | null;
}

/**
 * The live pricing catalogue (whether Stripe is wired up + its prices). Never
 * throws into render: a network/function error reads as "not configured", which
 * makes the UI fall back to the free-only cards.
 */
export async function fetchStripeConfig(): Promise<StripeConfig> {
  const { data, error } = await supabase.functions.invoke("stripe-prices", { body: {} });
  if (error || !data) return { configured: false, prices: [] };
  return data as StripeConfig;
}

/**
 * Start Stripe Checkout for a tier + billing interval; resolves to the hosted
 * URL to redirect to.
 */
export async function createCheckout(
  tier: string,
  interval: BillingInterval,
  returnUrl: string,
): Promise<string> {
  const { data, error } = await supabase.functions.invoke("create-checkout-session", {
    body: { tier, interval, returnUrl },
  });
  if (error) throw new Error(error.message);
  const url = (data as { url?: string } | null)?.url;
  if (!url) throw new Error("No checkout URL returned");
  return url;
}

/**
 * Open the Stripe Billing Portal; resolves to the hosted URL to redirect to.
 * `flow: "update"` deep-links straight into the change-plan screen (for the
 * "Change plan" button); the default generic portal handles cancel / payment
 * methods / invoices.
 */
export async function createPortal(
  returnUrl: string,
  flow?: "update",
): Promise<string> {
  const { data, error } = await supabase.functions.invoke("create-portal-session", {
    body: { returnUrl, ...(flow ? { flow } : {}) },
  });
  if (error) throw new Error(error.message);
  const url = (data as { url?: string } | null)?.url;
  if (!url) throw new Error("No portal URL returned");
  return url;
}
