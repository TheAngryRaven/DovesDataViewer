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

export interface Course {
  name: string;
  lengthFt?: number; // known course length in feet (from track database)
  startFinishA: { lat: number; lon: number };
  startFinishB: { lat: number; lon: number };
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
 * True when a course produces the classic three major sectors (start/finish +
 * two flagged majors). Reads the canonical `sectors` array, falling back to the
 * legacy `sector2`/`sector3` pair for un-normalized courses.
 */
export function courseHasSectors(course: Course | null): boolean {
  if (!course) return false;
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

export interface DovexMetadata {
  datetime?: string;
  driver?: string;
  course?: string;
  shortName?: string;
  bestLapMs?: number;
  optimalMs?: number;
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
