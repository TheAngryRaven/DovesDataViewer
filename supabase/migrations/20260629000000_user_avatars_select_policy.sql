-- Plan 0006 — avatar upload fix: add the missing SELECT policy on user-avatars.
--
-- Avatar uploads use `upsert: true`, so storage-api first checks whether the
-- object already exists — a SELECT on storage.objects under the caller's role.
-- The user-avatars bucket got INSERT/UPDATE/DELETE policies but NO SELECT, so
-- that existence check was denied and the upload 403'd ("Unauthorized") even
-- though the INSERT policy itself was correct (verified: request folder ==
-- auth.uid(), valid authenticated JWT). The user-files bucket has always carried
-- this read policy — mirror it here so the upsert can complete. Public reads of
-- avatars go through the bucket's public URL and are unaffected either way.
--
-- Idempotent + a fresh version, so it self-heals the beta DB (where the bucket's
-- write policies already exist) and is a clean addition on main / any fresh DB.

drop policy if exists "Users read own avatar" on storage.objects;
create policy "Users read own avatar"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'user-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
