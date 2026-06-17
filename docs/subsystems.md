# Subsystem Reference

Deep detail for the app-side subsystems, kept out of `CLAUDE.md` so it loads only
when you're working on the relevant area. `CLAUDE.md` carries the one-line summary
and points here. Hardware/BLE detail is in [`ble.md`](ble.md); cloud/subscriptions
in [`backend.md`](backend.md); i18n in [`i18n.md`](i18n.md).

---

## Parsers — format-specific notes

The parser contract (`isXxxFormat` / `parseXxxFile`, registration, detection
order) is in `CLAUDE.md`. The two parsers that break the simple sync contract:

### AiM XRK/XRZ (`src/lib/xrk/`) — the async exception (wasm)

AiM's native binary logs are parsed by **libxrk's pure-Rust core compiled to
WebAssembly** (no Pyodide/Python), run in a Web Worker.

Flow: `isXrkFile()` (extension or `<h` magic) → `parseXrkFile(file, onProgress?)`
→ worker (`xrkWorker.ts`) instantiates the wasm (`wasm/`, precached) once, calls
`parse_xrk(bytes)` → pure `xrkResample.ts` aligns native-rate channels onto the
GPS timebase (interpolate vs forward-fill per channel) → transferable
`Float64Array`s → pure `xrkMapping.ts` builds `ParsedData` (then the router's
`normalizeChannels` canonicalises it).

- **Parsing is async only** (worker), so it's reached via `parseDatalogFile()`.
  Every "load a file" path uses that: FileImport, reopen from FilesTab, **and the
  reference/overlay loaders** (`useReferenceLap`/`useLapOverlays` parse saved
  files via `parseDatalogFile(new File([blob], name))`, cached per file). So XRK
  works as main session, reference, and overlay. Snapshots use the loaded
  session's samples, so they work too. The sync `parseDatalogContent()` still
  throws for XRK as a safety net — its only callers (BLE, bundled sample) are
  never XRK.
- **Fully offline + fast.** The ~200 KB wasm is **precached** (`wasm` is in the
  SW `globPatterns`); no network, no runtime download. Typical parse is tens to a
  couple hundred ms.
- **Built from source, committed.** `xrk-wasm/` is a thin `wasm-bindgen` wrapper
  crate over libxrk's core, pinned to a libxrk `rev` in its `Cargo.toml`.
  `scripts/build-xrk-wasm.sh` builds it → commits `src/lib/xrk/wasm/`
  (`xrk_wasm.js` glue + `xrk_wasm_bg.wasm`). CI is JS-only and never builds Rust.
  Licenses: `src/lib/xrk/wasm/THIRD-PARTY-NOTICES.txt`.
- `onProgress` is threaded `parseDatalogFile` → router → `parseXrkFile` (XRK
  only); other formats ignore it.

### iRacing `.ibt` (`src/lib/iracingParser.ts`) — the sim's native export

iRacing's only on-disk telemetry export is the binary `.ibt` (iRacing Binary
Telemetry) the sim writes at the session tick rate (typically 60 Hz) once logging
is armed. There is no built-in CSV/MoTeC export; those are all third-party
conversions of this file, so the parser reads `.ibt` **directly** (synchronous,
pure JS `DataView`, fully offline — fits the normal contract, unlike XRK).

Layout (little-endian, per irsdk `irsdk_defines.h`): a 112-byte `irsdk_header` →
a 32-byte `irsdk_diskSubHeader` (only in `.ibt`; carries `sessionStartDate` +
`sessionRecordCount`) → the session-info **YAML** string → `varHeader[numVars]`
(144 bytes each: type, in-row byte offset, name/desc/unit) → fixed-stride data
rows (`sessionRecordCount` × `bufLen`, channel value at `rowBase +
varHeader.offset`, decoded by `irsdk_VarType`). It has no magic bytes, so it's
detected by validating the irsdk header's internal consistency plus a
`WeekendInfo` probe of the embedded session YAML (`isIracingFormat`).

GPS `Lat`/`Lon` (degrees) + `Speed` (m/s) + `Alt` make it a first-class GPS
source; `SessionTime` is the timebase. Driver inputs (throttle/brake/clutch → %,
gear, steering → °), engine (RPM, water/oil temp), and **native** lateral/
longitudinal g (`LatAccel`/`LongAccel` → `lat_g_native`/`lon_g_native`, coexisting
with the GPS-derived `lat_g`/`lon_g`) ride along in `extraFields` under human
names that `normalizeChannels` canonicalises.

---

## .dovex / .dovep formats (`src/lib/dovexParser.ts`)

Extended Dove format with an 8192-byte (8 KB) metadata header:
```
Line 1: datetime,driver,course,short_name,best_lap_ms,optimal_ms
Line 2: 2024-03-15 14:30:00,Mike,Full CW,OKC,62345,61200
Line 3: lap_times_ms
Line 4: 65432,64321,62345,63456   (lap times in ms, comma-separated)
\n padding to byte 8192
Byte 8192+: standard .dove CSV (timestamp,sats,hdop,lat,lng,...)
```

GPS data is always parseable even if metadata is corrupted. Metadata is attached
as `ParsedData.dovexMetadata`.

**`.dovep` ("Dove phone")** is the Phone Datalogger tool's output
(`lib/gps/dovepWriter.ts`). It is **byte-compatible `.dovex`** — same metadata
preamble + Dove CSV — so `isDovexFormat`/`parseDovexFile` read it with no new
parser (content-based routing in `datalogParser.ts` already matches it). The only
difference: it carries **only the channels a phone can measure**
(`timestamp,lat,lng,speed_mph,altitude_m,heading_deg,h_acc_m`) and omits the
device-only ones (`sats,hdop,rpm,accel_*`) rather than fabricating them. The
`.dovep` extension just drives the file-browser type bubble (`logFileType.ts`).

---

## Automatic Course Detection (`src/lib/courseDetection.ts`)

When a file is loaded and no track/course is saved in metadata, the system
auto-detects:

1. **Track discovery**: Find first valid GPS sample within **5 miles** (~8047m)
   of any known track.
2. **Course matching**: Try each course's S/F line → calculate laps → compare
   average lap distance (ft) to course `lengthFt` → pick closest match within 25%
   tolerance.
3. **Direction detection**: After S/F crossing, check which sector is crossed
   first — Sector 2 = forward, Sector 3 = reverse. Only works on courses with
   known sector lines.
4. **Waypoint mode fallback**: If no track matches or no course produces valid
   laps:
   - Drop a waypoint at the first sample where speed ≥ 30 MPH
   - Track returns to waypoint (within 30m after traveling 100m+) for rough lap
     timing
   - Divide lap distance by 3 for approximate sector boundaries
   - Show notice: "Waypoint timing — lower accuracy. Create a track for precise
     timing."

---

## Course Sectors ("Unlimited" sectors — `lib/courseSectors.ts`)

A course's timing lines are **start/finish (the implicit, always-major sector 1)
+ an ordered `Course.sectors` list** (`{line, major}[]`). Exactly three are
"major" (start/finish + two flagged). Hidden caps: **25 timing lines**, **3
majors** — both named constants (`MAX_SECTOR_LINES`, `MAX_MAJOR_SECTORS`), raise
later. `courseSectors.ts` is the single source of truth; the rest of the app
never reasons about sector geometry directly.

- **One list, two visual groups.** The editor (`SectorListEditor`, dnd-kit
  reorderable) shows the ordered list below the map; a per-row **Major** switch
  flags the majors, sub-sectors indent under their owning major, drag order drives
  numbering (`sectorLabels`: `1, 1.1, 2, 2.1, 3`). Save is blocked unless there
  are 0 sectors or exactly 3 majors (`validateCourseSectors`). Three line colors
  on every map: S/F green, major purple, sub sky-blue.
- **The logger only ever sees the 3 majors.** `majorSectorLines`/`legacyMirror`
  project the course down to start/finish + `sector2`/`sector3` —
  **byte-identical** to the pre-overhaul device JSON, submission payload, and
  content hash. `normalizeCourseSectors` migrates legacy `sector2/3` → the array
  (and keeps the mirror in sync) at **every load boundary** (track load, device
  download, admin read). Sub-sectors are app-only.
- **Lap timing.** `calculateLaps` detects a crossing for every line →
  `Lap.sectorTimes[]` (one per segment) + `Lap.sectorBoundaries[]` (sample index
  per line) + `Lap.sectors` (the S1/S2/S3 **major rollup** via `rollupMajorSectors`
  — so video overlays, snapshots, and the coach plugin keep working unchanged: the
  **coach receives the major rollup only, for now**). `calculateOptimalLap` sums
  the best time of **every** segment (the true ideal lap), excluded-segment →
  `null`.
- **Lap table** has a **Simple/Full** toggle (`LapTable.tsx`): Simple = S1/S2/S3,
  Full = one column per fine-grained sector, zebra-striped by major group,
  horizontally scrollable (shown only when sub-sectors exist). The per-lap "Map"
  overlay column was removed.
- **Crop-to-sector** (`SectorCropSelect`): the data-crop bar pairs the range
  slider (~80%) with a sector dropdown (~20%) that snaps `visibleRange` to a
  sector via `Lap.sectorBoundaries` (per-lap; disabled for all-laps view).
- **Persistence.** Track JSON + community submissions + the admin
  `courses`/`submissions` tables carry a canonical `sectors` / `sectors_data`
  array alongside the legacy mirror columns (migration
  `20260613000000_course_sectors_data.sql`; the generated Supabase types lag — the
  adapter builds the insert payload as a variable to dodge the excess-property
  check until regen). `submit-track` edge fn validates the optional `sectors`
  array (≤24, exactly-2-majors-or-none).

Full design history: [`plans/lap-sector-overhaul.md`](plans/lap-sector-overhaul.md).

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
  (`LapSnapshotPromptDialog`) when its best lap beats (or has no) stored snapshot;
  a manual "Save as snapshot" lives in `LapSnapshotControls` (the lap-list
  **Snapshots** picker, in the header so it serves simple + pro mode).
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

## Setup Revisions (`src/lib/setupRevision.ts` + `setupRevisionStorage.ts` + `setupHistory.ts`)

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
- **History panel.** Each **SetupsTab** row has a history (book) icon opening
  `drawer/SetupHistoryPanel.tsx` — a full-panel chronological timeline built by the
  pure `lib/setupHistory.ts` (`buildSetupHistory`). It joins this setup's revisions
  with the `FileMetadata` that reference them (`sessionSetupRev`) to show: the
  **original** revision in full, each later one as a **diff vs the previous** (only
  changed fields; numbers coloured green=up / red=down via `diffRevisionFields`,
  with a per-row full/diff toggle), each revision's **fastest lap** (the overall
  fastest highlighted), kart/course **bubbles** for the fastest usage, and a
  **kart + course filter** (drops non-matching revisions). Field flattening
  (`flattenRevisionFields`) reads each revision's *frozen* template so old history
  renders with the labels it had that day.
- **Orphan prune (GC).** A revision is an orphan once no
  `FileMetadata.sessionSetupRev` points at it. `pruneSetupRevisions()` deletes
  orphans (pure split: `findOrphanRevisionIds`); `maybePruneSetupRevisions()`
  throttles it to ~once every `PRUNE_INTERVAL_MS` (3 days) via a localStorage
  timestamp and is fired best-effort from `useSetupManager` on mount. Works fully
  offline.
- **Sync (cloud-sync plugin):** revisions ride the **generic garage-doc engine** —
  registered in `syncStores.ts` (`DOC_STORES` + `KEY_FIELD`, keyed by `id`), so
  they push/pull as ordinary `sync_records` rows counting toward the pooled
  documents budget. No dedicated table. Being immutable + content-addressed, the
  last-write-wins merge is a no-op on collision. **Prune is local-only:** a deleted
  orphan is **tombstoned** (`setupRevisionTombstones.ts`, per-user) rather than
  removed from the cloud. A fresh freeze of the same content clears the tombstone.
  **Cloud-side GC and later-editing are deliberate follow-ups.**

---

## Course Layouts (Drawing Feature)

The `course_layouts` table stores polyline drawings of track layouts (1:1 with
courses, unique on `course_id`, cascade delete).

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | Auto-generated |
| `course_id` | uuid FK → courses.id (unique) | One layout per course |
| `layout_data` | jsonb | Array of `{lat, lon}` coordinate points |
| `created_at` / `updated_at` | timestamptz | Timestamps |

**Access**: Admin-only RLS (same pattern as courses table). Layout lengths (in
feet) ARE exported to track JSON files as `lengthFt`.

**Draw tool**: In the VisualEditor, a "Draw" button allows clicking on the
satellite map to build a polyline outline. It is shown whenever `showDrawTool` is
set — **available to all users**, not just admin. User-drawn (or lap-generated)
outlines are persisted on `Course.layout` (a `{lat, lon}[]` polyline) through the
normal track-storage CRUD, so they ride cloud-sync and travel with a community
submission. Built-in courses still get their outline from `public/drawings.json`
(see `loadCourseDrawings`); when editing, the user's own `course.layout` takes
precedence over the built-in drawing.

**Manage Tracks (home screen)**: `LandingPage` renders a **Manage Tracks** action
tile that opens `TrackEditor` via its `triggerButton` + `startInManage` props — the
track manager is reachable with no datalog loaded. The create-flow dialogs
(`AddTrackDialog`/`AddCourseDialog`) pass `isNewTrack`/`showDrawTool` so location
search + manual drawing are available there.

**Generate Drawing**: A "Generate" button (visible when `showDrawTool` is true and
either laps *or* GPS samples are available) auto-populates the drawing from GPS
data. With detected laps it opens a picker — each lap **plus** a **Whole session**
option; with no laps it generates straight from the full session trace, so the
outline can be drawn before a course exists. The drawing state lives in
`useTrackEditorForm` (`formLayout`) and is written into the course via
`buildCourse()`. The editor's satellite basemap shares the race-line map's Esri
**Wayback** imagery-date picker (`useWaybackImagery`).

When a track/course is created or edited while a session is loaded, `TrackEditor`
immediately re-applies it via `onSelectionChange` (laps recompute, no file reload),
and every `TrackEditor` instance refreshes its list off a `garageEvents`
subscription on the `tracks` store so a new track appears in the selector without a
page refresh.

**Public drawings**: Admin exports drawings to `public/drawings.json` (keyed by
`shortName/courseName` → `[{lat, lon}, ...]`). Loaded by
`trackStorage.ts:loadCourseDrawings()` (cached). Rendered on the race line map as a
dashed polyline outline when a course is selected. Helper:
`getDrawingForCourse(shortName, courseName)`.

---

## Community Track Submission (`SubmitTrackDialog` + `lib/trackSubmission.ts`)

The "Submit to DB" flow (track editor) is a **bulk, form-free contribution**:
`buildSubmissionPlan(merged, defaults, submitted)` (pure, unit-tested) diffs the
user's local tracks against the built-in list (`loadDefaultTracks()`) and
classifies each user course as **new_track** (wholly new track —
`Track.isUserDefined`), **new_course** (a course added to a built-in track), or
**course_modification** (an edited built-in course). A user "edit" that is
byte-identical to the built-in course is skipped. The track-level rollup reads
**New** vs **Edited** (adding a course never overwrites the track). A geometry **+
drawing content hash** (`courseContentHash`, rounded to ~1cm — now also folds in
the course's `layout` polyline) drives both the identical-skip and dedupe:
`submittedTracksStorage.ts` (localStorage key `racing-datalog-submitted-v1`)
remembers each submitted course's hash, so unchanged courses aren't re-sent and a
later edit — geometry *or* drawing — re-flags the course. A course's `layout` rides
the plan as `SubmissionCourse.layout` → `layout_data` in the payload.

The **"Submit to DB" button is always rendered** (in `TrackEditor`'s manage view)
and **disabled when nothing is pending** — `TrackEditor` runs
`buildSubmissionPlan` itself to compute `pendingSubmissionCount`.

The review dialog sends all selected courses in **one** `submit-track` call
(`{ submissions: [...], turnstile_token }`); the edge function validates each, caps
batch size, rate-limits by rows/hour/IP, and inserts one `submissions` row per
course sharing a generated **`batch_id`** (migration
`20260603120000_submissions_batch_id.sql`). The admin **Submissions** tab groups a
batch together with **Approve all / Deny all**; each row is still reviewed/approved
individually (approval is still manual — it flips status; the admin then
builds/imports `tracks.json` as before). The single-submission body shape stays
supported for back-compat.

**Submissions table** has `has_layout` (bool) and `layout_data` (jsonb) columns to
carry drawing data through the workflow. The client sends a course's `layout` as
`layout_data` (validated + capped at 5000 points by the edge fn); the admin
**Submissions** tab previews the polyline (`DrawingPreview`) with an **Apply to
course layout** action that matches the DB course and calls `db.saveLayout`.

**Submitter attribution + the cloud-storage incentive.** Submitting works signed
out *and* signed in. When signed in, `submit-track` records
`submissions.submitted_by_user_id` (migration
`20260617000000_submissions_user_id_comp_tier.sql`) derived from the caller's
**verified JWT** (never a client-supplied id — anonymous stays `NULL`). The submit
dialog shows a "signed-in contributions earn free cloud storage" note (cloud
builds only — `VITE_ENABLE_CLOUD`; `useAuth()` picks the signed-in vs -out copy).
The admin **Submissions** tab resolves the id to a `profiles.display_name`
(`db.getProfiles`); the admin **Users** tab then comps contributors free premium
months. See `docs/backend.md` → *User management* (the `admin-users` edge fn + the
comp-aware `user_tier()`).

---

## File Browser (`FilesTab.tsx` + `lib/fileBrowserTree.ts` + `components/SessionBrowser.tsx`)

The Garage → **Files** tab is a folder hierarchy, not a flat list: **Track → Course
→ logs**, with an optional **Engine/Kart** grouping on the final list. All the tree
+ navigation math is pure in `fileBrowserTree.ts` (unit-tested); the reusable
presentational **`SessionBrowser`** renders the computed `BrowserView` (breadcrumb
+ folders + caller-rendered rows). `FilesTab` owns the local row chrome; the
Profile **Cloud logs** panel reuses `SessionBrowser` with its own rows.

- **Display name = the session's date/time**, derived from `sessionStartTime` (the
  first valid sample), e.g. "2/12/2026 11:15 AM" — *not* the upload time or raw
  filename (filename is the row's `title`/tooltip + the stable IndexedDB key).
- **Log type bubble:** each row shows a `FileTypeBadge` with the format derived
  from the file extension (`lib/logFileType.ts`, pure + unit-tested) — the format
  isn't persisted, so the extension is the source of truth.
- **Smart collapse:** a folder level is only rendered when there's more than one
  entry — a single track and/or single course auto-descends straight to the logs.
  The explicit Engine/Kart filter, by contrast, **always** shows its folder(s);
  logs with no engine/kart sit loose **below** the filter folders.
- **Untagged bucket:** logs missing a track/course land in an "Untagged" folder
  after the real tracks (collapsing to a flat list when it's the only group).
- **Opens at the current session.** `Index.tsx` passes the loaded session's
  `currentTrackName`/`currentCourseName`; `FilesTab` re-homes there (`defaultNav`)
  on every drawer open and whenever a different session loads.
- **Grouping data** rides `FileMetadata`: `sessionEngine` (snapshotted from the
  kart at assign time), `sessionKartId` (→ vehicle name), and `sessionStartTime`.
  Engine resolves to the snapshot first, then the live `Vehicle.engine`.
- **Cloud files appear inline.** Plugins contribute remote files via a `FileSource`
  (`FILE_SOURCES_POINT`); `buildBrowserSessions` merges them as `location: "cloud"`
  rows (deduped against local — local wins), and their metadata is read from the
  locally-synced `metadata` store. A cloud row is a one-tap **download → save →
  open**.

---

## Charts, Delta, Overlays & G-G diagram

Background for the analysis views; the user-facing settings list is in `CLAUDE.md`.

**Delta / pace.** `useReferenceLap.ts` routes pace through `computeLapPace`
(`lapDelta.ts`), which switches on `deltaMethod`: the **position** method (default,
the issue #29 port — arc-length resample + segment-projected gap) or the legacy
`distance` method (`calculatePace` in `referenceUtils.ts`). `deltaSampleMeters`
sets the resample spacing (default 2).

**Chart X-axis.** `chartXAxis` (`'distance'` default | `'time'`) is plumbed through
`SettingsContext` and consumed by both analysis charts (`TelemetryChart`,
`SingleSeriesChart`) via `lib/chartAxis.ts` (`buildChartAxis`): a pure,
unit-tested helper that maps each sample to an x-fraction (elapsed-time fraction,
or cumulative-distance fraction via `calculateDistanceArray`), supplies tick labels
(distance unit follows `useMetricDistance`), and an `indexAt` inverse for
scrubbing. Distance is the default so laps line up by track position.

The axis is **anchored at the start-finish line**: the charts draw the cropped
visible window stretched to fill the canvas (zoom preserved), but pass the full lap
(`allSamples`) + the window's `rangeStart` so `buildChartAxis` labels ticks in
*absolute* distance/time from the lap origin (`0` = start-finish). The range-slider
crop handles (`formatRangeLabel`, built in `Index.tsx`) follow the same scale.

**G-G diagram** (friction circle) is a pro-mode graph (`graphview/GGDiagram.tsx`)
added from the `GraphPanel` picker as the `__gg__` key. It scatters lateral vs
longitudinal G (lat on X, accel-positive lon on Y) for the visible window, overlays
the reference lap's cloud and the live scrub point, and draws concentric 0.5 g grip
rings. Data prep is pure + unit-tested in `lib/ggDiagram.ts` (`pickGForcePair`
honoring `gForceSource` → GPS `lat_g`/`lon_g` or native; `computeGGPoints` with
per-axis smoothing; `computeGGAxisMax`). Raw IMU `accel_*` is intentionally
excluded — it isn't guaranteed grip-frame-aligned.

**Multi-lap overlay** draws extra laps/snapshots across **all four data views at
once**: racing lines on both maps (`RaceLineView` + `MiniMap`) and distance-aligned
traces on both chart types, with per-lap values in the cursor tooltip.
Selection: per-lap (`LapTable` "Map" column), per-snapshot (`LapSnapshotControls`),
and laps from **other saved files** via the header **`OverlaysMenu`** (load+parse on
demand, cached in `useLapOverlays`). Held as stable ids (`lap:<n>` / `snap:<id>` /
`file:<lap>\x1f<name>`) and resolved by the pure, unit-tested `lib/lapOverlays.ts`
(`resolveOverlayLines` → `OverlayLine[]` with palette colors; `unionBounds` to fit
map overlays that run outside the active lap). `SessionContext` carries
`overlayLines` + `onToggleOverlay` + the external-file loader/adder + the align
toggle.

**Cross-session overlays (`snap:`/`file:`) can be drift-aligned** onto the current
lap via `lib/lapAlignment.ts` (2D Kabsch rigid registration, map-only — charts
compare by distance and are transform-invariant); same-session `lap:` overlays are
never transformed. The **Align lines** toggle lives on the map legend
(`useLapOverlays.alignOverlays`, default on); a sibling **collapse-legend** toggle
(`showOverlayLegend`) folds the per-lap list into a compact "N overlays" pill.
**The current lap always renders on top.** Chart overlays distance-align each lap
onto the current lap via `alignByDistance` (`referenceUtils.ts`); synthetic
`__pace__`/`__braking_g__` series don't overlay. Full design + deferred work:
[`plans/multi-lap-overlay.md`](plans/multi-lap-overlay.md).

**Channels** are normalized to canonical ids at parse time (`channels.ts` →
`normalizeChannels()`), so `extraFields` keys and `FieldMapping.name` are uniform
across formats (e.g. every parser's lateral-g lands on `lat_g`, label "Lat G").
G-force is modelled as distinct ids per source — `lat_g`/`lon_g` (primary/
GPS-derived), `lat_g_native`/`lon_g_native` (logger-native), `accel_x/y/z` (raw
IMU) — which coexist on a sample and must never collapse. `fieldResolver.ts` is the
settings-facing adapter. `toChannelKey()` is the idempotent shim that migrates
legacy display-name keys persisted in graph-prefs / saved overlay configs on load.
