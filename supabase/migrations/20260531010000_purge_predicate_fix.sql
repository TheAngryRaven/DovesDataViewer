-- Restore the documented personal-data retention predicates.
--
-- 20260527010000_gdpr_compliance defined purge_expired_personal_data to delete
-- submissions once they're no longer pending (status <> 'pending') after 1 year,
-- and stale login_attempts as soon as their lock elapses (locked_until < now()).
-- The later Lovable batch (20260528001943) redefined the same function with
-- LOOSER predicates — submissions only when reviewed_at IS NOT NULL, and
-- login_attempts only after locked_until < now() - 30 days. Because that
-- migration runs later, it won the `create or replace`, silently retaining
-- submitter free-text past the documented 1-year GDPR window for
-- rejected-but-unreviewed rows (and lock rows 30 days longer than intended).
--
-- This re-asserts the documented contract as the final definition. Idempotent.
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

  -- Reviewed/handled submissions go after a year; pending ones are kept so they
  -- can still be moderated regardless of age. "Not pending" — NOT "reviewed_at
  -- is set" — so a rejected row whose reviewed_at was never backfilled is still
  -- purged on schedule.
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
