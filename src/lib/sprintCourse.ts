/**
 * Sprint-course helpers — the `date_created` stamp and the "which course will
 * the device actually load" question.
 *
 * The logger does not let you pick a sprint course. It loads exactly one: the
 * newest by `date_created`, chosen with a plain **string** comparison in the
 * firmware's `sprint_select` unit. That makes the stamp format load-bearing
 * rather than cosmetic — anything that isn't zero-padded and
 * big-endian-ordered collates wrong and the device silently runs the wrong
 * layout. Everything here exists to keep this app on the same ordering.
 *
 * See `docs/plans/0015-sprint-mode.md` and, in the firmware repo,
 * `BirdsEye/sprint_select.{h,cpp}`.
 */

import { Course, isSprintCourse } from '@/types/racing';

/**
 * `YYYY-MM-DDTHH:MM` — sortable as a plain string, minute precision, local
 * time. Minute precision is deliberate: the stamp identifies *which cone layout
 * was walked*, not an instant, and it matches the resolution of the filename
 * stamps the device generates itself. Notably NOT a full ISO instant — no
 * seconds and no zone suffix, because the string is compared byte-wise against
 * stamps the device writes.
 */
export const SPRINT_DATE_CREATED_LENGTH = 16;

const STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Format a Date as the sortable `YYYY-MM-DDTHH:MM` stamp, in local time. */
export function formatSprintDateCreated(date: Date): string {
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
    `T${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  );
}

/**
 * True when a stamp is in the exact shape the device's string ordering relies
 * on. Anything else must not be trusted to sort — see `newestSprintCourseIndex`.
 */
export function isValidSprintDateCreated(stamp: string | undefined | null): boolean {
  return typeof stamp === 'string' && STAMP_RE.test(stamp);
}

/**
 * Stamp a sprint course with its creation time, **preserving an existing
 * stamp**. Editing a course must not make it jump the queue on the device —
 * `date_created` records when the layout was walked, not when the record was
 * last touched. Circuit courses are returned untouched.
 */
export function stampSprintDateCreated(course: Course, now: Date = new Date()): Course {
  if (!isSprintCourse(course)) return course;
  if (isValidSprintDateCreated(course.dateCreated)) return course;
  return { ...course, dateCreated: formatSprintDateCreated(now) };
}

/**
 * Index of the course the device would load: the newest sprint course by
 * `date_created`, compared as a string exactly as the firmware does.
 *
 * Returns -1 when there is nothing loadable. Courses with a missing or
 * malformed stamp sort **oldest** rather than being dropped — the device would
 * still see the file, and silently hiding it here would make the app disagree
 * with the hardware about what is on the card. A course with no valid stamp
 * only wins if it is the only candidate.
 *
 * Ties keep the earlier course: two layouts stamped the same minute are
 * genuinely ambiguous, and first-wins at least makes this app deterministic.
 */
export function newestSprintCourseIndex(courses: readonly Course[]): number {
  let best = -1;
  let bestStamp: string | null = null;

  courses.forEach((course, i) => {
    if (!isSprintCourse(course)) return;
    const stamp = isValidSprintDateCreated(course.dateCreated) ? course.dateCreated! : null;
    if (best === -1) {
      best = i;
      bestStamp = stamp;
      return;
    }
    if (stamp === null) return;                 // unstamped never displaces
    if (bestStamp === null || stamp > bestStamp) {
      best = i;
      bestStamp = stamp;
    }
  });

  return best;
}

/** The course the device would load, or undefined when there is no sprint course. */
export function newestSprintCourse(courses: readonly Course[]): Course | undefined {
  const i = newestSprintCourseIndex(courses);
  return i === -1 ? undefined : courses[i];
}
