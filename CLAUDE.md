# CLAUDE.md — Codebase Intelligence for AI Agents

## Project Identity

**Dove's DataViewer / HackTheTrack** — Open-source, offline-first motorsport telemetry viewer.
- Live: [hackthetrack.net](https://hackthetrack.net) | Published: [dovesdataviewer.lovable.app](https://dovesdataviewer.lovable.app)
- Companion hardware: [DovesDataLogger](https://github.com/TheAngryRaven/DovesDataLogger) (ESP32 GPS logger with BLE)
- PWA with full offline support via service worker + IndexedDB

---

## Golden Rules

1. **Offline-first**: 99% of features must work without network. Only weather, satellite tiles, and admin are exceptions.
2. **Modular & reusable**: Prefer small composable modules over monoliths. Rewrites for reusability are always welcome.
3. **Update README.md** when adding parsers, changing env vars, or modifying build params.
4. **Update credits** (in README) when adding new FOSS dependencies.
5. **Never do on the server what you can do on the client.**
6. **Add tests when possible**: New parsers, pure utilities, and protocol/format logic should ship with Vitest coverage. Bug fixes should add a regression test that fails before the fix. Don't leave testable logic untested.
7. **Keep `CHANGELOG.md` updated**: Add user-facing changes under the `[Unreleased]` heading (Keep a Changelog format) as you make them — don't wait for release time. Cut a new version section + tag when releasing.
8. **Keep it professional**: This is a public, released OSS project (v1.5.0+). Hold the bar — see the standards below.

---

## Code Quality & Professional Standards

This repo is public, released, and CI-gated. Treat every change as if a stranger
will read it tomorrow.

- **Green before merge**: `npm run lint`, `npm run typecheck`, `npm run test:run`,
  and `npm run build` must all pass. CI runs them as four separate workflows on
  every PR — don't merge red.
- **Tests are part of the change, not a follow-up.** See Golden Rule #6.
- **Changelog is part of the change.** See Golden Rule #7.
- **Docs stay in sync**: update `README.md`, this file, and the in-app
  `CreditsDialog.tsx` alongside the code that makes them stale (parsers, env
  vars, dependencies, architecture). The README Credits list and `CreditsDialog`
  must agree.
- **Small, focused PRs** with clear commit messages explaining the *why*. Prefer
  a topic branch + PR over committing to `main` directly.
- **No dead code, no boilerplate cruft**: delete unused code rather than
  commenting it out; no leftover `console.log`, no Lovable scaffolding defaults.
- **Comments explain *why*, not *what*** — only where the reason is non-obvious.
- **Respect the bundle budget**: keep lazy boundaries and vendor `manualChunks`
  intact (see Bundle Splitting below) so the initial payload stays small.
- **Honor the conventions below** (Tailwind tokens, composable hooks, parser
  contract, gated admin code). Consistency is a feature.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | React 18 + TypeScript |
| Build | Vite + vite-plugin-pwa (`/service-worker.js` active SW, `/sw.js` cleanup kill-switch) |
| Styling | Tailwind CSS + shadcn/ui (HSL design tokens in `index.css`) |
| Mapping | Leaflet (CartoDB + Esri tiles, cached 30 days by SW) |
| Charts | Custom Canvas 2D (not a library — see `TelemetryChart.tsx`, `SingleSeriesChart.tsx`) |
| Video Export | WebCodecs + [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) (H.264 video + AAC audio → MP4 output) |
| State | React hooks + React Query (for admin only) |
| Local Storage | IndexedDB (`dbUtils.ts`) for files/metadata/karts/notes/setups/video-sync/graph-prefs; localStorage for tracks & settings |
| Backend | None for core features. Optional admin via Supabase (Lovable Cloud) |
| BLE | Web Bluetooth API for DovesDataLogger device communication |

---

## Architecture Map

> Directory + entry-point level only. Leaf files are discoverable with
> `Glob`/`Grep`; ★ marks the load-bearing entry points worth knowing by name.

```
src/
├── pages/
│   ├── Index.tsx          # ★ Main SPA — file import, tab views, all state orchestration
│   ├── Admin.tsx          # Admin panel (behind VITE_ENABLE_ADMIN)
│   └── …                  # Login / Register / Privacy / Terms / NotFound
├── components/
│   ├── ui/                # shadcn/ui primitives
│   ├── admin/             # Admin tabs (Tracks, Courses, Submissions, BannedIps, Tools, Messages)
│   ├── tabs/              # Main view tabs (GraphView, RaceLine, LapTimes, Labs, Coach, Profile)
│   ├── graphview/         # Pro mode: GraphPanel, GraphViewPanel, MiniMap, SingleSeriesChart, InfoBox
│   ├── drawer/            # File-manager drawer tabs (Files, Vehicles/Karts, Notes, Setups, Device*)
│   ├── track-editor/      # Track editor sub-components (VisualEditor is lazy — see Bundle Splitting)
│   ├── video-overlays/    # Video-export overlay system: registry + themes + per-widget *Overlay,
│   │                      #   sectorUtils, dataSourceResolver, OverlaySettingsPanel, VideoExportDialog
│   ├── RaceLineView.tsx   # Leaflet map: race line, speed heatmap, braking zones
│   ├── TelemetryChart.tsx # Canvas speed/telemetry chart (simple mode)
│   ├── VideoPlayer.tsx    # Synced video playback + overlay system
│   ├── LapSnapshot*.tsx   # ★ Lap-snapshot picker (Controls) + "new fastest lap" save prompt
│   └── …                  # FileImport, DataloggerDownload (BLE entry, lazy), ContactDialog, …
├── hooks/                 # One concern each; Index.tsx orchestrates.
│   ├── useSessionData.ts  # Parses imported file → ParsedData
│   ├── useLapManagement.ts# Lap calc, selection, visible range
│   ├── usePlayback.ts     # Shared playback cursor (chart + map)
│   ├── useLapSnapshots.ts # ★ Lap-snapshot orchestration (capture/prompt/overlay)
│   ├── useReferenceLap / useVideoSync / useSettings / useSessionMetadata / useOnlineStatus
│   ├── use*Manager.ts     # IndexedDB CRUD: File, Vehicle (←Kart compat), Engine, Template, Note, Setup
│   └── useSubscription / useStripePrices   # billing, online — see docs/backend.md
├── lib/
│   ├── datalogParser.ts   # ★ Format auto-detection router (entry point for all parsing)
│   ├── *Parser.ts         # nmea, ubx, vbo, dove, dovex, alfano, aim, motec (+ parserUtils.ts)
│   ├── channels.ts        # ★ Canonical channel registry (ids/labels/units/aliases) + normalizeChannels()
│   ├── fieldResolver.ts   # Settings-facing adapter over channels.ts
│   ├── courseDetection.ts # ★ Auto track/course/direction detection + waypoint mode
│   ├── lapCalculation.ts  # Start/finish crossing detection → Lap[]
│   ├── lapDelta.ts        # ★ Position-based lap delta (arc-length resample + segment-projected gap)
│   ├── lapSnapshot.ts     # ★ Pure snapshot types/keying/buffer (course+engine identity)
│   ├── lapSnapshotStorage.ts # ★ IndexedDB CRUD for lap snapshots (emits garageEvents)
│   ├── setupRevision.ts  # ★ Pure content-addressed setup history: hash + freeze (immutable revisions)
│   ├── setupRevisionStorage.ts # ★ IndexedDB CRUD for setup revisions (freezeSetupRevision; emits garageEvents)
│   ├── dbUtils.ts         # ★ Shared IndexedDB: DB_NAME, DB_VERSION, openDB(), tx helpers
│   ├── garageEvents.ts    # ★ Host pub/sub: storage emits {store,key,put|delete}; cloud-sync syncs off it
│   ├── *Storage.ts        # IDB stores: file, kart(compat), vehicle, engine, template, note, setup,
│   │                      #   video, videoFile, graphPrefs; trackStorage = localStorage (user tracks)
│   ├── (racing math)      # brakingZones, speedEvents, speedBounds, gforceCalculation, referenceUtils, trackUtils
│   ├── (charts/video)     # chartUtils, chartColors, videoExport, overlayCanvasRenderer
│   ├── ble/               # Web Bluetooth DovesLapTimer protocol, split per-concern (see BLE Integration);
│   │                      #   + bleDatalogger.ts (legacy barrel), deviceTrackSync.ts, deviceSettingsSchema.ts
│   ├── db/                # Admin DB layer: ITrackDatabase + supabaseAdapter + getDatabase() factory
│   ├── billing.ts         # ★ Pure subscription logic, no Supabase import — see docs/backend.md
│   ├── billingClient.ts / pendingCheckout.ts   # Supabase billing I/O + sign-up checkout stash
│   ├── weatherService.ts  # OpenWeatherMap (online-only)
│   └── utils.ts           # Tailwind cn() helper
├── plugins/               # ★ Plugin framework (auto-discovered) — see Plugin Framework section
│   ├── (framework)        # types, registry, index, panels, mounts, storage + PluginPanelHost/PluginMount
│   ├── cloud-sync/         # ★ First-party plugin: Supabase file + garage sync — see docs/backend.md
│   └── coaching/           # Gitignored slot for the AI coach (npm pkg in production)
├── types/racing.ts        # ★ Core types: GpsSample, ParsedData, Lap, Course, Track, …
├── contexts/              # SettingsContext, DeviceContext (BLE), AuthContext (admin)
└── integrations/supabase/ # Auto-generated — DO NOT EDIT
```

---

## Data Flow Pipeline

```
File Import (drag-drop / BLE download / file manager)
  → fileStorage.ts (save raw blob to IndexedDB)
  → useSessionData.ts (read blob, call parseDatalogFile)
    → datalogParser.ts (auto-detect format, route to specific parser)
      → normalizeChannels() (channels.ts): rewrites every fieldMapping name + extraFields key to a canonical ChannelId (or `custom:` slug), sets display label/unit. Runs once for all formats — parsers keep emitting human names internally.
      → returns ParsedData { samples: GpsSample[], fieldMappings, bounds, duration, startDate, dovexMetadata?, parserStats? }
  → courseDetection.ts (auto-detect track, course, direction; waypoint fallback)
    → returns CourseDetectionResult { track, course, direction, laps, isWaypointMode }
  → useLapManagement.ts (detect laps via lapCalculation.ts using selected course's start/finish line)
    → returns Lap[] with timing, speed stats, sector times
  → Visualization:
      Simple mode: RaceLineView (Leaflet map) + TelemetryChart (Canvas)
      Pro mode: GraphViewPanel (multi-series Canvas charts) + MiniMap (Leaflet)
```

---

## Plugin Framework (`src/plugins/`)

Modular extension system. The open-source app defines the contract; plugins
implement `DataViewerPlugin` and are discovered from **two sources** at startup:
1. In-repo first-party plugins — `src/plugins/<name>/index.ts` via `import.meta.glob`.
2. External npm packages (the AI coach) — via the `virtual:external-plugins`
   module generated by `externalPluginsLoader` in `vite.config.ts`.
A plugin absent at build time simply never loads — the app builds/runs without it.

| File | Purpose |
|------|---------|
| `types.ts` | `DataViewerPlugin` (incl. `priority`), `PluginContext`, `PluginRegistry` contracts |
| `registry.ts` | Singleton registry: `register`/`get`/`list` + generic `contribute`/`getContributions`. Same-`id` plugins resolve by highest `priority` |
| `index.ts` | `initPlugins()` — glob + external discovery, runs each plugin's `setup(ctx)`. Called once in `main.tsx` before render |
| `external-plugins.d.ts` | Ambient type for the `virtual:external-plugins` module |
| `panels.ts` | **UI panel framework**: `PluginPanel` / `PluginPanelProps` contract, `PANELS_POINT`, `PanelSlot`, `getPanelsForSlot(slot)`. The curated session snapshot is the entire surface a panel can rely on — incl. `sessionSetup` (the current session's assigned setup) + `activeSnapshot` (`PluginSnapshot`: the loaded reference lap snapshot with clean-lap samples + frozen engine/course/vehicle/setup), so a coach panel can compare the current setup against the frozen snapshot setup |
| `PluginPanelHost.tsx` | Consumer: mounts every panel for a slot in a titled card, each wrapped in a per-panel error boundary; renders a `fallback` when none. A `chromeless` panel skips the card chrome (full-bleed); an all-chromeless slot (`isBareSlot`) drops the host's outer padding so one panel fills the tab |
| `mounts.ts` | **Inline mount framework**: `PluginMountDef`, `MOUNTS_POINT`, `MountSlot` (`FileRow`, `FileManagerSection`), per-slot context types, `getMounts(slot)`. For injecting raw components into fixed spots in core UI |
| `PluginMount.tsx` | Consumer: `<PluginMount slot ctx>` renders every mount for a slot (error-boundaried + Suspense), or nothing when none — safe to drop into core UI unconditionally |
| `storage.ts` | `getPluginStore(id)`: schema-less KV scoped to one plugin, in its own IndexedDB DB (`dove-plugin-<id>`). Decoupled from core `dbUtils`. Also exposed as `ctx.storage` |
| `coaching/` | **Gitignored** local-dev slot for the coach plugin (production loads it as an npm package) |

A plugin default-exports `{ id, name, version?, priority?, setup?(ctx) }`. In
`setup`, it contributes to named extension points
(`ctx.registry.contribute(point, value)`); consumers read via
`getContributions(point)`. New extension points need no registry changes.
`ctx.storage` is a `PluginStore` (per-plugin KV) for persisting plugin state.

**UI panels:** the first concrete extension point. A plugin contributes
`PluginPanel` descriptors to `PANELS_POINT`, targeting a *slot* (host surface).
Three slots exist today: `PanelSlot.Labs` (rendered by `LabsTab.tsx`; no
first-party panel targets it now — it shows only when the experimental
`enableLabs` setting is on or another plugin contributes), `PanelSlot.Coach`
(rendered by `CoachTab.tsx` — the dedicated AI Coach tab, home for the
`@perchwerks/eye-in-the-sky` coaching plugin), and `PanelSlot.Profile`
(rendered by `ProfileTab.tsx`, far-right — cloud-sync contributes the Account
sign-in panel, storage meters, and cloud-log management). All render contributed
panels via `PluginPanelHost` and are
**self-gating**: `Index.tsx` computes `hasLabsPanels`/`showCoach`/`showProfile`
from `getPanelsForSlot`, so a tab appears only when a
plugin contributes a panel to it (Labs additionally shows when the experimental
`enableLabs` setting is on). New slots are just new strings — no framework change.
`PluginPanelHost` wraps each panel in an error boundary **and** a `Suspense`
boundary, so panel components can be `React.lazy` (as `cloud-sync` is). A panel
may set `chromeless: true` to render its body without the host's card/header/
padding — for panels that own their full layout (e.g. a full-bleed coach
dashboard); the error boundary + Suspense still apply, and a slot whose panels
are all chromeless (`isBareSlot`) also drops the host's outer padding.

**Inline mounts:** where panels are standalone cards, *mounts* inject a raw
component into a fixed spot in core UI. A plugin contributes a `PluginMountDef`
to `MOUNTS_POINT`, targeting a `MountSlot`; the host renders `<PluginMount slot
ctx={…}>` at that spot, passing a typed context as a single `ctx` prop.
`FilesTab` exposes four: `MountSlot.FileRow` (per file row, ctx = that file),
`MountSlot.FileManagerSection` (once under the list, ctx = the whole list),
`MountSlot.FileManagerFooter` (near the bottom, above storage usage, ctx = the
whole list — home for the "Download all cloud logs" bulk action), and
`MountSlot.FileDeleteConfirm` (inside the delete-confirm banner, ctx = the target
file + a `registerOnConfirm` hook so a plugin can run an extra action — e.g.
cloud-sync's "also delete the cloud copy" — without the host knowing about
cloud). New mount locations are just new slot strings.

**Cloud Sync (first-party plugin, `src/plugins/cloud-sync/`):** the first
in-repo plugin built on the panel framework — contributes the **Account** panel
(`PanelSlot.Profile`, ordered first) plus file-manager mounts (per-file sync
toggle, and a bulk `DownloadAllCloudLogs` in the footer). Backs the IndexedDB
stores up to Supabase: structured stores → `sync_records` jsonb docs, raw blobs →
the private `user-files` bucket. **Full data model, sync engine, conflict
resolution, and backend live in `docs/backend.md`.**

**AI coach (npm package):** published to the public npm registry as
`@perchwerks/eye-in-the-sky` and listed in `optionalDependencies`. The loader in
`vite.config.ts` defaults to that package (no token or `.npmrc` needed);
`DOVE_PLUGIN_PACKAGES` (build env var) overrides the candidate list when set.
The coach shares the public stub's `id` with a higher `priority` to override it.
See `src/plugins/README.md` for the full publish/wire workflow.

Offline-first note: plugins are bundled internal code. Only a plugin's runtime
network calls (e.g. AI model APIs) go online — the accepted compromise. Supabase
cloud is purely file-sync.

---

## Parser System

Each parser exports two functions:
- `isXxxFormat(input: string | ArrayBuffer): boolean` — format detection
- `parseXxxFile(input: string | ArrayBuffer): ParsedData` — full parse

**To add a new parser:**
1. Create `src/lib/xxxParser.ts` with `isXxxFormat()` + `parseXxxFile()`
2. Register in `src/lib/datalogParser.ts` — add import + detection check in both `parseDatalogFile()` and `parseDatalogContent()`
3. Update `README.md` supported formats table
4. Update this file's architecture map

Detection order matters: binary formats first (MoTeC LD → UBX), then text formats from most-specific to least (VBO → MoTeC CSV → Dovex → Dove → Alfano → AiM → NMEA fallback).

---

## Core Types (`src/types/racing.ts`)

| Type | Key Fields |
|------|------------|
| `GpsSample` | `t` (ms), `lat`, `lon`, `speedMps/Mph/Kph`, `heading?`, `extraFields: Record<string,number>` |
| `ParsedData` | `samples[]`, `fieldMappings[]`, `bounds`, `duration`, `startDate?`, `dovexMetadata?`, `parserStats?` |
| `ParserStats` | `totalRows`, `acceptedRows`, `rejected: { nanFields, zeroCoords, outOfRange, speedCap, teleportation, incompleteRow }` |
| `DovexMetadata` | `datetime?`, `driver?`, `course?`, `shortName?`, `bestLapMs?`, `optimalMs?`, `lapTimesMs?[]` |
| `Lap` | `lapNumber`, `startTime/endTime`, `lapTimeMs`, speed stats, `startIndex/endIndex`, `sectors?` |
| `Course` | `name`, `lengthFt?`, `startFinishA/B` (lat/lon), optional `sector2/sector3` lines |
| `Track` | `name`, `shortName?` (max 8 chars), `courses[]` |
| `CourseDetectionResult` | `track`, `course`, `direction?`, `laps[]`, `isWaypointMode`, `waypointNotice?` |
| `CourseDirection` | `'forward' \| 'reverse'` |
| `FieldMapping` | `index`, `name` (canonical ChannelId or `custom:` slug — the extraFields key), `label?` (display), `unit?`, `enabled` |
| `FileMetadata` | `fileName`, `trackName`, `courseName`, `weatherStation*?`, `sessionKartId?`, `sessionSetupId?` (live setup), `sessionSetupRev?` (frozen setup-revision content hash), `fastestLapMs?`, `fastestLapNumber?` |

---

## Automatic Course Detection (`src/lib/courseDetection.ts`)

When a file is loaded and no track/course is saved in metadata, the system auto-detects:

1. **Track discovery**: Find first valid GPS sample within **5 miles** (~8047m) of any known track
2. **Course matching**: Try each course's S/F line → calculate laps → compare average lap distance (ft) to course `lengthFt` → pick closest match within 25% tolerance
3. **Direction detection**: After S/F crossing, check which sector is crossed first — Sector 2 = forward, Sector 3 = reverse. Only works on courses with known sector lines.
4. **Waypoint mode fallback**: If no track matches or no course produces valid laps:
   - Drop a waypoint at the first sample where speed ≥ 30 MPH
   - Track returns to waypoint (within 30m after traveling 100m+) for rough lap timing
   - Divide lap distance by 3 for approximate sector boundaries
   - Show notice: "Waypoint timing — lower accuracy. Create a track for precise timing."

---

## .dovex Format (`src/lib/dovexParser.ts`)

Extended Dove format with an 8192-byte (8 KB) metadata header:
```
Line 1: datetime,driver,course,short_name,best_lap_ms,optimal_ms
Line 2: 2024-03-15 14:30:00,Mike,Full CW,OKC,62345,61200
Line 3: lap_times_ms
Line 4: 65432,64321,62345,63456   (lap times in ms, comma-separated)
\n padding to byte 8192
Byte 8192+: standard .dove CSV (timestamp,sats,hdop,lat,lng,...)
```

GPS data is always parseable even if metadata is corrupted. Metadata is attached as `ParsedData.dovexMetadata`.

---

## IndexedDB Storage (`src/lib/dbUtils.ts`)

Single shared database: `"dove-file-manager"`, version 12.

| Store | Key | Module |
|-------|-----|--------|
| `files` | `name` | `fileStorage.ts` |
| `metadata` | `fileName` | `fileStorage.ts` |
| `karts` | `id` | `kartStorage.ts` |
| `notes` | `id` (indexed by `fileName`) | `noteStorage.ts` |
| `setups` | `id` (indexed by `kartId`) | `setupStorage.ts` |
| `video-sync` | `sessionFileName` | `videoStorage.ts` |
| `graph-prefs` | `sessionFileName` | `graphPrefsStorage.ts` |
| `vehicle-types` | `id` | `templateStorage.ts` |
| `setup-templates` | `id` | `templateStorage.ts` |
| `session-videos` | `sessionFileName` | `videoFileStorage.ts` |
| `engines` | `id` | `engineStorage.ts` |
| `lap-snapshots` | `id` (indexed by `courseKey`, `engineKey`) | `lapSnapshotStorage.ts` |
| `setup-revisions` | `id` = content hash (indexed by `setupId`) | `setupRevisionStorage.ts` |

To add a new store: increment `DB_VERSION`, add store name to `STORE_NAMES`, add creation logic in `openDB()`, create a corresponding storage module.

---

## Lap Snapshots (`src/lib/lapSnapshot.ts` + `lapSnapshotStorage.ts`)

Frozen "course fastest lap" captures — an immutable single-lap baseline for
cross-session comparison (and future AI coaching).

- **Identity = (course + engine).** Engine is the layman's "primary key"; the
  chassis travels inside the frozen `setup`. Exactly one snapshot per pair — a
  faster lap upserts in place (same deterministic `id`). `engine` is the free-text
  `Vehicle.engine` string, matched via `engineKey` (trimmed + lowercased).
- **What's frozen:** the lap's GPS samples **± a 5s buffer** on each side (so a
  later start/finish nudge still fits), `lapStartMs`/`lapEndMs` markers, the
  `Course` geometry, lap time, source file/lap, and a copy of the vehicle/setup.
  `snapshotLapSamples()` trims the buffer back to the clean lap for overlay.
- **Capture triggers:** assigning an engine + setup to a log prompts
  (`LapSnapshotPromptDialog`) when its best lap beats (or has no) stored
  snapshot; a manual "Save as snapshot" lives in `LapSnapshotControls` (the
  lap-list **Snapshots** picker, in the header so it serves simple + pro mode).
  Orchestrated by `useLapSnapshots`.
- **Loaded as a comparison overlay only.** Selecting a snapshot feeds its clean
  samples into the **external-reference slot** (`externalRefSamples`), so it
  renders like a reference lap and is **excluded from playback + the video
  player** — it is never an appended lap. Engine is shown in the overlay label.
- **Sync (cloud-sync plugin):** a **dedicated `lap_snapshots` table**, but its
  serialized payload size counts toward the **same unified per-tier byte budget**
  as documents + logs (`subscription_tiers.total_bytes`), enforced by a trigger —
  no separate count quota. Always pushes on save; a local delete **never**
  propagates to the cloud (the cloud copy is removed only explicitly from
  **Profile → Lap snapshots**, like the log menu). Cloud deletes are tombstoned
  (`snapshotTombstones.ts`) so reconcile won't resurrect a surviving local copy.
  `reconcileSnapshots()` pulls cloud→local additively and pushes local-only up.
  Local storage is always unlimited.

---

## Setup Revisions (`src/lib/setupRevision.ts` + `setupRevisionStorage.ts`)

Immutable, **content-addressed** history of vehicle setups — git's blob model
without the diff chains. A `VehicleSetup` (`setups` store) is the *live, editable*
working copy; a `SetupRevision` (`setup-revisions` store) is a write-once frozen
copy whose **`id` is a SHA-256 of its content**. This keeps a session's setup
exactly as it was the day it ran, even after the live setup is later edited.

- **Freeze on assignment.** `handleSaveSessionSetup` (`useSessionMetadata`) calls
  `freezeSetupRevision(setupId)`, which reads the live setup + its template, builds
  the revision (`buildSetupRevision`), and stores its hash on
  `FileMetadata.sessionSetupRev`. `sessionSetupId` (live pointer) is kept alongside
  for lineage / the future "edit the setup later" flow.
- **The hash is the identity.** `computeSetupHash(setup, template)` hashes a
  canonical (sorted-key) projection of the setup's values **+ the template
  structure**, excluding volatile bookkeeping (`id`/`createdAt`/`updatedAt`). So
  two sessions on the genuinely-identical setup dedup to the **same hash**, and any
  value change — *or* a template change (a renamed/added field) — yields a new
  hash, i.e. a new revision, with no child-type machinery. `freezeSetupRevision`
  is idempotent: an existing-hash revision is reused (original `createdAt` kept).
- **Self-contained.** A revision embeds a frozen copy of the `setup` **and** the
  template structure (`FrozenTemplate`: section + field names/units), so old
  history always renders with the labels it had that day.
- **Display.** `shortRevHash()` surfaces the leading 6 hex chars (git-style). The
  **SetupsTab** list shows each setup's current would-be hash; **NotesTab** shows
  the frozen `#hash` of the session's setup revision.
- **Sync (cloud-sync plugin):** revisions ride the **generic garage-doc engine** —
  registered in `syncStores.ts` (`DOC_STORES` + `KEY_FIELD`, keyed by `id`), so
  they push/pull as ordinary `sync_records` rows counting toward the pooled
  documents budget. No dedicated table. Being immutable + content-addressed, the
  last-write-wins merge is a no-op on collision. **Pruning of orphan revisions and
  later-editing are deliberate follow-ups** (not yet implemented).

---

## Cloud Sync, Subscriptions & GDPR — see `docs/backend.md`

These three subsystems are **Supabase-backed** and, per the offline-first rule
(#1), touch nothing in the core app. Their data models, RLS, triggers, edge
functions, and client wiring are documented in
**[`docs/backend.md`](docs/backend.md)** to keep this file focused. Read it
before working on:

- **Cloud Sync** (`src/plugins/cloud-sync/`) — per-user backup/sync of the
  IndexedDB garage + log blobs: auto-sync off `garageEvents`, conflict resolution
  (pending-wins + last-write-wins), the unified pooled byte quota, orphan-safety,
  and opt-in per-file logs.
- **Subscriptions / Stripe** — paid tiers that scale one pooled storage budget;
  tiers are data (`subscription_tiers.total_bytes`), prices resolve by Stripe
  lookup_key, and entitlements are written only by the webhook. Operator setup
  (Products/Prices, secrets, `pg_cron`) is in the README.
- **Data Rights & Retention / GDPR** — self-service export/erasure, the 7-day
  deletion window, and automatic IP minimisation.

Documents, logs, and lap snapshots all draw from **one pooled per-tier byte
budget** (`subscription_tiers.total_bytes`: free 50 MB / plus 10 GB / premium
100 GB / pro 500 GB), shown as a single segmented bar on the Profile tab — see
`docs/backend.md`.

---

## Course Layouts (Drawing Feature)

The `course_layouts` table stores polyline drawings of track layouts (1:1 with courses, unique on `course_id`, cascade delete).

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | Auto-generated |
| `course_id` | uuid FK → courses.id (unique) | One layout per course |
| `layout_data` | jsonb | Array of `{lat, lon}` coordinate points |
| `created_at` / `updated_at` | timestamptz | Timestamps |

**Access**: Admin-only RLS (same pattern as courses table). Layout lengths (in feet) ARE exported to track JSON files as `lengthFt`.

**Draw tool**: In the VisualEditor, a "Draw" button allows clicking on the satellite map to build a polyline outline. This manual drawing tool is **admin-only** (`isAdminEditor={true}` in CoursesTab).

**Generate Drawing**: A "Generate" button (visible when laps are available and `showDrawTool` is true) lets users select a lap and auto-populate the drawing from that lap's GPS samples. Always available in user-side TrackEditor when session data is loaded. Laps and samples are threaded from `Index.tsx` → `TrackEditor` → `VisualEditor`.

**"Generate Course Mapping" button**: Placeholder in admin CoursesTab — will eventually produce fingerprint data for automatic track detection on the DovesDataLogger hardware.

**Submissions**: The `submissions` table has `has_layout` (bool) and `layout_data` (jsonb) columns to carry drawing data through the submission workflow.

**Public drawings**: Admin exports drawings to `public/drawings.json` (keyed by `shortName/courseName` → `[{lat, lon}, ...]`). Loaded by `trackStorage.ts:loadCourseDrawings()` (cached). Rendered on the race line map as a dashed polyline outline when a course is selected. Helper: `getDrawingForCourse(shortName, courseName)`.

---

## BLE Integration (`src/lib/ble/`)

Connects to **DovesLapTimer** ESP32 device via Web Bluetooth.

| UUID | Characteristic | Purpose |
|------|---------------|---------|
| `0x1820` | Service | Internet Protocol Support (container) |
| `0x2A3D` | File List | Read: newline-separated `filename,size` pairs |
| `0x2A3E` | File Request | Write: `GET:filename`, `LIST`, `SLIST`, `SGET:key`, `SSET:key=value`, `SRESET`, `TLIST`, `TGET:name`, `TPUT:name`, `TDEL:name`, `BATT` |
| `0x2A3F` | File Data | Notify: chunked file data (reassembled client-side) |
| `0x2A40` | File Status | Notify: `SIZE:n`, `DONE`, `ERROR:msg`, settings (`SVAL`, `SEND`, `SOK`, `SERR`), tracks (`TFILE`, `TEND`, `TREADY`, `TOK`, `TERR`), battery (`BATT:<pct>,<volt>`) |

### File Protocol
LIST → select file → GET:filename → receive SIZE → stream data chunks → DONE.

### Settings Protocol
- `SLIST` → device sends `SVAL:key=value` for each setting on fileStatus, ends with `SEND`
- `SGET:key` → device responds `SVAL:key=value` or `SERR:NOT_FOUND` on fileStatus
- `SSET:key=value` → device responds `SOK:key` or `SERR:WRITE_FAIL` on fileStatus
- `SRESET` → device responds `SOK:RESET` on fileStatus, then reboots. App should disconnect immediately after receiving confirmation.

### Track File Protocol
- `TLIST` → device sends `TFILE:name.json` per file on fileStatus, ends with `TEND`
- `TGET:name.json` → reuses existing SIZE → data chunks (fileData) → DONE (fileStatus) transfer pattern
- `TPUT:name.json` → device responds `TREADY` on fileStatus → app sends data chunks on fileRequest (64-byte max) → `TDONE` → device responds `TOK` or `TERR:reason`
- `TDEL:name.json` → device responds `TOK` on fileStatus (success) or `TERR:reason` (failure). 10s timeout.

### Battery Protocol
- `BATT` → device responds `BATT:<percent>,<voltage>` on fileStatus (e.g., `BATT:85,3.98`). 5s timeout.

Settings schema is defined in `src/lib/deviceSettingsSchema.ts` — maps keys to labels, types, and validation rules. Unknown keys from the device are displayed as raw string fields (forward-compatible).

---

## Device Track Sync (`src/lib/deviceTrackSync.ts`)

Pure comparison/conversion logic for merging app tracks with device track files:
- `buildMergedTrackList()` — matches tracks by shortName, courses by name, classifies as synced/mismatch/device_only/app_only
- `coursesMatch()` — coordinate comparison with epsilon (0.0000005°)
- `buildTrackJsonForUpload()` — serializes app Track to device JSON format (flat course array, includes `lengthFt`)
- `deviceCourseToAppCourse()` / `appCourseToDeviceJson()` — format converters (both include `lengthFt`)
- `DeviceCourseJson` includes `lengthFt?: number` for hardware course detection by lap distance

---

## Device Manager

The slide-out drawer (`FileManagerDrawer.tsx`) has two top-level tabs:
- **Garage** — Files, Karts, Setups, Notes (original functionality)
- **Device** — BLE device management, gated behind a "Connect to Logger" prompt

Device sub-tabs:
- **Settings** — Read/write device settings via SLIST/SGET/SSET protocol
- **Tracks** — Full track sync manager: downloads all device track JSONs, merges with app tracks, shows sync status per track/course, supports upload/download/diff with side-by-side comparison modal

Global BLE connection state is managed by `DeviceContext.tsx`, wrapping the app tree in `Index.tsx`.

---

## Settings

`useSettings` hook (persists to localStorage) → `SettingsContext` for tree-wide access.

Key settings: `useKph`, `gForceSmoothing`, `gForceSmoothingStrength`, `brakingZoneSettings` (thresholds, duration, smoothing, color, width), `enableLabs` (hidden when no labs features), `darkMode`, `deltaMethod` (`'position'` default | `'distance'` legacy), `deltaSampleMeters` (arc-length resample spacing for position delta, default 2).

`useReferenceLap.ts` routes pace through `computeLapPace` (`lapDelta.ts`), which
switches on `deltaMethod`. The position method is the issue #29 port; `distance`
falls back to the legacy `calculatePace` in `referenceUtils.ts`.

Channels are normalized to canonical ids at parse time (`channels.ts` →
`normalizeChannels()`), so `extraFields` keys and `FieldMapping.name` are uniform
across formats (e.g. every parser's lateral-g lands on `lat_g`, with display
`label` "Lat G"). G-force is modelled as distinct ids per source — `lat_g`/`lon_g`
(primary/GPS-derived), `lat_g_native`/`lon_g_native` (logger-native), `accel_x/y/z`
(raw IMU) — which coexist on a sample and must never collapse. `fieldResolver.ts`
is the settings-facing adapter (resolves names→ids for the field-default
show/hide). `toChannelKey()` is the idempotent shim that migrates legacy
display-name keys persisted in graph-prefs / saved overlay configs on load, so
existing user data keeps resolving without a destructive migration.

---

## Environment Variables

| Variable | Client/Server | Description |
|----------|--------------|-------------|
| `VITE_SUPABASE_URL` | Client | Backend URL (auto-set) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Client | Backend anon key (auto-set) |
| `VITE_SUPABASE_PROJECT_ID` | Client | Backend project ID (auto-set) |
| `VITE_ENABLE_ADMIN` | Client | `"true"` to enable admin UI + `/admin` route. `/login` is also mounted when this OR `VITE_ENABLE_CLOUD` is on. |
| `VITE_ENABLE_CLOUD` | Client | `"true"` to enable public user accounts (Cloud Sync + Google sign-in + `/register`, `/forgot-password`, `/reset-password`, `/auth/callback`). Default `"false"` — preserves offline-first invariant. |
| `VITE_TURNSTILE_SITE_KEY` | Client | Cloudflare Turnstile site key (optional CAPTCHA) |
| `TURNSTILE_SECRET_KEY` | Server (edge fn) | Turnstile secret — `???` |
| `DOVE_PLUGIN_PACKAGES` | Build | Comma-separated external plugin npm packages to load. Overrides the default (`@perchwerks/eye-in-the-sky`) when set |

PWA deployment detail: the active offline-capable worker is emitted as `/service-worker.js` and registered only outside preview/iframe contexts. `public/sw.js` is reserved as a legacy kill-switch worker to evict stale caches from older installs that previously registered `/sw.js`.

Static hosting (Cloudflare Workers): the build is a pure static SPA (no server runtime). `wrangler.jsonc` (repo root) configures a static-assets-only Worker — no `main` script — with `assets.directory: "./dist"` and `not_found_handling: "single-page-application"` for client-side route fallback. `public/_headers` (copied into `./dist` by Vite, honored by Workers static assets) sets `no-cache` on the service workers + `index.html` and immutable long-cache on `/assets/*`. `.nvmrc` pins Node 20. Workers Builds runs `npm run build` then `wrangler deploy`. Supabase edge functions stay on Supabase — the Worker only serves the frontend. See the README "Deployment" section.

`vite.config.ts` defines public backend fallbacks for `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_SUPABASE_PROJECT_ID` so production builds still boot if managed env injection is missing; `.env` stays the preferred source when present.

---

## Commands

```bash
npm run dev        # Dev server on :8080
npm run build      # Production build → dist/
npm run lint       # ESLint
npm run typecheck  # tsc -b (must use build mode to follow project references)
npm run preview    # Preview production build
npm test           # Vitest in watch mode
npm run test:run   # Vitest single pass (CI-style)
npm run test:coverage  # Vitest + v8 coverage (enforces thresholds in vitest.config.ts)
```

> **Coverage scope (`vitest.config.ts`).** Coverage is deliberately scoped to
> *logic worth unit-testing* — `lib/` parsers/utilities/protocol code, `hooks/`,
> and `plugins/`. The React **view layer is excluded**: presentational
> components (`src/components/**/*.tsx`), route/page shells (`src/pages/**`),
> context providers (`src/contexts/**`), `App.tsx`, vendored `ui/`, and the
> generated Supabase client. Note the exclude targets `components/**/*.tsx`
> *only* — the `.ts` logic files under `components/video-overlays/` stay in
> scope. Don't widen the include to pull view code back in (it tanks the number
> with code nobody unit-tests) and don't exclude `hooks/`/`lib/` to inflate it
> (that hides real test debt). Thresholds are floors a few points below current
> actuals — ratchet them up as coverage grows.

> **Why `tsc -b`?** The root `tsconfig.json` has `files: []` and only uses
> `references` to point at `tsconfig.app.json` + `tsconfig.node.json`. Plain
> `tsc --noEmit` from repo root silently exits 0 without checking anything.
> `tsc -b` (build mode) follows references; both referenced configs have
> `noEmit: true` so nothing is emitted.

CI is split into five parallel workflows under `.github/workflows/`
(`lint.yml`, `typecheck.yml`, `test.yml`, `build.yml`, `coverage.yml`). Each
runs on every PR and push to `main` and shows up as its own status check +
README badge. `coverage.yml` also enforces the thresholds in `vitest.config.ts`,
posts a per-PR summary comment, and publishes the % badge JSON.

---

## Bundle Splitting / Code-Splitting

The initial bundle is kept small via `React.lazy` boundaries plus
`manualChunks` vendor splitting in `vite.config.ts`. Keep this in mind when
adding imports — pulling a lazy module into an eagerly-imported file
re-merges it into the main chunk.

**Lazy-loaded (off the initial path) — loaded on first use:**
- Routes: `Login`, `Admin`, `Register`, `Privacy` (`App.tsx`, wrapped in `<Suspense>`)
- Pro view: `GraphViewTab` and `LabsTab` (`Index.tsx`)
- `FileManagerDrawer` (slide-out drawer, `Index.tsx`)
- `DataloggerDownload` (BLE entry point; keeps `lib/ble/*` out of initial bundle — `FileImport.tsx`, `drawer/FilesTab.tsx`)
- `VisualEditor` (Leaflet drawing tools; `TrackEditor.tsx`, `track-editor/AddCourseDialog.tsx`, `track-editor/AddTrackDialog.tsx`, `admin/CoursesTab.tsx`)

**`EditorModeToggle` lives in its own file** (`track-editor/EditorModeToggle.tsx`)
so consumers can import the tiny toggle statically while `VisualEditor` stays
lazy. Import the toggle from `./EditorModeToggle`, never from `./VisualEditor`.

**Vendor chunks** (`manualChunks` in `vite.config.ts`): `vendor-react`,
`vendor-query`, `vendor-leaflet`, `vendor-supabase`, `vendor-radix`. These cache
independently across deploys so app-only changes don't re-download vendor code.

> Lazy components must be rendered inside a `<Suspense>` boundary. Use
> `lazy(() => import('…').then((m) => ({ default: m.Named })))` for the
> named-export components in this codebase.
>
> **Known follow-up:** `vendor-supabase` is still on the initial path because
> `AuthProvider` (`App.tsx`) and `SubmitTrackDialog` import the client eagerly.
> Deferring it would require gating the auth bootstrap on `VITE_ENABLE_ADMIN`.

---

## Key Conventions

- **No server when client works** — this is the #1 rule
- **Hooks are composable** — each hook does one thing, `Index.tsx` orchestrates
- **Parsers**: always export `isXxxFormat()` + `parseXxxFile()`, register in `datalogParser.ts`
- **IndexedDB stores**: all registered in `dbUtils.ts`, individual modules use `withReadTransaction` / `withWriteTransaction`
- **Tracks**: `public/tracks.json` is the source of truth at runtime; admin DB builds this file. Export format includes `longName`, `shortName`, `defaultCourse`, and per-course `lengthFt`. Tracks table has `default_course_id` FK. Course `lengthFt` values are imported as `length_ft_override` in the database.
- **Course Detection**: `courseDetection.ts` handles auto-detection of track/course/direction on file load, with waypoint mode fallback. Find nearest track within 5mi, match course by lap distance vs `lengthFt`.
- **Course Drawings**: Admin can export/import course layout drawings separately from tracks. Import clears `length_ft_override` for imported courses (drawing becomes source of truth).
- **CSS**: use Tailwind semantic tokens from `index.css`, never hardcode colors in components
- **Admin code** is fully optional and gated behind env vars — core app has zero admin dependencies
- **Edge functions** live in `supabase/functions/`, auto-deployed, configured in `supabase/config.toml`
- **Stale-state gotcha**: When calling a function immediately after `setState`, the new value isn't available in the current closure. Pass values explicitly (e.g., `calculateAndSetLaps(course, samples, fileName)`) instead of relying on state that was just set.

---

_Closing reminders, in the author's words (these reiterate the Golden Rules — kept
because they set the tone): **never do on the server what you can do on the
client** — 99% offline is the number-one priority (weather, satellite view, admin
excepted). **Keep code modular and reusable** — fuck line count as long as you
reuse the shit out of things; rewrites for reusability are always welcome. Keep
`README.md` current (ALWAYS note new env vars + their values, `???` for secrets)
and the Credits list current. And **always keep `CLAUDE.md` updated** with new
files and architecture as you go._
