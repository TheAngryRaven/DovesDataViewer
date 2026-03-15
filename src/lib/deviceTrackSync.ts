/**
 * Device Track Sync — Pure comparison/conversion logic.
 * Merges app tracks (from trackStorage) with device track files (from BLE)
 * and determines sync status per track and per course.
 */

import { Track, Course, SectorLine } from '@/types/racing';
import { haversineDistance } from '@/lib/parserUtils';

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
}

export interface DeviceTrackFile {
  shortName: string;              // filename without .json
  courses: DeviceCourseJson[];
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
  trackName?: string;              // full name from webapp (if known)
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

/** Compare an app Course with a device course JSON. */
export function coursesMatch(appCourse: Course, dc: DeviceCourseJson): boolean {
  // Compare start/finish
  if (!coordsEqual(appCourse.startFinishA.lat, dc.start_a_lat)) return false;
  if (!coordsEqual(appCourse.startFinishA.lon, dc.start_a_lng)) return false;
  if (!coordsEqual(appCourse.startFinishB.lat, dc.start_b_lat)) return false;
  if (!coordsEqual(appCourse.startFinishB.lon, dc.start_b_lng)) return false;

  // Compare sector 2
  const deviceS2 = sectorLineFromDevice(dc.sector_2_a_lat, dc.sector_2_a_lng, dc.sector_2_b_lat, dc.sector_2_b_lng);
  if (!!appCourse.sector2 !== !!deviceS2) return false;
  if (appCourse.sector2 && deviceS2) {
    if (!coordsEqual(appCourse.sector2.a.lat, deviceS2.a.lat)) return false;
    if (!coordsEqual(appCourse.sector2.a.lon, deviceS2.a.lon)) return false;
    if (!coordsEqual(appCourse.sector2.b.lat, deviceS2.b.lat)) return false;
    if (!coordsEqual(appCourse.sector2.b.lon, deviceS2.b.lon)) return false;
  }

  // Compare sector 3
  const deviceS3 = sectorLineFromDevice(dc.sector_3_a_lat, dc.sector_3_a_lng, dc.sector_3_b_lat, dc.sector_3_b_lng);
  if (!!appCourse.sector3 !== !!deviceS3) return false;
  if (appCourse.sector3 && deviceS3) {
    if (!coordsEqual(appCourse.sector3.a.lat, deviceS3.a.lat)) return false;
    if (!coordsEqual(appCourse.sector3.a.lon, deviceS3.a.lon)) return false;
    if (!coordsEqual(appCourse.sector3.b.lat, deviceS3.b.lat)) return false;
    if (!coordsEqual(appCourse.sector3.b.lon, deviceS3.b.lon)) return false;
  }

  return true;
}

// ─── Conversion ───────────────────────────────────────────────────────────────

/** Convert device course JSON to app Course */
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
  if (s2 && s3) {
    course.sector2 = s2;
    course.sector3 = s3;
  }

  return course;
}

/** Convert an app Course to device JSON format */
export function appCourseToDeviceJson(course: Course): DeviceCourseJson {
  const dc: DeviceCourseJson = {
    name: course.name,
    start_a_lat: course.startFinishA.lat,
    start_a_lng: course.startFinishA.lon,
    start_b_lat: course.startFinishB.lat,
    start_b_lng: course.startFinishB.lon,
  };

  if (course.sector2) {
    dc.sector_2_a_lat = course.sector2.a.lat;
    dc.sector_2_a_lng = course.sector2.a.lon;
    dc.sector_2_b_lat = course.sector2.b.lat;
    dc.sector_2_b_lng = course.sector2.b.lon;
  }
  if (course.sector3) {
    dc.sector_3_a_lat = course.sector3.a.lat;
    dc.sector_3_a_lng = course.sector3.a.lon;
    dc.sector_3_b_lat = course.sector3.b.lat;
    dc.sector_3_b_lng = course.sector3.b.lon;
  }

  return dc;
}

/** Build the full track JSON string the device expects (flat array of courses). */
export function buildTrackJsonForUpload(track: Track): string {
  const courses = track.courses.map(appCourseToDeviceJson);
  return JSON.stringify(courses, null, '\t');
}

/** Parse raw JSON string from device into course array. */
export function parseDeviceCourseJson(raw: string): DeviceCourseJson[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    console.error('Failed to parse device track JSON');
    return [];
  }
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
  const deviceByShortName = new Map(deviceFiles.map(df => [df.shortName, df]));
  const seenDeviceShortNames = new Set<string>();

  // Process app tracks first (ones with shortName)
  for (const track of appTracks) {
    const sn = track.shortName;
    if (!sn) continue; // Skip tracks without shortName — can't match to device

    const df = deviceByShortName.get(sn);
    if (df) {
      seenDeviceShortNames.add(sn);
      const mergedCourses = buildMergedCourses(track.courses, df.courses);
      const allSynced = mergedCourses.every(c => c.status === 'synced');
      entries.push({
        shortName: sn,
        trackName: track.name,
        status: allSynced ? 'synced' : 'mismatch',
        appTrack: track,
        appCourses: track.courses,
        deviceCourses: df.courses,
        mergedCourses,
      });
    } else {
      entries.push({
        shortName: sn,
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
    if (!seenDeviceShortNames.has(df.shortName)) {
      entries.push({
        shortName: df.shortName,
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

/** Count sectors in an app course. */
export function countAppSectors(course: Course): number {
  if (course.sector2 && course.sector3) return 3;
  if (course.sector2) return 2;
  return 0;
}

/** Distance in meters between start_a points of two courses. */
export function startADistance(appCourse: Course, dc: DeviceCourseJson): number {
  return haversineDistance(
    appCourse.startFinishA.lat, appCourse.startFinishA.lon,
    dc.start_a_lat, dc.start_a_lng
  );
}
