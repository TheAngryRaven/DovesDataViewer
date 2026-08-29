# Drag Mode — standing-start runs at unknown venues

> Status: **IN PROGRESS** — detector landed first (logic-first, like plan 0015);
> orchestration and UI follow in separate commits on this plan.

## Why this exists

A GPS log from a drag strip matches no known track — and today that's *worse*
than untimed. The return road loops back within `WAYPOINT_RETURN_RADIUS_M = 30`
of the staging area, so `createWaypointResult` (`src/lib/courseDetection.ts`)
**falsely detects out-and-back passes as "laps"**; when it doesn't, detection
returns `null` and the user gets the dead-end "No track detected" dialog with
zero timing. Drag racers get either garbage laps or nothing.

Drag mode detects standing-start runs (stopped → launch → straight-line pull),
lets the user pick a scoring distance — **1/8 mi (660 ft), 1000 ft,
1/4 mi (1320 ft)** — and produces time-slip-style results: ET at the scoring
distance plus every intermediate split (60 / 330 / 660 / 1000 ft).

Product decisions (owner-approved):

1. **Detect + prompt** — the drag detector runs when no track matches; if runs
   are found, `TrackPromptDialog` shows a "Drag runs detected" branch with the
   distance picker, pre-selected from the actual run lengths. Waypoint mode and
   Create Track stay available as escapes.
2. **Full time slip** — splits ride in `Lap.sectorTimes`/`sectorBoundaries` so
   existing sector UI works.
3. **Short runs shown as incomplete** — a pass that lifted early stays listed
   with the splits it reached, no final ET, and is **never ranked fastest**
   (its window duration can beat a real ET), while its partial splits DO feed
   the optimal calc (best 60 ft of the day counts from any pass).
4. Distance choice persists per file (`FileMetadata.dragDistanceFt`) and is
   switchable mid-session from the header.

Modeled on sprint mode (plan 0015): runs are plain `Lap[]` so the map, charts,
playback and lap table work unchanged; only labels that would be untrue fork.
**No `'drag'` CourseType, no synthetic Track/Course** — drag timing is
distance-based, not line-based. `selection` stays `null`, so course-gated
features (snapshots, overlays, leaderboards) stay inert.

## Design

### Detector — `src/lib/dragRunDetection.ts` (pure, fully unit-tested)

Batch state machine over `GpsSample[]`: `idle → staged → launching → running`.

- **Staged**: speed ≤ `STAGE_SPEED_MPH` (2) continuously for `MIN_STAGED_MS`
  (3 s). Samples in (2, 3] mph are neutral — they pause the staged clock
  without disarming (deep-stage creep).
- **Launch / t0**: the first sample above `LAUNCH_MOTION_MPH` (3) after a valid
  stage. Its `t` is t0 and its position is **distance zero** — anchoring at the
  launch sample makes staged GPS wander structurally harmless (nothing
  accumulates before launch) and is deterministic where interpolating "speed
  crosses zero" is noise-dominated. It starts the clock a hair late, loosely
  mimicking real strip rollout. *Our ET approximates strip timing; it is not
  sanctioned.*
- **Confirm** (the burnout / re-stage rule): motion must reach
  `LAUNCH_CONFIRM_MPH` (15) within `LAUNCH_CONFIRM_MS` (3 s) or the candidate
  is discarded and a fresh stage is required — so the scored launch is always
  the *last* stage before a confirmed acceleration, the same rule
  `pairSprintRuns` uses for sprint re-launches.
- **Running**: `calculateDistanceArray` over the run slice
  (`src/lib/referenceUtils.ts`); marks at `DRAG_MARKS_FT = [60, 330, 660,
  1000, 1320]` scored via `interpolateSampleByDistance` (sub-sample-accurate
  `t` → split, interpolated speed → trap readout). Lift = max smoothed speed
  (3-sample window, detection only); a mark ≤ `MARK_GRACE_M` (10 m) past the
  lift still scores; marks rolled through while coasting do **not** score —
  that's what keeps "lifted at the 660, coasted through the 1320" an
  incomplete quarter. Run window ends below `RUN_END_SPEED_MPH` (5), capped
  `RUN_TAIL_MAX_MS` (10 s) past the lift.
- **Run filter**: must score 60 ft and peak ≥ `MIN_RUN_PEAK_MPH` (30).
- **"Is this drag data?" gate** (inside the detector): the result is `null`
  unless ≥ 1 run scores the 660 ft mark with straight-line ratio
  ≥ `STRAIGHTNESS_MIN` (0.95, net displacement ÷ path distance over
  launch→660) and speed there ≥ `MIN_EIGHTH_SPEED_MPH` (40). Curvy autocross
  and slow parades fall through to waypoint mode. Because the gate demands a
  660, `suggestedDistanceFt` (longest standard distance completed by ≥ 1 run)
  always exists.

### Run → Lap mapping (same module)

`dragRunsToLaps(samples, runs, distanceFt)`. Marks for a distance =
`DRAG_MARKS_FT` up to it; the last is the scoring line.

- **Complete run**: `lapTimeMs` = ET at the scoring mark, `endIndex` = the
  mark's sample; `sectorTimes` = per-segment deltas, `sectorBoundaries` =
  `[launchIndex, …mark indices…]` (circuit `buildLap` contract). Top speed over
  the window ≈ speed at the stripe, so the existing Top Speed column doubles
  as trap speed (no new column in v1).
- **Incomplete run**: `lapTimeMs` = detector window duration (NOT an ET),
  arrays same length with `undefined` past the last scored mark —
  `calculateOptimalLap` already skips `undefined` per segment, so partial
  splits feed optimal for free. Marked with the new **`Lap.incomplete`** flag;
  every fastest-picking site skips it (`fastestRankedLap` in
  `lapCalculation.ts` + guards in `LapTable`, `useReferenceLap`,
  `useDataLoader`, `calculateOptimalLap.deltaToFastest`,
  `Index.selectedLapTimeMs`).

### Orchestration — `src/hooks/useDataLoader.ts` only

Drag runs **before** a waypoint result is accepted (that ordering IS the
false-positive fix); `autoDetectCourse` and `CourseDetectionResult` are
untouched (Simulator + realtimeTimer callers must not grow drag behavior).
Restore: `FileMetadata.dragDistanceFt` (feet-as-number, matching `lengthFt`
convention) re-runs the detector and re-maps silently; a real track/course
restore shadows a stale drag field; assigning a course clears the field.
Distance switching is a pure re-map of the held `DragRun[]` — no re-detection.

### UI

`TrackPromptDialog` precedence: course-step > drag > waypoint > no-track (title
forks too). Header gets a distance `Select` next to the compact TrackEditor,
visible only in drag mode (the switcher lives in `Index.tsx`, which already
holds the `useDataLoader` handle — so `SessionContext` only carries the
read-only `dragDistanceFt`, leaner than the originally planned
`dragSession`/`onSetDragDistance` pair). `LapTable` renders cumulative
time-slip columns (via `dragTimeSlipTimes`), an Incomplete badge, Run labels
through the existing `lapLabels` plumbing, Min Speed hidden (always ~0 at
launch), footer Best ET. `SectorCropSelect` self-derives drag mode — a null
course with `sectorBoundaries` only ever comes from drag laps, and the
boundary count encodes the distance — so the crop dropdown needed no prop
threading through `GraphViewPanel`. Mark labels stay imperial in v1 — drag
increments are defined in feet; a metric follow-up can localize them.

## Follow-ups (out of scope for v1)

- Per-mark trap-speed row (the detector already records interpolated speed at
  every mark in `DragMarkCrossing.speedMph`).
- Metric display for mark labels.
- Live drag timing on the phone lap timer (`lib/gps/realtimeTimer.ts` is
  circuit-only today).
- 1/16 mi (330 ft) scoring distance for junior classes — `DRAG_DISTANCES_FT`
  and the `FileMetadata.dragDistanceFt` number field need no schema change.

## Commits on this plan

1. `plan 0022:` detector + drag-data gate (`dragRunDetection.ts` + tests)
2. `plan 0022:` run→lap mapping + ranking guards (`Lap.incomplete`,
   `dragRunsToLaps`, `fastestRankedLap`, optimal guard)
3. `plan 0022:` orchestration + persistence (useDataLoader, FileMetadata)
4. `plan 0022:` UI + i18n (prompt branch, header switcher, LapTable, locales)
