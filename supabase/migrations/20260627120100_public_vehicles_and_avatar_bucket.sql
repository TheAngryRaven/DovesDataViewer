-- Plan 0006 — User profiles, part 2: the opt-in public vehicle projection and
-- the public avatar bucket.
--
-- A user's garage lives privately in sync_records (owner-only RLS, weights and
-- setups attached). The driver profile page must show vehicles publicly, so
-- vehicles the user flags "show on profile" are projected into public_vehicles
-- with ONLY public-safe columns — never weight/weightUnit or any setup. Avatars
-- go in a public bucket so the page can render them with a plain public URL.

-- ── Opt-in public vehicle projection ─────────────────────────────────────────
create table if not exists public.public_vehicles (
  user_id    uuid not null references auth.users (id) on delete cascade,
  vehicle_id text not null,                 -- the client Vehicle.id
  name       text not null,
  type_name  text,                          -- resolved vehicle-type label (denormalized)
  engine     text not null,
  number     integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, vehicle_id)
);
-- NEVER add weight / weightUnit / setup columns here — that is the whole point.

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

-- ── Public avatar bucket ─────────────────────────────────────────────────────
-- Public read (it's a public bucket); writes stay scoped to the owner's folder,
-- mirroring the user-files policies.
insert into storage.buckets (id, name, public)
values ('user-avatars', 'user-avatars', true)
on conflict (id) do nothing;

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
