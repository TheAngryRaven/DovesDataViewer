-- Leaderboards (plan 0005): public community leaderboard built from lap snapshots.
--
-- A user opt-in submits a frozen snapshot (one verified lap) as a leaderboard
-- entry. Entries are PUBLIC (readable by anyone, signed-in or not — the browse
-- page works without an account) so the whole point is cross-driver comparison.
--
-- Two tables:
--   * leaderboard_entries — one row per submitted snapshot. GPS, engine name and
--     the listed weight are always public; the chassis setup and engine-telemetry
--     channels are stripped client-side unless the submitter opts to share them.
--   * engine_classes — admin-managed keyword groups that collapse free-text engine
--     names ("Tillotson 225" / "225RS" / "Tilly") into one canonical class so
--     records group correctly. Classification is automatic on insert and the class
--     is admin-overridable per row WITHOUT touching the user's raw `engine` string.
--
-- Moderation is allow-by-default: status starts 'approved' and only a public read
-- filter hides denied rows. Admins flip status / class / notes via RLS policies.

-- ── engine_classes ───────────────────────────────────────────────────────────
create table if not exists public.engine_classes (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,                 -- canonical display, e.g. "Tillotson 225"
  keywords    text[] not null default '{}',  -- case-insensitive substrings of engine_key
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.engine_classes enable row level security;

-- Public read (labels + grouping work for anonymous visitors); admin-only writes.
drop policy if exists "Anyone reads engine classes"   on public.engine_classes;
drop policy if exists "Admins insert engine classes"   on public.engine_classes;
drop policy if exists "Admins update engine classes"   on public.engine_classes;
drop policy if exists "Admins delete engine classes"   on public.engine_classes;

create policy "Anyone reads engine classes"
  on public.engine_classes for select to anon, authenticated using (true);
create policy "Admins insert engine classes"
  on public.engine_classes for insert to authenticated with check (public.has_role(auth.uid(), 'admin'));
create policy "Admins update engine classes"
  on public.engine_classes for update to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
create policy "Admins delete engine classes"
  on public.engine_classes for delete to authenticated using (public.has_role(auth.uid(), 'admin'));

-- ── Classification helper ────────────────────────────────────────────────────
-- First class (by sort_order) any of whose keywords is a substring of the engine
-- key. SECURITY DEFINER so the insert trigger can resolve it under the submitter.
create or replace function public.classify_engine(p_engine_key text)
returns uuid language sql stable security definer set search_path = public as $$
  select c.id
    from public.engine_classes c
   where exists (
     select 1 from unnest(c.keywords) kw
      where kw <> '' and position(lower(kw) in lower(coalesce(p_engine_key, ''))) > 0
   )
   order by c.sort_order, c.created_at
   limit 1;
$$;
grant execute on function public.classify_engine(text) to anon, authenticated;

-- ── leaderboard_entries ──────────────────────────────────────────────────────
create table if not exists public.leaderboard_entries (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  -- Denormalized submitter profile name: the public label / lap label. Snapshotted
  -- at submit time so it stays stable if the user later renames, and so anonymous
  -- readers never need access to the profiles table.
  display_name             text not null,

  -- Identity / grouping
  track_name               text not null,
  course_name              text not null,
  course_key               text not null,
  direction                text,
  engine                   text not null,             -- raw user string, never mutated
  engine_key               text not null,             -- normalized (trim + lower)
  engine_class_id          uuid references public.engine_classes(id) on delete set null,
  class_source             text not null default 'auto' check (class_source in ('auto','admin')),

  listed_weight            numeric,                   -- public weight (groups exact-match)
  listed_weight_unit       text check (listed_weight_unit in ('lb','kg')),
  lap_time_ms              integer not null,

  -- Privacy + anti-resubmit
  content_hash             text not null,             -- stable hash of the snapshot identity
  setup_public             boolean not null default false,
  engine_telemetry_public  boolean not null default false,

  -- Frozen payload: clean-lap samples + course geometry (+ setup only when shared,
  -- engine-telemetry channels stripped unless shared). All stripping is client-side.
  data                     jsonb not null,

  -- Moderation (allow-by-default)
  status                   text not null default 'approved' check (status in ('approved','denied')),
  created_at               timestamptz not null default now(),
  reviewed_at              timestamptz,
  reviewed_by              uuid references auth.users(id) on delete set null,
  admin_notes              text,

  unique (user_id, content_hash)                      -- can't resubmit an identical snapshot
);

create index if not exists leaderboard_entries_course_idx on public.leaderboard_entries (course_key);
create index if not exists leaderboard_entries_status_idx  on public.leaderboard_entries (status);
create index if not exists leaderboard_entries_class_idx   on public.leaderboard_entries (engine_class_id);

alter table public.leaderboard_entries enable row level security;

drop policy if exists "Anyone reads approved entries"  on public.leaderboard_entries;
drop policy if exists "Users insert own entries"        on public.leaderboard_entries;
drop policy if exists "Users delete own entries"        on public.leaderboard_entries;
drop policy if exists "Admins read all entries"         on public.leaderboard_entries;
drop policy if exists "Admins update entries"           on public.leaderboard_entries;

-- Public can read approved rows (anonymous browse); a user always sees their own
-- (so a denied entry still shows in their submitted list).
create policy "Anyone reads approved entries"
  on public.leaderboard_entries for select to anon, authenticated
  using (status = 'approved' or auth.uid() = user_id);
create policy "Users insert own entries"
  on public.leaderboard_entries for insert to authenticated with check (auth.uid() = user_id);
create policy "Users delete own entries"
  on public.leaderboard_entries for delete to authenticated using (auth.uid() = user_id);
create policy "Admins read all entries"
  on public.leaderboard_entries for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create policy "Admins update entries"
  on public.leaderboard_entries for update to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

-- Auto-classify on insert when the client didn't pin a class.
create or replace function public.leaderboard_set_class()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.engine_class_id is null then
    NEW.engine_class_id := public.classify_engine(NEW.engine_key);
  end if;
  return NEW;
end;
$$;

drop trigger if exists leaderboard_entries_classify on public.leaderboard_entries;
create trigger leaderboard_entries_classify
  before insert on public.leaderboard_entries
  for each row execute function public.leaderboard_set_class();

-- ── Admin reclassify ─────────────────────────────────────────────────────────
-- Re-run auto-classification for every row whose class was NOT admin-set, so
-- editing keyword groups retroactively regroups the auto-classified records while
-- leaving manual overrides (class_source='admin') untouched.
create or replace function public.reclassify_entries()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'not authorized';
  end if;
  with updated as (
    update public.leaderboard_entries e
       set engine_class_id = public.classify_engine(e.engine_key)
     where e.class_source = 'auto'
       and e.engine_class_id is distinct from public.classify_engine(e.engine_key)
    returning 1
  )
  select count(*) into v_count from updated;
  return v_count;
end;
$$;
grant execute on function public.reclassify_entries() to authenticated;

-- Surface the new tables + functions to PostgREST immediately.
notify pgrst, 'reload schema';
