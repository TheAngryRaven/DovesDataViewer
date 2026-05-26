// Stripe webhook — the ONLY thing that grants/revokes a tier. Verifies the
// Stripe signature, then mirrors the subscription state into user_subscriptions
// using the service role. Must be deployed with verify_jwt = false (Stripe does
// not send a Supabase JWT) — auth is the signature check instead.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2025-03-31.basil',
  httpClient: Stripe.createFetchHttpClient(),
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();

const admin = (): SupabaseClient => createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// Map a Stripe Price id → our tier slug (falls back to 'free' if unknown).
async function tierForPrice(db: SupabaseClient, priceId: string | undefined): Promise<string> {
  if (!priceId) return 'free';
  const { data } = await db
    .from('subscription_tiers')
    .select('tier')
    .eq('stripe_price_id', priceId)
    .maybeSingle();
  return data?.tier ?? 'free';
}

// Resolve our user_id for a subscription: prefer the metadata we stamped at
// checkout, else look up by Stripe customer id.
async function resolveUserId(
  db: SupabaseClient,
  sub: Stripe.Subscription,
): Promise<string | null> {
  const metaId = sub.metadata?.user_id;
  if (metaId) return metaId;
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  if (!customerId) return null;
  const { data } = await db
    .from('user_subscriptions')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  return data?.user_id ?? null;
}

// current_period_end moved onto subscription items in recent API versions;
// fall back across both shapes.
function periodEnd(sub: Stripe.Subscription): string | null {
  const item = sub.items?.data?.[0] as (Stripe.SubscriptionItem & { current_period_end?: number }) | undefined;
  const ts = item?.current_period_end
    ?? (sub as unknown as { current_period_end?: number }).current_period_end;
  return typeof ts === 'number' ? new Date(ts * 1000).toISOString() : null;
}

async function applySubscription(
  db: SupabaseClient,
  sub: Stripe.Subscription,
  opts: { deleted?: boolean } = {},
): Promise<void> {
  const userId = await resolveUserId(db, sub);
  if (!userId) {
    console.error('stripe-webhook: no user for subscription', sub.id);
    return;
  }

  const priceId = sub.items?.data?.[0]?.price?.id;
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  const tier = opts.deleted ? 'free' : await tierForPrice(db, priceId);
  const status = opts.deleted ? 'canceled' : sub.status;

  await db.from('user_subscriptions').upsert({
    user_id: userId,
    tier,
    status,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    current_period_end: periodEnd(sub),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
}

Deno.serve(async (req) => {
  const sig = req.headers.get('stripe-signature');
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  const body = await req.text();
  if (!sig || !secret) {
    return new Response('Missing signature', { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, secret, undefined, cryptoProvider);
  } catch (e) {
    console.error('stripe-webhook: signature verification failed', e);
    return new Response('Invalid signature', { status: 400 });
  }

  try {
    const db = admin();
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const subId = typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription?.id;
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          await applySubscription(db, sub);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await applySubscription(db, event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await applySubscription(db, event.data.object as Stripe.Subscription, { deleted: true });
        break;
    }
  } catch (e) {
    console.error('stripe-webhook: handler error', e);
    return new Response('Handler error', { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
});
