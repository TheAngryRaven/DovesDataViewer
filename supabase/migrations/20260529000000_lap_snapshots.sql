-- Lap snapshots: frozen "course fastest lap" captures, count-quota'd by tier.
--
-- A NEW cloud data type (NOT byte document storage). Snapshots are chunky single
-- laps that power cross-session comparison and future AI coaching, so they get
-- their own table and a per-tier COUNT limit (free 5 / plus 10 / premium 20 /
-- pro 50) rather than counting against the documents byte quota.
--
-- Sync model (mirrored client-side): snapshots always push on save, but a local
-- delete never propagates — the cloud copy is removed only explicitly (profile
-- page). One row per (user, course, engine): a faster lap upserts in place and
-- never increases the count.

-- ── Table ────────────────────────────────────────────────────────────────────
create table if not exists public.lap_snapshots (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  course_key  text not null,
  engine_key  text not null,
  data        jsonb not null,
  updated_at  timestamptz not null default now(),
  unique (user_id, course_key, engine_key)
);

create index if not exists lap_snapshots_user_idx on public.lap_snapshots (user_id);

alter table public.lap_snapshots enable row level security;

drop policy if exists "Users read own snapshots"   on public.lap_snapshots;
drop policy if exists "Users insert own snapshots"  on public.lap_snapshots;
drop policy if exists "Users update own snapshots"  on public.lap_snapshots;
drop policy if exists "Users delete own snapshots"  on public.lap_snapshots;

create policy "Users read own snapshots"
  on public.lap_snapshots for select to authenticated using (auth.uid() = user_id);
create policy "Users insert own snapshots"
  on public.lap_snapshots for insert to authenticated with check (auth.uid() = user_id);
create policy "Users update own snapshots"
  on public.lap_snapshots for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users delete own snapshots"
  on public.lap_snapshots for delete to authenticated using (auth.uid() = user_id);

-- ── Per-tier snapshot COUNT limit (data-driven, like the byte limits) ────────
alter table public.subscription_tiers
  add column if not exists snapshot_count integer not null default 5;

update public.subscription_tiers set snapshot_count = 5  where tier = 'free';
update public.subscription_tiers set snapshot_count = 10 where tier = 'plus';
update public.subscription_tiers set snapshot_count = 20 where tier = 'premium';
update public.subscription_tiers set snapshot_count = 50 where tier = 'pro';

-- The snapshot count limit for a user, from their effective tier (falls back to
-- free, then to a hard default). SECURITY DEFINER so the trigger can resolve it.
create or replace function public.snapshot_limit(p_user uuid)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(
    (select t.snapshot_count from public.subscription_tiers t where t.tier = public.user_tier(p_user)),
    (select t.snapshot_count from public.subscription_tiers t where t.tier = 'free'),
    5);
$$;
grant execute on function public.snapshot_limit(uuid) to authenticated;

-- ── Count-quota enforcement ──────────────────────────────────────────────────
-- Fires BEFORE INSERT. An upsert that replaces an existing (user, course, engine)
-- row keeps the count, so we exclude that row from the tally — only genuinely new
-- combinations can be blocked.
create or replace function public.enforce_snapshot_quota()
returns trigger language plpgsql as $$
declare
  v_limit integer := public.snapshot_limit(NEW.user_id);
  v_count integer;
begin
  if v_limit is null then
    return NEW;
  end if;

  select count(*) into v_count
    from public.lap_snapshots
   where user_id = NEW.user_id
     and not (course_key = NEW.course_key and engine_key = NEW.engine_key);

  if v_count >= v_limit then
    raise exception 'snapshot_quota_exceeded: % snapshots used >= % limit', v_count, v_limit
      using errcode = 'check_violation';
  end if;

  return NEW;
end;
$$;

drop trigger if exists lap_snapshots_quota on public.lap_snapshots;
create trigger lap_snapshots_quota
  before insert on public.lap_snapshots
  for each row execute function public.enforce_snapshot_quota();

-- Keep updated_at fresh on every write.
create or replace function public.touch_lap_snapshot()
returns trigger language plpgsql as $$
begin
  NEW.updated_at = now();
  return NEW;
end;
$$;

drop trigger if exists lap_snapshots_touch on public.lap_snapshots;
create trigger lap_snapshots_touch
  before insert or update on public.lap_snapshots
  for each row execute function public.touch_lap_snapshot();

-- ── Usage readout for the profile meter ──────────────────────────────────────
create or replace function public.snapshot_usage()
returns table(used_count integer, limit_count integer)
language sql stable as $$
  select (select count(*)::integer from public.lap_snapshots where user_id = auth.uid()),
         public.snapshot_limit(auth.uid());
$$;
grant execute on function public.snapshot_usage() to authenticated;
