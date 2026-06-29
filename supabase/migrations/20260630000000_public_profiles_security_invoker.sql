-- Plan 0006 — resolve the "Security Definer View" linter warning on public_profiles.
--
-- public_profiles was a SECURITY DEFINER view (the Postgres default), which the
-- Supabase linter flags because it bypasses RLS on its base table. Recreate it as
-- a security_invoker view so it runs with the *querying* role's privileges, and
-- grant public (anon) read on profiles so anonymous /driver and leaderboard reads
-- still resolve. The only profile columns are public by design (display name,
-- avatar path/timestamp), so exposing the row to anon is fine. Writes are
-- unchanged and stay owner-only — the public can read but cannot insert/update.

create or replace view public.public_profiles
  with (security_invoker = true) as
  select user_id, display_name, avatar_path, avatar_updated_at
  from public.profiles;
grant select on public.public_profiles to anon, authenticated;

-- Public read of profiles (replaces the authenticated-only policy) so the
-- invoker-security view resolves for anonymous visitors. Insert/update policies
-- are untouched: only the owner can write their row.
drop policy if exists "Profiles readable by authenticated" on public.profiles;
drop policy if exists "Public can read profiles" on public.profiles;
create policy "Public can read profiles"
  on public.profiles for select to anon, authenticated using (true);

notify pgrst, 'reload schema';
