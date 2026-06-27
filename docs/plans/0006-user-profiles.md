# Plan 0006 — User Profiles

Status: implemented on branch `claude/user-profiles-images-fheq7s`.

## Why

Leaderboards (plan 0005) gave the app its first public, anonymous-readable cloud
surface, but user identity was just a `display_name` on a `profiles` table that
was authenticated-read only, case-sensitively unique, and had no avatar. This plan
rounds out the web app with **public driver profiles**: a face (avatar), a name you
can't impersonate by changing case, a sharable page showing a driver's vehicles and
uploaded leaderboard snapshots, and avatar thumbnails on the Leaderboards.

## What shipped

1. **Avatars.** Tap the profile picture on the Profile tab → on-device 1:1 centre-crop +
   downscale to ≤256px (`src/lib/imageCrop.ts`, pure + tested) → upload to a new **public**
   `user-avatars` bucket. The fixed object path + an `avatar_updated_at` `?v=` cache-buster
   make replacements repaint.
2. **Case-insensitive unique display names.** A destructive pre-flight de-dups any
   case-collisions (acceptable at ~5 users), then a `unique index on lower(display_name)`
   replaces the case-sensitive constraint. The `random_display_name`/`unique_display_name`
   SQL functions now compare case-insensitively. `/driver/:username` resolves via `.ilike`.
3. **Public `/driver/:username` page** (`src/pages/DriverProfile.tsx`, lazy, anon): avatar +
   name, the driver's **opt-in vehicles** (name/type/engine/number — never weight/setup), and
   approved leaderboard entries grouped by **course → weight** (`src/lib/driverProfileGroups.ts`,
   pure + tested). Unknown name → a "not found" state that keeps the header + back button.
4. **Opt-in vehicle publishing.** `Vehicle.publicProfile` flag (a *Show on profile* toggle in
   `VehiclesTab`) drives a public-safe projection into a new `public_vehicles` table, synced off
   the existing garage-change path (`autoSync.pushOne` → `publicVehicleSync.ts`). Unflag/delete
   removes the public row. Best-effort (self-heals on the next edit); the private `sync_records`
   backup is unchanged.
5. **Copy profile link** button under Sign out; **avatar thumbnails** left of names on
   Leaderboards rows; **← Back to home** on both off-session pages (`BackToHome.tsx`).

## Backend (two migrations)

- `20260627120000_profiles_ci_avatars.sql` — de-dup, `lower(display_name)` unique index,
  `avatar_path` + `avatar_updated_at` columns, CI name-resolution functions, and a
  column-limited anon-readable `public_profiles` **view** (RLS can't restrict columns, so a
  view is the right tool — exposes only `user_id, display_name, avatar_*`).
- `20260627120100_public_vehicles_and_avatar_bucket.sql` — `public_vehicles` table (anon read,
  owner write; FK-cascades on account delete), the public `user-avatars` bucket + owner-folder
  write policies.
- `process-account-deletions` now also empties the `user-avatars/{uid}/` folder (Storage objects
  aren't FK-cascaded).

## Key constraint honoured

`vendor-supabase` stays off the eager Index/Landing graph: all new Supabase access lives in
lazy `src/plugins/cloud-sync/*` (`publicProfile.ts`, `publicVehicleSync.ts`, avatar helpers in
`profile.ts`) or the lazy `DriverProfile` page, reached only via dynamic import. Build confirms
`DriverProfile`/`publicProfile` are their own chunks. `imageCrop.ts` is Supabase-free.

## Files

- Migrations: `supabase/migrations/20260627120000_*.sql`, `..._120100_*.sql`;
  `supabase/functions/process-account-deletions/index.ts`.
- New: `src/lib/imageCrop.ts`, `src/lib/driverProfileGroups.ts`, `src/pages/DriverProfile.tsx`,
  `src/components/BackToHome.tsx`, `src/components/ProfileAvatar.tsx`,
  `src/plugins/cloud-sync/publicProfile.ts`, `src/plugins/cloud-sync/publicVehicleSync.ts`,
  `src/locales/*/driver.json` (+ tests for the pure utils).
- Edited: `cloudClient.ts`, `profile.ts`, `leaderboardClient.ts`, `leaderboardBrowse.ts`
  (`GroupEntry.userId`), `autoSync.ts`, `vehicleStorage.ts`, `VehiclesTab.tsx`, `StoragePanel.tsx`,
  `Leaderboards.tsx`, `App.tsx`, i18n config/typing + `common`/`plugins`/`drawer` locales.

## Verification

`bun run lint`, `bun run typecheck`, `bun run test:run` (2051 pass), `bun run build` all green.
Manual end-to-end (staging Supabase needed): apply both migrations; upload/replace an avatar;
toggle a vehicle public on/off and confirm the `public_vehicles` row appears/disappears with no
weight column; open `/driver/<Name>` signed-out incognito (and a different-case URL); copy the
profile link; confirm the Leaderboards thumbnail and back-to-home button.

## Follow-ups

- Other languages were stop-gap seeded with the English strings (no API key in this
  environment); run `bun run i18n:seed` to machine-translate the new `driver` namespace + the
  added `common`/`plugins`/`drawer` keys (they carry no `_sourceHashes`, so they'll be picked up).
- Confirm the `public_profiles` view's definer-vs-`security_invoker` semantics on the target
  Postgres before relying on anon reads.
