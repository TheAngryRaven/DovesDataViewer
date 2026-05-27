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
│   ├── Login.tsx / Register.tsx / Privacy.tsx / Terms.tsx
│   └── NotFound.tsx
├── components/
│   ├── ui/                # shadcn/ui primitives (button, dialog, tabs, etc.)
│   ├── admin/             # Admin tabs: TracksTab, CoursesTab, SubmissionsTab, BannedIpsTab, ToolsTab, MessagesTab
│   ├── tabs/              # Main view tabs: GraphViewTab, RaceLineTab, LapTimesTab, LabsTab, CoachTab, ProfileTab
│   ├── graphview/         # Pro mode: GraphPanel, GraphViewPanel, MiniMap, SingleSeriesChart, InfoBox
│   ├── drawer/            # File manager drawer tabs: FilesTab, KartsTab/VehiclesTab, NotesTab, SetupsTab, DeviceSettingsTab, DeviceTracksTab, EngineCombobox
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
│   ├── LapSnapshotControls.tsx   # ★ Lap-list snapshot picker: save + load-as-overlay
│   ├── LapSnapshotPromptDialog.tsx # ★ "New course fastest lap" save prompt
│   └── ...
├── hooks/
│   ├── useSessionData.ts      # Parses imported file → ParsedData
│   ├── useLapManagement.ts    # Lap calculation, selection, visible range
│   ├── usePlayback.ts         # Playback cursor (shared across chart + map)
│   ├── useReferenceLap.ts     # Reference lap overlay logic
│   ├── useLapSnapshots.ts     # ★ Lap snapshot orchestration (capture/prompt/overlay)
│   ├── useVideoSync.ts        # Video ↔ telemetry synchronization
│   ├── useFileManager.ts      # IndexedDB file CRUD
│   ├── useKartManager.ts      # Backward compat re-export → useVehicleManager
│   ├── useVehicleManager.ts   # Vehicle profiles CRUD
│   ├── useEngineManager.ts    # Reusable engine-type list CRUD (search/create/import)
│   ├── useTemplateManager.ts  # Vehicle types & setup templates CRUD
│   ├── useNoteManager.ts      # Session notes CRUD
│   ├── useSetupManager.ts     # Generic setup sheets CRUD (template-driven)
│   ├── useSettings.ts         # User preferences (units, smoothing, dark mode, etc.)
│   ├── useSessionMetadata.ts  # Per-file metadata (selected track/course)
│   ├── useSubscription.ts     # Reads subscription tier catalogue + the user's plan (online, account-gated)
│   ├── useStripePrices.ts     # Reads the live Stripe price catalogue (configured? + monthly/annual prices); drives the no-Stripe failback
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
│   ├── channels.ts            # ★ Canonical channel registry (single source of truth: ids/labels/units/aliases) + normalizeChannels()
│   ├── fieldResolver.ts       # Settings-facing adapter over channels.ts (canonical id resolution + field categories)
│   ├── courseDetection.ts     # ★ Auto course detection, direction detection, waypoint mode
│   ├── lapCalculation.ts      # Start/finish line crossing detection → Lap[]
│   ├── lapSnapshot.ts         # ★ Pure snapshot types/keying/buffer (course+engine identity)
│   ├── lapSnapshotStorage.ts  # ★ IndexedDB CRUD for lap snapshots (emits garageEvents)
│   ├── brakingZones.ts        # Braking zone detection from G-force data
│   ├── speedEvents.ts         # Min/max speed event detection
│   ├── speedBounds.ts         # Speed range utilities
│   ├── gforceCalculation.ts   # G-force derivation from GPS data
│   ├── chartUtils.ts          # Canvas chart rendering helpers
│   ├── chartColors.ts         # Color palette for multi-series charts
│   ├── trackUtils.ts          # Track geometry utilities (findNearestTrack: 5mi radius)
│   ├── trackStorage.ts        # localStorage: tracks + courses (merged with public/tracks.json) + course drawings loader. User tracks emit garageEvents + carry updatedAt → cloud-synced via a store accessor (TRACKS_SYNC_STORE)
│   ├── referenceUtils.ts      # Reference lap comparison (legacy distance-based pace)
│   ├── lapDelta.ts            # ★ Position-based lap delta: arc-length resample + segment-projected gap (issue #29 port)
│   ├── dbUtils.ts             # ★ Shared IndexedDB: DB_NAME, DB_VERSION, openDB(), transaction helpers
│   ├── garageEvents.ts        # ★ Host pub/sub: storage modules emit {store,key,put|delete}; cloud-sync auto-syncs off it
│   ├── fileStorage.ts         # IndexedDB: raw file blobs
│   ├── kartStorage.ts         # Old kart storage (kept for compat)
│   ├── vehicleStorage.ts     # ★ Vehicle profiles CRUD (replaces kartStorage)
│   ├── engineStorage.ts      # IndexedDB: reusable engine-type list (emits garage events)
│   ├── engineUtils.ts        # Pure engine search/dedup/create-offer helpers
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
│   ├── billing.ts             # ★ Pure subscription logic + row/price shapes (effectiveTier, pricingCta, lookupKey, paidTiersVisible, priceFor, formatPrice) — unit-tested, no Supabase import
│   ├── billingClient.ts       # Supabase I/O for tiers/subscriptions + Stripe prices/checkout/portal (functions.invoke)
│   ├── pendingCheckout.ts     # localStorage stash for a plan chosen at sign-up; redeemed on first sign-in (account-first paid flow) — pure parse is unit-tested
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
│   ├── cloud-sync/            # ★ First-party plugin: Supabase file + garage sync (Labs panel + per-file toggle)
│   │   ├── index.ts             # Plugin def — contributes the Labs panel + a FileRow mount (both lazy, cloud-gated)
│   │   ├── CloudSyncPanel.tsx    # Sign-in + push/pull UI (lazy-loaded)
│   │   ├── FileSyncToggle.tsx    # Per-file sync toggle, mounted on each file row (off/pending/synced)
│   │   ├── FileDeleteToggle.tsx  # FileDeleteConfirm mount: opt-in "also delete the cloud copy" on local log delete (offline → pending)
│   │   ├── CloudFilesSection.tsx # FileManagerSection mount: lists all cloud files (on-device marked, others pullable)
│   │   ├── fileSync.ts           # Per-file selection state in the plugin store + fileSyncStatus/cloudOnlyNames/orphanedObjectNames (pure, tested)
│   │   ├── syncStores.ts         # Pure config: which stores sync + how they're keyed (testable)
│   │   ├── storeAccessors.ts     # Per-store read/get/put: default IndexedDB accessor + a localStorage accessor for tracks (the non-IDB seam)
│   │   ├── merge.ts              # ★ Pure conflict resolution: decideSync (pending-wins + updatedAt LWW), pendingId (tested)
│   │   ├── pendingSync.ts        # Persistent offline "pending changes" set (plugin KV); flushed priority-1 on reconnect
│   │   ├── storageTypes.ts      # Pure: storage types (documents 5MB / logs 20MB) + usage math (tested)
│   │   ├── syncEngine.ts         # pushAll/pushFile/pullAll + incremental pushRecord/deleteRecord + getStorageUsage + deleteCloudFile (rolls back orphan blob on index failure) + cleanupOrphanBlobs. Doc pushes chunk to a per-record fallback on quota (partial push + skipped count)
│   │   ├── autoSync.ts           # Background doc auto-sync: subscribes to garageEvents, debounced upsert/delete + reconcile on sign-in
│   │   ├── StoragePanel.tsx      # Profile-tab panel: display-name editor + plan/Manage-subscription + storage usage meters (lazy)
│   │   ├── CloudLogsPanel.tsx    # Profile-tab panel: list + delete cloud log files (cloud-only; opt-in local delete) (lazy)
│   │   ├── profile.ts            # getMyProfile / updateDisplayName (unique display names; taken-name handling)
│   │   └── cloudClient.ts        # Typed access to sync_records + bucket + sync_storage_usage RPC (escape hatch until types regen)
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
| `panels.ts` | **UI panel framework**: `PluginPanel` / `PluginPanelProps` contract, `PANELS_POINT`, `PanelSlot`, `getPanelsForSlot(slot)`. The curated session snapshot is the entire surface a panel can rely on |
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
in-repo plugin built on the panel framework. Sign-in + manual push/pull live in
`CloudSyncPanel` (lazy), contributed as the **Account** panel on the Profile tab
(`PanelSlot.Profile`, ordered first). The file manager's footer
(`MountSlot.FileManagerFooter`) gets a separate lazy `DownloadAllCloudLogs` mount
— a one-click bulk pull of every cloud log not yet on this device (self-hides
when signed out). (Cloud Sync used to be a Labs panel; no first-party panel
targets Labs now.) Structured stores go to the `sync_records` table as jsonb
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
| `FieldMapping` | `index`, `name` (canonical ChannelId or `custom:` slug — the extraFields key), `label?` (display), `unit?`, `enabled` |
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

Single shared database: `"dove-file-manager"`, version 11.

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

To add a new store: increment `DB_VERSION`, add store name to `STORE_NAMES`, add creation logic in `openDB()`, create a corresponding storage module.

---

## Lap Snapshots (`src/lib/lapSnapshot.ts` + `lapSnapshotStorage.ts`)

Frozen "course fastest lap" captures — an immutable single-lap baseline for
cross-session comparison (and future AI coaching).

- **Identity = (course + engine).** Engine is the layman's "primary key"; the
  chassis travels inside the frozen `setup`. Exactly one snapshot per pair — a
  faster lap upserts in place (same deterministic `id`), so the count never
  inflates. `engine` is the free-text `Vehicle.engine` string, matched via
  `engineKey` (trimmed + lowercased).
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
- **Sync (cloud-sync plugin):** a **dedicated `lap_snapshots` table** with a
  per-tier **COUNT** quota (free 5 / plus 10 / premium 20 / pro 50 via
  `subscription_tiers.snapshot_count`), enforced by a trigger — NOT byte document
  storage. Always pushes on save; a local delete **never** propagates to the
  cloud (the cloud copy is removed only explicitly from **Profile → Lap
  snapshots**, like the log menu). Cloud deletes are tombstoned
  (`snapshotTombstones.ts`) so reconcile won't resurrect a surviving local copy.
  `reconcileSnapshots()` pulls cloud→local additively and pushes local-only up.
  Local storage is always unlimited.

---

## Cloud Sync (`src/plugins/cloud-sync/`)

Optional per-user backup/sync of the IndexedDB data above to Supabase. Built as
a first-party plugin (Labs + Profile panels), online-only (accepted offline-first
exception). Manual push/pull remains (`CloudSyncPanel`), but the **document tier
now auto-syncs**, and is **offline-aware + conflict-safe**: storage modules emit
`garageEvents` on write/delete, and `autoSync.ts` (started in `setup`, dynamically
imported to stay off the initial bundle) debounces and incrementally **upserts /
deletes** the one changed record while signed in. So edits back up automatically
and **deletes propagate everywhere** — the Karts/Setups delete UI shows a loud
"deletes from every device + the cloud" warning when signed in.

**Conflict resolution** (`merge.ts`, pure + tested): every garage record carries an
`updatedAt` (stamped in each storage `save*`; the sync write path `writeOne` keeps
the cloud value). `decideSync` is **pending-wins + last-write-wins**: a change made
offline or whose push failed is recorded in a persistent **pending set**
(`pendingSync.ts`, in the plugin KV) and, on reconnect/sign-in, flushed first as
**priority-1** (replacing the cloud copy); everything else merges by newest
`updatedAt` (the record's logical edit time — never the server row time).
`reconcileDocs` does the two-way merge (pull cloud-newer, push local-newer/-only),
skipping pending keys. Its push (and `pushAll`'s) goes through `pushDocRows`: one
optimistic batch, falling back to per-record upserts if the server quota trigger
rejects the batch — so an over-limit local set still **partial-syncs** everything
that fits and reports a `skipped` count (surfaced as a toast) rather than failing
wholesale. `autoSync` tracks `navigator.onLine` + window online/offline events;
the Profile-tab `StoragePanel` flags offline state + the pending count.

**Storage types** (`storageTypes.ts`, enforced server-side) — distinct from
future *subscription tiers*: **documents** = all structured stores (5 MB, free,
auto-synced) and **logs** = file blobs (20 MB, opt-in). Limits live in the
`quota_limits` table (one source of truth for the enforcing trigger + the client
meter); `sync_storage_usage()` returns per-type usage for the Profile-tab meters.
Client checks are advisory — the DB trigger is the real gate.

Backend (migrations `..._cloud_sync.sql`, `..._storage_quotas.sql`):

| Object | Type | Notes |
|--------|------|-------|
| `sync_records` | table | One jsonb document per record: `(user_id, store, record_key, data, updated_at)`, unique on `(user_id, store, record_key)`. RLS: `auth.uid() = user_id`. `store`/`record_key` mirror the IndexedDB store name + key path. |
| `user-files` | Storage bucket | Private. Raw session blobs at `{user_id}/{encodeURIComponent(name)}`. RLS scopes objects to the owner's folder. |
| `quota_limits` | table | `(storage_type, max_bytes)` seeded `documents`=5 MB, `logs`=20 MB. Legacy baseline/fallback once tiers exist (see below). |
| `enforce_sync_quota` | trigger | BEFORE INSERT/UPDATE on `sync_records`: rejects writes that push a storage type over the **caller's tier** limit (`tier_limit()`), falling back to `quota_limits` (`quota_exceeded`). |
| `sync_storage_usage()` | RPC | Per-type `(used_bytes, limit_bytes)` for the caller — `limit_bytes` reflects the caller's tier. |
| `profiles` | table | `(user_id PK→auth.users, display_name unique, …)`. RLS: authenticated read-all, update/insert own. Display name is unique but **not** a key — user-editable. |
| `handle_new_user` | trigger | On `auth.users` insert: creates a profile, using the sign-up `display_name` or a generated silly name (`SpeedyRac3r-546`). `unique_display_name()` auto-suffixes a taken name at creation; user edits get an explicit "taken" error instead. |

Synced stores (`syncStores.ts` — pure, unit-tested): `metadata`, `karts`,
`setups`, `notes`, `graph-prefs`, `vehicle-types`, `setup-templates`, `tracks`
(jsonb docs) + `files` (blobs). Video stores are intentionally excluded (size).
`vehicle-types`/`setup-templates` ride along because setups are template-driven.
Most stores are IndexedDB; **`tracks` is localStorage** (only *user* tracks/courses,
never the built-in public ones), reached through `storeAccessors.ts` — a per-store
read/get/put seam so the engine isn't hard-wired to IndexedDB. Track edits stamp
`updatedAt` + emit `garageEvents`, so they ride the same auto-sync + delete
propagation + pending-wins/LWW merge as setups.

Cloud **log deletion** happens two ways. (1) On the Profile tab (`CloudLogsPanel`):
`listCloudFiles` (with `uploadedAt`) lists the user's cloud log files;
`deleteCloudFile(userId, name)` removes the blob + its `sync_records` index row
(cloud-only — other devices keep their downloaded copy), and the panel clears the
per-file selection + optionally deletes the local copy on this device. (2) On
**local delete** of a synced log: the `FileDeleteConfirm` mount (`FileDeleteToggle`)
adds an opt-in *"also delete the cloud copy"* switch (off by default — the cloud
copy is a backup). When ticked it calls `deleteCloudFile` (online) or queues a
`{store:"files", type:"delete"}` **pending change** (offline / on failure) that
`autoSync.pushOne` flushes via `deleteCloudFile` on reconnect.

**Orphan-safety:** `uploadBlob` writes the blob then the index row; if the index
write is rejected (e.g. the server quota trigger), it **rolls the blob back** so
it can't orphan in the bucket. `cleanupOrphanBlobs(userId)` (run once per user when
`CloudLogsPanel` opens) reclaims any pre-existing orphans — bucket objects whose
decoded name has no index row (`orphanedObjectNames`, pure + tested).

Files are **opt-in per file** (`fileSync.ts`): a `FileRow` mount adds a toggle to
each file-manager row (`off` → `pending` → `synced`), and the selection set lives
in the plugin's own KV store (`getPluginStore("cloud-sync")`). `pushAll` uploads
all garage docs but only the *selected* files; `pushFile` handles a single
toggle. A `FileManagerSection` mount (`CloudFilesSection`) lists **all** cloud
files — ones already on this device are marked present, others get a per-file
pull; pulling persists via `ctx.onSaveFile` (which refreshes the list). A
dedicated Cloud *tab* (a new garage-tab mount slot), `modified` detection, and a
"sync all" affordance remain follow-ups.

After a migration, Lovable regenerates `integrations/supabase/types.ts`. Until
then `cloudClient.ts` accesses the new table/bucket through a narrowly-typed
escape hatch confined to that one module.

### Subscriptions / Stripe (`..._stripe_subscriptions.sql`, `..._subscription_grace_trim.sql` + 4 edge functions)

Paid tiers scale the cloud-sync **logs** quota (`free` 20 MB → `plus` $1 500 MB
→ `premium` $3 1 GB → `pro` $10 1 GB; docs stay 5 MB). `premium` matches `pro`'s
storage but carries no AI credits. Each paid tier bills **monthly or annual**.
Tiers are **data**, not code (numbers are provisional):

| Object | Type | Notes |
|--------|------|-------|
| `subscription_tiers` | table | One row per plan: `(tier PK, label, price_cents, logs_bytes, doc_bytes, ai_credits, stripe_price_id, sort_order)`. Authenticated read-all. Change a limit = UPDATE here. (`stripe_price_id` is a legacy fallback only — prices now resolve by lookup_key, see below.) |
| `user_subscriptions` | table | `(user_id PK→auth.users, tier→subscription_tiers, status, stripe_customer_id, stripe_subscription_id, current_period_end, cancel_at_period_end, billing_interval, grace_until, logs_trimmed_at, updated_at)`. RLS: owner **read-only** — only the service role (webhook) writes, so no one can self-grant a tier. |
| `user_tier(uuid)` | fn (SECURITY DEFINER) | Effective tier: the subscription tier when `status in (active, trialing, past_due)`, else `free`. |
| `tier_limit(uuid, type)` | fn (SECURITY DEFINER) | Byte limit for a user + storage type from their tier; falls back to `free`, then `quota_limits`. Used by the quota trigger + usage RPC. |
| `encode_uri_component(text)` | fn | SQL parity with JS `encodeURIComponent`, so the trim job can address the right `user-files` bucket object (`{user_id}/{encoded name}`). |
| `trim_expired_logs()` | fn (SECURITY DEFINER) | For users past their `grace_until`, deletes synced **log** files newest-first (index row + bucket object) down to the free `logs_bytes`. Scheduled daily via `pg_cron` (guarded; enable the extension or run externally). Not granted to `authenticated`. |

**Prices via lookup_key (no Price ids in code):** each (tier × interval) has a
Stripe Price tagged with a lookup_key `${tier}_${interval}` (`plus_monthly`,
`plus_annual`, `premium_monthly`, …). Checkout and the catalogue resolve prices
live by lookup_key, so the Stripe dashboard is the single source of truth.

**Coming-soon tiers:** `COMING_SOON_TIERS` in `lib/billing.ts` (currently `pro`,
the AI plan) lists tiers that exist but aren't self-service purchasable yet —
shown as "Coming soon", excluded from `PlanChooser`, no Upgrade button, and
rejected by `create-checkout-session` (mirror the set there). They can still be
**comped** by creating the subscription directly in Stripe (set the
subscription's `metadata.user_id`, or change an existing customer's price); the
webhook grants whatever tier the price's lookup_key maps to.

**Cancellation grace:** a cancelled sub ends at the period boundary (Stripe
`customer.subscription.deleted`), dropping to free limits immediately (via
`user_tier`), but `grace_until = period_end + 60 days` keeps the user's logs so
they can re-subscribe/download. After grace, `trim_expired_logs()` trims them.

Edge functions (all `verify_jwt = false`; checkout/portal verify the JWT
manually like the rest of the repo, the webhook verifies the Stripe signature):

- `stripe-prices` — **public**, no auth. Reports `{ configured, prices[] }`:
  `configured:false` when `STRIPE_SECRET_KEY` is absent (→ client free-only
  failback), else live monthly/annual prices fetched by lookup_key.
- `create-checkout-session` — auth user + `{ tier, interval }` → ensure Stripe
  customer (persisted on `user_subscriptions`) → resolve Price by lookup_key →
  Checkout Session (subscription mode) → returns the hosted URL.
- `stripe-webhook` — **the only writer of entitlements**. Verifies the signature
  (`STRIPE_WEBHOOK_SECRET`), then on `checkout.session.completed` /
  `customer.subscription.created|updated|deleted` upserts `user_subscriptions`
  (tier + interval resolved from the Price's lookup_key; sets
  `cancel_at_period_end`; on cancellation sets `grace_until`; `deleted` → `free`)
  via the service role.
- `create-portal-session` — returns a Stripe Billing Portal URL for
  manage/upgrade/downgrade/cancel (no in-app billing UI).

Secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.

**Client wiring** (core, not the cloud-sync plugin — billing is account-level and
PricingCards renders even with cloud disabled): `lib/billing.ts` is the pure,
unit-tested layer (`isActiveStatus`/`effectiveTier`/`isPaidTier`/`pricingCta`,
plus `lookupKey`/`tiersWithPrices`/`paidTiersVisible`/`priceFor`/`formatPrice` +
row/price shapes); `lib/billingClient.ts` is the Supabase I/O (`fetchTiers`,
`fetchMySubscription`, `fetchStripeConfig`, `createCheckout(tier, interval)`,
`createPortal`), through the same untyped escape hatch as `cloudClient.ts`.
`hooks/useSubscription.ts` reads the tier catalogue + the user's subscription;
`hooks/useStripePrices.ts` reads the live price catalogue (online, never throws).
`PricingCards` has a **monthly/annual toggle**, shows live **Upgrade** /
**Current plan** actions, and — the **failback** — hides the paid tiers entirely
when `paidTiersVisible(config)` is false (only Guest + Free cards). `PlanChooser`
(sign-up) picks tier + interval; a paid choice stashes a `lib/pendingCheckout.ts`
intent that `components/PendingCheckoutRedirect.tsx` (mounted in `App.tsx` for
cloud builds) redeems → Checkout on first sign-in after email confirmation.
cloud-sync's Profile-tab `StoragePanel` shows the plan + renewal/cancellation/
grace date + a **Manage subscription** portal link. **Stripe setup (create
Products/Prices with the lookup_keys, secrets, webhook, enable pg_cron) is
operator config — see README.**

### Data Rights & Retention / GDPR (`..._gdpr_compliance.sql` + 3 edge functions)

Self-service data access, portability and erasure, plus automatic IP
minimisation. All account-gated (cloud-only) except the IP purge, which is
backend cron.

| Object | Type | Notes |
|--------|------|-------|
| `account_deletions` | table | `(user_id PK→auth.users, requested_at, scheduled_for)`. RLS: owner can **select** + **delete** (cancel); **no insert policy** — only the service role schedules, so the 7-day window can't be shortened client-side. |
| `purge_expired_personal_data()` | fn (SECURITY DEFINER) | (a) Nulls `submitted_by_ip` on `submissions`/`messages` older than **90 days**; (b) deletes `messages` and *reviewed* `submissions` older than **1 year** (pending submissions kept for moderation); deletes expired `banned_ips` + stale `login_attempts`. Run daily by `pg_cron`. |
| `due_account_deletions()` | fn (SECURITY DEFINER) | User ids whose `scheduled_for <= now()`. Read by the deletion worker. |

Edge functions (all `verify_jwt = false`; the two user-facing ones verify the
JWT manually):

- `export-account-data` — auth user → service-role gather of everything we hold
  (profile, subscription, roles, `sync_records`, contact `messages` by email,
  pending deletion). Returns JSON; the client adds cloud-file blobs + all local
  browser data and zips it.
- `request-account-deletion` — auth user → inserts an `account_deletions` row
  `scheduled_for = now()+7d` (idempotent; never shortens an in-flight request).
- `process-account-deletions` — **cron-only** (`x-cron-secret` must equal
  `DELETION_CRON_SECRET`). For each due user: removes their `user-files` Storage
  objects, then `auth.admin.deleteUser` (cascades profiles/sync_records/
  subscription/roles/account_deletions via FKs).

Scheduling: the migration always schedules the IP purge (pure SQL). The deletion
worker is auto-wired via `pg_cron` + `pg_net` **only if** a Vault secret
`deletion_cron_secret` exists (matching `DELETION_CRON_SECRET` on the function);
otherwise the migration raises a NOTICE and it's a documented operator step.

**Client** (cloud-sync plugin): `exportManifest.ts` (pure, unit-tested — assembles
the zip's text entries), `accountExport.ts` (I/O orchestrator: edge fn + local
stores + blob download → JSZip), `accountDeletion.ts` (email-OTP gate via
`signInWithOtp`/`verifyOtp` + schedule/cancel), and `DataPrivacyPanel.tsx` (the
Profile-tab "Data & privacy" panel). Admin `BannedIpsTab` exposes a ban TTL
(defaults to 90 days). Privacy policy "Your Rights" / "Data Retention" describe
all of the above.

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

Update the readme when new parsers are added and when build parameters change. Make sure to ALWAYS note new environment variables and their values (use "???" When it is a secret value) in the readme.

Update the credits list when new Foss libraries are added.

Never do on a server what you can do on the client, the NUMBER ONE PRIORITY for this webapp is that 99% of the features are available offline. (Things like weather, satellite view etc, are obvious exceptions).

Keep code modular and reusable, fuck line count as long as you can reuse the shit out of things, rewrites to make things more reusable are always cool.

ALWAYS keep CLAUDE.md updated with new files and information to help it as well.
