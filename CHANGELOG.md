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
- Plugin UI panel framework: plugins can contribute self-contained panels to a
  named slot, starting with the Labs tab. The tab now appears automatically when
  a plugin contributes a panel, and each panel is isolated by an error boundary.
- Cloud Sync (first-party plugin, in the Labs tab): sign in to back up and sync
  your session files and garage data (vehicles, setups, notes, graph prefs) to
  the cloud and pull them onto another device. Manual push/pull; data is private
  per account. Requires a backend (Supabase) and a connection — fully optional
  and offline-first otherwise.
- Cloud Sync — per-file selection: each file in the file manager has a sync
  toggle, so you choose exactly which sessions sync (opt-in, off by default).
  Pushing now uploads only your selected files (plus garage data). Selecting a
  file while offline records the intent and uploads once you're back online.
  Files that live in your cloud but not on this device are listed under the file
  manager with a one-click pull.
- Public user accounts (gated by `VITE_ENABLE_CLOUD`, default off): email +
  password sign up / sign in, Google sign-in via Lovable Cloud managed OAuth,
  forgot-password and reset-password flows. New routes: `/register`,
  `/forgot-password`, `/reset-password`, `/auth/callback`. A "Sign in" /
  "Sign out" affordance appears in the landing-page header when the flag is on.
  Regular accounts have no admin privileges (admin role remains driven by
  `user_roles`).

### Changed
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
