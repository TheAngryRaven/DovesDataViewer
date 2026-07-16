# Plan 0009 — Shared session links

**Status: implemented** (pending Supabase migration deploy + manual verification on a cloud build)

Public, opaque-token share URLs for cloud-uploaded logs. A signed-in user can
publish any cloud-synced session at `/s/{token}`; anyone with the link (including
anonymous visitors) opens it in the plan-0005 read-only viewer. A profile-level
default auto-publishes new uploads; per-session overrides work in both
directions. Public sessions also list on the driver's `/driver/:username` page.

## Product decisions (maintainer-approved)

1. **Auto-publish semantics** — `profiles.share_sessions_default` (default
   `false`). When on, every successful log push auto-creates a share
   (best-effort). When off, nothing is shared until the user flips a session
   public in the share modal. Per-session overrides both ways.
2. **Discovery** — public sessions are listed on the public driver profile page
   in addition to the direct link.
3. **Custom courses** — the frozen `Course` geometry is **embedded in the share
   row** (like leaderboard entries embed `entry.data.course`), so recipients get
   precise lap/sector timing immediately, with zero admin gating. User-defined
   courses are *additionally* auto-submitted to the community `submissions`
   queue (reusing `trackAutoSubmit`); approval only enriches `tracks.json`, it
   never blocks a link.

## Design decisions

### D1 — No filename in the public surface

The share URL must not leak the filename. RLS is row-level (can't hide columns)
and the repo deliberately avoids SECURITY DEFINER views, so the
**`shared_sessions` table simply has no filename column**. The owner-side
token↔filename mapping rides the log's private `sync_records` index row:
`data.share = { token }` (published) or `{ optedOut: true }` (explicitly
unshared). That's owner-only via existing RLS, cross-device, included in GDPR
export for free, cascades on account deletion, and is invisible to the quota
size function (`sync_record_size` reads only `data->>'size'`).

Accepted leak: a public `file_ext` column ("dovex", "xrk", …) — parser routing
needs it (binary formats detect by extension; the recipient reconstructs
`new File([blob], "shared-session." + ext)`). It reveals the logger format only.

Rejected alternatives: SECURITY DEFINER view (repo moved away from these);
column grants (can't distinguish owner from stranger within `authenticated`);
signed URLs / edge-function proxy (the signed URL embeds the object path, which
contains the filename; a streaming proxy violates "no server when client works").

### D2 — Shared ⇔ the `shared_sessions` row exists

No separate visibility store. The blob is **copied** (client-side re-upload of
the local/cloud blob) into the public `shared-sessions` bucket at
`{userId}/{token}` — the private `user-files` object never gets a public path.

- Auto-publish fires after a successful `pushFile` (`FileSyncToggle` →
  `maybeAutoPublish`), only when the profile default is on AND `data.share` is
  unset. A token or an opt-out both skip it — an unshared file never resurrects.
- Flipping the profile default affects **future uploads only** (no
  backfill/unpublish) — the settings copy says so.
- Unshare = delete row + public blob + set `data.share = { optedOut: true }`.
- `syncEngine.deleteCloudFile` is the deletion choke point: it reads the index
  row's token *before* deleting and best-effort removes the share row + blob.
- Server-side `trim_expired_logs` removes a trimmed log's share the same way
  (token read from `r.data->'share'->>'token'` in SQL).
- Token regeneration is out of scope v1 — unshare + reshare mints a fresh URL.
- **Bug fixed en route**: `uploadBlob` used to upsert `data: { size }` wholesale,
  which would clobber `data.share` on every re-upload. It now read-merges
  (regression-tested in `syncEngine.test.ts`).

### D3 — Quota

Shared copies are real second copies, so they **count** toward the pooled
per-tier byte budget: `shared_sessions.size_bytes` is summed into
`total_storage_used`, both existing enforce triggers, a new
`enforce_share_quota` BEFORE INSERT trigger, and the `logs_bytes` segment of
`sync_storage_usage()` (client row shape unchanged). `trim_expired_logs` counts
shared bytes as trimmable log bytes. Fallback if this ever proves problematic:
stop counting shared bytes (they duplicate an already-counted log) by dropping
the sum terms + trigger.

### D4 — Viewer route

`/s/:token` (cloud-gated, `App.tsx`) renders `<Index />`; Index reads the param
and self-loads — the URL is reload-safe and works cold for anonymous visitors
(unlike the in-memory leaderboard handoff). Flow: anon-fetch the row
(`publicShare.fetchSharedSession`, with the owner's live display name via the
`shared_sessions_profile_fkey` embed) → fetch the public blob → client-side
`parseDatalogFile` → `buildSharedSessionBundle` (`lib/shareSession.ts`) runs
**real `calculateLaps`** against the embedded course (contiguous single-driver
recording — no synthetic stitching) → inject through the same read-only state
path as leaderboards. `LeaderboardDescriptor` gained optional
`driverLabel`/`dateLabel` (and `engineLabel` became optional); `exitReadOnly`
navigates by source (`share` → `/`, `leaderboard` → `/leaderboards`).

## Key files

- `supabase/migrations/20260715000000_shared_sessions.sql` — table, RLS, public
  bucket + policies, profiles column, quota redefinitions
- `src/plugins/cloud-sync/`: `shareToken.ts`, `shareState.ts` (pure),
  `sessionShare.ts` (share/unshare/auto-publish orchestration),
  `publicShare.ts` (anon reads), `ShareFileButton.tsx` + `ShareSessionDialog.tsx`
  (UI), `cloudClient.ts` (+`sharedSessions()`/`sharedFiles()`), `profile.ts`
  (+`updateShareDefault`), `syncEngine.ts` (index-row read/patch helpers, share
  cleanup in `deleteCloudFile`, share-preserving `uploadBlob`),
  `trackAutoSubmit.ts` (refactored: reusable `submitCustomCourse`),
  `StoragePanel.tsx` (default toggle), `CloudLogsPanel.tsx` (per-row share)
- `src/lib/shareSession.ts` — pure bundle builder; `src/lib/leaderboardSession.ts`
  — widened descriptor
- `src/pages/Index.tsx` (share-load effect + `readOnlySource`), `src/App.tsx`
  (route), `src/pages/DriverProfile.tsx` (Shared sessions section),
  `src/components/LapTable.tsx` (descriptor segments)
- Edge fns: `process-account-deletions` (wipe shared bucket),
  `export-account-data` (include share rows)

## Follow-up polish (maintainer feedback after the BETA merge)

- Opening a share selects the **fastest lap** (was: whole-session view).
- **OverlaysMenu is enabled in read-only** (shares AND leaderboards) so viewers
  can compare read-only laps against their own local sessions.
- **Weather works in read-only**: the map + pro-mode InfoBox weather panels lost
  their `readOnly` gates, but the per-session weather cache and the
  station-metadata write-back are skipped (the synthetic "shared"/"leaderboard"
  file names must never key a cache entry or a metadata row).
- The pro-mode **InfoBox Vehicle tab is hidden** in read-only (was missed —
  saving a vehicle/setup makes no sense on a read-only view).

## Post-deploy

- Apply the migration, then regenerate `integrations/supabase/types.ts`
  (`shared_sessions` + the `profiles` column currently ride the untyped
  `cloudClient` escape hatch, per the leaderboards precedent).
- `bun run i18n:seed` for the new `share.*` / `driver.shared*` /
  `leaderboard.share.*` keys (English fallback until then).
