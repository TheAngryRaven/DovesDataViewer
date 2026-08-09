/**
 * What a device sync would actually do — computed, not performed.
 *
 * `buildMergedTrackList` answers "how do these two sides differ?". This answers
 * the next question: "which of those differences are we going to offer to fix,
 * in which direction, and which can never be fixed at all?" Keeping it pure
 * means the wizard's whole decision surface is unit-testable in a node
 * environment, where the dialog itself cannot even be rendered.
 */

import type { TrackKind } from '@/lib/ble/trackOpcodes';
import type { Course, Track } from '@/types/racing';
import { isSprintCourse } from '@/types/racing';
import {
  deviceCourseToAppCourse,
  isMixedKindTrack,
  type DeviceCourseJson,
  type MergedTrackEntry,
} from '@/lib/deviceTrackSync';
import { fitsDeviceBudget } from '@/lib/deviceTrackBudget';
import { isDeviceGeneratedName, isDeviceGeneratedShortName } from '@/lib/deviceGeneratedNames';

/**
 * Courses the firmware keeps per track file (`MAX_LAYOUTS` in `project.h`).
 *
 * Its parser silently ignores everything past this (`sd_functions.ino`
 * `if (numOfTracks < MAX_LAYOUTS)`), so a bigger track can never read back as
 * the file we wrote — it would report a mismatch on every connect forever. We
 * do NOT trim to fit: dropping a user's courses to make a checkmark go green is
 * the worse failure. Such tracks are skipped and surfaced instead.
 */
export const DEVICE_MAX_COURSES = 10;

/** Which way a row moves. Purely a label for the bubble; the ops decide the work. */
export type SyncDirection = 'upload' | 'download';

/** Why a difference is being reported rather than offered. */
export type SkipReason =
  /** Circuit and sprint courses in one track — two files on the device, no way to represent it. */
  | 'mixed_kind'
  /** More courses than the firmware will read back. */
  | 'too_many_courses'
  /**
   * The file would be bigger than the firmware's parse buffer, even after the
   * curation rule has had its say (plan 0017).
   *
   * Distinct from `too_many_courses` because neither guard subsumes the other:
   * on the larger buffer the course cap binds first, and on the smaller one a
   * sprint track overflows at about SEVEN courses — under the cap, which is why
   * the cap alone never caught it.
   *
   * Reported, never prompted. On a browser with nothing stored the default rule
   * alone has to settle, so a track that still doesn't fit is surfaced here to
   * be curated deliberately rather than raised as a dialog on every connect.
   */
  | 'too_many_bytes'
  /** A sprint track on a transport that can't reach the sprint folder. */
  | 'sprint_unsupported';

export interface SyncCourseRow {
  /** Stable across re-renders and edits; the checkbox `Set` keys on it. */
  key: string;
  /** The name as it stands now, before any rename. */
  name: string;
  kind: TrackKind;
  /** True when the name is a device placeholder, so the row gets a text box. */
  needsRename: boolean;
  direction: SyncDirection;
  appCourse?: Course;
  deviceCourse?: DeviceCourseJson;
}

export interface SyncTrackRow {
  key: string;
  /** Current identity — the shortName the merge keys on. */
  shortName: string;
  /** Current long name, from the app track or the device file's `longName`. */
  name: string;
  kind: TrackKind;
  direction: SyncDirection;
  /**
   * True when either the long name or the short name is a device placeholder.
   * Only the long name blocks saving; the short name re-derives from it.
   */
  needsRename: boolean;
  /** The file to overwrite, when one already exists. */
  deviceFileName?: string;
  appTrack?: Track;
  /** Courses on the device that the app doesn't have — always imported. */
  deviceOnlyCourses: DeviceCourseJson[];
  courses: SyncCourseRow[];
}

export interface SkippedTrack {
  key: string;
  shortName: string;
  name: string;
  kind: TrackKind;
  reason: SkipReason;
}

export interface SyncPlan {
  rows: SyncTrackRow[];
  /** Real differences we deliberately won't act on. Surfaced once, never retried. */
  skipped: SkippedTrack[];
}

export interface SyncPlanOptions {
  /**
   * False on transports that cannot reach `/TRACKS/SPRINT`. The native IPC
   * currently drops the `kind` argument on get/put/delete, so a sprint write
   * would silently land among the circuit tracks.
   */
  supportsSprintTracks?: boolean;
  /**
   * Bytes one track file may occupy on this device — `deviceTrackBudget()` of
   * the firmware's capability (plan 0017).
   *
   * Omitted means "don't check", so a caller that doesn't know the firmware
   * keeps the pre-curation behaviour rather than guessing a limit and skipping
   * tracks that were fine.
   */
  trackBudgetBytes?: number;
}

/** The display name for an entry, preferring whichever side actually has one. */
function entryName(entry: MergedTrackEntry): string {
  return entry.trackName || entry.deviceLongName || entry.shortName;
}

function courseRows(entry: MergedTrackEntry, trackKey: string): SyncCourseRow[] {
  return entry.mergedCourses
    .filter((mc) => mc.status !== 'synced')
    .map((mc) => ({
      key: `${trackKey}::${mc.name}`,
      name: mc.name,
      // A course's kind follows its own shape, not the track's — the track is
      // uniform by construction (mixed ones are skipped above).
      kind: mc.appCourse
        ? isSprintCourse(mc.appCourse)
          ? ('sprint' as const)
          : ('circuit' as const)
        : entry.kind,
      needsRename: isDeviceGeneratedName(mc.name),
      direction: mc.status === 'device_only' ? ('download' as const) : ('upload' as const),
      appCourse: mc.appCourse,
      deviceCourse: mc.deviceCourse,
    }));
}

/**
 * Turn a merged track list into the rows a sync would act on.
 *
 * Rules, in the order they apply:
 *
 * - `synced` tracks are dropped — there is nothing to do, and offering them is
 *   how a "sync?" prompt becomes noise that fires on every connect.
 * - `app_only` tracks are offered **only when user-defined**. The two tracks
 *   this app ships are reference data; pushing them onto every logger that
 *   connects is not what "unknown tracks" meant.
 * - `device_only` tracks download.
 * - `mismatch` tracks upload, after their device-only courses are imported —
 *   so an edit made here wins, but a course walked on the device is never lost.
 * - Anything that could never converge is skipped with a reason instead.
 */
export function buildSyncPlan(
  merged: MergedTrackEntry[],
  options: SyncPlanOptions = {},
): SyncPlan {
  const { supportsSprintTracks = true } = options;
  const rows: SyncTrackRow[] = [];
  const skipped: SkippedTrack[] = [];

  for (const entry of merged) {
    if (entry.status === 'synced') continue;

    const key = `${entry.kind}:${entry.shortName}`;
    const name = entryName(entry);
    const skip = (reason: SkipReason) =>
      skipped.push({ key, shortName: entry.shortName, name, kind: entry.kind, reason });

    if (entry.kind === 'sprint' && !supportsSprintTracks) {
      skip('sprint_unsupported');
      continue;
    }

    if (entry.appTrack && isMixedKindTrack(entry.appTrack)) {
      skip('mixed_kind');
      continue;
    }

    // Count what the file would end up holding, not just what one side has —
    // and only the courses actually bound for the device. A sprint track keeps
    // its newest course by default, so counting every app course skipped an
    // eleven-course venue that would have fitted comfortably.
    const deviceOnlyCourses = entry.mergedCourses
      .filter((mc) => mc.status === 'device_only' && mc.deviceCourse)
      .map((mc) => mc.deviceCourse!);
    // Read the curation off the merge, but count `appCourses` — an `app_only`
    // entry carries no merged courses at all, and deriving the list from the
    // merge would silently count it as empty and wave through a track that
    // cannot fit. Anything the merge has no opinion on stays planned.
    const plannedByName = new Map(
      entry.mergedCourses
        .filter((mc) => mc.appCourse)
        .map((mc) => [mc.name, mc.plannedOnDevice ?? true] as const),
    );
    const plannedAppCourses = entry.appCourses.filter((c) => plannedByName.get(c.name) ?? true);
    const resultingCourseCount = plannedAppCourses.length + deviceOnlyCourses.length;
    if (resultingCourseCount > DEVICE_MAX_COURSES) {
      skip('too_many_courses');
      continue;
    }

    // Then the wall the count guard never saw: on the smaller buffer a sprint
    // track overflows below the course cap. Measured through the real writer,
    // over the courses the file would actually end up with.
    if (options.trackBudgetBytes != null && entry.appTrack) {
      const resulting = [...plannedAppCourses, ...deviceOnlyCourses.map(deviceCourseToAppCourse)];
      if (!fitsDeviceBudget(entry.appTrack, resulting, options.trackBudgetBytes)) {
        skip('too_many_bytes');
        continue;
      }
    }

    // The app's own reference tracks are not "unknown tracks the device is
    // missing" — they are things the user never asked to carry.
    if (entry.status === 'app_only' && !entry.appTrack?.isUserDefined) continue;

    rows.push({
      key,
      shortName: entry.shortName,
      name,
      kind: entry.kind,
      direction: entry.status === 'device_only' ? 'download' : 'upload',
      needsRename:
        isDeviceGeneratedName(name) || isDeviceGeneratedShortName(entry.shortName),
      deviceFileName: entry.deviceFileName,
      appTrack: entry.appTrack,
      deviceOnlyCourses,
      courses: courseRows(entry, key),
    });
  }

  return { rows, skipped };
}

/** True when a plan has anything worth interrupting the user for. */
export function planHasWork(plan: SyncPlan): boolean {
  return plan.rows.length > 0;
}

/** Rows whose names still need the user's attention, in wizard order. */
export function rowsNeedingRename(plan: SyncPlan): SyncTrackRow[] {
  return plan.rows.filter((r) => r.needsRename);
}
