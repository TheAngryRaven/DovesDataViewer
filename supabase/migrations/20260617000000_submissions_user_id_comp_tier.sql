-- Track submissions: attribute to a signed-in user, + admin-comped tiers.
--
-- Two related changes:
--
--   1. submissions.submitted_by_user_id — when a logged-in user contributes
--      tracks, the submit-track edge function records who they are (derived from
--      their verified JWT, never a client-supplied id). Anonymous submissions
--      stay supported (the column is NULL). This lets an admin see who sent a
--      contribution and reward contributors with comped storage.
--
--   2. user_tier() becomes comp-expiry aware. Admins can grant a user free
--      months of a paid tier by writing a user_subscriptions row directly (no
--      Stripe). Those comp rows have no stripe_subscription_id, so — unlike a
--      Stripe-managed sub whose status is the source of truth — they must expire
--      at current_period_end. Stripe-backed rows are untouched (status-only, as
--      before), so paying users see no behavioural change.

-- ── 1. Submitter attribution ────────────────────────────────────────────────
alter table public.submissions
  add column if not exists submitted_by_user_id uuid references auth.users(id) on delete set null;

create index if not exists submissions_submitted_by_user_id_idx
  on public.submissions (submitted_by_user_id);

comment on column public.submissions.submitted_by_user_id is
  'The signed-in user who submitted this contribution (derived from their JWT by the submit-track edge function). NULL for anonymous submissions.';

-- ── 2. Comp-aware tier resolution ───────────────────────────────────────────
-- Effective tier: a row grants its tier while status allows access AND, for
-- comp rows (no Stripe subscription), only until current_period_end passes.
-- Stripe-managed rows (stripe_subscription_id set) keep status-only semantics.
create or replace function public.user_tier(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select tier from public.user_subscriptions
      where user_id = p_user
        and status in ('active','trialing','past_due')
        and (
          stripe_subscription_id is not null   -- Stripe-managed: status is source of truth
          or current_period_end is null        -- open-ended comp
          or current_period_end > now()        -- comp still within its granted window
        )
     order by current_period_end desc nulls first
     limit 1),
    'free');
$$;

grant execute on function public.user_tier(uuid) to authenticated;

-- Surface the new column + function to PostgREST immediately.
notify pgrst, 'reload schema';
