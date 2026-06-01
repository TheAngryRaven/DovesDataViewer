-- Self-repair lap_snapshots column-level defaults that the original
-- 20260529_lap_snapshots `CREATE TABLE IF NOT EXISTS` skipped when the table
-- pre-existed (same root pattern that left the unique constraint missing).
--
-- The previous error surfaced first as the missing ON CONFLICT target (fixed by
-- 20260530010000_lap_snapshots_unique_index). With the conflict target in place
-- the upsert reaches the INSERT, which now fails with:
--   null value in column "id" of relation "lap_snapshots" violates not-null
--   constraint
-- because the `default gen_random_uuid()` on `id` never landed either —
-- pushSnapshot doesn't (and shouldn't) send an id, so the column default has
-- to supply one. Re-set the defaults idempotently (setting a column default is
-- a metadata change; existing rows are untouched), then reload PostgREST so
-- inserts pick the defaults up.
alter table public.lap_snapshots
  alter column id set default gen_random_uuid();

alter table public.lap_snapshots
  alter column updated_at set default now();

notify pgrst, 'reload schema';
