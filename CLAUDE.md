# CLAUDE.md — Codebase Intelligence for AI Agents

> This file is prepended to **every** agent turn, so it's a **map + the durable
> rules**, not an encyclopedia. Deep subsystem detail lives in `docs/` and loads
> only when relevant — follow the `→ docs/…` pointers. Keep this file lean: if a
> fact is discoverable with Glob/Grep/Read, or it narrates implementation that
> will go stale, it belongs in code or `docs/`, not here.

## Project Identity

**Dove's DataViewer / LapWing** — Open-source, offline-first motorsport
telemetry viewer.
- Live: [lapwingdata.com](https://lapwingdata.com) | Beta: [beta.lapwingdata.com](https://beta.lapwingdata.com)
- Companion hardware: [DovesDataLogger](https://github.com/TheAngryRaven/DovesDataLogger) (nRF52840 GPS logger with BLE — Seeed XIAO nRF52840, `sense`/`nonsense` IMU variants)
- PWA with full offline support via service worker + IndexedDB

---

## Golden Rules

1. **Offline-first.** 99% of features must work without network. Only weather,
   satellite tiles, and admin/cloud are exceptions. *Never do on the server what
   you can do on the client.*
2. **Modular & reusable.** Prefer small composable modules over monoliths; line
   count doesn't matter if you reuse aggressively. Rewrites for reusability are
   always welcome. Hooks do one thing; `Index.tsx` orchestrates.
3. **Tests are part of the change.** New parsers, pure utilities, and protocol/
   format logic ship with Vitest coverage. Bug fixes add a regression test that
   fails before the fix. Don't leave testable logic untested.
4. **Changelog is part of the change.** Add user-facing changes to `CHANGELOG.md`
   as you make them. **Once a beta version is picked (e.g. `2.6.0`), keep that
   heading as `## [2.6.0] - unreleased` and keep adding under it until it ships —
   do NOT create a new `[Unreleased]` block or bump the patch on every commit.**
   Only on release do you set the date/tag, then start the next version.
5. **Docs stay in sync.** Update `README.md`, this file, the relevant `docs/*`, and
   the in-app `CreditsDialog.tsx` alongside the code that makes them stale (parsers,
   env vars, dependencies, architecture). README Credits and `CreditsDialog` must
   agree. Update Credits when adding a FOSS dependency.
6. **Green before merge.** `bun run lint`, `bun run typecheck`, `bun run test:run`,
   and `bun run build` all pass — CI runs them as separate workflows on every PR.
7. **Keep it professional.** Public, released OSS (v1.5.0+). No dead code (delete,
   don't comment out), no leftover `console.log`, no scaffolding cruft. Comments
   explain *why*, not *what*, only where non-obvious. Small, focused PRs with clear
   commit messages explaining the *why* — prefer a topic branch + PR over committing
   to `main`. Respect the bundle budget and the conventions below.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | React 18 + TypeScript |
| Build | Vite + vite-plugin-pwa (`/service-worker.js` active SW, `/sw.js` cleanup kill-switch) |
| Styling | Tailwind CSS + shadcn/ui (HSL design tokens in `index.css`) |
| Mapping | Leaflet (CartoDB + Esri tiles, cached 30 days by SW; satellite has an Esri **Wayback** imagery-date picker — `lib/satelliteImagery.ts`) |
| Charts | Custom Canvas 2D (not a library — `TelemetryChart.tsx`, `SingleSeriesChart.tsx`) |
| Video Export | WebCodecs + [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) (H.264 + AAC → MP4) |
| State | React hooks + React Query (admin only) |
| Drag/Reorder | [dnd kit](https://dndkit.com) — sector-list reorder; lazy with the track editor |
| Local Storage | IndexedDB (`dbUtils.ts`) for files/metadata/karts/notes/setups/etc.; localStorage for tracks & settings |
| Backend | None for core features. Optional admin/cloud via Supabase — see `docs/backend.md` |
| BLE | Web Bluetooth API for DovesDataLogger — see `docs/ble.md` |

---

## Architecture Map

> Directory + entry-point level. Leaf files are discoverable with Glob/Grep — they
> are intentionally **not** all listed here. ★ marks load-bearing entry points.

```
src/
├── pages/
│   ├── Index.tsx          # ★ Main SPA — file import, tab views, all state orchestration
│   ├── Admin.tsx          # Admin panel (behind VITE_ENABLE_ADMIN)
│   └── …                  # Login / Register / Privacy / Terms / NotFound
├── components/
│   ├── ui/                # shadcn/ui primitives
│   ├── admin/             # Admin tabs (Tracks, Courses, Submissions, Users, BannedIps, Tools, Messages)
│   ├── tabs/              # View tabs (GraphView, RaceLine, LapTimes, Coach, Tools; SetupsNotesPanel = Setups+Notes 50/50 split on md+, separate tabs on phones — bodies live in drawer/)
│   ├── graphview/         # Pro mode: GraphPanel, GraphViewPanel, MiniMap, SingleSeriesChart, GGDiagram, InfoBox, PanelCard (resizable card chrome for relocated Video/Mini-Map panels). On mobile the left column collapses via a divider flag tab, and Video/Mini-Map can be relocated into the resizable graph stack from the top of the "Add Graph" picker (GraphPanel reports which are active so the host drops its duplicate VideoPlayer — single shared video ref).
│   ├── drawer/            # File-manager drawer tabs (Files, Vehicles/Karts, Device*); SetupsTab + NotesTab also here but mounted as main-view tabs
│   ├── track-editor/      # Track editor: VisualEditor, SectorListEditor, CourseSectorEditor, Add*Dialog
│   ├── video-overlays/    # Video-export overlay system: registry + themes + per-widget *Overlay
│   ├── RaceLineView.tsx   # Leaflet map: race line, speed heatmap, braking zones
│   ├── TelemetryChart.tsx # Canvas speed/telemetry chart (simple mode)
│   ├── VideoPlayer.tsx    # Synced video playback + overlay system (multi-chunk GoPro playlists via lib/videoPlaylist)
│   └── …                  # FileImport, LoggerDownload (eager picker host) + LoggerPicker (image chooser) + DataloggerDownload (lazy Fledgling BLE flow), LapSnapshot*, …
├── hooks/                 # One concern each; Index.tsx orchestrates.
│   ├── useSessionData     # Parses imported file → ParsedData
│   ├── useLapManagement   # Lap calc, selection, visible range
│   ├── usePlayback        # Shared playback cursor (chart + map)
│   ├── useLapSnapshots / useLapOverlays / useReferenceLap / useVideoSync
│   ├── useSettings / useSessionMetadata / useOnlineStatus / useWaybackImagery
│   └── use*Manager        # IndexedDB CRUD: File, Vehicle (←Kart compat), Engine, Template, Note, Setup
├── lib/
│   ├── datalogParser.ts   # ★ Format auto-detection router (entry point for all parsing)
│   ├── *Parser.ts         # nmea, ubx, iracing (.ibt), vbo, dove, dovex, alfano, aim, motec
│   ├── xrk/               # ★ AiM .xrk/.xrz importer — libxrk (Rust→WASM) in a Web Worker (→ docs/subsystems.md)
│   ├── channels.ts        # ★ Canonical channel registry + normalizeChannels()
│   ├── courseDetection.ts # ★ Auto track/course/direction detection + waypoint mode (→ docs/subsystems.md)
│   ├── courseSectors.ts   # ★ Pure sector model: caps, normalizeCourseSectors, majorSectorLines (→ docs/subsystems.md)
│   ├── lapCalculation.ts  # Start/finish + per-sector crossing detection → Lap[]
│   ├── lapDelta.ts        # ★ Position-based lap delta (arc-length resample + segment-projected gap)
│   ├── fileBrowserTree.ts # ★ Pure file-browser hierarchy (→ docs/subsystems.md)
│   ├── sampleData.ts      # ★ Bundled sample log seeded as an ordinary file (→ docs/subsystems.md)
│   ├── lapOverlays.ts / lapAlignment.ts  # ★ Multi-lap overlay logic + Kabsch drift-align (→ docs/subsystems.md)
│   ├── lapSnapshot*.ts    # ★ Snapshot types/buffer + IndexedDB CRUD (→ docs/subsystems.md)
│   ├── setupRevision*.ts  # ★ Content-addressed setup history + IndexedDB CRUD (→ docs/subsystems.md)
│   ├── setupHistory.ts    # ★ Pure setup-history view-model (diff + fastest-lap aggregation) → drawer/SetupHistoryPanel (→ docs/subsystems.md)
│   ├── vehicleHistory.ts  # ★ Pure vehicle-history view-model (per-vehicle setup revisions, fastest-lap first, course filter) → drawer/VehicleHistoryPanel; reuses setupHistory primitives; shared card chrome in drawer/HistoryCard.tsx
│   ├── trackSubmission.ts # ★ Community-DB upload plan (→ docs/subsystems.md)
│   ├── dbUtils.ts         # ★ Shared IndexedDB: DB_NAME, DB_VERSION, openDB(), tx helpers
│   ├── garageEvents.ts    # ★ Host pub/sub: storage emits {store,key,put|delete}; cloud-sync syncs off it
│   ├── fileLoadingState.ts # ★ Host pub/sub for the global file-load overlay
│   ├── *Storage.ts        # IDB/localStorage store modules (file, vehicle, engine, template, note, setup, …)
│   ├── gps/               # ★ Phone-as-datalogger layer: gpsFix, customGps, sessionGate, realtimeTimer, dovepWriter
│   ├── loggers/           # ★ Generic LoggerConnection (listLogs/downloadLog/disconnect) + per-logger adapters — Fledgling=BLE today; MyChron (Tauri)/Alfano later satisfy the same interface
│   ├── speedHeatmap.ts / mapMarker.ts / brakingZones / gforceCalculation / …  # racing math
│   ├── chartUtils / canvas2d / chartAxis / chartColors / videoExport / overlayCanvasRenderer  # charts/video
│   ├── videoPlaylist.ts   # ★ Pure GoPro chunked-video model: parse/order GH/GX/GP/GOPR chunk names, build a virtual timeline (cumulative offsets) + virtual↔local time mapping + planAudioSegments (export audio stitch). useVideoSync swaps the <video> src per chunk; a single file is a 1-chunk playlist
│   ├── satelliteImagery.ts # ★ Esri Wayback parsing (online-only satellite imagery-date picker)
│   ├── ble/               # Web Bluetooth DovesLapTimer protocol + firmware OTA (→ docs/ble.md)
│   ├── db/                # Admin DB layer: ITrackDatabase + supabaseAdapter + getDatabase()
│   ├── billing*.ts        # Subscription logic + Supabase billing I/O (→ docs/backend.md)
│   ├── weatherService.ts  # Historical weather (online-only): NWS/IEM METAR → Open-Meteo fallback
│   ├── weatherCacheStorage.ts # Per-session historical-weather cache (IndexedDB, local-only/never cloud-synced): a session's date is fixed so its weather is immutable — cache it once, stop re-pinging the station/API on reopen
│   ├── buildInfo.ts       # Build version/hash/branch stamp + isPreviewBuild()
│   ├── versionCheck.ts    # ★ "Update available" signal: compares buildInfo vs the build-emitted, uncached /version.json (independent of the SW's own update detection) → main.tsx update toast
│   ├── debugConsole.ts    # ★ On-screen debug console (`?dbg=true`) — mobile/PWA has no dev tools
│   ├── units.ts           # ★ Pure unit conversions for the 3 imperial/metric toggles
│   ├── i18n/              # ★ i18next config/init/format (→ docs/i18n.md)
│   └── utils.ts           # Tailwind cn() helper
├── locales/              # ★ Translation JSON, src/locales/<lng>/<ns>.json. en/ = source of truth
├── plugins/               # ★ Plugin framework (auto-discovered) — see src/plugins/README.md
│   ├── (framework)        # types, registry, index, panels, mounts, fileSources, storage + hosts
│   ├── cloud-sync/        # ★ First-party plugin: Supabase file + garage sync (→ docs/backend.md)
│   ├── tools/             # ★ First-party plugin: Tools tab (kart seat-position viz; phone Lap Timer)
│   └── coaching/          # Gitignored slot for the AI coach (npm pkg in production)
├── types/racing.ts        # ★ Core types: GpsSample, ParsedData, Lap, Course, Track, …
├── contexts/              # SettingsContext, SessionContext, PlaybackContext, DeviceContext, AuthContext
│                          #   ★ PlaybackContext carries ONLY the playback cursor (updates per tick) —
│                          #   split from SessionContext to keep memo'd tabs quiet. Never put churning
│                          #   per-tick state in SessionContext; its value must stay referentially stable.
└── integrations/supabase/ # Auto-generated — DO NOT EDIT
```

---

## Data Flow Pipeline

```
File Import (drag-drop / BLE download / file manager)
  → fileStorage.ts (save raw blob to IndexedDB)
  → useSessionData.ts (read blob, call parseDatalogFile)
    → datalogParser.ts (auto-detect format, route to specific parser)
      → normalizeChannels() (channels.ts): rewrites every fieldMapping name + extraFields key to a
        canonical ChannelId (or `custom:` slug). Runs once for all formats.
      → returns ParsedData { samples, fieldMappings, bounds, duration, startDate, dovexMetadata?, parserStats? }
  → courseDetection.ts (auto-detect track, course, direction; waypoint fallback)
  → useLapManagement.ts (detect laps via lapCalculation.ts using the course's start/finish line)
  → Visualization:
      Simple mode: RaceLineView (Leaflet) + TelemetryChart (Canvas)
      Pro mode: GraphViewPanel (multi-series Canvas) + MiniMap (Leaflet)
```

---

## Core Types (`src/types/racing.ts`)

| Type | Key Fields |
|------|------------|
| `GpsSample` | `t` (ms), `lat`, `lon`, `speedMps/Mph/Kph`, `heading?`, `extraFields: Record<string,number>` |
| `ParsedData` | `samples[]`, `fieldMappings[]`, `bounds`, `duration`, `startDate?`, `dovexMetadata?`, `parserStats?` |
| `ParserStats` | `totalRows`, `acceptedRows`, `rejected: { nanFields, zeroCoords, outOfRange, speedCap, teleportation, incompleteRow }` |
| `DovexMetadata` | `datetime?`, `driver?`, `course?`, `shortName?`, `bestLapMs?`, `optimalMs?`, `lapTimesMs?[]` |
| `Lap` | `lapNumber`, `startTime/endTime`, `lapTimeMs`, speed stats, `startIndex/endIndex`, `sectors?` (S1/S2/S3 major rollup), `sectorTimes?` (fine-grained), `sectorBoundaries?` (per-line sample indices) |
| `Course` | `name`, `lengthFt?`, `startFinishA/B`, `sectors?: CourseSector[]`, deprecated `sector2/sector3` (legacy mirror), optional `layout?` (`{lat,lon}[]` outline) |
| `CourseSector` | `{ line: SectorLine, major: boolean }` — one timing line after start/finish |
| `Track` | `name`, `shortName?` (max 8 chars), `courses[]` |
| `CourseDetectionResult` | `track`, `course`, `direction?`, `laps[]`, `isWaypointMode`, `waypointNotice?` |
| `FieldMapping` | `index`, `name` (canonical ChannelId or `custom:` slug), `label?`, `unit?`, `enabled` |
| `FileMetadata` | `fileName`, `trackName`, `courseName`, `weatherStation*?`, `sessionKartId?`, `sessionSetupId?`, `sessionSetupRev?` (frozen hash), `sessionEngine?`, `sessionStartTime?`, `fastestLapMs?`, `fastestLapNumber?`, `displayName?` (browser-name override — the bundled sample), `isSample?` (marks the sample so the browser can hide it), `postSession?` (`PostSessionData`: post-session tire pressures — single/halves/quarters — + a single weight, entered on the Notes tab; cloud-synced via metadata, held for later processing). Partial updates go through `updateFileMetadata(fileName, patch)` (read-merge-write — never clobbers untouched tags). |

---

## Parser System

Each parser exports `isXxxFormat(input): boolean` (detection) + `parseXxxFile(input):
ParsedData` (full parse). **To add one:**
1. Create `src/lib/xxxParser.ts` with both functions.
2. Register in `src/lib/datalogParser.ts` — import + detection check in **both**
   `parseDatalogFile()` and `parseDatalogContent()`.
3. Update `README.md` supported-formats table + the architecture map above.
4. Add Vitest coverage.

**Detection order matters:** AiM XRK/XRZ first (binary, by extension/`<h` magic),
then other binary (MoTeC LD → UBX → iRacing `.ibt`), then text most-specific to
least (VBO → MoTeC CSV → Dovex → Dove → Alfano → AiM CSV → NMEA fallback).

Two parsers break the simple sync contract — the async **AiM XRK/XRZ** (Rust→WASM
Web Worker) and the binary **iRacing `.ibt`**. Details, plus the **.dovex/.dovep**
8 KB-header format: **→ `docs/subsystems.md`**.

---

## IndexedDB Storage (`src/lib/dbUtils.ts`)

Single shared database: `"dove-file-manager"`, **version 13**.

| Store | Key | Module |
|-------|-----|--------|
| `files` / `metadata` | `name` / `fileName` | `fileStorage.ts` |
| `karts` | `id` | `kartStorage.ts` |
| `notes` | `id` (indexed by `fileName`) | `noteStorage.ts` |
| `setups` | `id` (indexed by `kartId`) | `setupStorage.ts` |
| `video-sync` / `session-videos` | `sessionFileName` | `videoStorage.ts` / `videoFileStorage.ts` |
| `graph-prefs` | `sessionFileName` | `graphPrefsStorage.ts` |
| `vehicle-types` / `setup-templates` | `id` | `templateStorage.ts` |
| `engines` | `id` | `engineStorage.ts` |
| `lap-snapshots` | `id` (indexed by `courseKey`, `engineKey`) | `lapSnapshotStorage.ts` |
| `setup-revisions` | `id` = content hash (indexed by `setupId`) | `setupRevisionStorage.ts` |
| `weather-cache` | `fileName` | `weatherCacheStorage.ts` (local-only, **not** cloud-synced) |

To add a store: increment `DB_VERSION`, add to `STORE_NAMES`, add creation logic in
`openDB()`, create a storage module using `withReadTransaction`/`withWriteTransaction`.
Tracks live in **localStorage** (`trackStorage.ts`), not IndexedDB.

---

## Plugin Framework (`src/plugins/`)

Modular extension system. The OSS app defines the contract; plugins implement
`DataViewerPlugin` and are discovered at startup from **two sources**: in-repo
first-party plugins (`src/plugins/<name>/index.ts` via `import.meta.glob`) and
external npm packages (the AI coach, via `virtual:external-plugins`). A plugin
absent at build time simply never loads. **Full framework docs:
`src/plugins/README.md`.**

A plugin default-exports `{ id, name, version?, priority?, setup?(ctx) }`. In
`setup` it contributes to named extension points
(`ctx.registry.contribute(point, value)`); consumers read via
`getContributions(point)`. Same-`id` plugins resolve by highest `priority`.
`ctx.storage` is a per-plugin KV store. Extension points today:

- **Panels** (`panels.ts`, `PANELS_POINT`): a panel targets a *slot* —
  `Coach`, `Tools`, `Profile` — rendered by the matching tab via `PluginPanelHost`
  (per-panel error + Suspense boundaries, so panels can be `React.lazy`). Tabs are
  **self-gating**: `Index.tsx` computes visibility from `getPanelsForSlot`, so a tab
  appears only when a plugin contributes to it. `chromeless: true` skips the card.
- **Mounts** (`mounts.ts`, `MOUNTS_POINT`): inject a raw component into a fixed spot
  — `FileRow`, `FileDeleteConfirm`, `Landing` (the only off-session surface).
  Rendered via `<PluginMount slot ctx>`.
- **File sources** (`fileSources.ts`, `FILE_SOURCES_POINT`): feed *remote* files
  into the host browser as inline `cloud` rows without coupling the host to cloud.

First-party plugins: **cloud-sync** (Supabase file + garage sync → `docs/backend.md`)
and **tools** (Tools tab: kart seat-position visualizer + phone Lap Timer built on
`lib/gps/`). New slots/points are just new strings — no framework change.

> ## ⚠️ SUPER IMPORTANT — coach source differs by branch (DO NOT MERGE BLINDLY)
>
> **The `BETA` branch does NOT use the published npm package.** On `BETA` the coach
> is pulled straight from the coach repo's `BETA` branch as a git `optionalDependency`:
> - `package.json` → `"@theangryraven/eye-in-the-sky": "github:TheAngryRaven/DataViewer_coach#BETA"`
> - `vite.config.ts` → `DEFAULT_PLUGIN_PACKAGES = "@theangryraven/eye-in-the-sky"`
>
> **`main` stays on the published npm package** (`@perchwerks/eye-in-the-sky`,
> tilde-pinned). These are the **only two lines** that differ, and they must **NOT**
> ride a BETA → main merge. Product-cut dance (only when the maintainer asks):
> on `BETA` flip both lines to the tagged npm release → `bun install` → test →
> merge to `main`; after the merge, flip `BETA` back to the `github:…#BETA` dep.
> A git dep records the resolved commit SHA in `bun.lock`, so a new coach `BETA`
> push needs `bun update @theangryraven/eye-in-the-sky` to pull.

---

## Subsystems — summaries (detail in `docs/`)

Each is one-or-two lines here; the full design + file map is in `docs/subsystems.md`
unless noted.

- **Automatic course detection** (`courseDetection.ts`): on load with no saved
  track, find the nearest track within 5 mi, match a course by lap distance vs
  `lengthFt`, detect direction, else fall back to **waypoint mode** (lower accuracy).
- **Course sectors** (`courseSectors.ts`): timing lines = start/finish + an ordered
  `Course.sectors` list; exactly 3 "major" lines. The logger only ever sees the 3
  majors (`legacyMirror`); sub-sectors are app-only. `normalizeCourseSectors`
  migrates legacy `sector2/3` at every load boundary. **Single source of truth — the
  rest of the app never reasons about sector geometry directly.**
- **Lap snapshots** (`lapSnapshot*.ts`): frozen "course fastest lap" keyed by
  (course + engine); loaded as a comparison overlay only (excluded from playback).
- **Setup revisions** (`setupRevision*.ts`): immutable, content-addressed (`id` =
  SHA-256) history of vehicle setups, frozen on assignment.
- **Course layouts / drawing**: user-drawn polyline outlines persist on
  `Course.layout`; built-ins come from `public/drawings.json`. Draw/Generate tools
  in `VisualEditor`, available to all users.
- **Community submission** (`trackSubmission.ts`): bulk diff of local vs built-in
  tracks → one `submit-track` call per batch; content-hash dedupe. Signed-in
  submits are attributed (`submissions.submitted_by_user_id`, from the verified
  JWT) and the dialog shows a "contributions earn free cloud storage" note. The
  admin **Users** tab (`admin-users` edge fn) lists accounts + can **comp** free
  premium months (auto-expiring) → `docs/backend.md` → *User management*.
- **File browser** (`fileBrowserTree.ts` + `SessionBrowser`): Track→Course→logs
  hierarchy; display name = the session's date/time (or `FileMetadata.displayName`
  override); smart collapse; cloud rows merged inline. The bundled **sample log**
  (`sampleData.ts`) is an ordinary row, hidden when `showSampleFiles` is off.
- **BLE / device + firmware OTA**: app integration → `docs/ble.md`; the full
  transport-agnostic **wire spec** (every GATT characteristic, command, and packet,
  for replicating the connection in any stack — Tauri/native included) →
  [`docs/ble-protocol.md`](docs/ble-protocol.md). **Keep `docs/ble-protocol.md` in
  sync with every BLE wire-format change** (new command/response token, changed
  characteristic, chunking, or service) alongside the firmware + `src/lib/ble/`.
- **Cloud sync, subscriptions, GDPR**: Supabase-backed, touch nothing in the core
  app per Rule 1 → `docs/backend.md`. Documents, logs, and lap snapshots draw from
  **one pooled per-tier byte budget** (`subscription_tiers.total_bytes`).
- **Android / Tauri shell** (`lib/platform.ts`): the same bundle serves the web app
  and a native Android app (separate Tauri repo). `isNativeApp()` is the single
  gate — on native: **no service worker** (`main.tsx`), **no in-app purchases**
  (paid plans are web-only per Google Play policy; cloud sync still works), and
  external links open in the system browser (`openExternal`/`interceptExternal`).
  Public deletion URL at `/delete-account`. → `docs/android.md`.

---

## Settings

`useSettings` (persists to localStorage) → `SettingsContext` for tree-wide access.

**Units are three independent imperial/metric toggles** (all default imperial),
each a Switch in `SettingsModal`. All conversions live in **`lib/units.ts`** (pure,
unit-tested); canonical internal values convert only at display time. Language never
swaps units — that's a separate axis.
- `useKph` (speed) — MPH ⇄ KPH. Picks `speedMph`/`speedKph` + speed axis labels.
- `useMetricDistance` (distance) — ft/mi ⇄ m/km. Chart distance axis, range-crop
  labels, course lengths, distance-family channels (`distance`, `altitude`).
- `useMetricWeather` (weather) — °F/mph/inHg/ft ⇄ °C/(km/h)/hPa/m. Weather UI.

`showSampleFiles` (default true) shows/hides the bundled sample log — see the
sample-data note in `docs/subsystems.md`.

Other key settings: `gForceSmoothing(+Strength)`, `gForceSource`,
`brakingZoneSettings`, `darkMode`,
`deltaMethod` (`'position'` default | `'distance'`), `deltaSampleMeters`,
`chartXAxis` (`'distance'` default | `'time'`).

The analysis charts, lap delta, multi-lap overlays, and the G-G diagram have their
own design notes: **→ `docs/subsystems.md`**.

---

## Internationalization (i18n)

i18next + react-i18next. English is **bundled** (zero-flash fallback); other
languages (`es`, `fr`, `de`, `it`, `pt-BR`, `ja`) lazy-load per namespace, precached
by the SW (offline). Language is a setting (`AppSettings.language`); keys are typed
(`types/i18next.d.ts`) so a missing key fails `tsc -b`. **Every user-facing surface
is migrated** (legal pages stay English by design).

**Migrating a surface:** replace literals with `t("ns:key")`, add the key to
`src/locales/en/<ns>.json` (new namespace → register in `config.ts` + the typing),
then `bun run i18n:seed` to fill other languages. Mechanics, plugin-owned namespaces,
and the seeder: **→ `docs/i18n.md`**.

---

## Environment Variables

| Variable | Client/Server | Description |
|----------|--------------|-------------|
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` / `VITE_SUPABASE_PROJECT_ID` | Client | Backend creds (auto-set; `vite.config.ts` has public fallbacks) |
| `VITE_ENABLE_ADMIN` | Client | `"true"` enables admin UI + `/admin`. `/login` is mounted when this OR `VITE_ENABLE_CLOUD` is on. |
| `VITE_ENABLE_CLOUD` | Client | `"true"` enables public accounts (Cloud Sync + email sign-in + `/register` etc.). Default `"false"`. |
| `VITE_ENABLE_GOOGLE_AUTH` | Client | `"true"` shows "Continue with Google". Requires `VITE_ENABLE_CLOUD`. Default `"false"`. |
| `VITE_IS_NATIVE` | Client/Build | `"true"` ONLY for the native (Tauri/Android) shell build. Gates `isNativeApp()` (`lib/platform.ts`): no service worker, no in-app purchases (web-only billing — Google Play policy), external links via the system browser. Default `"false"`. → `docs/android.md`. |
| `VITE_TURNSTILE_SITE_KEY` | Client | Cloudflare Turnstile site key (optional CAPTCHA) |
| `TURNSTILE_SECRET_KEY` | Server (edge fn) | Turnstile secret — `???` |
| `VITE_FIRMWARE_MANIFEST_URL` | Client | Override the logger firmware OTA manifest URL. Unset: `main` → production manifest, non-`main`/preview → beta channel (same `isPreviewBuild()` switch). |
| `DOVE_PLUGIN_PACKAGES` | Build | Comma-separated external plugin npm packages. Overrides the default when set. |
| `ANTHROPIC_API_KEY` / `I18N_SEED_MODEL` | Maintainer tool | Used **only** by `bun run i18n:seed` (`ANTHROPIC_API_KEY` = `???`). Never in the app or CI build. |
| `VITE_APP_VERSION` / `VITE_GIT_HASH` / `VITE_BUILD_DATE` / `VITE_GIT_BRANCH` / `VITE_GIT_COMMIT_DATE` | Build (auto) | Footer version stamp — **not hand-set**; baked from `package.json` + git in `vite.config.ts`. |

**PWA/deploy detail:** the active offline worker is `/service-worker.js` (registered
outside preview/iframe contexts); `public/sw.js` is a legacy kill-switch. `vite.config.ts`
also emits `/version.json` per build (the freshness signal for `versionCheck.ts`); it's
excluded from the Workbox precache (`globIgnores`) and fetched uncached. Static
hosting is Cloudflare Workers (static-assets-only, `wrangler.jsonc`,
`bun run build` then `wrangler deploy`). Production `lapwingdata.com` attaches via
a `custom_domain` route in `wrangler.jsonc` (auto DNS+TLS — don't also attach it in
the dashboard). The beta domain `beta.lapwingdata.com` can't bind to a Branch
Preview URL, so a separate thin reverse-proxy Worker in `beta-proxy/` owns it and
forwards to `beta-lapwing.perchwerks.workers.dev` (deployed on its own; see
`beta-proxy/README.md`). Per-branch preview backend: `vite.config.ts` `pick()`
prefers `*_PREVIEW` Supabase creds on any non-`main` branch
(`WORKERS_CI_BRANCH`/`CF_PAGES_BRANCH`), so beta deployments bake in a preview DB.
`main` and local dev never read `_PREVIEW`. See README "Deployment".

---

## Commands

**Package manager: Bun (only).** `bun.lock` is the **sole committed lockfile**; CI
and Cloudflare run `bun install --frozen-lockfile`. Do **not** add an npm/yarn/pnpm
lockfile. Run scripts with `bun run <script>` — note `bun run test` (Vitest), **not**
`bun test` (Bun's own runner). After adding/removing a dep, `bun install` + commit
`bun.lock`.

```bash
bun install        # Install deps (--frozen-lockfile in CI)
bun run dev        # Dev server on :8080
bun run build      # Production build → dist/
bun run lint       # ESLint
bun run typecheck  # tsc -b (build mode — MUST be -b to follow project references)
bun run test       # Vitest watch (NOT `bun test`)
bun run test:run   # Vitest single pass (CI-style)
bun run test:coverage  # Vitest + v8 coverage (enforces thresholds in vitest.config.ts)
```

> **Why `tsc -b`?** Root `tsconfig.json` has `files: []` and only `references`. Plain
> `tsc --noEmit` from root silently exits 0 without checking anything. `tsc -b`
> follows references; both referenced configs have `noEmit: true`.

> **Coverage scope** is deliberately `lib/`, `hooks/`, `plugins/` (logic worth
> unit-testing). The React view layer is **excluded** (`components/**/*.tsx`,
> `pages/**`, `contexts/**`, `App.tsx`, `ui/`, generated Supabase). The exclude
> targets `components/**/*.tsx` *only* — `.ts` logic under `components/video-overlays/`
> stays in scope. Don't widen the include to pull view code back in, and don't
> exclude `hooks/`/`lib/` to inflate it. Thresholds are floors — ratchet up.

CI is five parallel workflows (`lint`, `typecheck`, `test`, `build`, `coverage`).
`coverage.yml` enforces thresholds, posts a per-PR comment, and pushes the badge to
a **GitHub Gist** (secret `GIST_TOKEN` + var `COVERAGE_GIST_ID`).

---

## Bundle Splitting / Code-Splitting

Initial bundle is kept small via `React.lazy` boundaries + `manualChunks` vendor
splitting in `vite.config.ts`. Pulling a lazy module into an eagerly-imported file
re-merges it into the main chunk — watch for this.

**Lazy (off the initial path):** routes (`Login`, `Admin`, `Register`, `Privacy`);
view tabs (`RaceLineTab`, `GraphViewTab`, `CoachTab`, `ToolsTab`, `SetupsTab`); `FileManagerDrawer`;
`DataloggerDownload` — the Fledgling BLE flow, mounted on demand by the eager
`LoggerDownload` picker host so `lib/ble/*` stays off the landing payload while the
menu still opens instantly; `CourseSectorEditor` (carries
`@dnd-kit/*`). Lazy components must render inside `<Suspense>`; use
`lazy(() => import('…').then((m) => ({ default: m.Named })))` for named exports.

**Vendor chunks:** `vendor-react`, `vendor-query`, `vendor-leaflet`,
`vendor-supabase`, `vendor-radix`, `vendor-i18n` — cache independently across deploys.

> **`vendor-supabase` is fully off the eager graph.** Its only static importers are
> lazy/flag-gated (`contexts/authBackend.ts`, lazy auth/admin pages, cloud-sync's
> lazy panels). Everything on the eager graph (`SubmitTrackDialog`, `PricingCards`,
> `useStripePrices`/`useSubscription`) reaches Supabase via dynamic import at the
> call site. **Do NOT add a static `@/integrations/supabase/client` (or
> `lib/billingClient`) import to anything eagerly reachable from `Index.tsx`/
> `LandingPage`** — it re-merges ~172 kB of Supabase into the landing payload.

---

## Key Conventions

- **No server when client works** — the #1 rule.
- **Hooks are composable** — each does one thing; `Index.tsx` orchestrates.
- **Parsers** export `isXxxFormat()` + `parseXxxFile()`, registered in `datalogParser.ts`.
- **IndexedDB stores** are registered in `dbUtils.ts`; modules use the tx helpers.
- **Tracks**: `public/tracks.json` is the runtime source of truth; admin DB builds
  it. Export includes `longName`, `shortName`, `defaultCourse`, per-course `lengthFt`.
- **CSS**: use Tailwind semantic tokens from `index.css`, never hardcode colors
  (e.g. `--warning`/`warning` for the preview-build footer).
- **Admin/cloud code** is fully optional and env-gated — the core app has zero
  admin/cloud dependencies on the eager graph.
- **Edge functions** live in `supabase/functions/`, auto-deployed, configured in
  `supabase/config.toml`.
- **Stale-state gotcha**: when calling a function immediately after `setState`, the
  new value isn't in the current closure — pass values explicitly (e.g.
  `calculateAndSetLaps(course, samples, fileName)`).
- **Channels** are normalized to canonical ids at parse time; the per-source g-force
  ids (`lat_g`/`lon_g` vs `*_native` vs raw `accel_*`) coexist and must never collapse.
