-- Storage quotas for cloud sync.
--
-- Two storage *types*, enforced server-side (client caps are advisory only):
--   • documents — all structured sync_records except file blobs (vehicles,
--     setups, templates, vehicle types, notes, metadata, graph prefs)
--   • logs      — raw session file blobs, tracked by their index row's size
--
-- ("type", not "tier" — subscription tiers will scale these limits later.)
-- Limits live in a single table (quota_limits) read by both the enforcing
-- trigger and the client meter, so there's one source of truth. A BEFORE
-- INSERT/UPDATE trigger on sync_records rejects writes that would push a type
-- over its limit; sync_storage_usage() returns per-type usage for the UI.

-- ── Limits (single source of truth) ─────────────────────────────────────────
create table if not exists public.quota_limits (
  storage_type text primary key,
  max_bytes bigint not null
);

insert into public.quota_limits (storage_type, max_bytes) values
  ('documents', 5242880),    -- 5 MB
  ('logs',     20971520)     -- 20 MB
on conflict (storage_type) do update set max_bytes = excluded.max_bytes;

alter table public.quota_limits enable row level security;

drop policy if exists "Anyone authenticated reads limits" on public.quota_limits;
create policy "Anyone authenticated reads limits"
  on public.quota_limits for select to authenticated
  using (true);

-- ── Per-record byte size ────────────────────────────────────────────────────
-- Files are counted by the size recorded on their index row; structured docs by
-- their serialized jsonb length.
create or replace function public.sync_record_size(p_store text, p_data jsonb)
returns bigint language sql immutable as $$
  select case
    when p_store = 'files' then coalesce((p_data->>'size')::bigint, 0)
    else octet_length(p_data::text)::bigint
  end;
$$;

-- Which storage type a sync store belongs to.
create or replace function public.sync_storage_type(p_store text)
returns text language sql immutable as $$
  select case when p_store = 'files' then 'logs' else 'documents' end;
$$;

-- ── Quota enforcement trigger ───────────────────────────────────────────────
create or replace function public.enforce_sync_quota()
returns trigger language plpgsql as $$
declare
  v_type  text   := public.sync_storage_type(NEW.store);
  v_limit bigint;
  v_used  bigint;
  v_new   bigint := public.sync_record_size(NEW.store, NEW.data);
begin
  select max_bytes into v_limit from public.quota_limits where storage_type = v_type;
  if v_limit is null then
    return NEW; -- no limit configured for this type
  end if;

  -- Current usage for this type, excluding the row being upserted.
  select coalesce(sum(public.sync_record_size(store, data)), 0)
    into v_used
    from public.sync_records
   where user_id = NEW.user_id
     and public.sync_storage_type(store) = v_type
     and not (store = NEW.store and record_key = NEW.record_key);

  if v_used + v_new > v_limit then
    raise exception
      'quota_exceeded: % storage over limit (% bytes used + % new > % limit)',
      v_type, v_used, v_new, v_limit
      using errcode = 'check_violation';
  end if;

  return NEW;
end;
$$;

drop trigger if exists sync_records_quota on public.sync_records;
create trigger sync_records_quota
  before insert or update on public.sync_records
  for each row execute function public.enforce_sync_quota();

-- ── Usage readout for the client meter ──────────────────────────────────────
-- Returns one row per storage type with used + limit bytes, scoped to the caller.
create or replace function public.sync_storage_usage()
returns table(storage_type text, used_bytes bigint, limit_bytes bigint)
language sql stable as $$
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
