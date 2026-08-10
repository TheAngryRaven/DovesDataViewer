/**
 * The state behind the "choose which courses go on the logger" dialog
 * (plan 0017).
 *
 * The dialog itself is a component, and components are untestable here — the
 * suite runs in `node` with no renderer, and `src/components/**` is excluded
 * from coverage. So everything that decides anything lives in this module and
 * the dialog only draws it.
 */

import { Course, Track } from '@/types/racing';
import {
  keepsOnlyNewest,
  newestCourseIndex,
  resolveDeviceCourses,
  type TrackCourseOverrides,
} from '@/lib/deviceCourseSelection';
import { projectDeviceTrackBytes } from '@/lib/deviceTrackBudget';

export interface PickerRow {
  course: Course;
  name: string;
  selected: boolean;
  /**
   * True for the course the default rule keeps on its own — the newest run of
   * a sprint track. Shown as a hint, NOT enforced: the user may drop it (they
   * might be about to walk a replacement) and may keep older ones.
   */
  isDefault: boolean;
  /** Sprint only; the dialog renders it so "oldest" is visible, not implied. */
  dateCreated?: string;
}

export interface PickerState {
  rows: PickerRow[];
  /** Bytes the device would store for the current selection. */
  bytes: number;
  budget: number;
  /** Bytes past the budget, or 0 when it fits. */
  overBy: number;
  /** False while the selection would not fit, or is empty. */
  canConfirm: boolean;
  /**
   * True when this track's courses accumulate — a sprint venue re-laying its
   * cones. The dialog uses it to explain WHY the list is trimmed by default,
   * rather than presenting the trim as arbitrary.
   */
  accumulates: boolean;
}

/**
 * The names the dialog should start with: whatever is currently bound for the
 * device, default rule plus any stored overrides.
 */
export function initialPickerSelection(
  courses: readonly Course[],
  overrides?: TrackCourseOverrides,
): string[] {
  return resolveDeviceCourses(courses, overrides)
    .filter((d) => d.included)
    .map((d) => d.course.name);
}

/**
 * Build the dialog's state for a given selection.
 *
 * `bytes` is measured through the real upload writer, so the number shown as
 * the reason to drop a course is the number that would be written.
 *
 * An empty selection cannot be confirmed. Writing a track file with no courses
 * is not "a smaller track" — it is a file the logger will parse, find nothing
 * in, and never detect, which looks exactly like the failure this whole plan
 * exists to prevent. Deleting the track is a different button.
 */
export function buildPickerState(
  track: Track,
  selectedNames: readonly string[],
  budget: number,
): PickerState {
  const wanted = new Set(selectedNames);
  const accumulates = keepsOnlyNewest(track.courses);
  const defaultIndex = accumulates ? newestCourseIndex(track.courses) : -1;

  const rows: PickerRow[] = track.courses.map((course, i) => ({
    course,
    name: course.name,
    selected: wanted.has(course.name),
    isDefault: defaultIndex === -1 ? true : i === defaultIndex,
    dateCreated: course.dateCreated,
  }));

  const selected = rows.filter((r) => r.selected).map((r) => r.course);
  const bytes = projectDeviceTrackBytes(track, selected);
  const overBy = Math.max(0, bytes - budget);

  return {
    rows,
    bytes,
    budget,
    overBy,
    canConfirm: selected.length > 0 && overBy === 0,
    accumulates,
  };
}

/** Toggle one course in a selection, returning a new list. */
export function togglePickerCourse(
  selectedNames: readonly string[],
  name: string,
): string[] {
  return selectedNames.includes(name)
    ? selectedNames.filter((n) => n !== name)
    : [...selectedNames, name];
}
