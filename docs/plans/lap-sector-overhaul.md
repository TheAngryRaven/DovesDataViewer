# Lap Sector Overhaul — "Unlimited" Sectors

Goal: replace the fixed Start/Finish + Sector 2 + Sector 3 model with **one ordered
list of sector lines** (hidden cap: 25 total), where exactly 3 are flagged **major**
(start/finish always is), while the **BLE logger export stays byte-identical**
(it only ever receives the 3 major lines). Caps live in named constants so "3 majors"
and "25 lines" can be raised later without an archaeology dig.

## 1. Data model (`src/types/racing.ts` + new `src/lib/courseSectors.ts`)

- New canonical field on `Course`:
  ```ts
  export interface CourseSector {
    line: SectorLine;      // existing { a: {lat,lon}, b: {lat,lon} }
    major: boolean;        // true = one of the "traditional" sectors
  }
  // Course.sectors?: CourseSector[]  — ordered lines AFTER start/finish.
  ```
  Start/finish stays `startFinishA/B` and is implicitly **sector 1, always major**
  (never stored in the array — matches the UI where it can't be unmarked/deleted).
- Legacy `sector2`/`sector3` stay on the type as `@deprecated` read-compat fields.
- New pure module **`lib/courseSectors.ts`** (unit-tested), the single home for:
  - `MAX_SECTOR_LINES = 25` (total incl. S/F, hidden cap) and `MAX_MAJOR_SECTORS = 3`.
  - `normalizeCourseSectors(course)` — migrates legacy `sector2`/`sector3` →
    `sectors: [{line: s2, major: true}, {line: s3, major: true}]`. Applied at every
    boundary where a `Course` enters memory (trackStorage load, device download,
    lap-snapshot load, admin read) so the rest of the app only ever sees `sectors`.
  - `majorLines(course)` — `[startFinish, ...majors]` in order (the logger projection).
  - `legacyMirror(course)` — derives `sector2`/`sector3` from majors[1]/majors[2]
    for serializers (rollback / old-PWA safety).
  - `sectorLabels(course)` — auto numbering: S/F = "1", subs under it = "1.1, 1.2",
    next major = "2", its subs "2.1"… (drag order ⇒ numbering, per the spec).
  - `validateCourseSectors(course)` — save rule: **either zero additional sectors,
    or exactly 3 majors total** (S/F + 2 flagged); plus the 25-line cap.
  - `rollupMajorSectors(course, sectorTimes)` — sums fine-grained segment times into
    the classic S1/S2/S3 (sum of each major group's sub-segments).
  - `courseHasSectors()` (racing.ts) → true when the course has 3 majors.

## 2. Lap calculation (`src/lib/lapCalculation.ts`)

- Generalize crossing detection: `LineCrossing.lineType: 'sf' | 's2' | 's3'` →
  `'sf' | number` (sector index). Detect crossings for **every** line in
  `course.sectors`; same 1s sector debounce.
- Per lap, walk crossings in course order between the two S/F crossings:
  - `Lap.sectorTimes?: (number | undefined)[]` — N lines ⇒ N segments
    (segment k = line k → line k+1, last wraps to S/F). A skipped/out-of-order
    crossing leaves that segment (and its neighbor) `undefined` — same spirit as
    today's partial-sector handling.
  - `Lap.sectorBoundaries?: number[]` — absolute sample index of each line crossing
    (powers crop-to-sector and the full lap-table view).
  - `Lap.sectors` (s1/s2/s3) **kept**, now populated via `rollupMajorSectors` —
    so the video-overlay sector widgets, `LapSummaryWidget`, snapshots, and the
    coach plugin keep working untouched (this *is* "send the major sectors to the
    coach for now").
- **Optimal lap = sum of best time per fine-grained segment across laps**
  (`calculateOptimalLap` reworked; laps missing any segment are excluded from that
  segment's best, lap excluded from "complete" check as today).
- Direction detection (`detectSectorOrder` + courseDetection): generalize "S2 before
  S3" → "2nd major before 3rd major". Waypoint mode unchanged (thirds → s1/s2/s3
  rollup only; no fine-grained list).
- Tests: N-sector segment times, partial crossings, rollup, all-sector optimal,
  boundaries, direction.

## 3. Storage & I/O — same wire data for the logger

- **`trackStorage.ts`** — built-in `tracks.json` + localStorage v2:
  - Load: prefer a new per-course `sectors: [{a_lat,a_lng,b_lat,b_lng,major}]`
    array; fall back to legacy `sector_2_*`/`sector_3_*` via normalization.
  - Save (user tracks): write `sectors` **and** the legacy mirror fields.
- **`deviceTrackSync.ts`** — *unchanged on the wire*: `appCourseToDeviceJson`
  projects `majorLines()` → `sector_2_*`/`sector_3_*` (byte-identical to today for
  migrated courses). `coursesMatch` compares only the device-visible projection, so
  sub-sectors never flag a mismatch. `deviceCourseToAppCourse` → two major entries.
  Known edge (documented, accepted): overwriting an app course *from* the device
  drops local sub-sectors — mismatch download already means "replace".
- **`trackSubmission.ts`** — payload gains the `sectors` array alongside the legacy
  flat fields. `courseContentHash`: keep the existing 12-coordinate part computed
  from the **majors** exactly as today and only append sub-sector data when present
  — already-submitted unchanged courses keep their hash (no mass re-flag); adding or
  editing a sub-sector re-flags, as it should.

## 4. Course editor UI

- New **`track-editor/SectorListEditor.tsx`** — the ordered list below the map:
  - Row 0: "Start/finish (Sector 1)" — no switch, no delete, not draggable.
  - Each sector row: drag handle, auto label (from `sectorLabels`), **Major** switch,
    delete, and tap-to-select (selects that line on the map for drag-placement).
  - Rows visually grouped/indented under their owning major; a **+** button at the
    end of each group inserts a new sub-sector there (placed at map center, like
    today's `createLineAtMapCenter`).
  - Helper note under the list: *"Mark the three traditional sectors of the course
    as a Major sector."* Save is blocked (with that reason) unless majors = 3 or the
    list is empty. No cap messaging until 25 is hit — then the + buttons disable
    with a "sector limit reached" hint.
  - Reorder: **`@dnd-kit/core` + `@dnd-kit/sortable`** (new dep — touch-friendly,
    actively maintained, tree-shakeable; README credits + `CreditsDialog` updated).
- **`useTrackEditorForm.ts`**: `formSector2`/`formSector3` → `formSectors:
  CourseSector[]` (+ selected-sector index); `buildCourse()` writes the array and
  enforces validation.
- **`VisualEditor.tsx`**: replace the three fixed buttons with line layers driven by
  `formSectors` — the list is the control surface; the map keeps per-line draggable
  endpoint markers for the *selected* line. Colors: S/F green `#22c55e` (as today),
  majors purple `#a855f7` (as today), **sub-sectors sky-blue `#38bdf8`** (new third
  color, editor + analysis maps).
- **Scrolling fix** (confirmed broken): `AddCourseDialog`'s `DialogContent` gets
  `max-h-[90vh] overflow-y-auto` (+ wider `max-w`) like the manage dialog already
  has; verify the in-manage edit view scrolls with the list present.
- Admin `CoursesTab` reuses `SectorListEditor` (replaces its 8 fixed coordinate
  fields) — see §7.

## 5. Analysis views

- **`RaceLineView.tsx`**: draw *all* sector lines — S/F red (unchanged), majors
  purple (unchanged), sub-sectors sky-blue, weight 3 / lower opacity so they read as
  secondary.
- **`LapTable.tsx`**:
  1. **Remove the per-lap "Map" overlay column** (overlays remain reachable via the
     header `OverlaysMenu` and snapshot controls).
  2. **Simple/Full toggle** (small segmented control in the table header area):
     - *Simple* (default): today's layout — S1/S2/S3 major rollups + the new
       all-sector optimal in the summary bar.
     - *Full*: one column per fine-grained sector labeled `1, 1.1, 1.2, 2, …`,
       **zebra-striped by major group** (alternating subtle bg per group), wrapped
       in `overflow-x-auto` for horizontal scrolling; fastest-per-column highlight
       kept. Toggle hidden when the course has no sub-sectors.

## 6. Crop bar redesign (simple + pro)

- The bottom bar in `RaceLineTab` and `GraphViewPanel` becomes a flex row:
  **`RangeSlider` at ~80%**, new **`SectorCropSelect` at ~20%** (stacks on small
  screens).
- The select lists `Full lap, 1, 1.1, 2, 2.1, …` for the **selected lap**; choosing
  one sets `visibleRange` from `Lap.sectorBoundaries` (lap-relative indices).
  Disabled with a placeholder when viewing all laps (sector spans are per-lap).
  Manually dragging the slider resets the select to "Custom". Selection state lives
  in `useLapManagement` so simple + pro stay in sync.

## 7. Admin + backend (last phase; gated, online-only)

- Migration: `ALTER TABLE courses ADD COLUMN sectors_data jsonb` (array of
  `{a_lat,a_lng,b_lat,b_lng,major}`); legacy 8 columns stay populated with the
  majors mirror on every write.
- `supabaseAdapter` / `ITrackDatabase` / `DbCourse`: map `sectors_data` ⇄
  `Course.sectors` (generated Supabase types untouched — cast, as with `batch_id`).
- `submit-track` edge fn: accept + validate optional `sectors` array (shape, lat/lon
  ranges, ≤24 entries, exactly-2-majors-or-none); rides `course_data` jsonb.
  Admin Submissions preview/apply carries it through to `sectors_data`.
- Admin tracks.json **export** writes `sectors` + legacy mirror; **import** prefers
  `sectors` (round-trip safe). `CoursesTab` editor reuses `SectorListEditor`.

## 8. Tests, docs, hygiene

- Vitest: `courseSectors.test.ts` (numbering, validation, normalization, rollup,
  projection, caps), expanded `lapCalculation`, `trackStorage` dual-format,
  `deviceTrackSync` byte-identical export + subsector-tolerant match,
  `trackSubmission` hash stability + re-flag on sub edit.
- `CHANGELOG.md` under `[Unreleased]`; `README.md` (track JSON format, dnd-kit
  credit), `CreditsDialog.tsx`, `CLAUDE.md` architecture/notes.
- Green: `npm run lint`, `typecheck`, `test:run`, `build` before push.

## Implementation order

1. `courseSectors.ts` + types + normalization (tests)
2. `lapCalculation.ts` generalization + optimal (tests)
3. trackStorage / deviceTrackSync / trackSubmission I/O (tests)
4. Editor UI: SectorListEditor + dnd-kit + VisualEditor + form hook + scroll fix
5. RaceLineView lines + LapTable (Map-column removal, Simple/Full toggle)
6. Crop bar 80/20 + SectorCropSelect
7. Admin/backend (migration, adapter, CoursesTab, edge fn, submissions, export/import)
8. Docs/changelog/credits, full CI pass

## Decisions made (flag for review)

- **Cap semantics**: 25 = total timing lines incl. start/finish; majors hard-capped
  at 3. Both single constants.
- **`Lap.sectors` (s1/s2/s3) is kept as the major rollup** — keeps coach plugin,
  video overlays, and snapshots working with zero changes, and *is* the "majors only
  to the coach" requirement.
- **dnd-kit** added as the drag-reorder dependency (none exists in the repo; the
  spec explicitly wants tap-and-drag, not up/down arrows).
- **Hash stability**: legacy hash input preserved for majors-only courses so
  existing submission dedupe records stay valid.
- Sub-sector line color: sky-blue (`#38bdf8`) — distinct from green S/F (editor) /
  red S/F (analysis) and purple majors.
