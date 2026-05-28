-- Canonicalize the lap_snapshots schema (consolidates the 0529/0530 drift).
--
-- The Lovable batch (20260528001943) created lap_snapshots with `id text not
-- null` and PK (user_id, id), with NO unique on (course_key, engine_key); the
-- hand-written 20260529 then no-op'd via CREATE TABLE IF NOT EXISTS, so
-- pushSnapshot's ON CONFLICT (user_id, course_key, engine_key) upsert was broken
-- until the 20260530 patch pair added the unique index + column defaults. That
-- left the canonical shape spread across four migrations and the `id` column as
-- text rather than uuid.
--
-- This single idempotent migration asserts the canonical shape in one place so a
-- deployment that somehow missed a patch self-heals on apply, and normalizes
-- `id` to uuid when it's safe to do so. pushSnapshot never sends an id (the
-- column default supplies one via gen_random_uuid()), so in practice every value
-- is already a uuid string — but we verify before casting so a stray non-uuid
-- value can never fail the deploy.
do $$
declare
  v_bad integer;
begin
  -- Guarantee the (user, course, engine) uniqueness the upsert targets, even on
  -- a deployment that never ran 20260530010000.
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and indexname = 'lap_snapshots_user_course_engine_uidx'
  ) then
    create unique index lap_snapshots_user_course_engine_uidx
      on public.lap_snapshots (user_id, course_key, engine_key);
  end if;

  -- Guarantee the column defaults (also missed if 20260530020000 never ran).
  alter table public.lap_snapshots alter column id set default gen_random_uuid();
  alter table public.lap_snapshots alter column updated_at set default now();

  -- Normalize id text -> uuid, but only when every existing value is a valid
  -- uuid (so the cast can't error and block the migration).
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
