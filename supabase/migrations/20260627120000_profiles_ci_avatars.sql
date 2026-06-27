-- Plan 0006 — User profiles, part 1: case-insensitive-unique display names,
-- avatar columns, and a column-limited anon-readable view.
--
-- Display names were previously unique only case-sensitively, so "aetter" and
-- "Aetter" could coexist and one could impersonate the other by changing case.
-- We collapse any case-insensitive duplicates (destructive — acceptable at the
-- current ~5-user scale) and replace the unique constraint with a functional
-- unique index on lower(display_name). Avatars live in the user-avatars bucket;
-- the path + an updated-at cache-buster are stored here. A public_profiles view
-- exposes ONLY the four public columns to anonymous visitors (the driver page).

-- ── Pre-flight: collapse case-insensitive duplicate names ────────────────────
-- Keep the earliest row per lower(name); suffix later collisions so the new
-- unique index can build. Destructive by design (a renamed account keeps its id).
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

-- ── Swap the case-sensitive unique constraint for a case-insensitive index ────
alter table public.profiles drop constraint if exists profiles_display_name_key;
drop index if exists profiles_display_name_lower_idx;
create unique index profiles_display_name_lower_idx
  on public.profiles (lower(display_name));

-- ── Avatar columns ───────────────────────────────────────────────────────────
-- avatar_path: stable object path in the user-avatars bucket ({user_id}/avatar.<ext>).
-- avatar_updated_at: appended to the public URL as ?v= so a replaced avatar (same
-- path, upsert) repaints instead of serving the cached image.
alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles add column if not exists avatar_updated_at timestamptz;

-- ── Make server-side name resolution case-insensitive ────────────────────────
-- These compared with `=`; switch to lower(...) so auto-generated / suffixed
-- names never collide case-insensitively with the new unique index.
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

-- ── Anon-readable, column-limited public view ────────────────────────────────
-- RLS can restrict rows but not columns, so a view is the right tool: anonymous
-- visitors of /driver/:username may read only these four columns. The view runs
-- with the (definer) migration role's rights; base-table RLS still gates writes.
create or replace view public.public_profiles as
  select user_id, display_name, avatar_path, avatar_updated_at
  from public.profiles;
grant select on public.public_profiles to anon, authenticated;

notify pgrst, 'reload schema';
