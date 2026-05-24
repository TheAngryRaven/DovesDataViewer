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
| Video Export | WebCodecs + [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) (H.264 video + AAC audio video + AAC audio MP4 output) |
| State | React hooks + React Query (for admin only) |
| Local Storage | IndexedDB (`dbUtils.ts`) for files/metadata/karts/notes/setups/video-sync/graph-prefs; localStorage for tracks & settings |
| Backend | None for core features. Optional admin via Supabase (Lovable Cloud) |
| BLE | Web Bluetooth API for DovesDataLogger device communication |

---

## Architecture Map

```
src/
├── pages/
│   ├── Index.tsx          # Main SPA — file import, tab views, all state orchestration
│   ├── Admin.tsx          # Admin panel (behind VITE_ENABLE_ADMIN)
│   ├── Login.tsx / Register.tsx / Privacy.tsx
│   └── NotFound.tsx
├── components/
│   ├── ui/                # shadcn/ui primitives (button, dialog, tabs, etc.)
│   ├── admin/             # Admin tabs: TracksTab, CoursesTab, SubmissionsTab, BannedIpsTab, ToolsTab, MessagesTab
│   ├── tabs/              # Main view tabs: GraphViewTab, RaceLineTab, LapTimesTab, LabsTab
│   ├── graphview/         # Pro mode: GraphPanel, GraphViewPanel, MiniMap, SingleSeriesChart, InfoBox
│   ├── drawer/            # File manager drawer tabs: FilesTab, KartsTab, NotesTab, SetupsTab, DeviceSettingsTab, DeviceTracksTab
│   ├── track-editor/      # Track editor sub-components
│   ├── RaceLineView.tsx   # Leaflet map with race line, speed heatmap, braking zones
│   ├── TelemetryChart.tsx # Canvas-based speed/telemetry chart (simple mode)
│   ├── VideoPlayer.tsx    # Synced video playback with modular overlay system
│   ├── video-overlays/   # Overlay system for video export
│   │   ├── types.ts             # OverlayInstance, OverlaySettings, DataSourceDef, ThemeDef
│   │   ├── registry.ts          # Overlay type definitions + factory
│   │   ├── themes.ts            # Classic + Neon theme definitions
│   │   ├── dataSourceResolver.ts # Maps data source IDs → values/ranges/units
│   │   ├── DigitalOverlay.tsx   # Numeric value + unit display
│   │   ├── AnalogOverlay.tsx    # Canvas needle gauge (~252° arc)
│   │   ├── GraphOverlay.tsx     # Rolling canvas line chart
│   │   ├── BarOverlay.tsx       # Horizontal 0-100% progress bar
│   │   ├── BubbleOverlay.tsx    # XY joystick-style circular widget
│   │   ├── sectorUtils.ts        # Shared sector status logic (colors, segment computation)
│   │   ├── MapOverlay.tsx       # Mini canvas race line with position dot + optional sector coloring
│   │   ├── PaceOverlay.tsx      # Horizontal pace delta indicator
│   │   ├── SectorOverlay.tsx    # 3 sector bubbles with delta + sparkle animation
│   │   ├── LapTimeOverlay.tsx   # Lap timer with optional pace mode (delta + best lap)
│   │   ├── OverlaySettingsPanel.tsx # Add/configure/remove overlay instances
│   │   └── VideoExportDialog.tsx    # Export dialog with quality options
│   ├── FileImport.tsx     # Drag-and-drop file import
│   ├── DataloggerDownload.tsx  # BLE device download UI
│   ├── ContactDialog.tsx  # Public contact form dialog (categories shared const)
│   └── ...
├── hooks/
│   ├── useSessionData.ts      # Parses imported file → ParsedData
│   ├── useLapManagement.ts    # Lap calculation, selection, visible range
│   ├── usePlayback.ts         # Playback cursor (shared across chart + map)
│   ├── useReferenceLap.ts     # Reference lap overlay logic
│   ├── useVideoSync.ts        # Video ↔ telemetry synchronization
│   ├── useFileManager.ts      # IndexedDB file CRUD
│   ├── useKartManager.ts      # Backward compat re-export → useVehicleManager
│   ├── useVehicleManager.ts   # Vehicle profiles CRUD
│   ├── useTemplateManager.ts  # Vehicle types & setup templates CRUD
│   ├── useNoteManager.ts      # Session notes CRUD
│   ├── useSetupManager.ts     # Generic setup sheets CRUD (template-driven)
│   ├── useSettings.ts         # User preferences (units, smoothing, dark mode, etc.)
│   ├── useSessionMetadata.ts  # Per-file metadata (selected track/course)
│   └── useOnlineStatus.ts     # Navigator.onLine wrapper
├── lib/
│   ├── datalogParser.ts       # ★ Format auto-detection router (entry point for all parsing)
│   ├── nmeaParser.ts          # NMEA 0183 text parser (fallback format)
│   ├── ubxParser.ts           # u-blox UBX binary parser
│   ├── vboParser.ts           # Racelogic VBO parser
│   ├── doveParser.ts          # DovesDataLogger CSV parser
│   ├── dovexParser.ts         # DovesDataLogger extended format (.dovex) with 8192-byte metadata header
│   ├── alfanoParser.ts        # Alfano CSV parser
│   ├── aimParser.ts           # AiM MyChron CSV parser
│   ├── motecParser.ts         # MoTeC LD binary + CSV parser
│   ├── parserUtils.ts         # Shared parser helpers (haversine, speed calc, etc.)
│   ├── fieldResolver.ts       # Canonical field name mapping across parsers
│   ├── courseDetection.ts     # ★ Auto course detection, direction detection, waypoint mode
│   ├── lapCalculation.ts      # Start/finish line crossing detection → Lap[]
│   ├── brakingZones.ts        # Braking zone detection from G-force data
│   ├── speedEvents.ts         # Min/max speed event detection
│   ├── speedBounds.ts         # Speed range utilities
│   ├── gforceCalculation.ts   # G-force derivation from GPS data
│   ├── chartUtils.ts          # Canvas chart rendering helpers
│   ├── chartColors.ts         # Color palette for multi-series charts
│   ├── trackUtils.ts          # Track geometry utilities (findNearestTrack: 5mi radius)
│   ├── trackStorage.ts        # localStorage: tracks + courses (merged with public/tracks.json) + course drawings loader
│   ├── referenceUtils.ts      # Reference lap comparison (legacy distance-based pace)
│   ├── lapDelta.ts            # ★ Position-based lap delta: arc-length resample + segment-projected gap (issue #29 port)
│   ├── dbUtils.ts             # ★ Shared IndexedDB: DB_NAME, DB_VERSION, openDB(), transaction helpers
│   ├── fileStorage.ts         # IndexedDB: raw file blobs
│   ├── kartStorage.ts         # Old kart storage (kept for compat)
│   ├── vehicleStorage.ts     # ★ Vehicle profiles CRUD (replaces kartStorage)
│   ├── templateStorage.ts    # ★ Vehicle types + setup templates, default kart schema
│   ├── noteStorage.ts         # IndexedDB: session notes
│   ├── setupStorage.ts        # IndexedDB: kart setups
│   ├── videoStorage.ts        # IndexedDB: video sync points + overlay settings
│   ├── videoFileStorage.ts    # ★ IndexedDB: video file blobs + metadata (exportType, lapNumber, hasOverlays)
│   ├── videoExport.ts         # VideoWebCodecs H.264+AAC, fallback MediaRecorder fix-webm-duration)
│   ├── overlayCanvasRenderer.ts # Canvas-based overlay drawing for export
│   ├── graphPrefsStorage.ts   # IndexedDB: per-session graph selections
│   ├── bleDatalogger.ts       # Legacy barrel — re-exports from `ble/` for back-compat
│   ├── ble/                   # Web Bluetooth: DovesLapTimer protocol, split per-concern
│   │   ├── index.ts             # Public API barrel
│   │   ├── types.ts             # BleConnection, FileInfo, DownloadProgress, BatteryInfo
│   │   ├── internal.ts          # UUIDs, debug logging (not exported)
│   │   ├── format.ts            # formatBytes / formatSpeed / formatTime
│   │   ├── connection.ts        # isBleSupported, connectToDevice, disconnect
│   │   ├── fileTransfer.ts      # LIST + GET file protocol (data log download)
│   │   ├── battery.ts           # BATT protocol
│   │   ├── settings.ts          # SLIST/SGET/SSET/SRESET settings protocol
│   │   └── trackSync.ts         # TLIST/TGET/TPUT/TDEL track-file protocol
│   ├── deviceTrackSync.ts     # Track sync logic: merge/compare app↔device tracks, coordinate diff
│   ├── deviceSettingsSchema.ts # Device settings key definitions + validation
│   ├── weatherService.ts      # OpenWeatherMap API (online-only)
│   ├── db/                    # Admin database layer (modular, swappable)
│   │   ├── types.ts           # ITrackDatabase interface
│   │   ├── supabaseAdapter.ts # Supabase implementation
│   │   └── index.ts           # Factory: getDatabase()
│   └── utils.ts               # Tailwind cn() helper
├── plugins/                   # ★ Plugin framework (auto-discovered via import.meta.glob)
│   ├── types.ts               # DataViewerPlugin / PluginContext / PluginRegistry contracts
│   ├── registry.ts            # Singleton registry + generic extension points
│   ├── index.ts               # initPlugins() — discovery + setup (called in main.tsx)
│   ├── panels.ts              # UI panel framework: PluginPanel/Props, PANELS_POINT, PanelSlot, getPanelsForSlot
│   ├── PluginPanelHost.tsx    # Mounts plugin panels for a slot (error-boundaried, Suspense-wrapped, with fallback)
│   ├── mounts.ts              # Inline mounts: MOUNTS_POINT, MountSlot (FileRow/FileManagerSection), contexts, getMounts
│   ├── PluginMount.tsx        # Renders inline mounts for a slot (error-boundaried, Suspense; renders null when none)
│   ├── storage.ts             # getPluginStore(id): per-plugin KV in its own IndexedDB DB (dove-plugin-<id>)
│   ├── cloud-sync/            # ★ First-party plugin: Supabase file + garage sync (Labs panel)
│   │   ├── index.ts             # Plugin def — contributes a lazy CloudSyncPanel to the Labs slot
│   │   ├── CloudSyncPanel.tsx    # Sign-in + push/pull UI (lazy-loaded)
│   │   ├── syncStores.ts         # Pure config: which IDB stores sync + how they're keyed (testable)
│   │   ├── syncEngine.ts         # pushAll/pullAll: IDB ↔ sync_records (jsonb) + user-files bucket (blobs)
│   │   └── cloudClient.ts        # Typed access to sync_records + bucket (escape hatch until types regen)
│   └── coaching/              # Gitignored private slot (AI coaching submodule)
├── types/
│   └── racing.ts              # ★ Core types: GpsSample, ParsedData, Lap, Course, Track, etc.
├── contexts/
│   ├── SettingsContext.tsx     # Settings provider (useKph, gForce, brakingZones, darkMode, labs)
│   ├── DeviceContext.tsx       # Global BLE connection state provider
│   └── AuthContext.tsx        # Admin auth context
│   └── AuthContext.tsx        # Admin auth context
└── integrations/supabase/     # Auto-generated — DO NOT EDIT
    ├── client.ts
    └── types.ts
```

---

## Data Flow Pipeline

```
File Import (drag-drop / BLE download / file manager)
  → fileStorage.ts (save raw blob to IndexedDB)
  → useSessionData.ts (read blob, call parseDatalogFile)
    → datalogParser.ts (auto-detect format, route to specific parser)
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
| `panels.ts` | **UI panel framework**: `PluginPanel` / `PluginPanelProps` contract, `PANELS_POINT`, `PanelSlot`, `getPanelsForSlot(slot)`. The curated session snapshot is the entire surface a panel can rely on |
| `PluginPanelHost.tsx` | Consumer: mounts every panel for a slot in a titled card, each wrapped in a per-panel error boundary; renders a `fallback` when none |
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
The only slot today is `PanelSlot.Labs` — `LabsTab.tsx` renders contributed
panels via `PluginPanelHost`, and a labs-slot panel makes the Labs tab appear
automatically even when the experimental `enableLabs` setting is off (`Index.tsx`
computes `hasLabsPanels`). New slots are just new strings — no framework change.
`PluginPanelHost` wraps each panel in an error boundary **and** a `Suspense`
boundary, so panel components can be `React.lazy` (as `cloud-sync` is).

**Inline mounts:** where panels are standalone cards, *mounts* inject a raw
component into a fixed spot in core UI. A plugin contributes a `PluginMountDef`
to `MOUNTS_POINT`, targeting a `MountSlot`; the host renders `<PluginMount slot
ctx={…}>` at that spot, passing a typed context as a single `ctx` prop.
`FilesTab` exposes two: `MountSlot.FileRow` (per file row, ctx = that file) and
`MountSlot.FileManagerSection` (once under the list, ctx = the whole list). New
mount locations are just new slot strings.

**Cloud Sync (first-party plugin, `src/plugins/cloud-sync/`):** the first
in-repo plugin built on the panel framework. Contributes a lazy Labs panel that
signs the user in (`useAuth`) and does manual push/pull of local IndexedDB data
to Supabase. Structured stores go to the `sync_records` table as jsonb
documents; raw session blobs go to the private `user-files` Storage bucket. See
the Cloud Sync section below for the data model.

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
| `FieldMapping` | `index`, `name`, `unit?`, `enabled` — maps extraFields to UI toggles |
| `FileMetadata` | `fileName`, `trackName`, `courseName`, `weatherStation*?`, `sessionKartId?`, `sessionSetupId?`, `fastestLapMs?`, `fastestLapNumber?` |

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

Single shared database: `"dove-file-manager"`, version 9.

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

To add a new store: increment `DB_VERSION`, add store name to `STORE_NAMES`, add creation logic in `openDB()`, create a corresponding storage module.

---

## Cloud Sync (`src/plugins/cloud-sync/`)

Optional per-user backup/sync of the IndexedDB data above to Supabase. Built as
a first-party plugin (Labs panel), online-only (accepted offline-first
exception). **Manual & directional**: "push" mirrors local → cloud, "pull"
brings cloud → local; on a key collision the chosen direction wins. Sync is
**additive** — neither side deletes the other's extra records (deletion
propagation + timestamp merge are deliberate follow-ups).

Backend (migration `..._cloud_sync.sql`):

| Object | Type | Notes |
|--------|------|-------|
| `sync_records` | table | One jsonb document per record: `(user_id, store, record_key, data, updated_at)`, unique on `(user_id, store, record_key)`. RLS: `auth.uid() = user_id`. `store`/`record_key` mirror the IndexedDB store name + key path. |
| `user-files` | Storage bucket | Private. Raw session blobs at `{user_id}/{encodeURIComponent(name)}`. RLS scopes objects to the owner's folder. |

Synced stores (`syncStores.ts` — pure, unit-tested): `metadata`, `karts`,
`setups`, `notes`, `graph-prefs`, `vehicle-types`, `setup-templates` (jsonb
docs) + `files` (blobs). Video stores are intentionally excluded (size).
`vehicle-types`/`setup-templates` ride along because setups are template-driven.

After a migration, Lovable regenerates `integrations/supabase/types.ts`. Until
then `cloudClient.ts` accesses the new table/bucket through a narrowly-typed
escape hatch confined to that one module.

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

`fieldResolver.ts` maps parser-specific field names (e.g., "Lat G", "Lateral G", "LatG") to canonical IDs (`lat_g`) so settings apply uniformly.

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
```

> **Why `tsc -b`?** The root `tsconfig.json` has `files: []` and only uses
> `references` to point at `tsconfig.app.json` + `tsconfig.node.json`. Plain
> `tsc --noEmit` from repo root silently exits 0 without checking anything.
> `tsc -b` (build mode) follows references; both referenced configs have
> `noEmit: true` so nothing is emitted.

CI is split into four parallel workflows under `.github/workflows/`
(`lint.yml`, `typecheck.yml`, `test.yml`, `build.yml`). Each runs on every PR
and push to `main` and shows up as its own status check + README badge.

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

Update the readme when new parsers are added and when build parameters change. Make sure to ALWAYS note new environment variables and their values (use "???" When it is a secret value) in the readme.

Update the credits list when new Foss libraries are added.

Never do on a server what you can do on the client, the NUMBER ONE PRIORITY for this webapp is that 99% of the features are available offline. (Things like weather, satellite view etc, are obvious exceptions).

Keep code modular and reusable, fuck line count as long as you can reuse the shit out of things, rewrites to make things more reusable are always cool.

ALWAYS keep CLAUDE.md updated with new files and information to help it as well.
