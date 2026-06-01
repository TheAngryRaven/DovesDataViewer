-- Stripe webhook idempotency / replay protection.
--
-- Stripe retries deliveries and makes NO ordering guarantee across objects, so
-- the webhook can see the same event twice, or a stale
-- `customer.subscription.deleted` for an OLD subscription arrive after a newer
-- `customer.subscription.updated`. Without a dedup record, a replayed or
-- out-of-order event re-runs applySubscription and can demote an active
-- entitlement (tier→free) or double-apply state.
--
-- This table records each processed event.id. The webhook claims the id before
-- processing (unique-violation ⇒ already handled ⇒ skip) and releases the claim
-- if processing fails, so failed events can still be retried. Service-role only
-- (RLS on, no policies ⇒ no client access; the service role bypasses RLS).
create table if not exists public.stripe_events (
  id          text primary key,
  type        text not null,
  received_at timestamptz not null default now()
);

alter table public.stripe_events enable row level security;

grant all on public.stripe_events to service_role;

notify pgrst, 'reload schema';
