-- Make admin comps expire like a cancelled subscription: a grace window, then
-- the existing log-trim job reclaims over-limit logs.
--
-- Problem: comps are user_subscriptions rows with status='active' and no
-- stripe_subscription_id; user_tier() already drops them to 'free' once
-- current_period_end passes. But trim_expired_logs() selected users by raw
-- status ("not in active/trialing/past_due"), so a lapsed comp — still
-- status='active' — was never trimmed, and its grace_until was never set.
--
-- Fix, two parts:
--   1. Gate the trim on the EFFECTIVE tier (user_tier()='free') instead of raw
--      status. This is identical for every Stripe case (active → paid → excluded;
--      cancelled → free → included) and additionally catches lapsed comps.
--   2. grant_premium (admin-users edge fn) now stamps grace_until =
--      current_period_end + 60 days, so a comp gets the same 60-day grace as a
--      cancelled Stripe sub. Backfill existing comp rows here.

-- ── 1. Trim by effective tier (re-create with one predicate changed) ─────────
create or replace function public.trim_expired_logs()
returns integer language plpgsql security definer set search_path = public, storage as $$
declare
  v_free_total bigint;
  v_user       uuid;
  v_logs       bigint;
  v_nonlog     bigint;
  v_allowance  bigint;
  v_deleted    int := 0;
  r            record;
begin
  select total_bytes into v_free_total from public.subscription_tiers where tier = 'free';
  if v_free_total is null then return 0; end if;

  for v_user in
    select user_id
      from public.user_subscriptions
     where public.user_tier(user_id) = 'free'   -- effective free: Stripe-cancelled OR lapsed comp
       and grace_until is not null
       and grace_until < now()
       and (logs_trimmed_at is null or logs_trimmed_at < grace_until)
  loop
    -- Split the pool: logs (trimmable) vs everything else (docs + snapshots, kept).
    select coalesce(sum(public.sync_record_size(store, data)), 0)
      into v_logs
      from public.sync_records
     where user_id = v_user and public.sync_storage_type(store) = 'logs';
    v_nonlog := public.total_storage_used(v_user) - v_logs;

    -- How many log bytes may remain so the POOLED total fits the free budget. If the
    -- kept data alone already exceeds it, deleting logs is futile → allowance 0 only
    -- when that headroom is gone; otherwise keep the oldest logs up to the headroom.
    v_allowance := greatest(0, v_free_total - v_nonlog);

    -- Skip the (futile, destructive) full wipe when logs can't get the pool under.
    if v_nonlog < v_free_total then
      for r in
        select record_key, data
          from public.sync_records
         where user_id = v_user
           and public.sync_storage_type(store) = 'logs'
         order by updated_at desc, record_key desc
      loop
        exit when v_logs <= v_allowance;
        delete from storage.objects
         where bucket_id = 'user-files'
           and name = v_user::text || '/' || public.encode_uri_component(r.record_key);
        delete from public.sync_records
         where user_id = v_user and store = 'files' and record_key = r.record_key;
        v_logs := v_logs - public.sync_record_size('files', r.data);
        v_deleted := v_deleted + 1;
      end loop;
    end if;

    update public.user_subscriptions set logs_trimmed_at = now() where user_id = v_user;
  end loop;

  return v_deleted;
end;
$$;

-- ── 2. Backfill grace for any comp rows granted before this change ───────────
-- A comp = a paid tier with no Stripe subscription. Give it the standard 60-day
-- grace measured from when its premium access ends (current_period_end).
update public.user_subscriptions
   set grace_until = current_period_end + interval '60 days'
 where stripe_subscription_id is null
   and tier <> 'free'
   and current_period_end is not null
   and grace_until is null;
