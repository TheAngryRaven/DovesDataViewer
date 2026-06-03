/**
 * Local record of which course geometries the user has already submitted to the
 * community database. Lets the contribute flow skip re-uploading unchanged
 * courses, while re-flagging a course the user later edits.
 *
 * Thin localStorage wrapper — all the diff/merge logic is pure in
 * `trackSubmission.ts`.
 */

import {
  mergeSubmittedRecords,
  type SubmissionCourse,
  type SubmittedRecord,
} from '@/lib/trackSubmission';

const STORAGE_KEY = 'racing-datalog-submitted-v1';

interface StoredShape {
  records: Record<string, SubmittedRecord>;
}

/** Load the remembered submissions, keyed by `submissionKey`. */
export function loadSubmittedRecords(): Record<string, SubmittedRecord> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredShape;
    return parsed.records ?? {};
  } catch (e) {
    console.error('Failed to load submitted-tracks records:', e);
    return {};
  }
}

/** Remember a freshly-submitted batch of courses. */
export function markCoursesSubmitted(
  courses: Array<Pick<SubmissionCourse, 'key' | 'contentHash'>>,
  batchId: string,
): void {
  try {
    const next = mergeSubmittedRecords(loadSubmittedRecords(), courses, batchId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ records: next } satisfies StoredShape));
  } catch (e) {
    console.error('Failed to persist submitted-tracks records:', e);
  }
}

/** Clear the remembered set (e.g. a "re-submit everything" escape hatch). */
export function clearSubmittedRecords(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.error('Failed to clear submitted-tracks records:', e);
  }
}
