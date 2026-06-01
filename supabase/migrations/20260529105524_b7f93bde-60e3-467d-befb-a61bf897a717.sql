-- Unified cloud-storage quota: ONE pooled byte budget per tier.
alter table public.subscription_tiers
  add column if not exists total_bytes bigint;

update public.subscription_tiers set total_bytes =     52428800 where tier = 'free';
update public.subscription_tiers set total_bytes =  10737418240 where tier = 'plus';
update public.subscription_tiers set total_bytes = 107374182400 where tier = 'premium';
update public.subscription_tiers set total_bytes = 536870912000 where tier = 'pro';
update public.subscription_tiers set total_bytes = 52428800 where total_bytes is null;

alter table public.subscription_tiers alter column total_bytes set not null;

create or replace function public.total_storage_used(p_user uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select
      coalesce((select sum(public.sync_record_size(store, data))
                  from public.sync_records where user_id = p_user), 0)
    + coalesce((select sum(octet_length(data::text))
                  from public.lap_snapshots where user_id = p_user), 0);
$$;
grant execute on function public.total_storage_used(uuid) to authenticated;

create or replace function public.tier_total_limit(p_user uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(
    (select total_bytes from public.subscription_tiers where tier = public.user_tier(p_user)),
    (select total_bytes from public.subscription_tiers where tier = 'free'),
    52428800);
$$;
grant execute on function public.tier_total_limit(uuid) to authenticated;

create or replace function public.enforce_sync_quota()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_limit bigint := public.tier_total_limit(NEW.user_id);
  v_new   bigint := public.sync_record_size(NEW.store, NEW.data);
  v_used  bigint;
begin
  if v_limit is null then return NEW; end if;
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
    into v_used;
  if v_used + v_new > v_limit then
    raise exception 'quota_exceeded: storage over limit (% bytes used + % new > % limit)',
      v_used, v_new, v_limit using errcode = 'check_violation';
  end if;
  return NEW;
end;
$$;

drop trigger if exists lap_snapshots_quota on public.lap_snapshots;
create trigger lap_snapshots_quota
  before insert or update on public.lap_snapshots
  for each row execute function public.enforce_snapshot_quota();

drop function if exists public.sync_storage_usage();
create or replace function public.sync_storage_usage()
returns table(documents_bytes bigint, logs_bytes bigint, snapshots_bytes bigint, total_limit_bytes bigint)
language sql stable security definer set search_path = public as $$
  select
    coalesce((select sum(public.sync_record_size(store, data))
                from public.sync_records
               where user_id = auth.uid()
                 and public.sync_storage_type(store) = 'documents'), 0)::bigint,
    coalesce((select sum(public.sync_record_size(store, data))
                from public.sync_records
               where user_id = auth.uid()
                 and public.sync_storage_type(store) = 'logs'), 0)::bigint,
    coalesce((select sum(octet_length(data::text))
                from public.lap_snapshots where user_id = auth.uid()), 0)::bigint,
    public.tier_total_limit(auth.uid());
$$;
grant execute on function public.sync_storage_usage() to authenticated;

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
    select coalesce(sum(public.sync_record_size(store, data)), 0)
      into v_logs
      from public.sync_records
     where user_id = v_user and public.sync_storage_type(store) = 'logs';
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

drop function if exists public.tier_limit(uuid, text);
drop function if exists public.snapshot_limit(uuid);
drop function if exists public.tier_snapshot_count(uuid);
drop function if exists public.snapshot_usage();
drop function if exists public.enforce_lap_snapshot_quota();

alter table public.subscription_tiers
  drop column if exists logs_bytes,
  drop column if exists doc_bytes,
  drop column if exists snapshot_count;

drop table if exists public.quota_limits;

notify pgrst, 'reload schema';