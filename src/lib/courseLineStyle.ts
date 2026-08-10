import { type Course, isSprintCourse } from '@/types/racing';

/**
 * Colours for a course's timing lines, shared by every map that draws them.
 *
 * These lived only in the track editor, which is how the separate sprint
 * finish line ended up rendered there and nowhere else — the race-line map and
 * the simulator map each had their own hardcoded start/finish colour and no
 * concept of a finish line at all. One module means the next map to appear
 * cannot quietly miss a line type.
 *
 * Green-to-red reads as start-to-end, which is the whole point of a
 * point-to-point course. Circuit start/finish keeps its own colour because
 * there it is one line doing both jobs, and re-colouring it would change every
 * existing session map for no reason.
 */
export const COURSE_LINE_COLORS = {
  /** Circuit: the single line that is both start and finish. */
  startFinish: '#ef4444',
  /** Sprint: the start line (green — you go from here). */
  sprintStart: '#22c55e',
  /** Sprint: the separate finish line (red — you stop here). */
  finish: '#ef4444',
  /** Major sector lines. */
  major: '#a855f7',
  /** Sub-sector lines between majors. */
  sub: '#38bdf8',
} as const;

/**
 * Colour for a course's opening line. On a circuit that line is the finish
 * too, so it stays red; on a sprint course it is only the start, and the
 * finish is drawn separately.
 */
export function openingLineColor(course: Pick<Course, 'type'> | null | undefined): string {
  return isSprintCourse(course)
    ? COURSE_LINE_COLORS.sprintStart
    : COURSE_LINE_COLORS.startFinish;
}

/**
 * The separate finish line to draw, or `null` when there isn't one.
 *
 * Guards on the course type as well as the field: a stray `finish` on a course
 * typed circuit is stale data, not a line to render.
 */
export function finishLineOf(course: Course | null | undefined) {
  if (!course || !isSprintCourse(course)) return null;
  return course.finish ?? null;
}
