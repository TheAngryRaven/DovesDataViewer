// Returns a Stripe Billing Portal URL so the user can manage / cancel / change
// their subscription on Stripe-hosted pages (no billing UI to build or maintain).
// An optional `flow: "update"` deep-links into the change-plan screen.
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

    const authClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await authClient.auth.getUser();
    if (userErr || !user) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const { returnUrl, flow } = await req.json().catch(() => ({}));

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: sub } = await admin
      .from('user_subscriptions')
      .select('stripe_customer_id, stripe_subscription_id, status')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!sub?.stripe_customer_id) {
      return json({ error: 'No billing account' }, 400);
    }

    const base = (typeof returnUrl === 'string' && returnUrl) || req.headers.get('origin') || undefined;

    // "Change plan" deep-links straight into the subscription-update flow instead
    // of the generic portal home. Only valid with an active subscription to
    // update; otherwise we fall back to the generic portal.
    const ENTITLING = ['active', 'trialing', 'past_due'];
    const wantUpdate =
      flow === 'update' && sub.stripe_subscription_id && ENTITLING.includes(sub.status ?? '');

    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: base,
      ...(wantUpdate
        ? {
            flow_data: {
              type: 'subscription_update',
              subscription_update: { subscription: sub.stripe_subscription_id as string },
            },
          }
        : {}),
    });

    return json({ url: session.url });
  } catch (e) {
    console.error('create-portal-session error', e);
    return json({ error: 'Internal error' }, 500);
  }
});
