-- Unified cloud-storage quota: ONE pooled byte budget per tier.
--
-- Supersedes the previous split model — two byte quotas (documents / logs) plus a
-- separate snapshot COUNT quota — with a single per-tier byte limit that ALL three
-- data kinds draw from:
--
--     documents (sync_records, non-files)
--   + logs      (sync_records, files — counted by their index row's size)
--   + snapshots (lap_snapshots, counted by serialized jsonb length)
--   ────────────────────────────────────────────────────────────────────
--   ≤ subscription_tiers.total_bytes   (free 50 MB / plus 10 GB / premium 100 GB / pro 500 GB)
--
-- `subscription_tiers.total_bytes` becomes the single source of truth for capacity.
-- The legacy per-type columns (logs_bytes / doc_bytes), the snapshot_count column,
-- and the quota_limits baseline table are all removed, along with the helper
-- functions that read them.
--
-- This migration is idempotent + self-healing and ordered last, so it overrides the
-- function/column drift left by the earlier hand-written + Lovable-batch migrations.
-- ORDERING NOTE: every function below is redefined to stop referencing the old
-- columns / quota_limits BEFORE those objects are dropped at the end (SQL-language
-- function bodies are validated at creation time).

-- ── 1. Single capacity column (data-driven, the one source of truth) ──────────
alter table public.subscription_tiers
  add column if not exists total_bytes bigint;

update public.subscription_tiers set total_bytes =     52428800 where tier = 'free';     --  50 MB
update public.subscription_tiers set total_bytes =  10737418240 where tier = 'plus';     --  10 GB
update public.subscription_tiers set total_bytes = 107374182400 where tier = 'premium';  -- 100 GB
update public.subscription_tiers set total_bytes = 536870912000 where tier = 'pro';      -- 500 GB
-- Backfill any unknown/custom tier rows so NOT NULL can be enforced (free baseline).
update public.subscription_tiers set total_bytes = 52428800 where total_bytes is null;

alter table public.subscription_tiers alter column total_bytes set not null;

-- ── 2. Pooled-usage + limit helpers ──────────────────────────────────────────
-- Total bytes a user occupies across BOTH backing tables. SECURITY DEFINER so the
-- count is exact regardless of the calling RLS context (the quota triggers + the
-- usage RPC rely on it).
create or replace function public.total_storage_used(p_user uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select
      coalesce((select sum(public.sync_record_size(store, data))
                  from public.sync_records where user_id = p_user), 0)
    + coalesce((select sum(octet_length(data::text))
                  from public.lap_snapshots where user_id = p_user), 0);
$$;
grant execute on function public.total_storage_used(uuid) to authenticated;

-- The single pooled byte limit for a user, from their effective tier. Falls back to
-- the free tier, then to a hard 50 MB default.
create or replace function public.tier_total_limit(p_user uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(
    (select total_bytes from public.subscription_tiers where tier = public.user_tier(p_user)),
    (select total_bytes from public.subscription_tiers where tier = 'free'),
    52428800);
$$;
grant execute on function public.tier_total_limit(uuid) to authenticated;

-- ── 3. Quota enforcement: sync_records (documents + logs) ─────────────────────
-- Rejects a write that would push the user's POOLED total (this table + all
-- lap_snapshots) over their tier limit. SECURITY DEFINER so the usage sum is exact.
-- The trigger sync_records_quota is already bound to this function name.
create or replace function public.enforce_sync_quota()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_limit bigint := public.tier_total_limit(NEW.user_id);
  v_new   bigint := public.sync_record_size(NEW.store, NEW.data);
  v_used  bigint;
begin
  if v_limit is null then return NEW; end if;

  -- Pooled usage, excluding the sync_records row being upserted (it's replaced).
  select
      coalesce((select sum(public.sync_record_size(store, data))
                  from public.sync_records
                 where user_id = NEW.user_id
                   and not (store = NEW.store and record_key = NEW.record_key)), 0)
    + coalesce((select sum(octet_length(data::text))
                  from public.lap_snapshots where user_id = NEW.user_id), 0)
    into v_used;

  if v_used + v_new > v_limit then
    raise exception 'quota_exceeded: storage over limit (% bytes used + % new > % limit)',
      v_used, v_new, v_limit using errcode = 'check_violation';
  end if;
  return NEW;
end;
$$;

-- ── 4. Quota enforcement: lap_snapshots (now BYTE-pooled, not a count) ─────────
-- Same pooled check, keyed off the snapshot payload size. Fires on INSERT *and*
-- UPDATE (a faster lap upserts in place and can change the payload size), excluding
-- the row being replaced — matched on the upsert conflict key (course_key, engine_key).
create or replace function public.enforce_snapshot_quota()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_limit bigint := public.tier_total_limit(NEW.user_id);
  v_new   bigint := octet_length(NEW.data::text);
  v_used  bigint;
begin
  if v_limit is null then return NEW; end if;

  select
      coalesce((select sum(public.sync_record_size(store, data))
                  from public.sync_records where user_id = NEW.user_id), 0)
    + coalesce((select sum(octet_length(data::text))
                  from public.lap_snapshots
                 where user_id = NEW.user_id
                   and not (course_key = NEW.course_key and engine_key = NEW.engine_key)), 0)
    into v_used;

  if v_used + v_new > v_limit then
    raise exception 'quota_exceeded: storage over limit (% bytes used + % new > % limit)',
      v_used, v_new, v_limit using errcode = 'check_violation';
  end if;
  return NEW;
end;
$$;

drop trigger if exists lap_snapshots_quota on public.lap_snapshots;
create trigger lap_snapshots_quota
  before insert or update on public.lap_snapshots
  for each row execute function public.enforce_snapshot_quota();

-- ── 5. Usage readout for the segmented meter ─────────────────────────────────
-- One row with the three segment sizes + the single pooled limit, for auth.uid().
-- Return type changes (was per-type rows), so drop before recreate.
drop function if exists public.sync_storage_usage();
create or replace function public.sync_storage_usage()
returns table(documents_bytes bigint, logs_bytes bigint, snapshots_bytes bigint, total_limit_bytes bigint)
language sql stable security definer set search_path = public as $$
  select
    coalesce((select sum(public.sync_record_size(store, data))
                from public.sync_records
               where user_id = auth.uid()
                 and public.sync_storage_type(store) = 'documents'), 0)::bigint,
    coalesce((select sum(public.sync_record_size(store, data))
                from public.sync_records
               where user_id = auth.uid()
                 and public.sync_storage_type(store) = 'logs'), 0)::bigint,
    coalesce((select sum(octet_length(data::text))
                from public.lap_snapshots where user_id = auth.uid()), 0)::bigint,
    public.tier_total_limit(auth.uid());
$$;
grant execute on function public.sync_storage_usage() to authenticated;

-- ── 6. Grace trim: target the free POOLED total, logs only ────────────────────
-- For a user past their grace window, delete their synced LOGS newest-first until
-- their pooled total (docs + remaining logs + snapshots) fits the free total_bytes,
-- keeping the OLDEST logs that fit. Snapshots + docs are never auto-deleted, so if
-- those alone already exceed the free total, trimming logs can't make the pool fit —
-- we skip rather than pointlessly wipe every log (the user stays over until they
-- free up snapshots/docs themselves). Return type changes (void -> integer), so drop
-- first. The existing pg_cron schedule keeps calling it by name.
drop function if exists public.trim_expired_logs();
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
     where status not in ('active', 'trialing', 'past_due')
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

-- ── 7. Drop the superseded per-type / count-quota machinery ───────────────────
-- (Done last: the functions above no longer reference any of these.)
drop function if exists public.tier_limit(uuid, text);
drop function if exists public.snapshot_limit(uuid);
drop function if exists public.tier_snapshot_count(uuid);
drop function if exists public.snapshot_usage();
drop function if exists public.enforce_lap_snapshot_quota();

alter table public.subscription_tiers
  drop column if exists logs_bytes,
  drop column if exists doc_bytes,
  drop column if exists snapshot_count;

-- quota_limits was the legacy per-type baseline; the pool makes it redundant.
-- DROP TABLE removes its RLS policies with it.
drop table if exists public.quota_limits;

-- Refresh PostgREST so the new sync_storage_usage() shape is served immediately.
notify pgrst, 'reload schema';
