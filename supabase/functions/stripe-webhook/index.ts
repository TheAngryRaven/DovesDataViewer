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

// 60-day window after a subscription ends before logs are trimmed to free.
const GRACE_DAYS = 60;

// Resolve our tier slug + billing interval from a price. Prices carry a
// lookup_key of "{tier}_{interval}" (e.g. "pro_annual"); fall back to the
// subscription_tiers.stripe_price_id mapping, then to free/null.
async function tierForPrice(
  db: SupabaseClient,
  price: Stripe.Price | undefined,
): Promise<{ tier: string; interval: string | null }> {
  if (!price) return { tier: 'free', interval: null };
  // The price nested in a webhook payload can arrive without lookup_key (a thin
  // object). Re-fetch the full price before falling back, so we never misresolve
  // an active paid subscription down to free just because the field was missing.
  let resolved = price;
  if (!resolved.lookup_key && resolved.id) {
    try {
      resolved = await stripe.prices.retrieve(resolved.id);
    } catch (e) {
      console.error('stripe-webhook: failed to retrieve price', resolved.id, e);
    }
  }
  if (resolved.lookup_key) {
    const [tier, interval] = resolved.lookup_key.split('_');
    if (tier) return { tier, interval: interval ?? null };
  }
  const intervalFromRecurring = resolved.recurring?.interval === 'year' ? 'annual' : 'monthly';
  const { data } = await db
    .from('subscription_tiers')
    .select('tier')
    .eq('stripe_price_id', resolved.id)
    .maybeSingle();
  return { tier: data?.tier ?? 'free', interval: data ? intervalFromRecurring : null };
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

const ENTITLING_STATUSES = ['active', 'trialing', 'past_due'];

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

  const price = sub.items?.data?.[0]?.price;
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  const status = opts.deleted ? 'canceled' : sub.status;
  const entitled = !opts.deleted && ENTITLING_STATUSES.includes(status);

  const { data: existing } = await db
    .from('user_subscriptions')
    .select('tier, grace_until, stripe_subscription_id')
    .eq('user_id', userId)
    .maybeSingle();

  // Out-of-order protection: Stripe gives no cross-object ordering guarantee, so
  // a delete for an OLD subscription can arrive after the user already moved to a
  // newer one (e.g. plus canceled, pro active). Only honour a deletion for the
  // subscription we currently track; a delete for a superseded sub is ignored so
  // it can't demote the active entitlement.
  if (
    opts.deleted &&
    existing?.stripe_subscription_id &&
    existing.stripe_subscription_id !== sub.id
  ) {
    console.log(
      'stripe-webhook: ignoring delete for superseded subscription',
      sub.id, '(current:', existing.stripe_subscription_id, ')',
    );
    return;
  }

  const resolved = await tierForPrice(db, price);
  let tier = entitled ? resolved.tier : 'free';
  // Safety net: an entitling Stripe status (active/trialing/past_due) must never
  // land on the free tier — that silently strips a paying customer's plan (e.g.
  // the symptom seen when un-cancelling: Stripe says subscribed, app says free).
  // If price resolution still came back empty, keep the paid tier we already had.
  if (entitled && tier === 'free' && existing?.tier && existing.tier !== 'free') {
    console.warn(
      'stripe-webhook: entitling subscription resolved to free; keeping existing tier',
      existing.tier, sub.id,
    );
    tier = existing.tier;
  }
  const endsAt = periodEnd(sub);

  // Cancellation grace: once the subscription stops entitling access, keep the
  // user's logs for GRACE_DAYS so they can re-subscribe / download. We only
  // *set* grace_until on the transition (don't keep pushing it later on repeat
  // webhooks), and clear it — plus re-arm logs_trimmed_at — when access resumes.
  let graceUntil: string | null | undefined;
  let logsTrimmedAt: string | null | undefined;
  if (entitled) {
    graceUntil = null;
    logsTrimmedAt = null;
  } else {
    if (existing?.grace_until) {
      graceUntil = undefined; // leave the already-set deadline untouched
    } else {
      const base = endsAt ? new Date(endsAt) : new Date();
      graceUntil = new Date(base.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    }
  }

  const row: Record<string, unknown> = {
    user_id: userId,
    tier,
    status,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    current_period_end: endsAt,
    cancel_at_period_end: !!sub.cancel_at_period_end,
    billing_interval: entitled ? resolved.interval : null,
    updated_at: new Date().toISOString(),
  };
  if (graceUntil !== undefined) row.grace_until = graceUntil;
  if (logsTrimmedAt !== undefined) row.logs_trimmed_at = logsTrimmedAt;

  await db.from('user_subscriptions').upsert(row, { onConflict: 'user_id' });
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

  const db = admin();

  // Idempotency: claim this event.id before processing. A unique violation means
  // Stripe already delivered it (retry/replay) — acknowledge and skip so we
  // don't re-apply (and possibly demote) subscription state.
  const { error: claimErr } = await db
    .from('stripe_events')
    .insert({ id: event.id, type: event.type });
  if (claimErr) {
    if (claimErr.code === '23505') {
      return new Response(JSON.stringify({ received: true, duplicate: true }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    // Couldn't record the claim for another reason — log and continue processing
    // (better to risk a rare reprocess than to drop the event entirely).
    console.error('stripe-webhook: failed to record event id', event.id, claimErr);
  }

  try {
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
    // Release the claim so Stripe's retry can reprocess this event.
    try {
      await db.from('stripe_events').delete().eq('id', event.id);
    } catch (relErr) {
      console.error('stripe-webhook: failed to release event claim', event.id, relErr);
    }
    return new Response('Handler error', { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
});
