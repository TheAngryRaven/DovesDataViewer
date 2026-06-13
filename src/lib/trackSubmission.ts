/**
 * Track-submission planning — pure logic for the "contribute to the community
 * database" flow.
 *
 * The old flow made the user hand-fill a coordinate form, one course at a time.
 * Instead we diff everything they already have locally against the built-in
 * (community) track list and produce a plan of exactly what is new or modified,
 * so the whole contribution can go up as a single payload.
 *
 * Local storage already only persists user-defined content (see trackStorage),
 * so the candidate set is small. `Track.isUserDefined` distinguishes a wholly
 * new track from a built-in one the user merely added/edited a course on; the
 * built-in `defaults` list tells us, for a course on a built-in track, whether
 * it is a brand-new course or a modification of an existing one.
 *
 * A content hash of each course's geometry lets us (a) skip a "modified" course
 * that is actually identical to the built-in one, and (b) remember what was
 * already submitted so an unchanged course is not re-uploaded.
 */

import type { Course, Track } from '@/types/racing';
import { deriveShortName } from '@/lib/trackUtils';
import { legacyMirror, normalizeCourseSectors } from '@/lib/courseSectors';
import { sectorsToJson, type SectorJson } from '@/lib/trackStorage';

/** Flat snake_case coordinate payload — the shape the edge fn + DB expect. */
export interface CourseSubmissionData {
  start_a_lat: number;
  start_a_lng: number;
  start_b_lat: number;
  start_b_lng: number;
  // Legacy two-major fields — still sent for back-compat with the DB columns.
  sector_2_a_lat?: number;
  sector_2_a_lng?: number;
  sector_2_b_lat?: number;
  sector_2_b_lng?: number;
  sector_3_a_lat?: number;
  sector_3_a_lng?: number;
  sector_3_b_lat?: number;
  sector_3_b_lng?: number;
  // Canonical ordered sector list (preferred; carries sub-sectors + major flags).
  sectors?: SectorJson[];
}

/** Submission type understood by the `submissions` table. */
export type SubmissionType = 'new_track' | 'new_course' | 'course_modification';

/** UI-facing classification of a single course in the plan. */
export type CourseChange = 'new-track' | 'new-course' | 'modified';

export interface SubmissionCourse {
  trackName: string;
  trackShortName?: string;
  courseName: string;
  type: SubmissionType;
  change: CourseChange;
  courseData: CourseSubmissionData;
  /**
   * Drawn track outline (polyline), when the user has one. Sent to the edge fn
   * as `layout_data` (separate from `course_data`); also folded into the content
   * hash so adding/changing a drawing re-flags an otherwise-unchanged course.
   */
  layout?: Array<{ lat: number; lon: number }>;
  /** Geometry + drawing hash — identity for dedupe against already-submitted content. */
  contentHash: string;
  /** Stable key (track + course) used by the already-submitted store. */
  key: string;
  /** True when this exact content was already submitted (unchanged since). */
  alreadySubmitted: boolean;
}

/** Track-level rollup. Adding a course to a built-in track reads as "edited". */
export type TrackStatus = 'new' | 'edited';

export interface SubmissionTrackGroup {
  trackName: string;
  shortName?: string;
  trackStatus: TrackStatus;
  courses: SubmissionCourse[];
}

export interface SubmissionPlan {
  groups: SubmissionTrackGroup[];
  /** Total courses that still need uploading (excludes already-submitted). */
  pendingCount: number;
}

/** One remembered submission: the geometry hash we last sent for a course. */
export interface SubmittedRecord {
  hash: string;
  submittedAt: number;
  batchId: string;
}

// ─── Keys & hashing ─────────────────────────────────────────────────────────

const KEY_SEP = '␟'; // ␟ unit separator — safe inside track/course names

/** Stable per-course key for the already-submitted store. */
export function submissionKey(trackName: string, courseName: string): string {
  return `${trackName}${KEY_SEP}${courseName}`;
}

// Round to 7 decimals (~1cm) so float noise below the coord epsilon doesn't
// produce a spurious "modified" diff.
function r(n: number): number {
  return Math.round(n * 1e7) / 1e7;
}

/**
 * Build the coordinate payload for a course. Sends the legacy two-major fields
 * (derived from the majors) for DB back-compat AND the canonical `sectors` array
 * carrying sub-sectors + major flags.
 */
export function courseToSubmissionData(course: Course): CourseSubmissionData {
  const norm = normalizeCourseSectors(course);
  const data: CourseSubmissionData = {
    start_a_lat: course.startFinishA.lat,
    start_a_lng: course.startFinishA.lon,
    start_b_lat: course.startFinishB.lat,
    start_b_lng: course.startFinishB.lon,
  };
  const { sector2, sector3 } = legacyMirror(norm);
  if (sector2 && sector3) {
    data.sector_2_a_lat = sector2.a.lat;
    data.sector_2_a_lng = sector2.a.lon;
    data.sector_2_b_lat = sector2.b.lat;
    data.sector_2_b_lng = sector2.b.lon;
    data.sector_3_a_lat = sector3.a.lat;
    data.sector_3_a_lng = sector3.a.lon;
    data.sector_3_b_lat = sector3.b.lat;
    data.sector_3_b_lng = sector3.b.lon;
  }
  const sectors = sectorsToJson(norm.sectors);
  if (sectors) data.sectors = sectors;
  return data;
}

// FNV-1a 32-bit → 8 hex chars. Not cryptographic — only change-detection.
function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Canonical (rounded) string for a drawn outline, or '' when there is none. */
function layoutHashInput(layout?: Array<{ lat: number; lon: number }>): string {
  if (!layout || layout.length < 2) return '';
  return layout.map((p) => `${r(p.lat)} ${r(p.lon)}`).join(';');
}

/**
 * Deterministic hash of a course's geometry + drawn outline (rounded). Name is
 * intentionally excluded — identity is carried by the key; the hash detects
 * geometry *or* drawing edits so a freshly-drawn outline re-flags the course.
 */
export function courseContentHash(course: Course): string {
  const norm = normalizeCourseSectors(course);
  const d = courseToSubmissionData(norm);
  const parts = [
    d.start_a_lat, d.start_a_lng, d.start_b_lat, d.start_b_lng,
    d.sector_2_a_lat, d.sector_2_a_lng, d.sector_2_b_lat, d.sector_2_b_lng,
    d.sector_3_a_lat, d.sector_3_a_lng, d.sector_3_b_lat, d.sector_3_b_lng,
  ].map((n) => (n === undefined ? '' : String(r(n))));
  parts.push(layoutHashInput(course.layout));
  // Only append sub-sector data when present, so a majors-only course hashes
  // byte-identically to the pre-overhaul hash (existing dedupe records stay valid).
  const subs = (norm.sectors ?? []).filter((s) => !s.major);
  if (subs.length > 0) {
    const seq = (norm.sectors ?? [])
      .map((s) => `${s.major ? 'M' : 'm'}:${r(s.line.a.lat)} ${r(s.line.a.lon)} ${r(s.line.b.lat)} ${r(s.line.b.lon)}`)
      .join(';');
    parts.push(seq);
  }
  return fnv1a(parts.join(','));
}

// ─── Plan ───────────────────────────────────────────────────────────────────

/**
 * Diff the user's local tracks against the built-in (community) list and build
 * the upload plan.
 *
 * @param merged   The merged track list (built-ins + user overlay), as returned
 *                 by `loadTracks()`. Only user-defined tracks/courses are
 *                 candidates for submission.
 * @param defaults The built-in track list (`loadDefaultTracks()`), used to tell
 *                 a new course apart from a modified one and to skip user
 *                 "edits" that are byte-identical to the built-in course.
 * @param submitted Already-submitted records keyed by `submissionKey`.
 */
export function buildSubmissionPlan(
  merged: Track[],
  defaults: Track[],
  submitted: Record<string, SubmittedRecord> = {},
): SubmissionPlan {
  // Built-in course geometry, looked up by "trackName / courseName".
  const defaultCourseHash = new Map<string, string>();
  for (const track of defaults) {
    for (const course of track.courses) {
      defaultCourseHash.set(submissionKey(track.name, course.name), courseContentHash(course));
    }
  }

  const groups: SubmissionTrackGroup[] = [];
  let pendingCount = 0;

  for (const track of merged) {
    const isNewTrack = !!track.isUserDefined;
    // A new track needs a short name; auto-derive one if it never got set so the
    // contribution isn't blocked (the create flow now fills this in up front).
    const resolvedShortName = isNewTrack
      ? (track.shortName?.trim() || deriveShortName(track.name) || undefined)
      : track.shortName;
    const courses: SubmissionCourse[] = [];

    for (const course of track.courses) {
      // Only user-touched courses are ever candidates.
      if (!course.isUserDefined) continue;

      const key = submissionKey(track.name, course.name);
      const hash = courseContentHash(course);
      const builtinHash = isNewTrack ? undefined : defaultCourseHash.get(key);

      // A user "edit" that is identical to the built-in course is a no-op.
      if (builtinHash !== undefined && builtinHash === hash) continue;

      let type: SubmissionType;
      let change: CourseChange;
      if (isNewTrack) {
        type = 'new_track';
        change = 'new-track';
      } else if (builtinHash === undefined) {
        type = 'new_course';
        change = 'new-course';
      } else {
        type = 'course_modification';
        change = 'modified';
      }

      const alreadySubmitted = submitted[key]?.hash === hash;
      if (!alreadySubmitted) pendingCount++;

      courses.push({
        trackName: track.name,
        trackShortName: resolvedShortName,
        courseName: course.name,
        type,
        change,
        courseData: courseToSubmissionData(course),
        layout: course.layout && course.layout.length >= 2 ? course.layout : undefined,
        contentHash: hash,
        key,
        alreadySubmitted,
      });
    }

    if (courses.length === 0) continue;
    groups.push({
      trackName: track.name,
      shortName: resolvedShortName,
      trackStatus: isNewTrack ? 'new' : 'edited',
      courses,
    });
  }

  return { groups, pendingCount };
}

/** Flatten a plan to the courses that still need uploading. */
export function pendingCourses(plan: SubmissionPlan): SubmissionCourse[] {
  return plan.groups.flatMap((g) => g.courses.filter((c) => !c.alreadySubmitted));
}

/**
 * Merge freshly-submitted courses into the remembered set (pure). Returns a new
 * record map; the caller persists it.
 */
export function mergeSubmittedRecords(
  existing: Record<string, SubmittedRecord>,
  submittedCourses: Array<Pick<SubmissionCourse, 'key' | 'contentHash'>>,
  batchId: string,
  now: number = Date.now(),
): Record<string, SubmittedRecord> {
  const next = { ...existing };
  for (const c of submittedCourses) {
    next[c.key] = { hash: c.contentHash, submittedAt: now, batchId };
  }
  return next;
}
