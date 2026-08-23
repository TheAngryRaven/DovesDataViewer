-- Plan 0019 — the in-session help button also sends the session's track data.
--
-- A datalog alone can't reproduce a lap/sector complaint: the start/finish
-- line, sector lines and layout the session was analysed against live in the
-- user's localStorage. The contact dialog now uploads that track bundle as a
-- second attachment (same private support-files bucket, same service-role
-- upload path as the datalog), so support gets the geometry with the log.

alter table public.messages add column if not exists track_file_name text;
alter table public.messages add column if not exists track_file_size bigint;
alter table public.messages add column if not exists track_storage_path text;
alter table public.messages add column if not exists track_compression text;

-- ── Retention ────────────────────────────────────────────────────────────────
-- Re-declare purge_expired_personal_data() (last defined in
-- 20260728120000_message_attachments.sql) so the new track objects are purged
-- with their message, exactly like the datalog attachment. Everything else in
-- the function is unchanged.

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
       select track_storage_path from public.messages
        where track_storage_path is not null
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
