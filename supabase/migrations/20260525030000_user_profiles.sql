-- User profiles: a unique, user-editable display name per account.
--
-- Display name is NOT a key (the user id is) — it's a human label that must be
-- unique and can be changed any time. If none is provided at sign-up (or for
-- existing users when this migration runs), a silly random name is generated,
-- e.g. "SpeedyRac3r-546". Avatars / richer profiles are intentionally deferred.

-- ── Table ────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Display names aren't sensitive (and are needed for future social/team
-- features + name-availability), so any authenticated user may read them.
drop policy if exists "Profiles readable by authenticated" on public.profiles;
create policy "Profiles readable by authenticated"
  on public.profiles for select to authenticated using (true);

drop policy if exists "Users insert own profile" on public.profiles;
create policy "Users insert own profile"
  on public.profiles for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile"
  on public.profiles for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Random silly name generation ─────────────────────────────────────────────
-- Adjective + (lightly leetified) noun + "-" + 3 digits, e.g. "SpeedyRac3r-546".
-- Retries until the generated name is free.
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
    exit when not exists (select 1 from public.profiles where display_name = candidate);
  end loop;
  return candidate;
end;
$$;

-- Resolve a desired name to a free one: blank → a random silly name; a taken
-- name → suffixed with digits until free. Used at account creation only (user
-- edits get an explicit "taken" error instead — see the client).
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

-- ── Auto-create a profile on sign-up ─────────────────────────────────────────
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

-- ── Backfill existing users (one at a time so names stay unique) ──────────────
do $$
declare u record;
begin
  for u in
    select id, raw_user_meta_data from auth.users
    where id not in (select user_id from public.profiles)
  loop
    insert into public.profiles (user_id, display_name)
    values (u.id, public.unique_display_name(u.raw_user_meta_data->>'display_name'));
  end loop;
end $$;
