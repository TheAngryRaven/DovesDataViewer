# Sprint Mode (Autocross / Point-to-Point) — DataViewer Side

> Status: **DONE** — including the end-of-project Android IPC follow-up, now
> that LapWing implements the `TS*` verbs. The logger and the timing library
> already shipped sprint support; this plan was the app catching up. Phase 3 of
> the cross-repo effort recorded in
> `DovesDataLogger/docs/plans/0002-sprint-mode.md`.

## Why this exists

A prospective buyer runs **autocross**, which the whole system was not designed
for. Autocross is **point-to-point**: a start line and a *separate* finish line,
one car at a time, several short runs per session with the engine idling in
between. Nothing laps anything.

The other two repos are done:

| Repo | State |
|---|---|
| `DovesLapTimer` (`BETA`) | `SprintTimer` + the extracted `CrossingEngine`, shipped |
| `DovesDataLogger` (`BETA`) | `/TRACKS/SPRINT/`, `SprintTimer` backend, `TS*` BLE opcodes, `race_mode` DOVEX column — shipped |
| **DovesDataViewer** | **nothing — this plan** |

### The gap that makes this urgent

**No tool can author a sprint track.** The logger reads `/TRACKS/SPRINT/*.json`,
picks the newest course by `date_created`, stands up `SprintTimer`, and will
sync the folder over `TSLIST`/`TSGET:`/`TSPUT:`/`TSDEL:`. All of it works and
none of it is reachable, because the only thing that writes those files would be
this app — and this app has no concept of a course type. Sprint mode is
currently testable only by hand-writing JSON onto an SD card, which means the
firmware work has never been exercised on a real course.

Closing that loop is the whole point of this plan: **author a sprint course
here → push it over `TSPUT:` → drive it → read the runs back.**

## What the firmware already expects

Contract, from `DovesDataLogger/CLAUDE.md` and `BirdsEye/sd_functions.ino`:

- Sprint tracks live in **`/TRACKS/SPRINT/`**. The folder is authoritative for
  kind — it is chosen by BLE *opcode*, never parsed from a filename, so a
  client cannot path between the two folders.
- Same object JSON as circuit tracks, plus:
  - `"type": "sprint"` at track level (redundant with the folder, but lets the
    app validate)
  - per-course **`finish_a_lat` / `finish_a_lng` / `finish_b_lat` /
    `finish_b_lng`** — required; a course with no finish line cannot be timed
  - per-course **`date_created`**, a sortable ISO-8601 stamp `YYYY-MM-DDTHH:MM`
- Sector lines stay optional: **zero, one, or two** (not the circuit model's
  all-or-nothing three majors).
- The device loads **the newest course by `date_created`** and only that one.
  Ordering is a plain string compare in the firmware's `sprint_select` unit —
  which is exactly why the stamp must be zero-padded ISO. A non-sortable format
  silently loads the wrong course.
- Logs carry a trailing **`race_mode`** header column, `CIRCUIT` / `SPRINT`,
  compared case-insensitively, empty ⇒ circuit.

## Design decisions

### 1. `Course.type`, optional, absent ⇒ circuit

```ts
export type CourseType = 'circuit' | 'sprint';
```

Added as `Course.type?: CourseType`. **Optional on purpose** — every existing
course, every bundled `public/tracks.json` entry, every Supabase row and every
cloud-synced blob predates the field, and all of them are circuits. A required
field would need a migration of data we already know the answer for. `isSprint()`
is the single reader; nothing else compares the literal.

This mirrors how the firmware treats the DOVEX `race_mode` column (empty ⇒
circuit) and how `Course.sectors` was introduced in plan 0003 — additive,
normalized at load boundaries, legacy shape still readable.

### 2. The finish line is a `SectorLine`, not four flat fields

`Course.finish?: SectorLine` reuses the existing `{a: {lat, lon}, b: {lat, lon}}`
shape, so the editor's drag handlers, the `sectorLinesEqual` comparator and the
device (de)serializers all work on it without new geometry code. The wire format
still flattens to `finish_a_lat` etc. because that is what the firmware parses.

**Invariant: a sprint course without a finish line is invalid.** The firmware
cannot time it. Validation enforces this rather than silently shipping a course
the device will ignore.

### 3. Validation branches on type; it does not get a new function

`validateCourseSectors` already owns "can this course be saved". Sprint gets a
branch inside it rather than a parallel validator, so the three call sites
(`SectorListEditor`, `TrackEditor`, `TrackPromptDialog`) keep working unchanged
and cannot drift apart.

| | circuit (unchanged) | sprint |
|---|---|---|
| sector lines | 0, or exactly 3 majors total | **0–2**, `major` ignored |
| finish line | n/a (start == finish) | **required** |

The `major` flag is meaningless in sprint: the runs are short and the segments
are just splits. Sprint courses are stored with `major: false` throughout so
that if a course is ever retyped to circuit, it fails validation loudly instead
of silently claiming a sector layout it never had.

### 4. `date_created` is stamped on save, in the firmware's collation order

`Course.dateCreated?: string`, format `YYYY-MM-DDTHH:MM` (minute precision,
local time — it identifies which cone layout was walked, not an instant). It is
set when a sprint course is first saved and **preserved** thereafter, so editing
a course does not make it jump the queue on the device.

Minute precision is what the firmware's filename stamps use, and it is enough to
disambiguate two layouts walked on the same day. It is deliberately *not* an ISO
instant with seconds/zone — the string is compared byte-wise against stamps the
device itself writes.

### 5. `coursesMatch` must see the sprint fields

Today it compares 4 start/finish coordinates and the two legacy sector pairs.
Left alone, it would report a sprint course as "synced" while ignoring a moved
finish line — the single most likely edit. It gains a type-aware branch. This is
a correctness fix, not a feature: the current function is *wrong* for any course
carrying data it does not know about.

## Phasing

Deliberately split — the survey found ~20 call sites for the editor's finish
handle alone, spread across four duplicated prop bags, and the repo's coverage
config excludes `src/components/**/*.tsx`. Logic-first keeps the testable part
testable (Golden Rule 3).

- ~~**PR 1 — model + validation + wire format.**~~ **Done** (#375). All in `src/lib` and
  `src/types`, all unit-tested, no UI. Nothing user-visible yet; it is the
  foundation the other three stand on.
- ~~**PR 2 — editor.**~~ **Done.** `LineId` gained a `'finish'` variant, the
  red finish handle (rendered last — driving order), the `CourseTypeToggle`,
  the Finish row in `SectorListEditor`, and sprint state in
  `useTrackEditorForm`. Two notes on what landed:
  - The type picker is **create-only**. Retyping a course that already has
    geometry would silently invalidate it, so editing keeps the saved type.
  - `TrackPromptDialog` and the admin `CoursesTab` were left circuit-only.
    Both keep their own copy of the editor state, and `courseType` defaults to
    `'circuit'`, so they compile and behave exactly as before. Community
    submission of sprint courses is already out of scope (see below), and the
    log-import prompt can follow once the runs view exists.
  - The save-time fork moved out of the hook into
    `sprintCourse.finalizeCourseForSave` so it is unit-testable — this repo's
    coverage config excludes `src/components/**/*.tsx` by design, so logic in
    a `.tsx` is logic that cannot be tested.
- ~~**PR 3 — protocol + merge.**~~ **Done.** `trackOpcodes.ts` owns the verb
  table (verified against `bluetooth.ino`, not just the protocol doc); every
  `trackSync.ts` function takes an optional `kind` defaulting to `'circuit'`;
  `buildMergedTrackList` keys on **(kind, shortName)**; `trackKind` /
  `isMixedKindTrack` decide which folder a track belongs in.
- ~~**PR 4 — device seam + Device tab (Web Bluetooth only).**~~ **Done.** `DeviceTracksTab`
  goes through the transport-neutral `DeviceDetails` seam
  (`lib/loggers/types.ts`), which has **two** implementations: Web Bluetooth
  (`bleDetails.ts`) and the native Android IPC bridge
  (`dovesloggerConnection.ts`). The seam gains `kind`; BLE implements it; the
  tab gains a kind indicator, since a circuit and a sprint track can now share
  a short name.

  **Decided: the native side is deferred to the end of the project.** The
  native app is not live yet and its release slipped, so there is nothing to
  regress — the BLE path is the only one users have today. The native
  implementation reports no sprint tracks until it is updated, which is honest
  (it genuinely cannot fetch them) rather than a silent failure.

### ~~Android IPC — end-of-project follow-up~~ — **Done.**

LapWing now implements the `TS*` verbs behind its `logger_*_track` commands
(`TrackKind` + a single opcode table in `loggers/doveslogger/tracks.rs`,
mirroring `trackOpcodes.ts`), so the seam reaches parity with Web Bluetooth:

- `listTracks(kind)` / `getTrack(name, kind)` / `putTrack(name, data, kind)` /
  `deleteTrack(name, kind)` now forward `kind` straight through to the bridge,
  which routes to `TSLIST` / `TSGET:` / `TSPUT:` / `TSDEL:` for `'sprint'`.
  `supportsSprintTracks` is `true`.
- Fixed **in the seam**, as this section required — not patched at a call site.
  `dovesloggerConnection.ts` is still the single place the two transports agree.
- The `kind` argument is optional on LapWing's side of the IPC (it defaults to
  circuit), but this repo always sends it explicitly.
- Sequenced at the END of this plan on purpose: it was gated on another
  product's release, not on anything in this repo, and blocking sprint mode on
  it would have stalled work that is otherwise finished.
- ~~**PR 5 — reading runs back.**~~ **Done.** (Was PR 4; renumbered when the
  seam split out.) `race_mode` in `dovexParser`, run derivation in
  `calculateLaps`, and sprint-aware sector/label handling. Four things landed,
  each with a decision worth keeping:

  - **`race_mode` and `device_name` are parsed.** The firmware emits eight
    metadata columns; the parser read six, so `race_mode` was on the wire and
    silently dropped. Column names come from `BirdsEye/dovex_header.cpp`, not
    the firmware's own docs (see the cross-repo note below). `parseRaceMode`
    returns `undefined` — not `'circuit'` — for an absent, empty *or
    unrecognized* value: an unknown mode should leave behaviour untouched
    rather than assert a timing model the log never claimed.
    `lib/gps/dovepWriter.ts` was deliberately **not** widened to emit the two
    columns; the phone laptimer records circuit sessions only, and an absent
    `race_mode` already means circuit.

  - **Run derivation follows the device exactly.** `pairSprintRuns` implements
    `DovesDataLogger` plan 0002 §7 Q4: a start crossing opens a run *and
    cancels any run in progress* (the botched-course re-launch rule), a finish
    crossing completes it, and a finish with no armed run is ignored —
    i.e. each run opens at the **last** start crossing before its finish.
    That rule is also what makes the derivation robust to a driver crossing the
    start line on the way back to grid: the launch is always the last start-line
    crossing before a finish.
    The per-lap body (speed stats + the sector-boundary walk) was extracted into
    a shared `buildLap`, since circuit and sprint differ only in *which*
    crossings get paired. `calculateLaps` keeps its signature, so all six call
    sites gained sprint for free. A sprint course with no finish line returns
    `[]` rather than pairing runs off the start line alone.

  - **Splits are the displayed sectors.** `rollupMajorSectors` returned
    `undefined` for every sprint course (it required three flagged majors, and
    sprint splits are stored `major: false` on purpose) — so splits the driver
    placed in the editor rendered as em-dashes. A new
    `displayedSectorIndices` makes the *reader* type-aware while the stored
    flags stay untouched: circuit uses the flagged majors, sprint uses every
    split. With `MAX_SPRINT_SPLITS = 2` a run has at most three segments, which
    is exactly the S1/S2/S3 the lap table, video overlays and snapshots already
    render. `courseHasSectors` gained the matching branch, and the lap table's
    Simple/Full toggle is suppressed for sprint (all splits being unflagged, its
    "has sub-sectors" test would otherwise say yes and label them "1 / 1.1 /
    1.2").
    **Left alone on purpose:** `sectorLabels` still numbers sprint splits
    `1.1` / `1.2`. It also drives the track editor and `SectorCropSelect`, so
    retyping it would touch PR 2's landed UI for a cosmetic gain — a follow-up,
    not part of reading runs back.

  - **`race_mode` narrows detection.** Parsing it was not enough: nothing in the
    app read `dovexMetadata` at all. A venue can carry both a circuit and a
    sprint track, so `findNearestTrack` could pick the wrong one outright and
    the session would show zero runs. `tracksForRaceMode` drops the
    non-matching courses (then the emptied tracks) before `autoDetectCourse`
    runs, wired in `useDataLoader` only. It is conservative in both directions —
    an unknown mode, or a filter that would leave nothing, returns the input
    unchanged, so no log detects worse than it did before.

  **Wording:** "lap" stays, per the section below. Only the two labels that are
  factually untrue point-to-point fork on course type: the empty-state hint
  (which told the user to pick a track with a start/finish line) and "Avg Lap
  Length" → "Avg Run Length". The column header stays "Lap".

## Deliberately kept: "lap" wording

The AX drivers call them laps. The firmware kept the wording on-device for the
same reason. Runs are modelled as `Lap[]` so every existing consumer — the lap
table, the overlay renderer, leaderboards, the video sync — keeps working.

What landed in PR 5: the noun "Lap" is kept everywhere, in the code *and* on
screen. Only strings that would be **factually untrue** for a point-to-point run
fork on course type — the empty-state hint and "Avg Lap Length". The lap-number
column header is still "Lap".

## Not in scope

- **On-device course creator** (`DovesDataLogger` plan 0002 §5). It emits
  `NEWTRACK_`/`NEWCOURSE_` files explicitly designed to be renamed in this app
  afterwards, so it wants this plan finished first.
- **Supabase `courses` columns** for the sprint fields. Community submission of
  sprint courses is a later step; local + device sync comes first, and the
  offline-first rule (Golden Rule 1) means nothing here depends on the cloud.
- **Firmware upgrade-path mapping** (`DovesDataLogger` plan 0004) — unrelated,
  parked to the end of the cross-repo effort.

## Cross-repo note found while surveying

`DovesDataLogger/CLAUDE.md` documents the DOVEX metadata columns as
`driver_name` / `course_name` / `optimal_lap_ms`, but `BirdsEye/dovex_header.cpp`
actually emits `driver` / `course` / `optimal_ms`. This app matches the `.cpp`
(`dovexParser.ts` keys off the emitted names), so the **code is right and the
firmware's doc is wrong**. Worth a one-line fix over there; noted here so the
next person to read that table does not "correct" the parser to match it.
