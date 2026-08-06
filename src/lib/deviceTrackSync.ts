/**
 * Device Track Sync — Pure comparison/conversion logic.
 * Merges app tracks (from trackStorage) with device track files (from BLE)
 * and determines sync status per track and per course.
 */

import { Track, Course, CourseSector, SectorLine, isSprintCourse } from '@/types/racing';
import type { TrackKind } from '@/lib/ble/trackOpcodes';
import { haversineDistance } from '@/lib/parserUtils';
import { legacyMirror, majorSectorLines, normalizeCourseSectors } from '@/lib/courseSectors';
import { deriveShortName } from '@/lib/trackUtils';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Raw course format used by the datalogger device JSON files */
export interface DeviceCourseJson {
  name: string;
  lengthFt?: number;
  start_a_lat: number;
  start_a_lng: number;
  start_b_lat: number;
  start_b_lng: number;
  sector_2_a_lat?: number;
  sector_2_a_lng?: number;
  sector_2_b_lat?: number;
  sector_2_b_lng?: number;
  sector_3_a_lat?: number;
  sector_3_a_lng?: number;
  sector_3_b_lat?: number;
  sector_3_b_lng?: number;
  /**
   * Sprint only, required there: the separate finish line. Circuit courses omit
   * these — start and finish are the same line.
   * See `docs/plans/0015-sprint-mode.md`.
   */
  finish_a_lat?: number;
  finish_a_lng?: number;
  finish_b_lat?: number;
  finish_b_lng?: number;
  /**
   * Sprint only: sortable `YYYY-MM-DDTHH:MM` stamp. The logger picks the newest
   * course by a plain STRING compare of this field, so the zero-padded shape is
   * load-bearing.
   */
  date_created?: string;
}

export interface DeviceTrackFile {
  /**
   * The track's IDENTITY — what the merge keys on, matched against app
   * `Track.shortName`. Prefer the file's declared `shortName`; fall back to the
   * filename base for legacy bare-array files that declare nothing.
   *
   * This is NOT necessarily the filename. For a track the on-device course
   * creator wrote they differ: `N260803_1432.json` declares `shortName:
   * "08031432"`. Keying on the filename there meant the imported track could
   * never match its own device file again, so the sync re-offered it forever.
   */
  shortName: string;
  /**
   * Where the track LIVES on the device — the actual `*.json` to overwrite or
   * delete. Absent for entries that exist only in the app.
   */
  fileName?: string;
  courses: DeviceCourseJson[];
  /**
   * `longName` out of the object wrapper, when the file had one. Distinct from
   * `shortName` above, which is the FILENAME base — for a track the on-device
   * course creator wrote those differ (`N260803_1432.json` carrying
   * `shortName: "08031432"`), and the rename flow needs the human-facing one.
   */
  longName?: string;
  /**
   * Which folder this file came out of. Circuit (`/TRACKS`) and sprint
   * (`/TRACKS/SPRINT`) are separate namespaces on the device, so the same
   * shortName can legitimately exist in both — the kind is part of a file's
   * identity, not a property of its contents.
   */
  kind?: TrackKind;
}

export type TrackSyncStatus =
  | 'synced'       // all courses match
  | 'mismatch'     // track exists on both but courses differ
  | 'device_only'  // track on device but not in webapp
  | 'app_only';    // track in webapp but not on device

export type CourseSyncStatus =
  | 'synced'
  | 'mismatch'
  | 'device_only'
  | 'app_only';

export interface MergedCourseEntry {
  name: string;
  status: CourseSyncStatus;
  appCourse?: Course;
  deviceCourse?: DeviceCourseJson;
}

export interface MergedTrackEntry {
  shortName: string;
  /** Circuit or sprint. Entries are keyed on (kind, shortName), never shortName alone. */
  kind: TrackKind;
  trackName?: string;              // full name from webapp (if known)
  /** `longName` the device file carries, when it has one. */
  deviceLongName?: string;
  /**
   * The device file backing this entry. Absent for `app_only`. Always write and
   * delete through this, never `shortName + '.json'` — see `DeviceTrackFile`.
   */
  deviceFileName?: string;
  status: TrackSyncStatus;
  appTrack?: Track;
  appCourses: Course[];
  deviceCourses: DeviceCourseJson[];
  mergedCourses: MergedCourseEntry[];
}

// ─── Coordinate Comparison ────────────────────────────────────────────────────

const COORD_EPSILON = 0.0000005; // ~0.05m at equator

function coordsEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < COORD_EPSILON;
}

function sectorLineFromDevice(
  aLat?: number, aLng?: number, bLat?: number, bLng?: number
): SectorLine | undefined {
  if (aLat != null && aLng != null && bLat != null && bLng != null) {
    return { a: { lat: aLat, lon: aLng }, b: { lat: bLat, lon: bLng } };
  }
  return undefined;
}

function sectorLinesEqual(a?: SectorLine, b?: SectorLine): boolean {
  if (!!a !== !!b) return false;
  if (!a || !b) return true;
  return (
    coordsEqual(a.a.lat, b.a.lat) &&
    coordsEqual(a.a.lon, b.a.lon) &&
    coordsEqual(a.b.lat, b.b.lat) &&
    coordsEqual(a.b.lon, b.b.lon)
  );
}

/**
 * The two timing lines this course projects into the device's `sector_2_*` /
 * `sector_3_*` slots.
 *
 * Circuit takes the two flagged majors (app-only sub-sectors are never sent).
 * Sprint takes its split lines positionally — `major` is meaningless
 * point-to-point, so sprint splits are stored unflagged and `legacyMirror`
 * would drop them.
 */
function deviceSectorProjection(course: Course): { sector2?: SectorLine; sector3?: SectorLine } {
  if (isSprintCourse(course)) {
    const splits = course.sectors ?? [];
    return { sector2: splits[0]?.line, sector3: splits[1]?.line };
  }
  return legacyMirror(normalizeCourseSectors(course));
}

/**
 * Compare an app Course with a device course JSON. Only the device-visible
 * projection is compared — app-only sub-sectors never flag a mismatch, since
 * they're never sent to the device.
 *
 * For sprint courses that projection also covers the finish line and
 * `date_created`: without them a moved finish line — the single most likely
 * edit to a sprint course — would read as "synced".
 */
export function coursesMatch(appCourse: Course, dc: DeviceCourseJson): boolean {
  // Compare start/finish
  if (!coordsEqual(appCourse.startFinishA.lat, dc.start_a_lat)) return false;
  if (!coordsEqual(appCourse.startFinishA.lon, dc.start_a_lng)) return false;
  if (!coordsEqual(appCourse.startFinishB.lat, dc.start_b_lat)) return false;
  if (!coordsEqual(appCourse.startFinishB.lon, dc.start_b_lng)) return false;

  // A course that changed kind is never a match, whichever way it went: the
  // device stores the two kinds in different folders, so this is a different
  // file, not an edit.
  const deviceIsSprint = dc.finish_a_lat != null;
  if (isSprintCourse(appCourse) !== deviceIsSprint) return false;

  if (deviceIsSprint) {
    const deviceFinish = sectorLineFromDevice(
      dc.finish_a_lat, dc.finish_a_lng, dc.finish_b_lat, dc.finish_b_lng,
    );
    if (!sectorLinesEqual(appCourse.finish, deviceFinish)) return false;
    if ((appCourse.dateCreated ?? undefined) !== (dc.date_created ?? undefined)) return false;
  }

  // Compare the projected sector lines against the device's two sector slots.
  const { sector2, sector3 } = deviceSectorProjection(appCourse);
  const deviceS2 = sectorLineFromDevice(dc.sector_2_a_lat, dc.sector_2_a_lng, dc.sector_2_b_lat, dc.sector_2_b_lng);
  const deviceS3 = sectorLineFromDevice(dc.sector_3_a_lat, dc.sector_3_a_lng, dc.sector_3_b_lat, dc.sector_3_b_lng);

  return sectorLinesEqual(sector2, deviceS2) && sectorLinesEqual(sector3, deviceS3);
}

// ─── Conversion ───────────────────────────────────────────────────────────────

/**
 * Convert device course JSON to app Course. The device's two sector lines become
 * the course's two major sectors (the only sectors the device knows about).
 */
export function deviceCourseToAppCourse(dc: DeviceCourseJson): Course {
  const course: Course = {
    name: dc.name,
    lengthFt: dc.lengthFt,
    startFinishA: { lat: dc.start_a_lat, lon: dc.start_a_lng },
    startFinishB: { lat: dc.start_b_lat, lon: dc.start_b_lng },
    isUserDefined: true,
  };

  const s2 = sectorLineFromDevice(dc.sector_2_a_lat, dc.sector_2_a_lng, dc.sector_2_b_lat, dc.sector_2_b_lng);
  const s3 = sectorLineFromDevice(dc.sector_3_a_lat, dc.sector_3_a_lng, dc.sector_3_b_lat, dc.sector_3_b_lng);

  // A finish line is what makes it a sprint course — the device only ever emits
  // these four fields for tracks out of /TRACKS/SPRINT.
  const finish = sectorLineFromDevice(dc.finish_a_lat, dc.finish_a_lng, dc.finish_b_lat, dc.finish_b_lng);
  if (finish) {
    course.type = 'sprint';
    course.finish = finish;
    if (dc.date_created) course.dateCreated = dc.date_created;
    // Splits are positional and unflagged: `major` has no meaning in a run, and
    // flagging them would let a retype-to-circuit silently look like a valid
    // three-major layout it never had.
    const splits: CourseSector[] = [];
    if (s2) splits.push({ line: s2, major: false });
    if (s3) splits.push({ line: s3, major: false });
    if (splits.length > 0) course.sectors = splits;
    return course;
  }

  if (s2 && s3) {
    course.sector2 = s2;
    course.sector3 = s3;
  }

  return normalizeCourseSectors(course);
}

/**
 * Convert an app Course to device JSON. Projects the course's three major
 * sectors down to start/finish + the two legacy sector lines — byte-identical to
 * the pre-overhaul output. App-only sub-sectors are intentionally dropped.
 */
export function appCourseToDeviceJson(course: Course): DeviceCourseJson {
  const dc: DeviceCourseJson = {
    name: course.name,
    start_a_lat: course.startFinishA.lat,
    start_a_lng: course.startFinishA.lon,
    start_b_lat: course.startFinishB.lat,
    start_b_lng: course.startFinishB.lon,
  };

  if (course.lengthFt != null) {
    dc.lengthFt = course.lengthFt;
  }

  const { sector2, sector3 } = deviceSectorProjection(course);
  if (sector2) {
    dc.sector_2_a_lat = sector2.a.lat;
    dc.sector_2_a_lng = sector2.a.lon;
    dc.sector_2_b_lat = sector2.b.lat;
    dc.sector_2_b_lng = sector2.b.lon;
  }
  if (sector3) {
    dc.sector_3_a_lat = sector3.a.lat;
    dc.sector_3_a_lng = sector3.a.lon;
    dc.sector_3_b_lat = sector3.b.lat;
    dc.sector_3_b_lng = sector3.b.lon;
  }

  if (isSprintCourse(course) && course.finish) {
    dc.finish_a_lat = course.finish.a.lat;
    dc.finish_a_lng = course.finish.a.lon;
    dc.finish_b_lat = course.finish.b.lat;
    dc.finish_b_lng = course.finish.b.lon;
    if (course.dateCreated) dc.date_created = course.dateCreated;
  }

  return dc;
}

/**
 * The object-form track file, as the firmware writes it and parses it back
 * (`BirdsEye/sd_functions.ino` `parseTrackFile()`).
 *
 * Everything outside `courses` is optional because the legacy bare-array shape
 * carries none of it — the firmware blanks all four fields for an array file.
 */
export interface DeviceTrackFileJson {
  longName?: string;
  shortName?: string;
  /** `"sprint"` marks a sprint track. The folder is authoritative; this is a hint. */
  type?: string;
  defaultCourse?: string;
  courses: DeviceCourseJson[];
}

/**
 * Build the full track JSON string the device expects.
 *
 * Emits the **object** form. This used to emit a bare array, which the firmware
 * still parses — but its array branch explicitly blanks `longName`, `shortName`
 * and `defaultCourse`, and every course then falls back to `lengthFt = 0`. That
 * costs real behaviour on the device: `lengthFt` is what CourseDetector ranks
 * courses by, so an array-uploaded track could never be detected and dropped
 * straight to Lap Anything, and the blank `shortName` reached the DOVEX header's
 * `short_name` column. The object form is what the app's own track files and the
 * on-device course creator already write, so nothing new is being asked of the
 * firmware — the array writer was simply lossy.
 */
export function buildTrackJsonForUpload(track: Track): string {
  return serializeDeviceTrackFile({
    longName: track.name,
    // Never emit an empty shortName: it lands in the log header, and it is the
    // key this app's own merge uses to recognise the file on the next connect.
    shortName: track.shortName || deriveShortName(track.name),
    type: trackKind(track),
    defaultCourse: track.courses[0]?.name ?? '',
    courses: track.courses.map(appCourseToDeviceJson),
  });
}

/** Serialize an object-form track file the way the device expects it. */
export function serializeDeviceTrackFile(file: DeviceTrackFileJson): string {
  return JSON.stringify(file, null, '\t');
}

/**
 * Rebuild an existing device file around a new course list, keeping its wrapper
 * metadata intact.
 *
 * Callers that edit a single course used to re-serialize the course array on its
 * own, which quietly stripped `longName`/`shortName`/`defaultCourse` off the file
 * and reset every `lengthFt` — the same loss the bare-array uploader caused, just
 * reached from a different button.
 */
export function rebuildDeviceTrackJson(
  entry: Pick<MergedTrackEntry, 'deviceLongName' | 'trackName' | 'shortName' | 'kind'>,
  courses: DeviceCourseJson[],
): string {
  return serializeDeviceTrackFile({
    longName: entry.deviceLongName || entry.trackName || entry.shortName,
    shortName: entry.shortName,
    type: entry.kind,
    defaultCourse: courses[0]?.name ?? '',
    courses,
  });
}

/**
 * Parse a track JSON file pulled off the device, keeping the wrapper metadata.
 *
 * BOTH on-disk shapes are accepted, matching the firmware's own
 * `parseTrackFile()`:
 *
 * - **object** — `{longName, shortName, type, defaultCourse, courses:[…]}`,
 *   the format this app's track files use and the one the **on-device course
 *   creator writes**.
 * - **bare array** — `[{…course…}]`, the legacy shape, and still what
 *   `buildTrackJsonForUpload` sends.
 *
 * Accepting only the array was a silent data-loss bug the moment the device
 * could author a track itself: the object parses fine, isn't an array, and
 * fell through to `[]` — so a walked course synced back as a track with no
 * courses at all, with nothing logged to say why.
 */
export function parseDeviceTrackFile(raw: string): DeviceTrackFileJson | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error('Failed to parse device track JSON');
    return null;
  }

  // Legacy bare array: courses only, no metadata to recover.
  if (Array.isArray(parsed)) return { courses: parsed as DeviceCourseJson[] };

  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    const courses = Array.isArray(obj.courses) ? (obj.courses as DeviceCourseJson[]) : [];
    const str = (v: unknown): string | undefined =>
      typeof v === 'string' && v !== '' ? v : undefined;
    // A well-formed object with no course list is a real (if empty) track —
    // distinct from unparseable, so don't shout about it.
    return {
      longName: str(obj.longName),
      shortName: str(obj.shortName),
      type: str(obj.type),
      defaultCourse: str(obj.defaultCourse),
      courses,
    };
  }

  console.error('Device track JSON is neither a course array nor a track object');
  return null;
}

/**
 * Turn one file pulled off the device into a merge-ready `DeviceTrackFile`.
 *
 * This owns the identity rule: a track is keyed by the `shortName` it declares,
 * and only falls back to the filename base when it declares none (legacy
 * bare-array files). Keeping that here rather than at the call site is the
 * point — it is the rule that decides whether an imported track ever matches
 * its own device file again.
 */
export function deviceTrackFileFrom(
  fileName: string,
  raw: string,
  kind: TrackKind,
): DeviceTrackFile {
  const base = fileName.replace(/\.json$/i, '');
  const parsed = parseDeviceTrackFile(raw);
  return {
    shortName: parsed?.shortName || base,
    fileName,
    longName: parsed?.longName,
    courses: parsed?.courses ?? [],
    kind,
  };
}

/**
 * Course array only — the shape most callers want. See `parseDeviceTrackFile`
 * for the wrapper metadata (`longName` / `shortName`), which the rename flow
 * needs and which this deliberately drops.
 */
export function parseDeviceCourseJson(raw: string): DeviceCourseJson[] {
  return parseDeviceTrackFile(raw)?.courses ?? [];
}

// ─── Track kind ───────────────────────────────────────────────────────────────

/**
 * Which device folder a track belongs in.
 *
 * A track file on the device is wholly one kind — it lives in `/TRACKS` or in
 * `/TRACKS/SPRINT`, never both — so the kind is derived from the courses it
 * carries. Any sprint course makes the whole track sprint.
 */
export function trackKind(track: Pick<Track, 'courses'>): TrackKind {
  return track.courses.some(isSprintCourse) ? 'sprint' : 'circuit';
}

/**
 * True when a track carries both circuit and sprint courses.
 *
 * This cannot be represented on the device: the two kinds are separate files in
 * separate folders, so such a track would have to be split. Callers surface it
 * rather than silently pushing half the courses — the editor has no way to
 * create one today, but a cloud-synced or hand-edited track could be.
 */
export function isMixedKindTrack(track: Pick<Track, 'courses'>): boolean {
  const sprint = track.courses.filter(isSprintCourse).length;
  return sprint > 0 && sprint < track.courses.length;
}

// ─── Merge Logic ──────────────────────────────────────────────────────────────

/** Build merged course list for a single track. */
function buildMergedCourses(
  appCourses: Course[],
  deviceCourses: DeviceCourseJson[]
): MergedCourseEntry[] {
  const entries: MergedCourseEntry[] = [];
  const deviceByName = new Map(deviceCourses.map(dc => [dc.name, dc]));
  const seenDeviceNames = new Set<string>();

  // Process app courses first
  for (const ac of appCourses) {
    const dc = deviceByName.get(ac.name);
    if (dc) {
      seenDeviceNames.add(ac.name);
      entries.push({
        name: ac.name,
        status: coursesMatch(ac, dc) ? 'synced' : 'mismatch',
        appCourse: ac,
        deviceCourse: dc,
      });
    } else {
      entries.push({ name: ac.name, status: 'app_only', appCourse: ac });
    }
  }

  // Device-only courses
  for (const dc of deviceCourses) {
    if (!seenDeviceNames.has(dc.name)) {
      entries.push({ name: dc.name, status: 'device_only', deviceCourse: dc });
    }
  }

  return entries;
}

/** Build merged track list from app tracks and device files. */
export function buildMergedTrackList(
  appTracks: Track[],
  deviceFiles: DeviceTrackFile[]
): MergedTrackEntry[] {
  const entries: MergedTrackEntry[] = [];
  // Keyed on (kind, shortName): the device keeps circuit and sprint tracks in
  // different folders, so "OKC" in each is two distinct files. Keying on the
  // short name alone would collide them and report one as a mismatch of the
  // other.
  const key = (kind: TrackKind, shortName: string) => `${kind}:${shortName}`;
  const deviceByKey = new Map(deviceFiles.map(df => [key(df.kind ?? 'circuit', df.shortName), df]));
  const seenDeviceKeys = new Set<string>();

  // Process app tracks first (ones with shortName)
  for (const track of appTracks) {
    const sn = track.shortName;
    if (!sn) continue; // Skip tracks without shortName — can't match to device

    const kind = trackKind(track);
    const df = deviceByKey.get(key(kind, sn));
    if (df) {
      seenDeviceKeys.add(key(kind, sn));
      const mergedCourses = buildMergedCourses(track.courses, df.courses);
      const allSynced = mergedCourses.every(c => c.status === 'synced');
      entries.push({
        shortName: sn,
        kind,
        trackName: track.name,
        deviceLongName: df.longName,
        deviceFileName: df.fileName ?? `${df.shortName}.json`,
        status: allSynced ? 'synced' : 'mismatch',
        appTrack: track,
        appCourses: track.courses,
        deviceCourses: df.courses,
        mergedCourses,
      });
    } else {
      entries.push({
        shortName: sn,
        kind,
        trackName: track.name,
        status: 'app_only',
        appTrack: track,
        appCourses: track.courses,
        deviceCourses: [],
        mergedCourses: track.courses.map(c => ({
          name: c.name,
          status: 'app_only' as CourseSyncStatus,
          appCourse: c,
        })),
      });
    }
  }

  // Device-only tracks
  for (const df of deviceFiles) {
    const dfKind = df.kind ?? 'circuit';
    if (!seenDeviceKeys.has(key(dfKind, df.shortName))) {
      entries.push({
        shortName: df.shortName,
        kind: dfKind,
        deviceLongName: df.longName,
        deviceFileName: df.fileName ?? `${df.shortName}.json`,
        status: 'device_only',
        appCourses: [],
        deviceCourses: df.courses,
        mergedCourses: df.courses.map(dc => ({
          name: dc.name,
          status: 'device_only' as CourseSyncStatus,
          deviceCourse: dc,
        })),
      });
    }
  }

  // Sort: app tracks first, then device-only
  entries.sort((a, b) => {
    const order: Record<TrackSyncStatus, number> = { synced: 0, mismatch: 1, app_only: 2, device_only: 3 };
    return order[a.status] - order[b.status];
  });

  return entries;
}

// ─── Diff Helpers ─────────────────────────────────────────────────────────────

/** Count sectors in a device course (0, 2, or 3 — sector 1 is implicit start→s2). */
export function countDeviceSectors(dc: DeviceCourseJson): number {
  const hasS2 = dc.sector_2_a_lat != null;
  const hasS3 = dc.sector_3_a_lat != null;
  if (hasS2 && hasS3) return 3;
  if (hasS2) return 2;
  return 0;
}

/** Count device-visible sectors in an app course (0, 2, or 3 — majors only). */
export function countAppSectors(course: Course): number {
  const majors = majorSectorLines(normalizeCourseSectors(course)).length;
  if (majors >= 2) return 3;
  if (majors === 1) return 2;
  return 0;
}

/** Distance in meters between start_a points of two courses. */
export function startADistance(appCourse: Course, dc: DeviceCourseJson): number {
  return haversineDistance(
    appCourse.startFinishA.lat, appCourse.startFinishA.lon,
    dc.start_a_lat, dc.start_a_lng
  );
}
