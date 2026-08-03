import { Course, CourseSector, SectorLine, SectorTimes, isSprintCourse } from '@/types/racing';

/**
 * Sector model — the single source of truth for the "unlimited sectors" feature.
 *
 * A course's timing lines, in driving order, are: the start/finish line (always
 * sector 1, always "major") followed by `course.sectors` (zero or more lines).
 * Exactly three of them are flagged "major" (start/finish + two) — these are the
 * only lines exported to the BLE logger. Everything else (numbering, validation,
 * legacy migration, rollup to the classic S1/S2/S3) lives here so the rest of
 * the app never reasons about sector geometry directly.
 */

/** Hidden cap on total timing lines (start/finish + sub-sectors). Raise later. */
export const MAX_SECTOR_LINES = 25;
/** Hard cap on "major" sectors (start/finish + this-many-minus-one flagged). */
export const MAX_MAJOR_SECTORS = 3;
/** Max entries allowed in `course.sectors` (the array excludes start/finish). */
export const MAX_COURSE_SECTORS = MAX_SECTOR_LINES - 1;

/** Default half-length (in degrees longitude) of a freshly-dropped sector line
 *  — ~15m at mid-latitudes, so the whole line is ~30m. The user drags the
 *  endpoints onto the track from there. */
export const DEFAULT_SECTOR_HALF_LENGTH_DEG = 0.00015;

/**
 * A short horizontal (east-west) timing line centered on `center`. Used when
 * adding a new sector so it drops in the middle of the current map view rather
 * than near start/finish; the view is left untouched and the user nudges the
 * endpoints into place.
 */
export function centeredSectorLine(
  center: { lat: number; lon: number },
  halfLengthDeg: number = DEFAULT_SECTOR_HALF_LENGTH_DEG,
): SectorLine {
  return {
    a: { lat: center.lat, lon: center.lon - halfLengthDeg },
    b: { lat: center.lat, lon: center.lon + halfLengthDeg },
  };
}

/**
 * Migrate any course into the canonical `sectors` array and keep the legacy
 * `sector2`/`sector3` mirror in agreement. Idempotent. Call at every boundary a
 * Course enters memory (track load, device download, snapshot load, admin read).
 */
export function normalizeCourseSectors(course: Course): Course {
  let sectors = course.sectors;

  if (!sectors || sectors.length === 0) {
    // Legacy course: sector2/sector3 are the two majors after start/finish.
    const migrated: CourseSector[] = [];
    if (course.sector2) migrated.push({ line: course.sector2, major: true });
    if (course.sector3) migrated.push({ line: course.sector3, major: true });
    sectors = migrated.length > 0 ? migrated : undefined;
  }

  const mirror = sectors ? legacyMirror({ ...course, sectors }) : {};
  return { ...course, sectors, sector2: mirror.sector2, sector3: mirror.sector3 };
}

/** The major lines among `course.sectors` (excludes the implicit start/finish). */
export function majorSectorLines(course: Course): SectorLine[] {
  return (course.sectors ?? []).filter((s) => s.major).map((s) => s.line);
}

/**
 * Derive the legacy `sector2`/`sector3` from the first two majors so serializers
 * (device export, track JSON, content hash) keep emitting the exact same wire
 * data as before for migrated courses.
 */
export function legacyMirror(course: Course): { sector2?: SectorLine; sector3?: SectorLine } {
  const majors = majorSectorLines(course);
  return { sector2: majors[0], sector3: majors[1] };
}

/**
 * Auto-numbering labels, one per timing line INCLUDING start/finish at index 0.
 * Drag order drives numbering: each major opens a new group ("1", "2", "3"), and
 * sub-sectors take "{group}.{n}" since the last major. Example:
 *   S/F → "1", sub → "1.1", major → "2", sub → "2.1", sub → "2.2", major → "3".
 */
export function sectorLabels(course: Course): string[] {
  const labels: string[] = ['1']; // start/finish is always major group 1
  let group = 1;
  let sub = 0;
  for (const s of course.sectors ?? []) {
    if (s.major) {
      group += 1;
      sub = 0;
      labels.push(String(group));
    } else {
      sub += 1;
      labels.push(`${group}.${sub}`);
    }
  }
  return labels;
}

export interface SectorValidation {
  valid: boolean;
  /** Human-readable reason a save is blocked, or null when valid. */
  reason: string | null;
}

/** Max split lines between a sprint course's start and finish (plan 0015). */
export const MAX_SPRINT_SPLITS = 2;

/**
 * Save rule, by course type.
 *
 * **Circuit** — either zero additional sectors, or exactly three major sectors
 * total (start/finish + two flagged), within `MAX_SECTOR_LINES` overall.
 *
 * **Sprint** — a finish line is REQUIRED (the logger cannot time a run without
 * one, so saving a course it will ignore is worse than blocking), and there may
 * be zero to `MAX_SPRINT_SPLITS` optional split lines. The `major` flag carries
 * no meaning point-to-point and is not checked.
 */
export function validateCourseSectors(course: Course): SectorValidation {
  const sectors = course.sectors ?? [];

  if (isSprintCourse(course)) {
    if (!course.finish) {
      return { valid: false, reason: 'A sprint course needs a finish line — drag one onto the map.' };
    }
    if (sectors.length > MAX_SPRINT_SPLITS) {
      return {
        valid: false,
        reason: `A sprint course can have at most ${MAX_SPRINT_SPLITS} split lines between start and finish.`,
      };
    }
    return { valid: true, reason: null };
  }

  if (sectors.length === 0) return { valid: true, reason: null };

  if (sectors.length > MAX_COURSE_SECTORS) {
    return { valid: false, reason: `Too many sectors (max ${MAX_SECTOR_LINES} including start/finish).` };
  }

  const majors = sectors.filter((s) => s.major).length + 1; // + start/finish
  if (majors !== MAX_MAJOR_SECTORS) {
    return {
      valid: false,
      reason: `Mark the three traditional sectors as a Major sector (start/finish is one — flag ${MAX_MAJOR_SECTORS - 1} more).`,
    };
  }
  return { valid: true, reason: null };
}

/** True once the course is at the hidden timing-line cap (no more can be added). */
export function isAtSectorLimit(course: Course): boolean {
  return (course.sectors ?? []).length >= MAX_COURSE_SECTORS;
}

/**
 * True once all `MAX_MAJOR_SECTORS` majors are spoken for (start/finish + the
 * flagged sub-sectors). The logger only ever sees three majors, so the editor
 * hides the "major" toggle on non-major rows at this point; un-flagging an
 * existing major drops back below the cap and the toggles return.
 */
export function isAtMajorLimit(course: Course): boolean {
  const flaggedMajors = (course.sectors ?? []).filter((s) => s.major).length;
  return flaggedMajors + 1 >= MAX_MAJOR_SECTORS; // + start/finish
}

/**
 * Roll the fine-grained per-segment times up into the classic S1/S2/S3, where
 * each major sector spans from its major line to the next major line. A major
 * sector is `undefined` if any of its constituent segments is missing.
 *
 * `sectorTimes[k]` is the segment beginning at timing line k (index 0 = start/
 * finish), aligned to the order [startFinish, ...course.sectors].
 */
export function rollupMajorSectors(
  course: Course,
  sectorTimes: (number | undefined)[],
): SectorTimes | undefined {
  // Indices of the major timing lines (line 0 = start/finish is always major).
  const majorIdx = [0];
  (course.sectors ?? []).forEach((s, i) => {
    if (s.major) majorIdx.push(i + 1);
  });
  if (majorIdx.length < MAX_MAJOR_SECTORS) return undefined;

  const n = sectorTimes.length;
  const groupTotal = (from: number, toExclusive: number): number | undefined => {
    let sum = 0;
    for (let k = from; k < toExclusive; k++) {
      const v = sectorTimes[k];
      if (v === undefined) return undefined;
      sum += v;
    }
    return sum;
  };

  return {
    s1: groupTotal(majorIdx[0], majorIdx[1]),
    s2: groupTotal(majorIdx[1], majorIdx[2]),
    s3: groupTotal(majorIdx[2], n),
  };
}
