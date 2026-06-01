-- Cloud sync: per-user storage of telemetry files + garage data.
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

drop policy if exists "Users read own sync records" on public.sync_records;
create policy "Users read own sync records"
  on public.sync_records for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users insert own sync records" on public.sync_records;
create policy "Users insert own sync records"
  on public.sync_records for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users update own sync records" on public.sync_records;
create policy "Users update own sync records"
  on public.sync_records for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users delete own sync records" on public.sync_records;
create policy "Users delete own sync records"
  on public.sync_records for delete to authenticated
  using (auth.uid() = user_id);

-- Raw file blobs
insert into storage.buckets (id, name, public)
values ('user-files', 'user-files', false)
on conflict (id) do nothing;

drop policy if exists "Users read own files" on storage.objects;
create policy "Users read own files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'user-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users upload own files" on storage.objects;
create policy "Users upload own files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'user-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users update own files" on storage.objects;
create policy "Users update own files"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'user-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users delete own files" on storage.objects;
create policy "Users delete own files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'user-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );