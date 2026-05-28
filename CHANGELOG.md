# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> This changelog was introduced at the `1.5.0` release. An early `V1.0.0` tag
> exists from March 2026, but predates the changelog; no per-version records
> were kept between it and `1.5.0`. The `1.5.0` entry below is reconstructed
> from git history and grouped by theme rather than exhaustive per-commit
> detail.

## [Unreleased]

### Added
- **Lap snapshots — frozen "course fastest lap" per engine.** Capture a single
  lap (its GPS samples plus a 5-second buffer on each side, the course geometry,
  the engine, and a copy of the vehicle/setup) as an immutable baseline you can
  load and compare against any later session on that course — regardless of the
  engine you're running now (the loaded snapshot shows its engine, so 2-stroke
  vs 4-stroke reads clearly).
  - **One per (course, engine).** Assigning an engine + setup to a log prompts to
    save/update the course fastest lap when its best lap beats (or has no) stored
    snapshot; a manual **Save as snapshot** action lives in the lap-list
    **Snapshots** picker too. A faster lap replaces the snapshot in place.
  - **Loaded as the reference lap (comparison overlay)** — never auto-plays, and
    is excluded from playback and the video player (it rides the reference-overlay
    slot, not the lap selection). Pick one from the **Snapshots** menu next to the
    lap dropdown (simple + pro), or from a **"Load snapshot as reference"** button
    next to the external-reference loader on the lap times page.
  - **Exposed to plugin panels** via `PluginPanelProps.activeSnapshot` (a
    `PluginSnapshot` with clean-lap samples + frozen engine/course/vehicle/setup)
    and `PluginPanelProps.sessionSetup` (the setup the driver is currently
    running), so the AI coach can compare the current session and setup against a
    frozen course-fastest-lap baseline.
  - **Local-first & unlimited on-device; cloud-synced with per-tier COUNT limits**
    (free 5 / plus 10 / premium 20 / pro 50) via a dedicated `lap_snapshots`
    table — not byte document storage. Snapshots always push on save, but a local
    delete never removes the cloud copy (like the log menu); the cloud copy is
    removed only explicitly from **Profile → Lap snapshots**, which also lists
    on-device snapshots when signed out.
- **GDPR self-service data tools** (Profile → **Data & privacy**, cloud builds):
  - **Download my data** — exports everything we hold about you as a single ZIP:
    your account data (profile, subscription, roles, synced garage records,
    contact messages, synced log files) plus the data stored locally in your
    browser (settings, garage stores, local session files). Backed by the new
    `export-account-data` edge function.
  - **Delete my account** — full self-service erasure. Confirmed by an emailed
    one-time code (guards against a hijacked session), then **scheduled 7 days
    out** and cancellable during that window, after which the account, its
    Storage files and all associated rows are permanently erased. Backed by the
    `request-account-deletion` and (cron-driven) `process-account-deletions`
    edge functions.
- **Automatic data-retention (TTL):** a daily job nulls the submitter IP on
  contact messages and community submissions **90 days** after they're received,
  then deletes the rows in full after **1 year** (contact messages entirely;
  community submissions once they've been reviewed — pending ones are kept for
  moderation), and clears expired IP bans and stale sign-in rate-limit records —
  so abuse-prevention and contact data are minimised even without traffic to
  trigger the existing reactive cleanup.
- **Age confirmation at sign-up:** account creation (email and Google) now
  requires ticking a checkbox confirming you are **16 or older**, alongside the
  existing Terms/Privacy agreement.
- **Banned-IP expiry in the admin panel:** banning an IP now takes a selectable
  duration (1 / 7 / 30 / 90 / 365 days or permanent), defaulting to **90 days**;
  expired bans are purged automatically.
- **Customizable engine types for vehicles**: the vehicle form's *Engine* field
  is now a searchable combobox backed by a reusable, per-user engine list. Type
  to filter previously used engines; if the name isn't found, create it inline.
  Existing vehicles' engine names are auto-imported into the list, and a *manage*
  link beside the field opens a small menu for deleting saved engines (engines
  currently in use by a vehicle are protected from deletion). The engine list is
  stored locally (IndexedDB) and travels with the rest of your garage data over
  cloud sync.
- **Terms of Service page** (`/terms`) and a rewritten **Privacy Policy** that
  now accurately reflect the optional online features — accounts, cloud sync,
  Stripe-billed plans, and AI coaching — instead of the old "nothing ever leaves
  your device" copy. Both pages adapt to the build flags (offline-only builds
  show the simpler policy) and are linked from the landing-page footer. Account
  sign-up now states the **16+ age requirement** and links both documents
  (under-16 users use the app offline only). AI coaching is documented as
  informational only — not safety or professional advice.
- **Paid subscription tiers**: Stripe-backed `Plus` ($1/mo, 500 MB logs),
  `Premium` ($3/mo, 1 GB logs), and `Pro` ($10/mo, 1 GB logs + AI coaching)
  plans on top of the free 20 MB tier. Plan limits are
  data-driven (`subscription_tiers` table) and the cloud-sync storage quota is
  enforced per the user's tier. Backed by `create-checkout-session`,
  `stripe-webhook`, and `create-portal-session` edge functions; entitlements are
  granted solely by the verified Stripe webhook. The **Plans & pricing** cards
  now show live **Upgrade** / **Current plan** actions for signed-in users (a
  paid tier stays "Coming soon" until its Stripe Price is configured), and the
  **Profile** tab shows your plan with a **Manage subscription** link to the
  Stripe billing portal.
- **Monthly & annual billing**: each paid tier now offers a monthly or annual
  price, resolved live from Stripe by **lookup_key** (`plus_monthly`,
  `plus_annual`, `premium_monthly`, …) so the Stripe dashboard is the single
  source of truth — no Price ids in code. The pricing cards gain a
  **monthly/annual toggle**, and sign-up lets you **pick a plan + interval**: a
  paid choice creates the account first, then resumes to Stripe Checkout on your
  first sign-in (after email confirmation). A new public `stripe-prices` edge
  function feeds the catalogue.
- **No-Stripe failback**: when no Stripe secret key is configured, the pricing
  UI shows only the two free cards (Guest + Free) and hides the paid tiers
  entirely instead of showing them as "Coming soon".
- **AI (Pro) tier is "coming soon"**: the AI-coaching plan is shown as a teaser
  but isn't self-service purchasable — it's not selectable at sign-up, has no
  Upgrade button, and `create-checkout-session` rejects it. It can still be
  comped to a tester by creating the subscription directly in Stripe (the
  webhook grants whatever tier the price maps to). Gated by a single
  `COMING_SOON_TIERS` set in `lib/billing.ts`.
- **Cancellation grace + log trimming**: cancelling ends service at the period
  boundary and drops you to the free tier's limits, but your cloud logs are kept
  for a **60-day grace window** to re-subscribe or download. After it expires, a
  daily `pg_cron` job (`trim_expired_logs()`) trims synced logs **newest-first**
  to the free allowance. The Profile tab surfaces the cancellation/grace date.
- Document storage + **auto-sync**: when you're signed in, your garage
  (vehicles, setups, setup templates, notes) now backs up to the cloud
  automatically as you change it — no manual push. The "documents" storage type
  is free with a **5 MB** limit; raw session **logs** are a separate **20 MB**
  storage type. Limits are enforced server-side.
- **Propagation deletes**: deleting a vehicle or setup while signed in removes it
  from **every device and the cloud**, with a clear warning before you confirm.
- New **Profile** tab (far right) showing your cloud storage usage against the
  document and log limits.
- **Cloud log management** (Profile tab): see the session log files stored in your
  cloud — with upload date and size — and delete them. Deleting removes the
  **cloud copy only** (other devices keep what they've already downloaded), with
  an optional toggle to **also delete the local copy from this device**. Clear
  "this can't be undone" warning.
- **User display names**: choose a unique display name when you register, or get a
  fun auto-generated one (e.g. `SpeedyRac3r-546`) if you leave it blank — editable
  any time from the Profile tab, with a clear "that name's taken" message. Existing
  accounts are given a generated name automatically.
- Plugin UI panel framework: plugins can contribute self-contained panels to a
  named slot, starting with the Labs tab. The tab now appears automatically when
  a plugin contributes a panel, and each panel is isolated by an error boundary.
- Dedicated AI Coach tab: a new top-level view (`PanelSlot.Coach`) that hosts the
  coaching plugin's session-debrief dashboard. Like Labs, it is self-gating — the
  tab only appears when the coach plugin is installed and contributes a panel. The
  bundled coach (`@perchwerks/eye-in-the-sky` 0.2.5) ships a full-bleed analysis
  dashboard (uPlot telemetry charts, corner/sector breakdowns) that loads lazily,
  off the initial bundle.
- Plugin panels can now be **chromeless** — a panel may render full-bleed without
  the host's card/header/padding (used by the coach dashboard), while keeping its
  error boundary and Suspense.
- Cloud Sync (first-party plugin, in the Labs tab): sign in to back up and sync
  your session files and garage data (vehicles, setups, notes, graph prefs) to
  the cloud and pull them onto another device. Manual push/pull; data is private
  per account. Requires a backend (Supabase) and a connection — fully optional
  and offline-first otherwise.
- Cloud Sync — per-file selection: each file in the file manager has a sync
  toggle, so you choose exactly which sessions sync (opt-in, off by default).
  Pushing now uploads only your selected files (plus garage data). Selecting a
  file while offline records the intent and uploads once you're back online.
  A "Cloud files" list under the file manager shows everything in your cloud —
  files already on this device are marked as such, and any that aren't get a
  one-click pull.
- Public user accounts (gated by `VITE_ENABLE_CLOUD`, default off): email +
  password sign up / sign in, Google sign-in via Lovable Cloud managed OAuth,
  forgot-password and reset-password flows. New routes: `/register`,
  `/forgot-password`, `/reset-password`, `/auth/callback`. A "Sign in" /
  "Sign out" affordance appears in the landing-page header when the flag is on.
  Regular accounts have no admin privileges (admin role remains driven by
  `user_roles`).

### Added
- Deleting a **synced log locally** now offers an opt-in *"also delete the cloud
  copy"* toggle in the delete confirm (off by default — the cloud copy is a
  backup). When offline, the cloud delete queues and propagates on reconnect.
- Your custom **tracks & courses now sync to the cloud** too (documents storage),
  the same way setups do — auto-sync, delete propagation, and the offline-aware
  timestamp merge. Only your user-created tracks/courses sync; built-in tracks
  stay local.
- **Plans & pricing** cards on the landing page (below the sample) and on the
  registration page — Free offline, Free online (20 MB cloud logs), and paid
  tiers (marked "Coming soon" until billing is wired up).
- **"Download all cloud logs"** button at the bottom of the file manager:
  one-click bulk pull of every cloud log not already on this device.
- Registration now supports a **Cloudflare Turnstile captcha** when
  `VITE_TURNSTILE_SITE_KEY` is set (gracefully skipped when it isn't), and
  rejects **disposable / temporary email** addresses.

### Changed
- Bumped the optional AI coach plugin (`@perchwerks/eye-in-the-sky`) from
  `0.2.5` to `0.3.0`.
- **Registration page** now shows the **Plans & pricing** cards above the
  sign-up form instead of below it.
- **Cloud Sync moved out of the Labs tab**: sign-in and manual push/pull now live
  on the **Profile** tab as an "Account" panel. The Labs tab no longer appears
  unless the experimental setting is on or a plugin contributes to it.
- Landing-page and About copy now reflect **optional cloud storage** (instead of
  "files never leave your device"), since cloud sync is available when signed in.
- When local garage data exceeds the cloud **documents** limit, sync now does a
  **partial push** — it saves everything that fits and tells you how many items
  didn't — instead of rejecting the whole batch and syncing nothing.
- Cloud document sync is now **offline-aware and conflict-safe**. Garage records
  (vehicles, setups, templates, notes) carry an edit timestamp, and sync uses
  last-write-wins, so a newer change is never overwritten by an older copy.
  Changes made **offline** are saved as pending and, on reconnect, take
  **priority** — replacing the cloud copy. The Profile tab flags when you're
  offline and how many changes are waiting to sync.
- Telemetry channels are now normalized to a canonical identity at import time,
  so the Settings "default fields" show/hide and your saved graph and video-
  overlay selections apply **consistently across every logger format** (e.g.
  lateral G is one channel whether the file came from a Dove, AiM, Alfano, or
  VBO log). Existing files keep their saved graph/overlay choices — legacy field
  names are migrated transparently on load.
- Lap delta / pace is now **position-based** by default: your line is projected
  onto a reference lap resampled to a uniform arc-length grid, so the gap is
  robust to racing-line and GPS-rate differences and no longer drifts over a lap
  (the old cumulative-distance method is selectable under Settings → Lap Delta).
  This upgrades the pace readout everywhere — charts, race-line, overlays, and
  video export.
- Build flag rename: `VITE_ENABLE_REGISTRATION` retired. Cloud auth routes
  (`/register`, `/forgot-password`, `/reset-password`, `/auth/callback`) and the
  Cloud Sync Labs panel are now all gated by the single `VITE_ENABLE_CLOUD`
  flag. `VITE_ENABLE_ADMIN` continues to gate `/admin` independently; `/login`
  mounts when either flag is on. With `VITE_ENABLE_CLOUD` off, no auth pages,
  Google OAuth SDK, or Cloud Sync panel are included in the bundle.
- Build-time env vars now also accept an `HTT_` mirror prefix
  (`HTT_SUPABASE_URL`, `HTT_SUPABASE_PUBLISHABLE_KEY`, `HTT_SUPABASE_PROJECT_ID`,
  `HTT_ENABLE_CLOUD`, `HTT_ENABLE_ADMIN`) so contributors can store backend
  wiring in Lovable workspace build secrets instead of committing a `.env`.
  Precedence: `VITE_*` > `HTT_*` > built-in public fallback. See `.env.example`.
- Lovable preview URLs now aggressively unregister service workers and clear
  Cache Storage so preview tabs stop serving stale builds after updates.
- The optional AI coach plugin now ships from the public npm registry as
  `@perchwerks/eye-in-the-sky` and loads by default — no build token or `.npmrc`
  required. (Previously a private GitHub Packages package gated behind
  `NODE_AUTH_TOKEN`.)

### Security
- **Password reset is now gated on a real recovery session.** `/reset-password`
  only lets you set a new password when the page was opened from the emailed
  recovery link (a `PASSWORD_RECOVERY` token) — so a merely signed-in session (a
  shared/unattended tab, a stolen token) can no longer change the account
  password without proving control of the email.
- **Account deletion now verifies the emailed code server-side.** The
  `request-account-deletion` function verifies the one-time code itself before
  scheduling, so a stolen JWT alone can't schedule deletion via a direct call —
  the caller must also possess the code we emailed.
- **No more cross-account data bleed in cloud sync.** Pending offline changes,
  cloud-deletion tombstones, and per-file sync selections are now partitioned per
  user, so signing out of one account and into another on the same browser can
  never flush the first account's queued state into the second's cloud.
- **Duplicate paid subscriptions are blocked.** Checkout refuses to start a
  second subscription when one is already active (plan changes route through the
  billing portal instead), preventing a double-billed account from a mis-click.
- **Stripe webhook is now replay- and ordering-safe.** Events are de-duplicated
  by id, and a `subscription.deleted` for a superseded subscription is ignored,
  so a retried or out-of-order delivery can't demote an active entitlement.
- **Account-deletion worker deletes the auth user before wiping files**, so a
  transient failure can no longer leave a half-deleted account whose files are
  already gone but whose rows and cancellation window remain.
- **GDPR retention restored to the documented window.** A later migration had
  quietly loosened `purge_expired_personal_data` (keeping rejected-but-unreviewed
  submissions and lock rows past their intended TTL); the documented predicates
  are reasserted.
- Fresh clones default to the **offline-first public app** again:
  `VITE_ENABLE_ADMIN` and `VITE_ENABLE_CLOUD` now default to `false` in the
  build fallbacks, so a build without injected env doesn't ship admin/cloud UI
  pointed at an upstream backend. Production enables them explicitly.

### Fixed
- **Lap snapshots are now direction-aware.** A course driven in reverse keeps a
  separate "fastest lap" snapshot from the forward direction instead of
  overwriting it (and the position-based pace overlay refuses to compare against
  a reference recorded in the opposite direction, rather than showing nonsense
  gains).
- **Saving a snapshot manually won't silently destroy a faster one.** "Save
  current lap as snapshot" now asks before replacing a stored snapshot that's
  faster than the lap you're saving.
- **Plugin tabs (Coach, Profile, Labs) appear even when a plugin registers its
  panels asynchronously** — the tab list now reacts to plugin contributions
  instead of freezing the snapshot at first render, so the AI coach tab no longer
  goes missing until a full page reload.
- **Pull no longer downgrades a newer local record** or silently opts files into
  ongoing sync — a manual Pull keeps a local edit that's newer than the cloud
  copy and just downloads files without flipping their sync state.
- **Cloud orphan-blob cleanup no longer races a concurrent upload**: only objects
  older than a grace window are reclaimed, so a file uploaded at the same moment
  the Profile tab opens can't be deleted before its index row commits.
- **Lap-snapshot insert failed with `null value in column "id" of relation
  "lap_snapshots" violates not-null constraint`** — same root pattern as the
  missing unique constraint: when the `lap_snapshots` table pre-existed the
  snapshots migration, `CREATE TABLE IF NOT EXISTS` skipped the whole
  declaration, so the `id uuid primary key default gen_random_uuid()` column
  came in without its default. `pushSnapshot` doesn't send an id (it shouldn't),
  so the insert had nothing to fill it with. A follow-up migration re-sets the
  column defaults idempotently so existing deployments self-repair.
- **Lap-snapshot upsert failed with "no unique or exclusion constraint matching
  the ON CONFLICT specification"** when the `lap_snapshots` table pre-existed
  the snapshots migration — the inline `unique (user_id, course_key, engine_key)`
  in `CREATE TABLE IF NOT EXISTS` was skipped along with the table, so reconcile
  and the manual "Sync local snapshots" button both errored. A follow-up
  migration adds the constraint as an idempotent unique index so existing
  deployments self-repair on apply.
- **PostgREST schema cache reload** after the subscriptions/snapshots migration
  batch. Newly-created tables and functions (`subscription_tiers`,
  `user_subscriptions`, `lap_snapshots`, `snapshot_usage()`, …) existed in the
  database but were invisible over the REST API until the cache reloaded —
  breaking checkout (non-2xx), lap-snapshot sync, and the snapshot usage meter
  while Stripe price loading (which bypasses PostgREST) still worked. A migration
  now issues `notify pgrst, 'reload schema'`.
- Lap-snapshot and document auto-sync now reconcile **independently** — a failure
  in one (a missing table, a quota rejection) no longer silently skips the other.
- The Profile **Lap snapshots** panel no longer blanks out when the usage meter
  can't load; the snapshot list stays usable and the meter is treated as
  best-effort.
- The Profile **Lap snapshots** panel now reconciles on open (uploading any
  local-only snapshots) and refreshes live on snapshot changes, so it
  self-heals a sign-in reconcile that failed (e.g. a transient outage) without
  needing an app reload.
- Cloud log uploads no longer **orphan a blob** when the server quota rejects the
  index write — the just-uploaded blob is rolled back. Any pre-existing orphans
  are reclaimed when the Cloud logs panel is opened.

## [1.5.0] - 2026-05-22

The first changelogged release. Dove's DataViewer is a feature-complete,
offline-first, installable PWA for viewing and analyzing motorsport telemetry —
live at [hackthetrack.net](https://hackthetrack.net). This release also adds the
open-source project scaffolding and a bundle-size pass.

### Added — Open Source & Tooling
- Open-source project hygiene: `CONTRIBUTING.md`, `SECURITY.md`,
  `CODE_OF_CONDUCT.md`, this `CHANGELOG.md`, GitHub issue/PR templates, and
  Dependabot configuration.
- README **Credits** and **License** sections; populated `package.json`
  metadata (name, version, license, repository, author).

### Added — File Formats
- Auto-detecting import for UBX (u-blox), VBO (Racelogic/RaceBox), Dove &
  Dovex (DovesDataLogger), Alfano, AiM MyChron, MoTeC (CSV + native LD binary),
  and NMEA 0183.
- `.dovex` extended format with an 8 KB metadata header (driver, course, lap
  times) that degrades gracefully to raw GPS if metadata is corrupt.

### Added — Analysis & Visualization
- Automatic track & course detection within a 5-mile radius, with
  forward/reverse direction detection.
- Waypoint mode fallback for lap timing with no known track.
- Automatic lap detection via start/finish line crossing, with 3-sector split
  timing and optimal-lap calculation.
- Interactive Leaflet race-line map with speed heatmap and braking-zone
  detection/visualization.
- Pro graph view with multi-series Canvas telemetry charts, reference-lap
  overlay, and pace-delta comparison.
- G-force derivation from GPS with configurable smoothing.

### Added — Video & Overlays
- Video sync with telemetry playback.
- Nine overlay gauge types (digital, analog, graph, bar, bubble, map, pace,
  sector, lap time) with Classic and Neon themes.
- MP4 export via WebCodecs (H.264 + AAC), with a MediaRecorder fallback.

### Added — Data Management
- Vehicle profiles, template-driven setup sheets, and per-session notes.
- IndexedDB-backed storage for files, metadata, karts, notes, setups,
  video-sync points, and graph preferences.
- Custom track & course editor with map drawing and community submissions.

### Added — Devices & Connectivity
- BLE integration with the DovesDataLogger (file download, device settings,
  battery, and full track sync over Web Bluetooth).
- Local weather lookup (IEM ASOS / NWS).
- Optional, fully gated admin backend (Supabase) for the community track
  database — the core app makes zero database calls on normal loads.

### Added — Platform
- Installable PWA with full offline support via service worker + IndexedDB.
- Dark & light mode.

### Changed — Quality Pass (May 2026)
- Enabled TypeScript strict mode and fixed resulting type issues.
- Split CI into parallel lint / typecheck / test / build workflows with README
  badges.
- Refactored `Index.tsx` into composable hooks/contexts; split the BLE module
  into per-concern files under `src/lib/ble/` and added protocol tests.
- Hardened PWA cache recovery (NetworkFirst HTML, legacy `/sw.js` kill-switch),
  added safer production env fallbacks, and added SEO metadata
  (sitemap, robots, per-route head tags, `llms.txt`).
- Code-split the bundle with `React.lazy` boundaries and `manualChunks` vendor
  splitting, shrinking the initial gzip payload (~403 KB → ~294 KB) by deferring
  admin, pro view, file-manager drawer, BLE download, and the Leaflet editor off
  the first-load path.

[Unreleased]: https://github.com/TheAngryRaven/DovesDataViewer/compare/v1.5.0...HEAD
[1.5.0]: https://github.com/TheAngryRaven/DovesDataViewer/compare/V1.0.0...v1.5.0
