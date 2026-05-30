-- Documents + snapshots are ALWAYS free to sync.
--
-- They still COUNT toward the pooled per-tier budget (so they shrink the headroom
-- left for logs), but a write of a document or snapshot is never itself rejected
-- for being over the cap. Only logs (and, later, videos) are blocked once the pool
-- is full.
--
-- Supersedes the enforcement in 20260601000000_unified_storage_quota.sql, where all
-- three kinds were rejected at the limit. Documents are KB-sized garage data and
-- snapshots are user-curated baselines — silently dropping either because the pool
-- is full of logs is a worse failure than letting them nudge slightly past. Ordered
-- after the unified-quota migration; idempotent + self-healing.

-- ── sync_records: enforce ONLY for log blobs (store = 'files') ────────────────
-- Document upserts (every non-'files' store) return early, so they always commit
-- regardless of the pooled total. A log is still blocked when the WHOLE pool —
-- free docs/snapshots included — would exceed the tier limit. SECURITY DEFINER so
-- the usage sum is exact regardless of the caller's RLS context.
create or replace function public.enforce_sync_quota()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_limit bigint;
  v_new   bigint;
  v_used  bigint;
begin
  -- Documents are always free to sync (they still count toward the pool below).
  if public.sync_storage_type(NEW.store) <> 'logs' then
    return NEW;
  end if;

  v_limit := public.tier_total_limit(NEW.user_id);
  if v_limit is null then return NEW; end if;
  v_new := public.sync_record_size(NEW.store, NEW.data);

  -- Pooled usage (docs + other logs + snapshots), excluding the log row being
  -- upserted (it's replaced).
  select
      coalesce((select sum(public.sync_record_size(store, data))
                  from public.sync_records
                 where user_id = NEW.user_id
                   and not (store = NEW.store and record_key = NEW.record_key)), 0)
    + coalesce((select sum(octet_length(data::text))
                  from public.lap_snapshots where user_id = NEW.user_id), 0)
    into v_used;

  if v_used + v_new > v_limit then
    raise exception 'quota_exceeded: storage over limit (% bytes used + % new > % limit)',
      v_used, v_new, v_limit using errcode = 'check_violation';
  end if;
  return NEW;
end;
$$;

-- ── lap_snapshots: snapshots are always free now — drop the byte-quota gate ────
-- Their serialized size still counts via total_storage_used / sync_storage_usage
-- (the meter), they're just never rejected on write.
drop trigger if exists lap_snapshots_quota on public.lap_snapshots;
drop function if exists public.enforce_snapshot_quota();