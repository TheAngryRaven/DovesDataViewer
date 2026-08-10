/**
 * Which of a track's courses belong on the device (plan 0017).
 *
 * The device holds a subset; the app holds everything. This module is the ONLY
 * place that decides which subset, so the sync plan, the upload writers, the
 * "is it synced?" check and the picker UI can never disagree about it — a
 * disagreement between any two of them is a track that re-prompts on every
 * connect, which is exactly the trap plan 0016 was written to close.
 */

import { Course, isSprintCourse } from '@/types/racing';

/**
 * A user's explicit deviations from the default rule, per track.
 *
 * Names, not indices: courses are reordered and re-saved, and an index would
 * silently retarget. Absent from both lists means "no opinion" — the default
 * rule decides, which is what makes an empty store a working configuration
 * rather than a broken one.
 */
export interface TrackCourseOverrides {
  /** Course names forced ON the device, past what the default rule picks. */
  include: string[];
  /** Course names forced OFF the device, against what the default rule picks. */
  exclude: string[];
}

export interface CourseDecision {
  course: Course;
  included: boolean;
  /** `user` when an override decided this, `default` when the rule did. */
  why: 'default' | 'user';
}

/** An empty set of overrides — the state every logger starts in. */
export const NO_OVERRIDES: TrackCourseOverrides = { include: [], exclude: [] };

/**
 * The newest sprint course, by `dateCreated`.
 *
 * `dateCreated` is a zero-padded `YYYY-MM-DDTHH:MM` stamp compared as a plain
 * string — the same comparison the firmware does, deliberately. A course with
 * no stamp sorts oldest: it predates the field, and treating a missing value as
 * "newest" would let it displace the course actually walked this morning.
 *
 * Returns -1 for an empty list. Ties resolve to the LAST such course, matching
 * "most recently added" when two were stamped in the same minute.
 */
export function newestCourseIndex(courses: readonly Course[]): number {
  let best = -1;
  let bestStamp = '';
  for (let i = 0; i < courses.length; i++) {
    const stamp = courses[i].dateCreated ?? '';
    if (best === -1 || stamp >= bestStamp) {
      best = i;
      bestStamp = stamp;
    }
  }
  return best;
}

/**
 * True when this track's courses accumulate — i.e. the default rule should keep
 * only the newest rather than all of them.
 *
 * A sprint venue re-lays its cones every event and the on-device creator mints
 * a dated course each time, so the file grows without bound. Circuit courses
 * are layouts of a fixed track: there are a handful, they don't accumulate, and
 * dropping one would take a layout the driver still runs off the device.
 */
export function keepsOnlyNewest(courses: readonly Course[]): boolean {
  return courses.some(isSprintCourse);
}

/**
 * Decide, for every course, whether it belongs on the device.
 *
 * Default rule first, then the user's explicit overrides on top. Order is
 * preserved so a caller can render decisions against the list it already has.
 *
 * An override naming a course that isn't here is ignored rather than an error —
 * courses get renamed and deleted in the app, and a stale name should decay to
 * the default, not break the sync.
 */
export function resolveDeviceCourses(
  courses: readonly Course[],
  overrides: TrackCourseOverrides = NO_OVERRIDES,
): CourseDecision[] {
  const newest = keepsOnlyNewest(courses) ? newestCourseIndex(courses) : -1;
  const included = new Set(overrides.include);
  const excluded = new Set(overrides.exclude);

  return courses.map((course, i) => {
    const byDefault = newest === -1 ? true : i === newest;

    // An explicit exclude wins over an explicit include: it is the one that
    // keeps a file under the device's buffer, and the cost of getting it wrong
    // is a track that stops being detected at the venue.
    if (excluded.has(course.name)) return { course, included: false, why: 'user' };
    if (included.has(course.name)) return { course, included: true, why: 'user' };
    return { course, included: byDefault, why: 'default' };
  });
}

/** The courses that belong on the device, in their original order. */
export function selectedDeviceCourses(
  courses: readonly Course[],
  overrides: TrackCourseOverrides = NO_OVERRIDES,
): Course[] {
  return resolveDeviceCourses(courses, overrides)
    .filter(d => d.included)
    .map(d => d.course);
}

/**
 * Fold a user's checkbox state back into overrides.
 *
 * Only genuine deviations are stored: a choice that matches what the default
 * rule would do anyway records nothing. That keeps the store small, and it
 * means a track the user never curated stays on the default forever rather
 * than being frozen to whatever it happened to look like the day they opened
 * the picker.
 */
export function overridesFromSelection(
  courses: readonly Course[],
  selectedNames: readonly string[],
): TrackCourseOverrides {
  const wanted = new Set(selectedNames);
  const include: string[] = [];
  const exclude: string[] = [];

  for (const { course, included } of resolveDeviceCourses(courses)) {
    const want = wanted.has(course.name);
    if (want === included) continue;
    if (want) include.push(course.name);
    else exclude.push(course.name);
  }
  return { include, exclude };
}
