// Public price catalogue for the pricing UI. Returns whether Stripe is wired up
// (a secret key is present) plus the live monthly/annual Prices for the paid
// tiers, resolved by lookup_key so the dashboard is the single source of truth —
// no Price ids in code or env. When STRIPE_SECRET_KEY is absent it reports
// { configured: false }, which is the client's signal to fall back to showing
// only the free cards. No auth: prices are public marketing data.
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// One lookup_key per (tier × interval). Create matching Prices in Stripe with
// these exact lookup keys; anything missing simply won't appear in the UI.
const LOOKUP_KEYS = [
  'plus_monthly', 'plus_annual',
  'premium_monthly', 'premium_annual',
  'pro_monthly', 'pro_annual',
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const secret = Deno.env.get('STRIPE_SECRET_KEY');
  if (!secret) {
    return json({ configured: false, prices: [] });
  }

  try {
    const stripe = new Stripe(secret, {
      apiVersion: '2025-03-31.basil',
      httpClient: Stripe.createFetchHttpClient(),
    });

    const { data } = await stripe.prices.list({
      lookup_keys: LOOKUP_KEYS,
      active: true,
      expand: ['data.product'],
    });

    const prices = data
      .filter((p) => p.lookup_key)
      .map((p) => {
        const [tier, interval] = (p.lookup_key as string).split('_');
        return {
          tier,
          interval,                 // 'monthly' | 'annual'
          lookupKey: p.lookup_key,
          priceId: p.id,
          unitAmount: p.unit_amount, // cents, may be null for metered
          currency: p.currency,
        };
      });

    return json({ configured: true, prices });
  } catch (e) {
    console.error('stripe-prices error', e);
    // Configured but errored — let the client fall back gracefully.
    return json({ configured: false, prices: [] });
  }
});
