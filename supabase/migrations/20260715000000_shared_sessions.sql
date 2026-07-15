-- Shared sessions (plan 0009): public share links for cloud-uploaded logs.
--
-- A signed-in user can publish a cloud-synced log behind an opaque, crypto-random
-- token URL (/s/{token}). The public surface NEVER contains the filename:
--   * shared_sessions — one row per published log, keyed by the token. Carries the
--     frozen course geometry (so recipients get precise lap/sector timing even for
--     personal courses), display metadata, and the blob size. NO filename column —
--     the owner-side token<->filename mapping lives in the log's private
--     sync_records index row (data.share), which is owner-only by existing RLS.
--   * shared-sessions bucket — a public bucket holding a copy of the raw log blob
--     at {user_id}/{token}. Public read; writes scoped to the owner's folder.
--
-- A profiles.share_sessions_default flag makes NEW uploads auto-publish.
-- Shared copies count toward the pooled per-tier byte budget (plan 0009 D3).

-- ── 1. Profile default: new uploads public? ───────────────────────────────────
alter table public.profiles
  add column if not exists share_sessions_default boolean not null default false;

-- ── 2. shared_sessions ────────────────────────────────────────────────────────
create table if not exists public.shared_sessions (
  token           text primary key,   -- opaque crypto-random base64url id (>=128 bits)
  user_id         uuid not null references auth.users(id) on delete cascade,
  -- Extension only (parser routing: binary formats detect by extension).
  -- NEVER add a filename column here — anon must not resolve token -> filename.
  file_ext        text not null,
  course          jsonb not null,     -- frozen Course geometry (normalized sectors + layout)
  track_name      text not null,
  course_name     text not null,
  session_date    timestamptz,
  fastest_lap_ms  integer,
  size_bytes      bigint not null,
  created_at      timestamptz not null default now()
);

create index if not exists shared_sessions_user_idx on public.shared_sessions (user_id);

-- Second FK so PostgREST can embed the owner's live display name + avatar
-- (profiles!shared_sessions_profile_fkey), mirroring leaderboard_entries.
alter table public.shared_sessions
  drop constraint if exists shared_sessions_profile_fkey;
alter table public.shared_sessions
  add constraint shared_sessions_profile_fkey
  foreign key (user_id) references public.profiles(user_id) on delete cascade;

alter table public.shared_sessions enable row level security;

drop policy if exists "Anyone reads shared sessions"      on public.shared_sessions;
drop policy if exists "Users insert own shared sessions"  on public.shared_sessions;
drop policy if exists "Users delete own shared sessions"  on public.shared_sessions;

-- Public read is the whole point (the token is the secret). No update policy:
-- a share is immutable — unshare + reshare mints a fresh token.
create policy "Anyone reads shared sessions"
  on public.shared_sessions for select to anon, authenticated using (true);
create policy "Users insert own shared sessions"
  on public.shared_sessions for insert to authenticated with check (auth.uid() = user_id);
create policy "Users delete own shared sessions"
  on public.shared_sessions for delete to authenticated using (auth.uid() = user_id);

-- ── 3. Public blob bucket ─────────────────────────────────────────────────────
-- Public read; writes stay scoped to the owner's folder (user-avatars pattern).
insert into storage.buckets (id, name, public)
values ('shared-sessions', 'shared-sessions', true)
on conflict (id) do nothing;

drop policy if exists "Users upload own shared session blobs" on storage.objects;
create policy "Users upload own shared session blobs"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'shared-sessions'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users delete own shared session blobs" on storage.objects;
create policy "Users delete own shared session blobs"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'shared-sessions'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── 4. Quota: shared copies draw from the pooled byte budget ──────────────────
-- The shared blob is a real second copy of the log, so it counts (plan 0009 D3).

create or replace function public.total_storage_used(p_user uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select
      coalesce((select sum(public.sync_record_size(store, data))
                  from public.sync_records where user_id = p_user), 0)
    + coalesce((select sum(octet_length(data::text))
                  from public.lap_snapshots where user_id = p_user), 0)
    + coalesce((select sum(size_bytes)
                  from public.shared_sessions where user_id = p_user), 0);
$$;
grant execute on function public.total_storage_used(uuid) to authenticated;

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
    + coalesce((select sum(size_bytes)
                  from public.shared_sessions where user_id = NEW.user_id), 0)
    into v_used;

  if v_used + v_new > v_limit then
    raise exception 'quota_exceeded: storage over limit (% bytes used + % new > % limit)',
      v_used, v_new, v_limit using errcode = 'check_violation';
  end if;
  return NEW;
end;
$$;

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
    + coalesce((select sum(size_bytes)
                  from public.shared_sessions where user_id = NEW.user_id), 0)
    into v_used;

  if v_used + v_new > v_limit then
    raise exception 'quota_exceeded: storage over limit (% bytes used + % new > % limit)',
      v_used, v_new, v_limit using errcode = 'check_violation';
  end if;
  return NEW;
end;
$$;

-- New shares must also fit the pool (token PK means an insert never replaces).
create or replace function public.enforce_share_quota()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_limit bigint := public.tier_total_limit(NEW.user_id);
  v_used  bigint;
begin
  if v_limit is null then return NEW; end if;

  select
      coalesce((select sum(public.sync_record_size(store, data))
                  from public.sync_records where user_id = NEW.user_id), 0)
    + coalesce((select sum(octet_length(data::text))
                  from public.lap_snapshots where user_id = NEW.user_id), 0)
    + coalesce((select sum(size_bytes)
                  from public.shared_sessions
                 where user_id = NEW.user_id and token <> NEW.token), 0)
    into v_used;

  if v_used + NEW.size_bytes > v_limit then
    raise exception 'quota_exceeded: storage over limit (% bytes used + % new > % limit)',
      v_used, NEW.size_bytes, v_limit using errcode = 'check_violation';
  end if;
  return NEW;
end;
$$;

drop trigger if exists shared_sessions_quota on public.shared_sessions;
create trigger shared_sessions_quota
  before insert on public.shared_sessions
  for each row execute function public.enforce_share_quota();

-- Shared bytes surface in the meter's logs segment (same client row shape).
create or replace function public.sync_storage_usage()
returns table(documents_bytes bigint, logs_bytes bigint, snapshots_bytes bigint, total_limit_bytes bigint)
language sql stable security definer set search_path = public as $$
  select
    coalesce((select sum(public.sync_record_size(store, data))
                from public.sync_records
               where user_id = auth.uid()
                 and public.sync_storage_type(store) = 'documents'), 0)::bigint,
    ( coalesce((select sum(public.sync_record_size(store, data))
                  from public.sync_records
                 where user_id = auth.uid()
                   and public.sync_storage_type(store) = 'logs'), 0)
    + coalesce((select sum(size_bytes)
                  from public.shared_sessions where user_id = auth.uid()), 0) )::bigint,
    coalesce((select sum(octet_length(data::text))
                from public.lap_snapshots where user_id = auth.uid()), 0)::bigint,
    public.tier_total_limit(auth.uid());
$$;
grant execute on function public.sync_storage_usage() to authenticated;

-- ── 5. Grace trim: trimming a log also removes its share ──────────────────────
-- Shared copies count as trimmable log bytes. When a log's index row carries a
-- share token (data.share.token), the share row + public blob go with it.
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
  v_token      text;
  v_share_size bigint;
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
    -- Split the pool: logs + their shared copies (trimmable) vs docs + snapshots (kept).
    select coalesce(sum(public.sync_record_size(store, data)), 0)
      into v_logs
      from public.sync_records
     where user_id = v_user and public.sync_storage_type(store) = 'logs';
    v_logs := v_logs + coalesce(
      (select sum(size_bytes) from public.shared_sessions where user_id = v_user), 0);
    v_nonlog := public.total_storage_used(v_user) - v_logs;

    v_allowance := greatest(0, v_free_total - v_nonlog);

    if v_nonlog < v_free_total then
      for r in
        select record_key, data
          from public.sync_records
         where user_id = v_user
           and public.sync_storage_type(store) = 'logs'
         order by updated_at desc, record_key desc
      loop
        exit when v_logs <= v_allowance;
        -- Remove the log's share (row + public blob) before its index row goes.
        v_token := r.data -> 'share' ->> 'token';
        if v_token is not null then
          select size_bytes into v_share_size
            from public.shared_sessions where token = v_token and user_id = v_user;
          if v_share_size is not null then
            delete from public.shared_sessions where token = v_token and user_id = v_user;
            delete from storage.objects
             where bucket_id = 'shared-sessions'
               and name = v_user::text || '/' || v_token;
            v_logs := v_logs - v_share_size;
          end if;
        end if;
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

notify pgrst, 'reload schema';
