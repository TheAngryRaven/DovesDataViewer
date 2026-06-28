-- Plan 0006 — self-healing repair of the user-profiles backend.
--
-- The original two migrations (20260627120000_profiles_ci_avatars +
-- 20260627120100_public_vehicles_and_avatar_bucket) did not fully take on the
-- beta *preview* database: the user-avatars bucket row was present but its
-- storage.objects RLS policies were missing, so avatar uploads failed with
-- "violates row-level security policy". Rather than hand-run SQL (which defeats
-- migrations), this migration re-asserts the ENTIRE plan-0006 backend in a single
-- fully idempotent pass. It is safe to run against any database — a DB where the
-- originals applied cleanly sees only no-ops; a DB where they were skipped is
-- brought fully up to spec. A fresh DB runs the originals first, then this as a
-- superset no-op.

-- ── profiles: avatar columns ─────────────────────────────────────────────────
alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles add column if not exists avatar_updated_at timestamptz;

-- ── profiles: case-insensitive-unique display name ───────────────────────────
-- De-dup any case-collisions first so the functional unique index can build
-- (no-op once the originals ran). Then drop the legacy case-sensitive constraint
-- and ensure the lower(display_name) index exists.
do $$
declare r record;
begin
  for r in
    select user_id, display_name,
      row_number() over (partition by lower(display_name) order by created_at, user_id) as rn
    from public.profiles
  loop
    if r.rn > 1 then
      update public.profiles
        set display_name = r.display_name || '-' || r.rn::text,
            updated_at = now()
        where user_id = r.user_id;
    end if;
  end loop;
end $$;

alter table public.profiles drop constraint if exists profiles_display_name_key;
create unique index if not exists profiles_display_name_lower_idx
  on public.profiles (lower(display_name));

-- ── profiles: case-insensitive server-side name resolution ───────────────────
create or replace function public.random_display_name()
returns text language plpgsql as $$
declare
  adjs text[] := array[
    'Speedy','Turbo','Drifty','Nitro','Reckless','Smooth','Apex','Sideways',
    'Greasy','Loose','Sketchy','Mighty','Sneaky','Wobbly','Blazing','Rowdy',
    'Janky','Cosmic','Feral','Zippy'];
  nouns text[] := array[
    'Racer','Driver','Pilot','Hooligan','Throttle','Slider','Charger','Rocket',
    'Gremlin','Goblin','Wrench','Piston','Sender','Drifter','Maniac','Comet',
    'Bandit','Cheetah','Noodle','Menace'];
  candidate text;
begin
  loop
    candidate :=
      adjs[1 + floor(random() * array_length(adjs, 1))::int]
      || replace(nouns[1 + floor(random() * array_length(nouns, 1))::int], 'e', '3')
      || '-' || (100 + floor(random() * 900))::int::text;
    exit when not exists (
      select 1 from public.profiles where lower(display_name) = lower(candidate)
    );
  end loop;
  return candidate;
end;
$$;

create or replace function public.unique_display_name(desired text)
returns text language plpgsql as $$
declare
  d text := nullif(btrim(coalesce(desired, '')), '');
  candidate text;
  tries int := 0;
begin
  if d is null then
    return public.random_display_name();
  end if;
  candidate := d;
  while exists (
    select 1 from public.profiles where lower(display_name) = lower(candidate)
  ) loop
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

-- ── profiles: anon-readable, column-limited view ─────────────────────────────
create or replace view public.public_profiles as
  select user_id, display_name, avatar_path, avatar_updated_at
  from public.profiles;
grant select on public.public_profiles to anon, authenticated;

-- ── public_vehicles: opt-in public projection (no weight/setup, ever) ────────
create table if not exists public.public_vehicles (
  user_id    uuid not null references auth.users (id) on delete cascade,
  vehicle_id text not null,
  name       text not null,
  type_name  text,
  engine     text not null,
  number     integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, vehicle_id)
);

alter table public.public_vehicles enable row level security;

drop policy if exists "Anyone reads public vehicles" on public.public_vehicles;
create policy "Anyone reads public vehicles"
  on public.public_vehicles for select to anon, authenticated using (true);

drop policy if exists "Users insert own public vehicles" on public.public_vehicles;
create policy "Users insert own public vehicles"
  on public.public_vehicles for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users update own public vehicles" on public.public_vehicles;
create policy "Users update own public vehicles"
  on public.public_vehicles for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users delete own public vehicles" on public.public_vehicles;
create policy "Users delete own public vehicles"
  on public.public_vehicles for delete to authenticated
  using (auth.uid() = user_id);

-- ── user-avatars bucket + storage RLS (the part that was missing) ────────────
-- Force `public = true` even if the bucket row already existed (e.g. created by
-- a prior partial apply) as private, then re-assert the owner-folder write
-- policies. THIS is what unblocks the avatar upload.
insert into storage.buckets (id, name, public)
values ('user-avatars', 'user-avatars', true)
on conflict (id) do update set public = true;

drop policy if exists "Users upload own avatar" on storage.objects;
create policy "Users upload own avatar"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'user-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users update own avatar" on storage.objects;
create policy "Users update own avatar"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'user-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users delete own avatar" on storage.objects;
create policy "Users delete own avatar"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'user-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

notify pgrst, 'reload schema';
