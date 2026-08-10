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
import { compareVersions } from '@/lib/ble/dfu/firmwareManifest';

/**
 * First firmware release whose track JSON buffer is
 * {@link DEVICE_TRACK_BYTES_LARGE}. Everything at or below `3.1.0` — the last
 * release before this one — parses tracks in half that.
 */
export const TRACK_BUFFER_MIN_VERSION = '3.2.0';

/**
 * Whether this firmware has the larger track buffer.
 *
 * The ONE place a firmware version is turned into this capability; everything
 * downstream takes the boolean. Mirrors `needsOtaLayoutUpgrade`.
 *
 * **An unknown version returns `false`, which is the opposite of what
 * `needsOtaLayoutUpgrade` does with one — deliberately.** That function must
 * never nag a user without certainty, so uncertainty means "don't". Here
 * uncertainty must never overfill a card, because a track file past the buffer
 * is not a degraded track: it fails to parse, gets no manifest entry, and
 * stops being detected at the venue. So uncertainty means "assume the smaller
 * buffer" — at worst the user keeps one course fewer than they could have.
 *
 * `compareVersions` ignores prerelease suffixes, so a beta build stamped
 * `3.2.0-beta.<sha>` counts as `3.2.0` and reads as capable.
 */
export function supportsLargeTrackBuffer(version: string | null | undefined): boolean {
  if (!version) return false;
  return compareVersions(version, TRACK_BUFFER_MIN_VERSION) >= 0;
}

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
