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
  bundled coach (`@perchwerks/eye-in-the-sky` 0.2.0) ships a full-bleed analysis
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

### Changed
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
