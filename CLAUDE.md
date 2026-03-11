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

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | React 18 + TypeScript |
| Build | Vite + vite-plugin-pwa |
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
│   ├── dovexParser.ts         # DovesDataLogger extended format (.dovex) with 4096-byte metadata header
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
│   ├── trackStorage.ts        # localStorage: tracks + courses (merged with public/tracks.json)
│   ├── referenceUtils.ts      # Reference lap comparison utilities
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
│   ├── bleDatalogger.ts       # Web Bluetooth: DovesLapTimer BLE protocol (files + settings + tracks)
│   ├── deviceTrackSync.ts     # Track sync logic: merge/compare app↔device tracks, coordinate diff
│   ├── deviceSettingsSchema.ts # Device settings key definitions + validation
│   ├── weatherService.ts      # OpenWeatherMap API (online-only)
│   ├── db/                    # Admin database layer (modular, swappable)
│   │   ├── types.ts           # ITrackDatabase interface
│   │   ├── supabaseAdapter.ts # Supabase implementation
│   │   └── index.ts           # Factory: getDatabase()
│   └── utils.ts               # Tailwind cn() helper
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
      → returns ParsedData { samples: GpsSample[], fieldMappings, bounds, duration, startDate, dovexMetadata? }
  → courseDetection.ts (auto-detect track, course, direction; waypoint fallback)
    → returns CourseDetectionResult { track, course, direction, laps, isWaypointMode }
  → useLapManagement.ts (detect laps via lapCalculation.ts using selected course's start/finish line)
    → returns Lap[] with timing, speed stats, sector times
  → Visualization:
      Simple mode: RaceLineView (Leaflet map) + TelemetryChart (Canvas)
      Pro mode: GraphViewPanel (multi-series Canvas charts) + MiniMap (Leaflet)
```

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
| `ParsedData` | `samples[]`, `fieldMappings[]`, `bounds`, `duration`, `startDate?`, `dovexMetadata?` |
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

Extended Dove format with a 4096-byte metadata header:
```
Line 1: datetime,driver,course,short_name,best_lap_ms,optimal_ms
Line 2: 2024-03-15 14:30:00,Mike,Full CW,OKC,62345,61200
Line 3: 65432,64321,62345,63456   (lap times in ms, comma-separated)
\n padding to byte 4096
Byte 4096+: standard .dove CSV (timestamp,sats,hdop,lat,lng,...)
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

---

## BLE Integration (`src/lib/bleDatalogger.ts`)

Connects to **DovesLapTimer** ESP32 device via Web Bluetooth.

| UUID | Characteristic | Purpose |
|------|---------------|---------|
| `0x1820` | Service | Internet Protocol Support (container) |
| `0x2A3D` | File List | Read: newline-separated `filename,size` pairs |
| `0x2A3E` | File Request | Write: `GET:filename`, `LIST`, `SLIST`, `SGET:key`, `SSET:key=value`, `TLIST`, `TGET:name`, `TPUT:name` |
| `0x2A3F` | File Data | Notify: chunked file data (reassembled client-side) |
| `0x2A40` | File Status | Notify: `SIZE:n`, `DONE`, `ERROR:msg`, settings (`SVAL`, `SEND`, `SOK`, `SERR`), tracks (`TFILE`, `TEND`, `TREADY`, `TOK`, `TERR`) |

### File Protocol
LIST → select file → GET:filename → receive SIZE → stream data chunks → DONE.

### Settings Protocol
- `SLIST` → device sends `SVAL:key=value` for each setting on fileStatus, ends with `SEND`
- `SGET:key` → device responds `SVAL:key=value` or `SERR:NOT_FOUND` on fileStatus
- `SSET:key=value` → device responds `SOK:key` or `SERR:WRITE_FAIL` on fileStatus

### Track File Protocol
- `TLIST` → device sends `TFILE:name.json` per file on fileStatus, ends with `TEND`
- `TGET:name.json` → reuses existing SIZE → data chunks (fileData) → DONE (fileStatus) transfer pattern
- `TPUT:name.json` → device responds `TREADY` on fileStatus → app sends data chunks on fileRequest (64-byte max) → `TDONE` → device responds `TOK` or `TERR:reason`

Settings schema is defined in `src/lib/deviceSettingsSchema.ts` — maps keys to labels, types, and validation rules. Unknown keys from the device are displayed as raw string fields (forward-compatible).

---

## Device Track Sync (`src/lib/deviceTrackSync.ts`)

Pure comparison/conversion logic for merging app tracks with device track files:
- `buildMergedTrackList()` — matches tracks by shortName, courses by name, classifies as synced/mismatch/device_only/app_only
- `coursesMatch()` — coordinate comparison with epsilon (0.0000005°)
- `buildTrackJsonForUpload()` — serializes app Track to device JSON format (flat course array)
- `deviceCourseToAppCourse()` / `appCourseToDeviceJson()` — format converters

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

Key settings: `useKph`, `gForceSmoothing`, `gForceSmoothingStrength`, `brakingZoneSettings` (thresholds, duration, smoothing, color, width), `enableLabs` (hidden when no labs features), `darkMode`.

`fieldResolver.ts` maps parser-specific field names (e.g., "Lat G", "Lateral G", "LatG") to canonical IDs (`lat_g`) so settings apply uniformly.

---

## Environment Variables

| Variable | Client/Server | Description |
|----------|--------------|-------------|
| `VITE_SUPABASE_URL` | Client | Backend URL (auto-set) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Client | Backend anon key (auto-set) |
| `VITE_SUPABASE_PROJECT_ID` | Client | Backend project ID (auto-set) |
| `VITE_ENABLE_ADMIN` | Client | `"true"` to enable admin UI + `/login` route |
| `VITE_ENABLE_REGISTRATION` | Client | `"true"` to enable `/register` route |
| `VITE_TURNSTILE_SITE_KEY` | Client | Cloudflare Turnstile site key (optional CAPTCHA) |
| `TURNSTILE_SECRET_KEY` | Server (edge fn) | Turnstile secret — `???` |

---

## Commands

```bash
npm run dev       # Dev server on :8080
npm run build     # Production build → dist/
npm run lint      # ESLint
npm run preview   # Preview production build
```

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
