# Sprint Mode (Autocross / Point-to-Point) — DataViewer Side

> Status: **IN PROGRESS** — the logger and the timing library already ship
> sprint support; this plan is the app catching up. Phase 3 of the cross-repo
> effort recorded in `DovesDataLogger/docs/plans/0002-sprint-mode.md`.

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

- **PR 1 — model + validation + wire format (this PR).** All in `src/lib` and
  `src/types`, all unit-tested, no UI. Nothing user-visible yet; it is the
  foundation the other three stand on.
- **PR 2 — editor.** `LineId` gains a `'finish'` variant, the finish handle,
  the sprint/circuit toggle, and the four prop bags.
- **PR 3 — device sync.** `TS*` opcodes in `trackSync.ts`, sprint awareness in
  `deviceTrackSync.ts`'s merge, `DeviceTracksTab` UI. Note `MergedTrackEntry`
  keys on `shortName` alone today, so a sprint and a circuit track sharing a
  short name currently collide — that needs a kind in the key.
- **PR 4 — reading runs back.** `race_mode` in `dovexParser`, run derivation
  (`calculateLaps` pairs *consecutive* start/finish crossings and wraps the last
  segment back to start/finish — both assumptions are false for sprint), and a
  run-oriented `LapTable`.

## Deliberately kept: "lap" wording

The AX drivers call them laps. The firmware kept the wording on-device for the
same reason. Runs are modelled as `Lap[]` so every existing consumer — the lap
table, the overlay renderer, leaderboards, the video sync — keeps working. Only
labels change, and only in PR 4.

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
