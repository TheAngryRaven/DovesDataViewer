-- Subscription tiers + Stripe-backed user subscriptions.
--
-- Builds on storage_quotas: that migration enforced two storage *types*
-- (documents / logs) against a single global quota_limits table. This one makes
-- the *limit* depend on the user's subscription tier:
--
--   • subscription_tiers  — one row per plan (free / plus / pro) with its per-type
--     byte limits, price, and Stripe price id. Limits are now DATA: changing a
--     plan's storage or price is an UPDATE here, not a code change.
--   • user_subscriptions  — one row per user mapping them to a tier, plus the
--     Stripe customer/subscription ids + status. Written ONLY by the service role
--     (the stripe-webhook edge function) — users can read their own row but can
--     never grant themselves a tier.
--
-- The enforce_sync_quota trigger + sync_storage_usage() now resolve the caller's
-- tier limit (falling back to free, then to quota_limits) instead of reading the
-- global table directly. quota_limits remains the ultimate baseline/fallback.

-- ── Tiers (data-driven plan catalogue) ──────────────────────────────────────
create table if not exists public.subscription_tiers (
  tier            text primary key,
  label           text   not null,
  price_cents     integer not null default 0,
  logs_bytes      bigint not null,
  doc_bytes       bigint not null,
  ai_credits      integer not null default 0,
  stripe_price_id text,                      -- null for free; set after creating the Stripe Price
  sort_order      integer not null default 0
);

insert into public.subscription_tiers
  (tier,   label,  price_cents, logs_bytes,  doc_bytes, ai_credits, sort_order) values
  ('free', 'Free',           0,   20971520,    5242880,          0, 0),  --  20 MB logs / 5 MB docs
  ('plus', 'Plus',         100,  524288000,    5242880,          0, 1),  -- 500 MB logs / 5 MB docs
  ('pro',  'Pro',         1000, 1073741824,    5242880,          0, 2)   --   1 GB logs / 5 MB docs
on conflict (tier) do update set
  label       = excluded.label,
  price_cents = excluded.price_cents,
  logs_bytes  = excluded.logs_bytes,
  doc_bytes   = excluded.doc_bytes,
  ai_credits  = excluded.ai_credits,
  sort_order  = excluded.sort_order;

alter table public.subscription_tiers enable row level security;

drop policy if exists "Anyone authenticated reads tiers" on public.subscription_tiers;
create policy "Anyone authenticated reads tiers"
  on public.subscription_tiers for select to authenticated
  using (true);

-- ── Per-user subscription state (service-role-written) ──────────────────────
create table if not exists public.user_subscriptions (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  tier                   text not null default 'free' references public.subscription_tiers(tier),
  status                 text not null default 'active',  -- Stripe subscription.status
  stripe_customer_id     text,
  stripe_subscription_id text,
  current_period_end     timestamptz,
  updated_at             timestamptz not null default now()
);

create index if not exists user_subscriptions_customer_idx
  on public.user_subscriptions (stripe_customer_id);

alter table public.user_subscriptions enable row level security;

-- Users may read their own row. No insert/update/delete policies exist, so only
-- the service role (which bypasses RLS) can write — i.e. the stripe-webhook fn.
drop policy if exists "Users read own subscription" on public.user_subscriptions;
create policy "Users read own subscription"
  on public.user_subscriptions for select to authenticated
  using (auth.uid() = user_id);

-- ── Tier resolution helpers ─────────────────────────────────────────────────
-- The effective tier for a user: their subscription tier when the status grants
-- access (active / trialing / past_due grace), else 'free'. SECURITY DEFINER so
-- the quota trigger can resolve any row's tier regardless of RLS.
create or replace function public.user_tier(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select s.tier
       from public.user_subscriptions s
      where s.user_id = p_user
        and s.status in ('active', 'trialing', 'past_due')),
    'free');
$$;

-- The byte limit for a given user + storage type, from their effective tier.
-- Falls back to the free tier, then to the legacy quota_limits baseline.
create or replace function public.tier_limit(p_user uuid, p_type text)
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case when p_type = 'logs' then t.logs_bytes else t.doc_bytes end
       from public.subscription_tiers t
      where t.tier = public.user_tier(p_user)),
    (select case when p_type = 'logs' then t.logs_bytes else t.doc_bytes end
       from public.subscription_tiers t
      where t.tier = 'free'),
    (select max_bytes from public.quota_limits where storage_type = p_type));
$$;

grant execute on function public.user_tier(uuid)  to authenticated;
grant execute on function public.tier_limit(uuid, text) to authenticated;

-- ── Quota enforcement: now tier-aware ───────────────────────────────────────
create or replace function public.enforce_sync_quota()
returns trigger language plpgsql as $$
declare
  v_type  text   := public.sync_storage_type(NEW.store);
  v_limit bigint := public.tier_limit(NEW.user_id, v_type);
  v_used  bigint;
  v_new   bigint := public.sync_record_size(NEW.store, NEW.data);
begin
  if v_limit is null then
    return NEW; -- no limit configured for this type
  end if;

  -- Current usage for this type, excluding the row being upserted.
  select coalesce(sum(public.sync_record_size(store, data)), 0)
    into v_used
    from public.sync_records
   where user_id = NEW.user_id
     and public.sync_storage_type(store) = v_type
     and not (store = NEW.store and record_key = NEW.record_key);

  if v_used + v_new > v_limit then
    raise exception
      'quota_exceeded: % storage over limit (% bytes used + % new > % limit)',
      v_type, v_used, v_new, v_limit
      using errcode = 'check_violation';
  end if;

  return NEW;
end;
$$;

-- (trigger sync_records_quota already bound to this function in storage_quotas)

-- ── Usage readout: limits now reflect the caller's tier ─────────────────────
create or replace function public.sync_storage_usage()
returns table(storage_type text, used_bytes bigint, limit_bytes bigint)
language sql stable as $$
  select t.storage_type,
         coalesce((
           select sum(public.sync_record_size(r.store, r.data))
             from public.sync_records r
            where r.user_id = auth.uid()
              and public.sync_storage_type(r.store) = t.storage_type
         ), 0)::bigint,
         public.tier_limit(auth.uid(), t.storage_type)
    from (values ('documents'), ('logs')) as t(storage_type);
$$;

grant execute on function public.sync_storage_usage() to authenticated;
