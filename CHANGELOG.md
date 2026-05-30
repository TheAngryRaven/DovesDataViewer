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
- Cloudflare Workers deployment support: `wrangler.jsonc` (static-assets-only
  Worker serving `./dist` with single-page-application not-found handling),
  `public/_headers` (no-cache for the service workers + `index.html`, immutable
  long-cache for hashed assets), an `.nvmrc` pinning Node 20, and a Deployment
  section in the README documenting the build settings and how to flip on admin
  via env vars.

### Changed
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
