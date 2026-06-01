-- GDPR compliance: personal-data retention (IP TTL) + scheduled account deletion.
--
-- Two concerns:
--   1. Personal-data minimisation, in two layers:
--        a. `submitted_by_ip` on submissions and messages is nulled 90 days
--           after the row was created (the abuse-investigation window);
--        b. the rows themselves are then deleted once their content is no longer
--           needed — contact messages and *reviewed* submissions after 1 year
--           (pending submissions are kept so they can still be moderated).
--      Expired `banned_ips` and stale `login_attempts` rows are deleted too. A
--      daily pg_cron job runs the purge so data is cleared even when there's no
--      traffic to trigger the reactive cleanup the edge functions already do.
--   2. Self-service account deletion is *scheduled*, not immediate. A 7-day grace
--      window (reversible by the user) guards against a hijacked session wiping a
--      user's race history. `account_deletions` holds the pending request; the
--      `process-account-deletions` edge function does the irreversible work
--      (Storage objects + the auth row — neither of which SQL should delete
--      directly) once the window elapses.

-- ── Extensions (scheduling + outbound HTTP for the deletion worker) ───────────
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── 1. IP retention purge ─────────────────────────────────────────────────────
-- SECURITY DEFINER so the cron job (and an authorized edge function) can run it
-- regardless of the caller. Touches only abuse-prevention columns/rows.
create or replace function public.purge_expired_personal_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- (a) Drop the submitter IP once the abuse-investigation window (90d) passes.
  update public.submissions
     set submitted_by_ip = null
   where submitted_by_ip is not null
     and created_at < now() - interval '90 days';

  update public.messages
     set submitted_by_ip = null
   where submitted_by_ip is not null
     and created_at < now() - interval '90 days';

  -- (b) Delete the rows themselves once their content is no longer needed (1y).
  -- Contact messages (email + free-text) go entirely.
  delete from public.messages
   where created_at < now() - interval '1 year';

  -- Reviewed submissions go; pending ones are kept so they can still be
  -- moderated regardless of age.
  delete from public.submissions
   where status <> 'pending'
     and created_at < now() - interval '1 year';

  -- Expired bans no longer protect anything — remove the IP entirely.
  delete from public.banned_ips
   where expires_at is not null
     and expires_at < now();

  -- Stale rate-limit rows (the edge function also clears these reactively).
  delete from public.login_attempts
   where locked_until is not null
     and locked_until < now();
end;
$$;

revoke all on function public.purge_expired_personal_data() from public, anon, authenticated;

-- ── 2. Scheduled account deletion ─────────────────────────────────────────────
create table if not exists public.account_deletions (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  requested_at  timestamptz not null default now(),
  scheduled_for timestamptz not null
);

alter table public.account_deletions enable row level security;

-- A user may SEE and CANCEL (delete) their own pending request. There is no
-- INSERT/UPDATE policy: only the service role (the request-account-deletion edge
-- function) can create a request, so a client can never shorten the 7-day window
-- or schedule a deletion for someone else.
drop policy if exists "Users read own deletion" on public.account_deletions;
create policy "Users read own deletion"
  on public.account_deletions for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users cancel own deletion" on public.account_deletions;
create policy "Users cancel own deletion"
  on public.account_deletions for delete to authenticated
  using (auth.uid() = user_id);

-- Accounts whose grace window has elapsed — read by the deletion worker.
create or replace function public.due_account_deletions()
returns setof uuid
language sql
security definer
set search_path = public
as $$
  select user_id from public.account_deletions where scheduled_for <= now();
$$;

revoke all on function public.due_account_deletions() from public, anon, authenticated;

-- ── 3. Schedule the jobs (idempotent, and tolerant of missing config) ─────────
do $$
declare
  v_secret text;
  v_url    text := 'https://svjlieovpyiffbqwhtgk.supabase.co/functions/v1/process-account-deletions';
begin
  -- Re-running the migration must not error on already-scheduled jobs.
  if exists (select 1 from cron.job where jobname = 'purge-expired-personal-data') then
    perform cron.unschedule('purge-expired-personal-data');
  end if;
  if exists (select 1 from cron.job where jobname = 'process-account-deletions') then
    perform cron.unschedule('process-account-deletions');
  end if;

  -- IP retention purge: pure SQL, no secret needed — always scheduled. 03:17 UTC.
  perform cron.schedule(
    'purge-expired-personal-data',
    '17 3 * * *',
    $job$ select public.purge_expired_personal_data(); $job$
  );

  -- Account-deletion worker: posts to the edge function, which needs a shared
  -- secret (DELETION_CRON_SECRET env on the function). The secret lives in Vault
  -- under `deletion_cron_secret`; when present we auto-wire the daily job, else
  -- we leave a notice so the operator can add it (see README). 03:37 UTC.
  begin
    select decrypted_secret into v_secret
      from vault.decrypted_secrets
     where name = 'deletion_cron_secret'
     limit 1;
  exception when others then
    v_secret := null;
  end;

  if v_secret is not null then
    perform cron.schedule(
      'process-account-deletions',
      '37 3 * * *',
      format(
        $job$ select net.http_post(
          url := %L,
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', %L),
          body := '{}'::jsonb
        ); $job$,
        v_url, v_secret
      )
    );
  else
    raise notice 'account_deletions: set Vault secret "deletion_cron_secret" (and the matching DELETION_CRON_SECRET env on the process-account-deletions function), then re-run this migration to auto-schedule the worker. See README.';
  end if;
end $$;
