/**
 * The exact work a sync will do, as data.
 *
 * Separating "what to do" from "doing it" is what makes the risky part
 * testable: the ordering below is the difference between a failed sync you can
 * recover from and one that loses a track. The async runner just walks this
 * list.
 */

import type { TrackKind } from '@/lib/ble/trackOpcodes';
import type { Course, Track } from '@/types/racing';
import {
  appCourseToDeviceJson,
  deviceCourseToAppCourse,
  serializeDeviceTrackFile,
  type DeviceCourseJson,
} from '@/lib/deviceTrackSync';
import type { SyncTrackRow } from '@/lib/deviceSyncPlan';
import {
  NO_OVERRIDES,
  selectedDeviceCourses,
  type TrackCourseOverrides,
} from '@/lib/deviceCourseSelection';

/** A track row plus the names the user settled on for it. */
export interface SyncResolution {
  row: SyncTrackRow;
  /** Final track long name. */
  name: string;
  /** Final short name — becomes the device filename base. */
  shortName: string;
  /** Final course names by course-row key. Courses absent here keep their name. */
  courseNames?: Record<string, string>;
}

export type SyncOperation =
  /** Write the whole track file to the device. */
  | { type: 'device_put'; trackKey: string; folder: TrackKind; fileName: string; json: string }
  /** Remove the file the track used to live in, after a rename. */
  | { type: 'device_delete'; trackKey: string; folder: TrackKind; fileName: string }
  /** Store the track locally under its final name. */
  | { type: 'app_put'; trackKey: string; track: Track }
  /** Drop the local track's old name, after a rename. */
  | { type: 'app_delete'; trackKey: string; trackName: string };

/** Rename a course if the user gave it a new name, else keep what it had. */
function finalCourseName(
  resolution: SyncResolution,
  trackKey: string,
  currentName: string,
): string {
  const key = `${trackKey}::${currentName}`;
  return resolution.courseNames?.[key]?.trim() || currentName;
}

/**
 * Every course the track ends up with: the app's, plus anything walked on the
 * device that the app doesn't have yet.
 *
 * Device-only courses are always imported rather than overwritten. An upload is
 * "the app's version wins for edits", not "throw away what was recorded in the
 * field" — that would quietly destroy the exact thing this flow exists to
 * rescue.
 */
function finalCourses(resolution: SyncResolution): Course[] {
  const { row } = resolution;
  const fromApp = (row.appTrack?.courses ?? []).map((c) => ({
    ...c,
    name: finalCourseName(resolution, row.key, c.name),
  }));
  const seen = new Set(fromApp.map((c) => c.name));
  const fromDevice = row.deviceOnlyCourses
    .map((dc) => ({
      ...deviceCourseToAppCourse(dc),
      name: finalCourseName(resolution, row.key, dc.name),
    }))
    // A rename can collide with an existing app course; the app's copy wins,
    // since it is the one that may carry sub-sectors the device can't hold.
    .filter((c) => !seen.has(c.name));
  return [...fromApp, ...fromDevice];
}

function deviceCoursesFor(courses: Course[]): DeviceCourseJson[] {
  return courses.map(appCourseToDeviceJson);
}

/**
 * Turn resolved rows into an ordered operation list.
 *
 * **Order is the whole point.** Per track: write the new file, then delete the
 * old one, then update local storage.
 *
 * - *Put before delete* so a failure between them leaves the track on the card
 *   twice — annoying, and the next sync reconciles it — rather than leaving it
 *   nowhere. Delete-first would lose a field recording to a dropped BLE packet.
 * - *Device before app* so a failure after the write leaves the device holding
 *   a correctly-named file and the app holding nothing: the next connect offers
 *   it as a plain download with no rename needed. The reverse order strands a
 *   renamed app track next to its old device file, and the user sees the same
 *   track twice.
 */
export function planOperations(
  resolutions: SyncResolution[],
  overridesFor: (kind: TrackKind, shortName: string) => TrackCourseOverrides =
    () => NO_OVERRIDES,
): SyncOperation[] {
  const ops: SyncOperation[] = [];

  for (const resolution of resolutions) {
    const { row } = resolution;
    const name = resolution.name.trim();
    const shortName = resolution.shortName.trim();
    const courses = finalCourses(resolution);
    const fileName = `${shortName}.json`;

    // The app keeps every course; the DEVICE gets the subset (plan 0017). Two
    // deliberately different lists — writing `courses` to the card is what made
    // accepting the wizard silently undo the user's curation and put the file
    // straight back over the firmware's parse buffer.
    //
    // A renamed track or course falls back to the default rule, since the
    // overrides are keyed by names it no longer has. That is the safe
    // direction: the default keeps a sprint track's newest course only.
    const deviceCourses = selectedDeviceCourses(courses, overridesFor(row.kind, shortName));

    ops.push({
      type: 'device_put',
      trackKey: row.key,
      folder: row.kind,
      fileName,
      json: serializeDeviceTrackFile({
        longName: name,
        shortName,
        type: row.kind,
        defaultCourse: deviceCourses[0]?.name ?? '',
        courses: deviceCoursesFor(deviceCourses),
      }),
    });

    // Only when the file actually moved. Comparing case-insensitively because
    // the card is FAT: "OKC.json" and "okc.json" are the same file, and
    // "deleting the old one" would delete the one just written.
    if (row.deviceFileName && row.deviceFileName.toLowerCase() !== fileName.toLowerCase()) {
      ops.push({
        type: 'device_delete',
        trackKey: row.key,
        folder: row.kind,
        fileName: row.deviceFileName,
      });
    }

    ops.push({
      type: 'app_put',
      trackKey: row.key,
      track: { name, shortName, courses, isUserDefined: true },
    });

    // Local storage keys tracks by name, so a rename is a new entry — the old
    // one has to go or the user ends up with both.
    const previousName = row.appTrack?.name;
    if (previousName && previousName !== name) {
      ops.push({ type: 'app_delete', trackKey: row.key, trackName: previousName });
    }
  }

  return ops;
}
