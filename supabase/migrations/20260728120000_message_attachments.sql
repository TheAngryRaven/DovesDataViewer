-- Plan 0013 (follow-up) — contact messages can carry a datalog attachment.
--
-- The in-session help button opens the contact dialog; with a session loaded
-- the user can opt to attach the current session's datalog. The file lands in
-- the same private support-files bucket as parse-error reports (admin-only
-- read/delete), uploaded by the submit-message edge function's service role.

alter table public.messages add column if not exists file_name text;
alter table public.messages add column if not exists file_size bigint;
alter table public.messages add column if not exists storage_path text;
alter table public.messages add column if not exists compression text;

-- ── Retention: fold the new artifacts into the GDPR purge ────────────────────
-- Extends purge_expired_personal_data() (gdpr_compliance.sql):
--  * parse_error_reports (added after the original purge shipped) now follow
--    the same policy as messages — IP nulled at 90 days, rows deleted at 1 year;
--  * support-files objects attached to purged messages/reports are removed
--    with their rows so attachments never outlive the report they explain.
--    (SQL-level storage.objects delete — same transaction, no HTTP hop.)

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

  update public.parse_error_reports
     set submitted_by_ip = null
   where submitted_by_ip is not null
     and created_at < now() - interval '90 days';

  -- (b) Delete the rows themselves once their content is no longer needed (1y).
  -- Attachments first, so support files never outlive their row.
  delete from storage.objects
   where bucket_id = 'support-files'
     and name in (
       select storage_path from public.messages
        where storage_path is not null
          and created_at < now() - interval '1 year'
       union all
       select storage_path from public.parse_error_reports
        where created_at < now() - interval '1 year'
     );

  -- Contact messages (email + free-text) go entirely.
  delete from public.messages
   where created_at < now() - interval '1 year';

  delete from public.parse_error_reports
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

notify pgrst, 'reload schema';
