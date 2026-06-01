-- Cloud sync: per-user storage of telemetry files + garage data.
--
-- Structured records (file metadata, vehicles/karts, setups, notes, graph prefs,
-- vehicle types, setup templates) are stored one row each in sync_records as a
-- jsonb document keyed by (user_id, store, record_key) — the same keys the
-- client's IndexedDB stores use. Raw session file blobs live in the private
-- user-files Storage bucket under {user_id}/. Everything is scoped to its owner
-- via RLS; there is no cross-user or public read path.

-- ── Structured records ──────────────────────────────────────────────────────
create table if not exists public.sync_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  store text not null,
  record_key text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  unique (user_id, store, record_key)
);

create index if not exists sync_records_user_store_idx
  on public.sync_records (user_id, store);

alter table public.sync_records enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='sync_records' and policyname='Users read own sync records') then
    create policy "Users read own sync records" on public.sync_records for select to authenticated using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='sync_records' and policyname='Users insert own sync records') then
    create policy "Users insert own sync records" on public.sync_records for insert to authenticated with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='sync_records' and policyname='Users update own sync records') then
    create policy "Users update own sync records" on public.sync_records for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='sync_records' and policyname='Users delete own sync records') then
    create policy "Users delete own sync records" on public.sync_records for delete to authenticated using (auth.uid() = user_id);
  end if;
end $$;

grant select, insert, update, delete on public.sync_records to authenticated;
grant all on public.sync_records to service_role;

-- ── Raw file blobs ──────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('user-files', 'user-files', false)
on conflict (id) do nothing;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Users read own files') then
    create policy "Users read own files" on storage.objects for select to authenticated using (bucket_id = 'user-files' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Users upload own files') then
    create policy "Users upload own files" on storage.objects for insert to authenticated with check (bucket_id = 'user-files' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Users update own files') then
    create policy "Users update own files" on storage.objects for update to authenticated using (bucket_id = 'user-files' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Users delete own files') then
    create policy "Users delete own files" on storage.objects for delete to authenticated using (bucket_id = 'user-files' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Storage quotas
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.quota_limits (
  storage_type text primary key,
  max_bytes bigint not null
);

insert into public.quota_limits (storage_type, max_bytes) values
  ('documents', 5242880),
  ('logs',     20971520)
on conflict (storage_type) do update set max_bytes = excluded.max_bytes;

alter table public.quota_limits enable row level security;
grant select on public.quota_limits to authenticated;
grant all on public.quota_limits to service_role;

drop policy if exists "Anyone authenticated reads limits" on public.quota_limits;
create policy "Anyone authenticated reads limits"
  on public.quota_limits for select to authenticated
  using (true);

create or replace function public.sync_record_size(p_store text, p_data jsonb)
returns bigint language sql immutable set search_path = public as $$
  select case
    when p_store = 'files' then coalesce((p_data->>'size')::bigint, 0)
    else octet_length(p_data::text)::bigint
  end;
$$;

create or replace function public.sync_storage_type(p_store text)
returns text language sql immutable set search_path = public as $$
  select case when p_store = 'files' then 'logs' else 'documents' end;
$$;

create or replace function public.enforce_sync_quota()
returns trigger language plpgsql set search_path = public as $$
declare
  v_type  text   := public.sync_storage_type(NEW.store);
  v_limit bigint;
  v_used  bigint;
  v_new   bigint := public.sync_record_size(NEW.store, NEW.data);
begin
  select max_bytes into v_limit from public.quota_limits where storage_type = v_type;
  if v_limit is null then return NEW; end if;
  select coalesce(sum(public.sync_record_size(store, data)), 0)
    into v_used
    from public.sync_records
   where user_id = NEW.user_id
     and public.sync_storage_type(store) = v_type
     and not (store = NEW.store and record_key = NEW.record_key);
  if v_used + v_new > v_limit then
    raise exception 'quota_exceeded: % storage over limit (% bytes used + % new > % limit)',
      v_type, v_used, v_new, v_limit using errcode = 'check_violation';
  end if;
  return NEW;
end;
$$;

drop trigger if exists sync_records_quota on public.sync_records;
create trigger sync_records_quota
  before insert or update on public.sync_records
  for each row execute function public.enforce_sync_quota();

create or replace function public.sync_storage_usage()
returns table(storage_type text, used_bytes bigint, limit_bytes bigint)
language sql stable set search_path = public as $$
  select q.storage_type,
         coalesce(sum(public.sync_record_size(r.store, r.data)), 0)::bigint,
         q.max_bytes
    from public.quota_limits q
    left join public.sync_records r
      on r.user_id = auth.uid()
     and public.sync_storage_type(r.store) = q.storage_type
   group by q.storage_type, q.max_bytes;
$$;

grant execute on function public.sync_storage_usage() to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- User profiles
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;

drop policy if exists "Profiles readable by authenticated" on public.profiles;
create policy "Profiles readable by authenticated" on public.profiles for select to authenticated using (true);
drop policy if exists "Users insert own profile" on public.profiles;
create policy "Users insert own profile" on public.profiles for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile" on public.profiles for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.random_display_name()
returns text language plpgsql set search_path = public as $$
declare
  adjs text[] := array['Speedy','Turbo','Drifty','Nitro','Reckless','Smooth','Apex','Sideways','Greasy','Loose','Sketchy','Mighty','Sneaky','Wobbly','Blazing','Rowdy','Janky','Cosmic','Feral','Zippy'];
  nouns text[] := array['Racer','Driver','Pilot','Hooligan','Throttle','Slider','Charger','Rocket','Gremlin','Goblin','Wrench','Piston','Sender','Drifter','Maniac','Comet','Bandit','Cheetah','Noodle','Menace'];
  candidate text;
begin
  loop
    candidate := adjs[1 + floor(random() * array_length(adjs, 1))::int]
      || replace(nouns[1 + floor(random() * array_length(nouns, 1))::int], 'e', '3')
      || '-' || (100 + floor(random() * 900))::int::text;
    exit when not exists (select 1 from public.profiles where display_name = candidate);
  end loop;
  return candidate;
end;
$$;

create or replace function public.unique_display_name(desired text)
returns text language plpgsql set search_path = public as $$
declare
  d text := nullif(btrim(coalesce(desired, '')), '');
  candidate text;
  tries int := 0;
begin
  if d is null then return public.random_display_name(); end if;
  candidate := d;
  while exists (select 1 from public.profiles where display_name = candidate) loop
    tries := tries + 1;
    candidate := d || '-' || (100 + floor(random() * 9900))::int::text;
    if tries > 50 then
      candidate := d || '-' || replace(gen_random_uuid()::text, '-', '');
      exit;
    end if;
  end loop;
  return candidate;
end;
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, public.unique_display_name(new.raw_user_meta_data->>'display_name'));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for existing users
insert into public.profiles (user_id, display_name)
select u.id, public.unique_display_name(u.raw_user_meta_data->>'display_name')
from auth.users u
left join public.profiles p on p.user_id = u.id
where p.user_id is null;

-- ═══════════════════════════════════════════════════════════════════════════
-- Stripe subscriptions
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.subscription_tiers (
  tier text primary key,
  label text not null,
  price_cents integer not null default 0,
  logs_bytes bigint not null,
  doc_bytes bigint not null,
  ai_credits integer not null default 0,
  stripe_price_id text,
  sort_order integer not null default 0
);

alter table public.subscription_tiers enable row level security;
grant select on public.subscription_tiers to authenticated, anon;
grant all on public.subscription_tiers to service_role;

drop policy if exists "Tiers readable by all" on public.subscription_tiers;
create policy "Tiers readable by all" on public.subscription_tiers for select using (true);

insert into public.subscription_tiers (tier, label, price_cents, logs_bytes, doc_bytes, ai_credits, sort_order) values
  ('free',    'Free',    0,    20971520,   5242880, 0,  0),
  ('plus',    'Plus',    100,  1572864000, 5242880, 0,  10),
  ('pro',     'Pro',     1000, 1073741824, 5242880, 100, 30)
on conflict (tier) do update set
  label = excluded.label,
  price_cents = excluded.price_cents,
  logs_bytes = excluded.logs_bytes,
  doc_bytes = excluded.doc_bytes,
  ai_credits = excluded.ai_credits,
  sort_order = excluded.sort_order;

create table if not exists public.user_subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  tier text not null default 'free' references public.subscription_tiers(tier),
  status text not null default 'inactive',
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  billing_interval text,
  updated_at timestamptz not null default now()
);

alter table public.user_subscriptions enable row level security;
grant select on public.user_subscriptions to authenticated;
grant all on public.user_subscriptions to service_role;

drop policy if exists "Users read own subscription" on public.user_subscriptions;
create policy "Users read own subscription" on public.user_subscriptions for select to authenticated using (auth.uid() = user_id);

create or replace function public.user_tier(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select tier from public.user_subscriptions
      where user_id = p_user
        and status in ('active','trialing','past_due')),
    'free');
$$;

grant execute on function public.user_tier(uuid) to authenticated;

create or replace function public.tier_limit(p_user uuid, p_type text)
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case p_type when 'logs' then logs_bytes when 'documents' then doc_bytes end
       from public.subscription_tiers where tier = public.user_tier(p_user)),
    (select case p_type when 'logs' then logs_bytes when 'documents' then doc_bytes end
       from public.subscription_tiers where tier = 'free'),
    (select max_bytes from public.quota_limits where storage_type = p_type));
$$;

grant execute on function public.tier_limit(uuid, text) to authenticated;

-- Update quota trigger to use tier_limit
create or replace function public.enforce_sync_quota()
returns trigger language plpgsql set search_path = public as $$
declare
  v_type  text   := public.sync_storage_type(NEW.store);
  v_limit bigint := public.tier_limit(NEW.user_id, v_type);
  v_used  bigint;
  v_new   bigint := public.sync_record_size(NEW.store, NEW.data);
begin
  if v_limit is null then return NEW; end if;
  select coalesce(sum(public.sync_record_size(store, data)), 0)
    into v_used
    from public.sync_records
   where user_id = NEW.user_id
     and public.sync_storage_type(store) = v_type
     and not (store = NEW.store and record_key = NEW.record_key);
  if v_used + v_new > v_limit then
    raise exception 'quota_exceeded: % storage over limit (% bytes used + % new > % limit)',
      v_type, v_used, v_new, v_limit using errcode = 'check_violation';
  end if;
  return NEW;
end;
$$;

create or replace function public.sync_storage_usage()
returns table(storage_type text, used_bytes bigint, limit_bytes bigint)
language sql stable security definer set search_path = public as $$
  select q.storage_type,
         coalesce(sum(public.sync_record_size(r.store, r.data)), 0)::bigint,
         public.tier_limit(auth.uid(), q.storage_type)
    from public.quota_limits q
    left join public.sync_records r
      on r.user_id = auth.uid()
     and public.sync_storage_type(r.store) = q.storage_type
   group by q.storage_type;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Premium tier
-- ═══════════════════════════════════════════════════════════════════════════
insert into public.subscription_tiers (tier, label, price_cents, logs_bytes, doc_bytes, ai_credits, sort_order)
values ('premium', 'Premium', 300, 1073741824, 5242880, 0, 20)
on conflict (tier) do update set
  label = excluded.label,
  price_cents = excluded.price_cents,
  logs_bytes = excluded.logs_bytes,
  doc_bytes = excluded.doc_bytes,
  ai_credits = excluded.ai_credits,
  sort_order = excluded.sort_order;

-- ═══════════════════════════════════════════════════════════════════════════
-- GDPR compliance
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.account_deletions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  requested_at timestamptz not null default now(),
  scheduled_for timestamptz not null
);

alter table public.account_deletions enable row level security;
grant select, delete on public.account_deletions to authenticated;
grant all on public.account_deletions to service_role;

drop policy if exists "Users read own deletion" on public.account_deletions;
create policy "Users read own deletion" on public.account_deletions for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users cancel own deletion" on public.account_deletions;
create policy "Users cancel own deletion" on public.account_deletions for delete to authenticated using (auth.uid() = user_id);

create or replace function public.encode_uri_component(p_text text)
returns text language sql immutable as $$
  select string_agg(
    case when c ~ '[A-Za-z0-9\-_.!~*''()]' then c
         else regexp_replace(encode(convert_to(c,'UTF8'),'hex'),'(..)','%\1','g') end,
    '')
  from regexp_split_to_table(p_text, '') as c;
$$;

create or replace function public.purge_expired_personal_data()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.submissions set submitted_by_ip = null
    where submitted_by_ip is not null and created_at < now() - interval '90 days';
  update public.messages set submitted_by_ip = null
    where submitted_by_ip is not null and created_at < now() - interval '90 days';
  delete from public.messages where created_at < now() - interval '1 year';
  delete from public.submissions where reviewed_at is not null and created_at < now() - interval '1 year';
  delete from public.banned_ips where expires_at is not null and expires_at < now();
  delete from public.login_attempts where locked_until is not null and locked_until < now() - interval '30 days';
end;
$$;

create or replace function public.due_account_deletions()
returns setof uuid language sql stable security definer set search_path = public as $$
  select user_id from public.account_deletions where scheduled_for <= now();
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Subscription grace + trim
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.user_subscriptions
  add column if not exists grace_until timestamptz,
  add column if not exists logs_trimmed_at timestamptz;

-- Drop first: the incremental 20260528000000 migration already created this
-- with `returns integer`, and create-or-replace cannot change a return type.
-- A later migration (20260529105524) re-establishes the integer-returning form.
drop function if exists public.trim_expired_logs();
create or replace function public.trim_expired_logs()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user record;
  v_free_logs bigint;
  v_used bigint;
  v_row record;
begin
  select logs_bytes into v_free_logs from public.subscription_tiers where tier = 'free';
  for v_user in
    select us.user_id from public.user_subscriptions us
     where us.grace_until is not null and us.grace_until < now()
       and (us.logs_trimmed_at is null or us.logs_trimmed_at < us.grace_until)
  loop
    select coalesce(sum(public.sync_record_size(store, data)), 0)
      into v_used from public.sync_records
      where user_id = v_user.user_id and store = 'files';
    for v_row in
      select record_key, data from public.sync_records
       where user_id = v_user.user_id and store = 'files'
       order by updated_at desc
    loop
      exit when v_used <= v_free_logs;
      perform 1 from storage.objects
        where bucket_id = 'user-files'
          and name = v_user.user_id::text || '/' || public.encode_uri_component(v_row.record_key);
      delete from storage.objects
        where bucket_id = 'user-files'
          and name = v_user.user_id::text || '/' || public.encode_uri_component(v_row.record_key);
      delete from public.sync_records
        where user_id = v_user.user_id and store = 'files' and record_key = v_row.record_key;
      v_used := v_used - public.sync_record_size('files', v_row.data);
    end loop;
    update public.user_subscriptions
       set logs_trimmed_at = now()
     where user_id = v_user.user_id;
  end loop;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Lap snapshots
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.subscription_tiers
  add column if not exists snapshot_count integer not null default 5;

update public.subscription_tiers set snapshot_count = 5  where tier = 'free';
update public.subscription_tiers set snapshot_count = 10 where tier = 'plus';
update public.subscription_tiers set snapshot_count = 20 where tier = 'premium';
update public.subscription_tiers set snapshot_count = 50 where tier = 'pro';

create table if not exists public.lap_snapshots (
  id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  course_key text not null,
  engine_key text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists lap_snapshots_user_course_idx
  on public.lap_snapshots (user_id, course_key);
create index if not exists lap_snapshots_user_engine_idx
  on public.lap_snapshots (user_id, engine_key);

alter table public.lap_snapshots enable row level security;
grant select, insert, update, delete on public.lap_snapshots to authenticated;
grant all on public.lap_snapshots to service_role;

drop policy if exists "Users read own snapshots" on public.lap_snapshots;
create policy "Users read own snapshots" on public.lap_snapshots for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users insert own snapshots" on public.lap_snapshots;
create policy "Users insert own snapshots" on public.lap_snapshots for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users update own snapshots" on public.lap_snapshots;
create policy "Users update own snapshots" on public.lap_snapshots for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users delete own snapshots" on public.lap_snapshots;
create policy "Users delete own snapshots" on public.lap_snapshots for delete to authenticated using (auth.uid() = user_id);

create or replace function public.tier_snapshot_count(p_user_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(
    (select snapshot_count from public.subscription_tiers where tier = public.user_tier(p_user_id)),
    (select snapshot_count from public.subscription_tiers where tier = 'free'));
$$;

grant execute on function public.tier_snapshot_count(uuid) to authenticated;

create or replace function public.enforce_lap_snapshot_quota()
returns trigger language plpgsql set search_path = public as $$
declare
  v_limit integer := public.tier_snapshot_count(NEW.user_id);
  v_count integer;
begin
  select count(*) into v_count from public.lap_snapshots
    where user_id = NEW.user_id and id <> NEW.id;
  if v_count + 1 > v_limit then
    raise exception 'snapshot_quota_exceeded: % snapshots over limit (% existing + 1 new > % limit)',
      v_limit, v_count, v_limit using errcode = 'check_violation';
  end if;
  return NEW;
end;
$$;

drop trigger if exists lap_snapshots_quota on public.lap_snapshots;
create trigger lap_snapshots_quota
  before insert on public.lap_snapshots
  for each row execute function public.enforce_lap_snapshot_quota();
