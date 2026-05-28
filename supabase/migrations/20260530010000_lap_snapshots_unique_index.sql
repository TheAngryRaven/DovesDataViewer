-- Ensure the lap_snapshots (user, course, engine) unique constraint exists.
--
-- 20260529_lap_snapshots declared `unique (user_id, course_key, engine_key)`
-- inline in the CREATE TABLE, but if the table pre-existed (e.g. a partial
-- earlier run, or some other path created it), the `if not exists` skipped and
-- the inline constraint never landed. The upsert in pushSnapshot
-- (ON CONFLICT (user_id, course_key, engine_key) DO UPDATE) then fails with
-- "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification", so reconcile and manual sync both error.
--
-- Add the constraint as a unique INDEX (idempotent via `if not exists` and
-- equally matchable by ON CONFLICT) so existing deployments self-repair on
-- migration apply, and the constraint is guaranteed even when the table
-- pre-existed. Finally reload PostgREST so it sees the new index.
create unique index if not exists lap_snapshots_user_course_engine_uidx
  on public.lap_snapshots (user_id, course_key, engine_key);

notify pgrst, 'reload schema';
