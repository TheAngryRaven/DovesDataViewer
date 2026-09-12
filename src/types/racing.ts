// Core racing data types

export interface GpsSample {
  t: number; // milliseconds since start
  lat: number;
  lon: number;
  speedMps: number; // meters per second
  speedMph: number;
  speedKph: number;
  heading?: number; // degrees (0-360, from RMC course field)
  rawNmea?: string;
  extraFields: Record<string, number>;
}

export interface SectorLine {
  a: { lat: number; lon: number };
  b: { lat: number; lon: number };
}

/**
 * One timing line in a course's ordered sector list. The start/finish line is
 * always the implicit first sector (always "major") and is NOT stored here —
 * `Course.sectors` holds only the lines AFTER start/finish, in driving order.
 *
 * `major` flags one of the "traditional" sectors familiar to most drivers. A
 * course either has zero additional sectors, or exactly three majors total
 * (start/finish + two flagged here). Only the three major lines are exported to
 * the BLE logger — sub-sectors are app-only. See `lib/courseSectors.ts`.
 */
export interface CourseSector {
  line: SectorLine;
  major: boolean;
}

/**
 * How a course is timed.
 *
 * - `circuit` — the classic model: one line that is both start and finish, laps
 *   formed from consecutive crossings of it.
 * - `sprint` — point-to-point (autocross, hillclimb, rally stage): a start line
 *   and a SEPARATE finish line, timed as runs rather than laps.
 *
 * Absent means `circuit`. The field is optional because every course that
 * existed before sprint mode is a circuit — requiring it would mean migrating
 * data whose answer we already know. Read it through `isSprintCourse()` rather
 * than comparing the literal. See `docs/plans/0015-sprint-mode.md`.
 */
export type CourseType = 'circuit' | 'sprint';

export interface Course {
  name: string;
  /** Timing model; absent means `circuit`. See {@link CourseType}. */
  type?: CourseType;
  lengthFt?: number; // known course length in feet (from track database)
  startFinishA: { lat: number; lon: number };
  startFinishB: { lat: number; lon: number };
  /**
   * Sprint only, and REQUIRED there: the separate finish line. A sprint course
   * without one cannot be timed by the logger, so validation rejects it rather
   * than shipping a course the device will silently ignore. Unset on circuit
   * courses, where start and finish are the same line.
   */
  finish?: SectorLine;
  /**
   * Sprint only: when this course's cone layout was walked, as a sortable
   * `YYYY-MM-DDTHH:MM` local stamp. The logger loads the NEWEST course by this
   * field and compares the stamps as plain strings, so the zero-padded ISO
   * shape is load-bearing — a non-sortable format silently loads the wrong
   * course. Stamped on first save and preserved across edits, so revising a
   * course doesn't make it jump the queue on the device.
   */
  dateCreated?: string;
  /**
   * Ordered sector lines after start/finish (canonical model). Normalized in
   * from the legacy `sector2`/`sector3` fields at every load boundary via
   * `normalizeCourseSectors` — the rest of the app reads only this.
   */
  sectors?: CourseSector[];
  /** @deprecated read-compat mirror of the 2nd major line — derived on save. */
  sector2?: SectorLine;
  /** @deprecated read-compat mirror of the 3rd major line — derived on save. */
  sector3?: SectorLine;
  isUserDefined?: boolean; // true if user added/modified this course
  /**
   * User-drawn (or lap-generated) track outline — an ordered polyline of
   * {lat, lon} points. Persisted alongside the course so it rides cloud-sync
   * and travels with a community submission. Built-in courses get their outline
   * from public/drawings.json instead (see loadCourseDrawings).
   */
  layout?: Array<{ lat: number; lon: number }>;
}

/**
 * True when a course is timed point-to-point (start line ≠ finish line).
 *
 * The single reader of `Course.type` — everything else asks this, so the
 * "absent means circuit" default lives in exactly one place.
 */
export function isSprintCourse(course: Pick<Course, 'type'> | null | undefined): boolean {
  return course?.type === 'sprint';
}

/**
 * True when a course produces sector times worth displaying.
 *
 * **Circuit** — the classic three majors (start/finish + two flagged). Reads
 * the canonical `sectors` array, falling back to the legacy `sector2`/`sector3`
 * pair for un-normalized courses.
 *
 * **Sprint** — any split at all. Splits are stored `major: false` (the flag is
 * meaningless point-to-point), so the circuit rule would report every sprint
 * course as sector-less and hide splits the driver deliberately placed. One
 * split already divides the run into two timed segments.
 */
export function courseHasSectors(course: Course | null): boolean {
  if (!course) return false;
  if (isSprintCourse(course)) return (course.sectors?.length ?? 0) > 0;
  if (course.sectors && course.sectors.length > 0) {
    const majors = course.sectors.filter((s) => s.major).length;
    return majors >= 2; // + the implicit start/finish major = 3 total
  }
  return Boolean(course.sector2 && course.sector3);
}

export interface Track {
  name: string;
  shortName?: string; // max 8 chars, used for zip filenames and compact display
  courses: Course[];
  isUserDefined?: boolean; // true if entire track is user-added
  updatedAt?: number; // last local edit time (ms) — set on save; used for cloud-sync merge
}

// Legacy interface for backward compatibility during migration
export interface LegacyTrack {
  id: string;
  name: string;
  startFinishA: { lat: number; lon: number };
  startFinishB: { lat: number; lon: number };
  createdAt: number;
}

export interface LapCrossing {
  sampleIndex: number;
  crossingTime: number; // ms since start
  fraction: number; // 0-1 position along segment
}

// Major-sector rollup times (only present when course has the three major sectors).
// Derived from the fine-grained `sectorTimes` by `rollupMajorSectors` — kept so the
// lap-table "Simple" view, video overlays, snapshots, and the coach plugin keep
// working unchanged.
export interface SectorTimes {
  s1?: number; // ms from start/finish to 2nd major crossing
  s2?: number; // ms from 2nd major to 3rd major crossing
  s3?: number; // ms from 3rd major to next start/finish
}

export interface Lap {
  lapNumber: number;
  startTime: number;
  endTime: number;
  lapTimeMs: number;
  maxSpeedMph: number;
  maxSpeedKph: number;
  minSpeedMph: number;
  minSpeedKph: number;
  startIndex: number;
  endIndex: number;
  sectors?: SectorTimes; // Major rollup — present when course has 3 major sectors
  /**
   * Fine-grained per-segment times, one entry per timing line in course order
   * (segment k = line k → line k+1, last wraps back to start/finish). `undefined`
   * for a segment whose crossing was missed/out-of-order. Present whenever the
   * course defines any sectors. Length === 1 + course.sectors.length.
   */
  sectorTimes?: (number | undefined)[];
  /**
   * Absolute sample index of each timing-line crossing within this lap, aligned
   * to `sectorTimes` (boundary k = where line k was crossed; index 0 === lap
   * start). `undefined` where the crossing was missed. Powers crop-to-sector.
   */
  sectorBoundaries?: (number | undefined)[];
  /**
   * The lap never reached its scoring distance: `lapTimeMs` is the duration of
   * the recorded data window, NOT a comparable completed time — never rank it
   * as fastest (see `fastestRankedLap`). Its partial `sectorTimes` still feed
   * the optimal-lap calc. Currently only set by drag mode for short runs.
   */
  incomplete?: boolean;
}

export interface FieldMapping {
  index: number;
  /** Stable channel identity (canonical ChannelId or a `custom:` slug). */
  name: string;
  /** Human-readable display name; falls back to `name` when absent. */
  label?: string;
  unit?: string;
  enabled: boolean;
}

/**
 * How a logged session was timed, from the DOVEX header's `race_mode` column.
 *
 * The device writes `CIRCUIT` / `SPRINT` (compared case-insensitively) and
 * leaves it empty in circuit sessions; logs predating the column have no such
 * field at all. Both cases surface as `undefined` — "unknown, assume circuit" —
 * so a reader never has to distinguish "old log" from "circuit log".
 */
export type RaceMode = 'circuit' | 'sprint';

export interface DovexMetadata {
  datetime?: string;
  driver?: string;
  course?: string;
  shortName?: string;
  bestLapMs?: number;
  optimalMs?: number;
  /** The logging device's name (`device_name`). Trailing column; older logs omit it. */
  deviceName?: string;
  /**
   * Timing model the session was recorded in (`race_mode`). Trailing column;
   * absent, empty or unrecognized ⇒ `undefined` (treat as circuit).
   */
  raceMode?: RaceMode;
  /** Per-lap times from the header. In a sprint session these are run times. */
  lapTimesMs?: number[];
}

export interface ParserStats {
  totalRows: number;
  acceptedRows: number;
  rejected: {
    nanFields: number;
    zeroCoords: number;
    outOfRange: number;
    speedCap: number;
    teleportation: number;
    incompleteRow: number;
    lowQuality: number;
  };
}

export interface ParsedData {
  samples: GpsSample[];
  fieldMappings: FieldMapping[];
  bounds: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  };
  duration: number;
  startDate?: Date;
  dovexMetadata?: DovexMetadata;
  parserStats?: ParserStats;
}

// Course detection result types
export type CourseDirection = 'forward' | 'reverse';

export interface CourseDetectionResult {
  track: Track;
  course: Course;
  direction?: CourseDirection;
  laps: Lap[];
  isWaypointMode: boolean;
  waypointNotice?: string;
  /**
   * Relative difference between detected lap distance and the course's known
   * `lengthFt`, as a non-negative fraction (e.g., 0.05 = 5% off).
   * Undefined when the matched course has no `lengthFt` or in waypoint mode.
   * UI can use this to flag low-confidence matches — anything > 0.25 is
   * outside the course-detection algorithm's documented tolerance.
   */
  lengthMatchDiff?: number;
}

// Selection state for track + course
export interface TrackCourseSelection {
  trackName: string;
  courseName: string;
  course: Course;
  /**
   * Direction the course is being driven, when known (from auto-detection).
   * Part of a lap snapshot's identity so a reverse-direction lap doesn't
   * overwrite the forward snapshot. Undefined is treated as 'forward'.
   */
  direction?: CourseDirection;
}
