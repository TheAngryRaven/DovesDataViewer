-- 20260531000000_stripe_event_dedup.sql
create table if not exists public.stripe_events (
  id          text primary key,
  type        text not null,
  received_at timestamptz not null default now()
);

alter table public.stripe_events enable row level security;

grant all on public.stripe_events to service_role;

notify pgrst, 'reload schema';

-- 20260531010000_purge_predicate_fix.sql
create or replace function public.purge_expired_personal_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.submissions
     set submitted_by_ip = null
   where submitted_by_ip is not null
     and created_at < now() - interval '90 days';

  update public.messages
     set submitted_by_ip = null
   where submitted_by_ip is not null
     and created_at < now() - interval '90 days';

  delete from public.messages
   where created_at < now() - interval '1 year';

  delete from public.submissions
   where status <> 'pending'
     and created_at < now() - interval '1 year';

  delete from public.banned_ips
   where expires_at is not null
     and expires_at < now();

  delete from public.login_attempts
   where locked_until is not null
     and locked_until < now();
end;
$$;

revoke all on function public.purge_expired_personal_data() from public, anon, authenticated;

-- 20260531020000_lap_snapshots_canonical.sql
do $$
declare
  v_bad integer;
begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and indexname = 'lap_snapshots_user_course_engine_uidx'
  ) then
    create unique index lap_snapshots_user_course_engine_uidx
      on public.lap_snapshots (user_id, course_key, engine_key);
  end if;

  alter table public.lap_snapshots alter column id set default gen_random_uuid();
  alter table public.lap_snapshots alter column updated_at set default now();

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'lap_snapshots'
       and column_name = 'id' and data_type = 'text'
  ) then
    select count(*) into v_bad
      from public.lap_snapshots
     where id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
    if v_bad = 0 then
      alter table public.lap_snapshots alter column id drop default;
      alter table public.lap_snapshots alter column id type uuid using id::uuid;
      alter table public.lap_snapshots alter column id set default gen_random_uuid();
    else
      raise notice 'lap_snapshots.id left as text: % non-uuid value(s) present', v_bad;
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';