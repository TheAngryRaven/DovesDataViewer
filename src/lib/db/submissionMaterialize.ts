/**
 * Materialize an approved community submission into concrete track/course rows.
 *
 * Approving a submission used to only flip `submissions.status` to `approved` —
 * a moderation flag that left the `tracks`/`courses` tables untouched, so an
 * approved track/course never actually appeared in the live database. This
 * module builds the validated course payload from a submission so the adapter
 * can upsert it; the pure builder is unit-tested, the DB orchestration lives in
 * the adapter (`applySubmission`).
 */

import type { DbSubmission, DbCourse } from './types';

/** A course's column values minus the keys the DB/adapter fills in. */
export type SubmissionCourseColumns = Omit<
  DbCourse,
  'id' | 'track_id' | 'created_at' | 'updated_at'
>;

function validateLat(v: unknown, label: string, courseName: string): number {
  const n = Number(v);
  if (isNaN(n) || !isFinite(n) || n < -90 || n > 90) {
    throw new Error(`Invalid latitude ${label} in course "${courseName}": must be between -90 and 90`);
  }
  return n;
}

function validateLng(v: unknown, label: string, courseName: string): number {
  const n = Number(v);
  if (isNaN(n) || !isFinite(n) || n < -180 || n > 180) {
    throw new Error(`Invalid longitude ${label} in course "${courseName}": must be between -180 and 180`);
  }
  return n;
}

/**
 * Build the validated course columns for an approved submission. Throws on any
 * out-of-range / non-finite coordinate so a bad submission never lands as a
 * malformed course row. Sectors come from the dedicated `sectors_data` column
 * (preferred), falling back to the `sectors` key inside `course_data`.
 */
export function buildCourseColumnsFromSubmission(sub: DbSubmission): SubmissionCourseColumns {
  const courseName = sub.course_name.trim();
  if (!courseName || courseName.length > 100) {
    throw new Error(`Invalid course name in submission: "${sub.course_name}"`);
  }
  const cd = (sub.course_data ?? {}) as Record<string, unknown>;

  const optLat = (v: unknown, label: string): number | null =>
    v === undefined || v === null ? null : validateLat(v, label, courseName);
  const optLng = (v: unknown, label: string): number | null =>
    v === undefined || v === null ? null : validateLng(v, label, courseName);

  const columns: SubmissionCourseColumns = {
    name: courseName,
    enabled: true,
    start_a_lat: validateLat(cd.start_a_lat, 'start_a_lat', courseName),
    start_a_lng: validateLng(cd.start_a_lng, 'start_a_lng', courseName),
    start_b_lat: validateLat(cd.start_b_lat, 'start_b_lat', courseName),
    start_b_lng: validateLng(cd.start_b_lng, 'start_b_lng', courseName),
    sector_2_a_lat: optLat(cd.sector_2_a_lat, 'sector_2_a_lat'),
    sector_2_a_lng: optLng(cd.sector_2_a_lng, 'sector_2_a_lng'),
    sector_2_b_lat: optLat(cd.sector_2_b_lat, 'sector_2_b_lat'),
    sector_2_b_lng: optLng(cd.sector_2_b_lng, 'sector_2_b_lng'),
    sector_3_a_lat: optLat(cd.sector_3_a_lat, 'sector_3_a_lat'),
    sector_3_a_lng: optLng(cd.sector_3_a_lng, 'sector_3_a_lng'),
    sector_3_b_lat: optLat(cd.sector_3_b_lat, 'sector_3_b_lat'),
    sector_3_b_lng: optLng(cd.sector_3_b_lng, 'sector_3_b_lng'),
    sectors_data: null,
    superseded_by: null,
    length_ft_override: null,
  };

  // Canonical ordered sector list: prefer the dedicated column, fall back to the
  // `sectors` key folded into course_data by the submit edge function.
  const rawSectors = Array.isArray(sub.sectors_data)
    ? sub.sectors_data
    : Array.isArray(cd.sectors)
      ? (cd.sectors as Array<Record<string, unknown>>)
      : null;
  if (rawSectors && rawSectors.length > 0) {
    columns.sectors_data = rawSectors.map((s) => ({
      a_lat: validateLat(s.a_lat, 'sector a_lat', courseName),
      a_lng: validateLng(s.a_lng, 'sector a_lng', courseName),
      b_lat: validateLat(s.b_lat, 'sector b_lat', courseName),
      b_lng: validateLng(s.b_lng, 'sector b_lng', courseName),
      major: Boolean(s.major),
    }));
  }

  // lengthFt (if the submitter sent one) becomes the length override.
  const lengthFt = Number(cd.lengthFt);
  if (cd.lengthFt !== undefined && cd.lengthFt !== null && !isNaN(lengthFt) && lengthFt > 0) {
    columns.length_ft_override = Math.round(lengthFt);
  }

  return columns;
}
