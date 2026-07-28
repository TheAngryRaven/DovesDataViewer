-- Plan 0013 — Parse-error support reports.
--
-- When a datalog fails to parse, users (signed in or not) can send the file
-- plus a message to the support team for diagnosis. Rows are inserted ONLY by
-- the submit-parse-report edge function (service role) so all abuse controls
-- (IP ban, rate limit, size caps) live in one place; there is deliberately no
-- insert policy. Files land in a private bucket that only admins can read.

create table if not exists public.parse_error_reports (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  email text,
  error_text text,                       -- the parser exception shown to the user
  app_version text,
  file_name text not null,               -- original name, restored on admin download
  file_size bigint not null,             -- original (uncompressed) size in bytes
  storage_path text not null,            -- object path in the support-files bucket
  compression text,                      -- 'gzip' when the client compressed the upload
  user_id uuid references auth.users (id) on delete set null,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  submitted_by_ip text
);

alter table public.parse_error_reports enable row level security;

drop policy if exists "Admins can select parse error reports" on public.parse_error_reports;
create policy "Admins can select parse error reports"
  on public.parse_error_reports for select to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role));

drop policy if exists "Admins can update parse error reports" on public.parse_error_reports;
create policy "Admins can update parse error reports"
  on public.parse_error_reports for update to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role));

drop policy if exists "Admins can delete parse error reports" on public.parse_error_reports;
create policy "Admins can delete parse error reports"
  on public.parse_error_reports for delete to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role));

-- ── Private support-files bucket ─────────────────────────────────────────────
-- Writes go through the edge function's service role only. Admins read (to
-- download attachments) and delete (when removing a report).

insert into storage.buckets (id, name, public)
values ('support-files', 'support-files', false)
on conflict (id) do nothing;

drop policy if exists "Admins read support files" on storage.objects;
create policy "Admins read support files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'support-files'
    and public.has_role(auth.uid(), 'admin'::app_role)
  );

drop policy if exists "Admins delete support files" on storage.objects;
create policy "Admins delete support files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'support-files'
    and public.has_role(auth.uid(), 'admin'::app_role)
  );

notify pgrst, 'reload schema';
