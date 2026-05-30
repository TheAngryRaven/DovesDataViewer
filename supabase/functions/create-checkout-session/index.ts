// Creates a Stripe Checkout Session for a subscription tier + billing interval
// and returns its URL. The caller's Supabase JWT (Authorization: Bearer …)
// identifies the user; the Price is resolved live by lookup_key ("{tier}_{interval}",
// e.g. "plus_annual") so the Stripe dashboard is the source of truth — no Price
// ids in code or DB. The actual entitlement is granted by stripe-webhook on
// completion — never by the client.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2025-03-31.basil',
  httpClient: Stripe.createFetchHttpClient(),
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ error: 'Unauthorized' }, 401);
    }

    // Identify the user from their JWT.
    const authClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await authClient.auth.getUser();
    if (userErr || !user) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const { tier, interval, returnUrl } = await req.json().catch(() => ({}));
    if (!tier || typeof tier !== 'string' || tier === 'free') {
      return json({ error: 'Invalid tier' }, 400);
    }
    // Tiers that exist but aren't self-service purchasable yet (Premium + the AI
    // Pro plan). They can still be comped by creating the subscription directly
    // in Stripe — the webhook honours it. Keep in sync with billing.ts
    // COMING_SOON_TIERS.
    const COMING_SOON = new Set(['premium', 'pro']);
    if (COMING_SOON.has(tier)) {
      return json({ error: 'Tier is coming soon and not yet available to purchase' }, 400);
    }
    const billingInterval = interval === 'annual' ? 'annual' : 'monthly';

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // The tier must exist in our catalogue (and not be the free tier).
    const { data: tierRow } = await admin
      .from('subscription_tiers')
      .select('tier')
      .eq('tier', tier)
      .maybeSingle();
    if (!tierRow) {
      return json({ error: 'Unknown tier' }, 400);
    }

    // Resolve the live Price by lookup_key — the dashboard is the source of truth.
    const lookupKey = `${tier}_${billingInterval}`;
    const { data: prices } = await stripe.prices.list({
      lookup_keys: [lookupKey],
      active: true,
      limit: 1,
    });
    const price = prices[0];
    if (!price) {
      return json({ error: 'Tier is not purchasable' }, 400);
    }

    // Reuse the user's Stripe customer if we have one, else create + persist it.
    const { data: sub } = await admin
      .from('user_subscriptions')
      .select('stripe_customer_id, status, stripe_subscription_id')
      .eq('user_id', user.id)
      .maybeSingle();

    // Block a SECOND parallel subscription. If the user already has an active
    // subscription, a plan change must go through the Billing Portal (which
    // swaps the plan on the existing sub with proration) — not a new Checkout
    // Session, which would create a duplicate Stripe subscription and bill the
    // customer twice. The client routes paid→paid clicks to the portal; this is
    // the server-side backstop.
    const ENTITLING = ['active', 'trialing', 'past_due'];
    if (sub?.stripe_subscription_id && ENTITLING.includes(sub.status ?? '')) {
      return json(
        { error: 'You already have an active subscription. Manage your plan from the billing portal.' },
        409,
      );
    }

    let customerId = sub?.stripe_customer_id ?? undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;
      await admin.from('user_subscriptions').upsert(
        { user_id: user.id, stripe_customer_id: customerId },
        { onConflict: 'user_id' },
      );
    }

    const base = (typeof returnUrl === 'string' && returnUrl) || req.headers.get('origin') || '';
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: price.id, quantity: 1 }],
      client_reference_id: user.id,
      subscription_data: { metadata: { user_id: user.id, tier, interval: billingInterval } },
      allow_promotion_codes: true,
      success_url: `${base}?checkout=success`,
      cancel_url: `${base}?checkout=cancel`,
    });

    return json({ url: session.url });
  } catch (e) {
    console.error('create-checkout-session error', e);
    return json({ error: 'Internal error' }, 500);
  }
});
