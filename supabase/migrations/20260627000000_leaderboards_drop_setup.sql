-- Leaderboards (plan 0005): drop setup from submissions entirely.
--
-- Sharing chassis setup data on a public leaderboard made people uneasy, so the
-- submission flow no longer collects or stores it. Remove the now-unused
-- setup_public column and strip any `setup` key from existing entry payloads so
-- nothing lingers from the beta window.

alter table public.leaderboard_entries drop column if exists setup_public;

update public.leaderboard_entries
   set data = data - 'setup'
 where data ? 'setup';

notify pgrst, 'reload schema';
