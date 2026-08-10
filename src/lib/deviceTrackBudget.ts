/**
 * How many bytes of track file the logger can actually hold (plan 0017).
 *
 * The device reads a whole track file into a fixed buffer and parses it there.
 * One byte past that buffer and the read is cut mid-JSON: `deserializeJson`
 * fails, `buildTrackList()` adds no manifest entry, and **the track stops being
 * detected at the venue entirely** rather than merely losing its tail. So this
 * is a hard wall, and the cost of misjudging it is losing timing for the day.
 */

import { Course, Track } from '@/types/racing';
import { buildTrackJsonForUpload } from '@/lib/deviceTrackSync';

/**
 * `JSON_BUFFER_SIZE` on firmware from the release that raised it.
 * Clears the 10-course `MAX_LAYOUTS` cap for every course shape.
 */
export const DEVICE_TRACK_BYTES_LARGE = 8192;

/**
 * `JSON_BUFFER_SIZE` on earlier firmware.
 *
 * The firmware's own measurements put a sprint course with a finish line and
 * two splits at ~528 B, so a sprint track hits this wall at about SEVEN
 * courses — below the 10-course cap, which is why the cap alone never caught
 * it.
 */
export const DEVICE_TRACK_BYTES_SMALL = 4096;

/**
 * The byte budget for a device.
 *
 * Takes the capability boolean rather than a version, so nothing downstream of
 * `DeviceDetails` ever compares versions.
 */
export function deviceTrackBudget(supportsLargeTrackBuffer: boolean | undefined): number {
  return supportsLargeTrackBuffer ? DEVICE_TRACK_BYTES_LARGE : DEVICE_TRACK_BYTES_SMALL;
}

/**
 * Bytes the device would store for `track` carrying exactly `courses`.
 *
 * Measured, never estimated: this runs the real upload writer and the real
 * `TextEncoder`, which is what `putTrack` is handed. A per-course byte table
 * would drift the first time the writer changed, and the number this returns is
 * shown to the user as the reason they have to drop a course — it has to be the
 * number actually written.
 */
export function projectDeviceTrackBytes(track: Track, courses: readonly Course[]): number {
  return new TextEncoder().encode(
    buildTrackJsonForUpload({ ...track, courses: [...courses] }),
  ).length;
}

/** True when `courses` fit the device's buffer. */
export function fitsDeviceBudget(
  track: Track,
  courses: readonly Course[],
  budget: number,
): boolean {
  return projectDeviceTrackBytes(track, courses) <= budget;
}

/** Bytes over the budget, or 0 when it fits. For "drop N more" messaging. */
export function bytesOverBudget(
  track: Track,
  courses: readonly Course[],
  budget: number,
): number {
  return Math.max(0, projectDeviceTrackBytes(track, courses) - budget);
}
