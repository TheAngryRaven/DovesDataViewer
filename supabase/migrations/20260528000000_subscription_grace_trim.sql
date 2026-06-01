-- Cancellation grace window + log trimming.
--
-- When a paid subscription is cancelled it ends at the period boundary (Stripe
-- fires customer.subscription.deleted then). At that point the user drops to the
-- free tier's *limits* immediately (user_tier() already returns 'free' for any
-- non-active status), but their existing cloud logs are kept for a 60-day grace
-- so they can re-subscribe (or download everything) before anything is removed.
-- After the grace expires, trim_expired_logs() deletes their synced log files
-- newest-first until they fit the free tier's logs_bytes allowance.
--
-- New user_subscriptions columns track the cancellation state the webhook needs:
--   • cancel_at_period_end — Stripe flag: cancels at the next renewal.
--   • billing_interval     — 'monthly' | 'annual' (from the price lookup_key).
--   • grace_until          — when the 60-day window closes (set on cancellation).
--   • logs_trimmed_at      — last time trim_expired_logs() ran for this user, so
--                            a re-subscribe + re-cancel re-arms the trim.

alter table public.user_subscriptions
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists billing_interval     text,
  add column if not exists grace_until           timestamptz,
  add column if not exists logs_trimmed_at        timestamptz;

-- ── encodeURIComponent() parity ──────────────────────────────────────────────
-- File blobs live in the user-files bucket at "{user_id}/{encodeURIComponent(name)}"
-- (see cloud-sync syncEngine.blobPath). To delete the right storage object from
-- SQL we must reproduce JS encodeURIComponent exactly: keep the unreserved set
-- (A-Z a-z 0-9 - _ . ! ~ * ' ( )) and percent-encode every other UTF-8 byte as
-- uppercase %XX.
create or replace function public.encode_uri_component(p_text text)
returns text language plpgsql immutable set search_path = public as $$
declare
  v_bytes bytea := convert_to(coalesce(p_text, ''), 'UTF8');
  v_out   text  := '';
  v_byte  int;
  i       int;
begin
  for i in 0 .. length(v_bytes) - 1 loop
    v_byte := get_byte(v_bytes, i);
    if (v_byte between 48 and 57)        -- 0-9
       or (v_byte between 65 and 90)     -- A-Z
       or (v_byte between 97 and 122)    -- a-z
       or v_byte in (45, 95, 46, 33, 126, 42, 39, 40, 41)  -- - _ . ! ~ * ' ( )
    then
      v_out := v_out || chr(v_byte);
    else
      v_out := v_out || '%' || upper(lpad(to_hex(v_byte), 2, '0'));
    end if;
  end loop;
  return v_out;
end;
$$;

-- ── Trim expired-grace users' logs to the free allowance ─────────────────────
-- For every user whose subscription no longer grants access and whose grace has
-- expired (and who hasn't already been trimmed for this grace window), delete
-- their synced log files newest-first until the cumulative size of the kept
-- (oldest) files fits the free tier's logs_bytes. Both the index row and the
-- bucket object are removed. SECURITY DEFINER so it can cross RLS + storage;
-- intentionally NOT granted to authenticated — only the scheduled job / service
-- role runs it.
create or replace function public.trim_expired_logs()
returns integer language plpgsql security definer set search_path = public, storage as $$
declare
  v_free_limit bigint;
  v_user       uuid;
  v_deleted    int := 0;
  r            record;
begin
  select logs_bytes into v_free_limit from public.subscription_tiers where tier = 'free';
  if v_free_limit is null then
    return 0;
  end if;

  for v_user in
    select user_id
      from public.user_subscriptions
     where status not in ('active', 'trialing', 'past_due')
       and grace_until is not null
       and grace_until < now()
       and (logs_trimmed_at is null or logs_trimmed_at < grace_until)
  loop
    for r in
      with ranked as (
        select id, record_key,
               sum(public.sync_record_size(store, data)) over (
                 order by updated_at asc, id asc
                 rows between unbounded preceding and current row
               ) as cum
          from public.sync_records
         where user_id = v_user
           and public.sync_storage_type(store) = 'logs'
      )
      select id, record_key from ranked where cum > v_free_limit
    loop
      delete from storage.objects
       where bucket_id = 'user-files'
         and name = v_user::text || '/' || public.encode_uri_component(r.record_key);
      delete from public.sync_records where id = r.id;
      v_deleted := v_deleted + 1;
    end loop;

    update public.user_subscriptions
       set logs_trimmed_at = now()
     where user_id = v_user;
  end loop;

  return v_deleted;
end;
$$;

-- ── Daily schedule via pg_cron ───────────────────────────────────────────────
-- Guarded: if pg_cron isn't enabled on the project the migration still succeeds;
-- enable the extension (Dashboard → Database → Extensions) and re-run the
-- schedule block, or invoke trim_expired_logs() from an external scheduler.
do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron unavailable (%); schedule public.trim_expired_logs() manually.', sqlerrm;
end $$;

do $$
begin
  perform cron.unschedule('trim-expired-logs');
exception when others then
  null; -- no existing job (or pg_cron absent) — nothing to remove
end $$;

do $$
begin
  perform cron.schedule('trim-expired-logs', '0 3 * * *', 'select public.trim_expired_logs();');
exception when others then
  raise notice 'Could not schedule trim-expired-logs (%); run it from an external scheduler.', sqlerrm;
end $$;
