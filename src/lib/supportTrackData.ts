/**
 * Track data for support attachments (plan 0019).
 *
 * A datalog on its own is only half a bug report: lap times, sector splits and
 * course detection all depend on the *track* the session was analysed against —
 * user-drawn start/finish lines, sector lines, layout outlines — and that lives
 * in the user's localStorage, not in the file. Without it a "my laps are wrong"
 * report is impossible to reproduce.
 *
 * So the in-session help button ships the session's track alongside its datalog:
 * this module builds the JSON bundle (pure, testable) and fetches the track from
 * storage for the dialog. Nothing here touches Supabase — the bundle rides the
 * existing `submit-message` multipart attachment path (plan 0013).
 */

import type { Course, Track } from '@/types/racing';
import { normalizeCourseSectors } from '@/lib/courseSectors';
import { getTrack } from '@/lib/trackStorage';
import { sanitizeReportFileName } from '@/lib/parseReport';
import { buildInfo } from '@/lib/buildInfo';

/** Bundle discriminator — lets a future importer recognise the file. */
export const SUPPORT_TRACK_KIND = 'lapwing-support-track';

/** Bump when the shape changes incompatibly. */
export const SUPPORT_TRACK_VERSION = 1;

export interface SupportTrackBundle {
  kind: typeof SUPPORT_TRACK_KIND;
  version: number;
  /** The datalog this track belongs to — pairs the two attachments up. */
  sessionFile: string;
  trackName: string;
  /** The course the session was analysed against, when one was selected. */
  courseName: string | null;
  /** App version that produced the bundle (helps date the geometry). */
  appVersion: string;
  /**
   * The stored track, sectors normalized (legacy `sector2`/`sector3` folded
   * into the canonical list) so support reads one model.
   */
  track: Track;
  /**
   * The exact course object the session used. Usually the matching entry in
   * `track.courses`, but kept separate: the session can hold a course that was
   * since edited or deleted locally, and that discrepancy is often the bug.
   */
  course: Course | null;
}

export interface SupportTrackInput {
  sessionFileName: string;
  trackName: string;
  /** Track as stored locally (defaults + user overlay merged). */
  track: Track | undefined;
  /** Course in use by the loaded session, if any. */
  course?: Course | null;
  appVersion?: string;
}

/**
 * Build the bundle. Returns null when there is no track to send — a session
 * loaded in waypoint mode (no track matched) has nothing to attach.
 */
export function buildSupportTrackBundle(input: SupportTrackInput): SupportTrackBundle | null {
  if (!input.track && !input.course) return null;

  const track: Track = input.track
    ? { ...input.track, courses: input.track.courses.map(normalizeCourseSectors) }
    : { name: input.trackName, courses: [] };

  return {
    kind: SUPPORT_TRACK_KIND,
    version: SUPPORT_TRACK_VERSION,
    sessionFile: input.sessionFileName,
    trackName: input.trackName,
    courseName: input.course?.name ?? null,
    appVersion: input.appVersion ?? buildInfo.version,
    track,
    course: input.course ? normalizeCourseSectors(input.course) : null,
  };
}

/**
 * Attachment filename: the datalog's name with a `.track.json` suffix, so the
 * pair is obvious in the admin list and on disk.
 */
export function supportTrackFileName(sessionFileName: string): string {
  const base = sanitizeReportFileName(sessionFileName).replace(/\.[^.]+$/, '') || 'session';
  return `${base}.track.json`;
}

/** Serialize a bundle to the blob the multipart upload carries. */
export function supportTrackBlob(bundle: SupportTrackBundle): Blob {
  return new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
}

/**
 * Collect the loaded session's track straight from storage — the async half,
 * called lazily on submit so opening the dialog reads nothing.
 */
export async function collectSessionTrackAttachment(input: {
  sessionFileName: string;
  trackName?: string | null;
  course?: Course | null;
}): Promise<{ blob: Blob; name: string } | null> {
  if (!input.trackName) return null;
  const track = await getTrack(input.trackName).catch(() => undefined);
  const bundle = buildSupportTrackBundle({
    sessionFileName: input.sessionFileName,
    trackName: input.trackName,
    track,
    course: input.course ?? null,
  });
  if (!bundle) return null;
  return { blob: supportTrackBlob(bundle), name: supportTrackFileName(input.sessionFileName) };
}
