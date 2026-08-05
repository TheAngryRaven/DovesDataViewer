/**
 * Naming the tracks and courses a sync is about to write.
 *
 * Two jobs, both pure so the wizard's `.tsx` stays a renderer:
 *
 * 1. **The edit rules.** A short name follows the long name until the user
 *    takes it over — and, by explicit decision, editing the long name after
 *    that takes it back. A course name follows its track's new name the same
 *    way. Simple and predictable beats clever here.
 * 2. **The save gate.** A name that reaches the device has to be legal there,
 *    unique, and actually chosen by a human rather than left as a date stamp.
 */

import type { TrackKind } from '@/lib/ble/trackOpcodes';
import { MAX_SHORT_NAME_LENGTH, deriveShortName } from '@/lib/trackUtils';
import { isDeviceGeneratedName } from '@/lib/deviceGeneratedNames';
import type { SyncCourseRow, SyncTrackRow } from '@/lib/deviceSyncPlan';

/**
 * Characters a short name may use.
 *
 * The firmware's validator (`BirdsEye/filename_validator.cpp`) also permits
 * `.`, `_` and `-`, but a short name becomes the FILENAME base, and a dot there
 * reads as an extension. Alphanumerics only — which is also exactly what
 * `deriveShortName` emits, so the auto-derived value is always legal.
 */
const SHORT_NAME_CHARSET = /^[A-Za-z0-9]+$/;

export interface TrackNameDraft {
  name: string;
  shortName: string;
  /** True once the user has typed in the short-name box themselves. */
  shortNameTouched: boolean;
}

export interface CourseNameDraft {
  name: string;
  /** True once the user has typed here; stops the track name overwriting it. */
  touched: boolean;
}

export type NameProblem =
  /** Nothing typed. */
  | 'required'
  /** Still the date stamp the device generated. */
  | 'still_generated'
  | 'short_required'
  | 'short_charset'
  | 'short_too_long'
  | 'short_duplicate';

// ─── Editing ─────────────────────────────────────────────────────────────────

/**
 * Force a typed short name into something the device will accept: alphanumerics
 * only, uppercase, capped. Matches `deriveShortName`'s own normalisation, so a
 * hand-typed name and a derived one can't disagree about what is legal.
 */
export function normalizeShortName(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, MAX_SHORT_NAME_LENGTH);
}

/**
 * The starting state for a track's name fields.
 *
 * A device-generated name starts the box EMPTY rather than pre-filled: the row
 * exists precisely because that name isn't usable, and pre-filling it invites
 * clicking straight past. A name the user already chose is kept as-is.
 */
export function initialTrackDraft(row: SyncTrackRow): TrackNameDraft {
  if (isDeviceGeneratedName(row.name)) {
    return { name: '', shortName: '', shortNameTouched: false };
  }
  return {
    name: row.name,
    shortName: normalizeShortName(row.shortName) || deriveShortName(row.name),
    shortNameTouched: false,
  };
}

/**
 * Typing in the long-name box.
 *
 * This always re-derives the short name, even one the user had customised —
 * their call: "if they edit it then edit the full name, just regen the short
 * name, their fault they changed it".
 */
export function editTrackName(draft: TrackNameDraft, name: string): TrackNameDraft {
  return { name, shortName: deriveShortName(name), shortNameTouched: false };
}

/** Typing in the short-name box. Takes ownership until the long name changes. */
export function editTrackShortName(draft: TrackNameDraft, shortName: string): TrackNameDraft {
  return { ...draft, shortName: normalizeShortName(shortName), shortNameTouched: true };
}

/**
 * The starting state for a course's name field.
 *
 * A generated course name follows the track's new name — the firmware gives a
 * new track and its first course the same stamp, so they are the same thing
 * named twice.
 */
export function initialCourseDraft(row: SyncCourseRow, trackName: string): CourseNameDraft {
  if (isDeviceGeneratedName(row.name)) return { name: trackName, touched: false };
  return { name: row.name, touched: false };
}

export function editCourseName(draft: CourseNameDraft, name: string): CourseNameDraft {
  return { name, touched: true };
}

/**
 * Re-point an untouched course name at a track name that just changed — the
 * user went Back, renamed the track, and came forward again. A course name they
 * typed themselves is left alone.
 */
export function retargetCourseDraft(
  draft: CourseNameDraft,
  trackName: string,
): CourseNameDraft {
  return draft.touched ? draft : { name: trackName, touched: false };
}

// ─── Validation ──────────────────────────────────────────────────────────────

export interface TrackNameContext {
  /**
   * Short names already claimed — by another row in this wizard, or by a file
   * already on the device of the same kind. Compared case-insensitively, and
   * must exclude the row's own current name.
   */
  takenShortNames: Iterable<string>;
}

/**
 * What still stands between this track and "Save & import", or null if nothing.
 *
 * A track name is required whichever kind it is: a venue is permanent, so a
 * date stamp is never the right name for one. (Its *courses* are a different
 * matter — see `validateCourseDraft`.)
 */
export function validateTrackDraft(
  draft: TrackNameDraft,
  context: TrackNameContext = { takenShortNames: [] },
): NameProblem | null {
  const name = draft.name.trim();
  if (!name) return 'required';
  if (isDeviceGeneratedName(name)) return 'still_generated';

  const shortName = draft.shortName.trim();
  if (!shortName) return 'short_required';
  if (!SHORT_NAME_CHARSET.test(shortName)) return 'short_charset';
  if (shortName.length > MAX_SHORT_NAME_LENGTH) return 'short_too_long';

  const taken = new Set(Array.from(context.takenShortNames, (s) => s.toUpperCase()));
  if (taken.has(shortName.toUpperCase())) return 'short_duplicate';

  return null;
}

/**
 * What still stands between this course and "Save & import", or null.
 *
 * Circuit courses must be named; **sprint courses need not be**. A sprint venue
 * re-lays its course every event, so the date it was walked genuinely is the
 * most useful label — forcing a name there would just make people type noise.
 */
export function validateCourseDraft(
  draft: CourseNameDraft,
  kind: TrackKind,
): NameProblem | null {
  const name = draft.name.trim();
  if (!name) return 'required';
  if (kind === 'circuit' && isDeviceGeneratedName(name)) return 'still_generated';
  return null;
}
