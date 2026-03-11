/**
 * Course Detection Module
 *
 * Automatic course identification, direction detection, and waypoint mode fallback.
 *
 * Algorithm (batch, post-parse):
 * 1. Find first GPS sample within 5 miles of any known track → identify track
 * 2. Try each course's S/F line → calculate laps
 * 3. Compare average lap distance (in feet) to course lengthFt
 * 4. Pick closest match within 25% tolerance
 * 5. If no match: fall back to waypoint mode
 *
 * Direction Detection (sector-based):
 * - After S/F crossing, check which sector is crossed first
 * - Sector 2 first → forward; Sector 3 first → reverse
 *
 * Waypoint Mode:
 * - Drop waypoint when vehicle first hits 30 MPH
 * - Track returns to waypoint for rough lap timing
 * - Divide lap distance by 3 for approximate sectors
 */

import { GpsSample, Track, Course, Lap, CourseDirection, CourseDetectionResult, courseHasSectors } from '@/types/racing';
import { calculateLaps } from './lapCalculation';
import { findNearestTrack } from './trackUtils';
import { haversineDistance } from './parserUtils';

// 5 miles in meters
const TRACK_SEARCH_RADIUS_M = 8047;

// Speed threshold for waypoint drop (MPH)
const WAYPOINT_SPEED_THRESHOLD_MPH = 30;

// Distance thresholds for waypoint mode
const WAYPOINT_RETURN_RADIUS_M = 30;
const WAYPOINT_MIN_TRAVEL_M = 100;

// Tolerance for course length matching
const LENGTH_MATCH_TOLERANCE = 0.25; // 25%

/**
 * Calculate average lap distance in feet from GPS samples.
 */
function calculateAverageLapDistanceFt(samples: GpsSample[], laps: Lap[]): number {
  if (laps.length === 0) return 0;

  let totalDistFt = 0;
  for (const lap of laps) {
    let lapDist = 0;
    for (let i = lap.startIndex; i < lap.endIndex && i < samples.length - 1; i++) {
      lapDist += haversineDistance(
        samples[i].lat, samples[i].lon,
        samples[i + 1].lat, samples[i + 1].lon
      );
    }
    totalDistFt += lapDist * 3.28084; // meters to feet
  }

  return totalDistFt / laps.length;
}

/**
 * Detect direction based on sector crossings.
 * If sector 2 is hit first after S/F → forward.
 * If sector 3 is hit first after S/F → reverse.
 */
function detectDirection(samples: GpsSample[], course: Course, laps: Lap[]): CourseDirection | undefined {
  if (!courseHasSectors(course) || !course.sector2 || !course.sector3 || laps.length === 0) {
    return undefined;
  }

  // Check sector times on the first lap that has them
  for (const lap of laps) {
    if (lap.sectors?.s1 !== undefined && lap.sectors?.s2 !== undefined) {
      // If we got valid S1→S2→S3 in order, that's forward
      return 'forward';
    }
  }

  // If sectors don't compute in the forward direction, try checking if
  // sector 3 comes before sector 2 — that would indicate reverse.
  // We can infer this from the lap calculation: if s3 crossing comes before s2,
  // the standard calculator won't find valid sector times.
  // So if no lap has valid sector times but we DO have S/F crossings, it's likely reverse.
  if (laps.length > 0 && laps.every(l => !l.sectors?.s1 || !l.sectors?.s2)) {
    return 'reverse';
  }

  return undefined;
}

/**
 * Auto-detect the best course for a set of GPS samples.
 *
 * @param samples Parsed GPS samples
 * @param tracks All available tracks (with courses)
 * @returns Detection result, or null if no track is nearby
 */
export function autoDetectCourse(
  samples: GpsSample[],
  tracks: Track[]
): CourseDetectionResult | null {
  if (samples.length < 10 || tracks.length === 0) return null;

  // Step 1: Find first valid GPS sample
  const validSample = samples.find(
    s => s.lat !== 0 && s.lon !== 0 && Math.abs(s.lat) <= 90 && Math.abs(s.lon) <= 180
  );
  if (!validSample) return null;

  // Step 2: Find nearest track within 5 miles
  const nearestTrack = findNearestTrack(
    validSample.lat, validSample.lon, tracks, TRACK_SEARCH_RADIUS_M
  ) as Track | null;

  if (!nearestTrack) {
    // No track nearby — try waypoint mode
    return createWaypointResult(samples);
  }

  // Step 3: Try each course, calculate laps, find best match by length
  type CourseCandidate = {
    course: Course;
    laps: Lap[];
    avgDistFt: number;
    lengthDiff: number;
  };

  const candidates: CourseCandidate[] = [];

  for (const course of nearestTrack.courses) {
    const laps = calculateLaps(samples, course);
    if (laps.length === 0) continue;

    const avgDistFt = calculateAverageLapDistanceFt(samples, laps);

    if (course.lengthFt && course.lengthFt > 0) {
      const diff = Math.abs(avgDistFt - course.lengthFt) / course.lengthFt;
      candidates.push({ course, laps, avgDistFt, lengthDiff: diff });
    } else {
      // No known length — still a candidate but with max diff
      candidates.push({ course, laps, avgDistFt, lengthDiff: Infinity });
    }
  }

  if (candidates.length === 0) {
    // No course produced laps — try waypoint mode
    return createWaypointResult(samples);
  }

  // Sort by number of laps (more = better) then by length match
  candidates.sort((a, b) => {
    // First prefer candidates with known length match
    if (a.lengthDiff !== Infinity && b.lengthDiff === Infinity) return -1;
    if (a.lengthDiff === Infinity && b.lengthDiff !== Infinity) return 1;

    // Then by length difference
    if (a.lengthDiff !== b.lengthDiff) return a.lengthDiff - b.lengthDiff;

    // Then by number of laps
    return b.laps.length - a.laps.length;
  });

  const best = candidates[0];

  // If best match is too far off on length, still use it but note it
  const direction = detectDirection(samples, best.course, best.laps);

  return {
    track: nearestTrack,
    course: best.course,
    direction,
    laps: best.laps,
    isWaypointMode: false,
  };
}

/**
 * Create a waypoint-based lap timing result.
 * Drops a waypoint at the first point where speed >= 30 MPH,
 * then detects returns to that waypoint.
 */
function createWaypointResult(samples: GpsSample[]): CourseDetectionResult | null {
  // Find waypoint: first sample at >= 30 MPH
  const waypointIdx = samples.findIndex(s => s.speedMph >= WAYPOINT_SPEED_THRESHOLD_MPH);
  if (waypointIdx < 0) return null;

  const waypoint = samples[waypointIdx];
  const wpLat = waypoint.lat;
  const wpLon = waypoint.lon;

  // Walk through samples, track distance from waypoint
  const laps: Lap[] = [];
  let lastCrossingIdx = waypointIdx;
  let lastCrossingTime = waypoint.t;
  let traveledSinceLastCrossing = 0;
  let lapNumber = 0;

  // Buffer for finding closest approach
  let minDist = Infinity;
  let minDistIdx = -1;

  for (let i = waypointIdx + 1; i < samples.length; i++) {
    const s = samples[i];
    const prev = samples[i - 1];

    // Accumulate distance
    traveledSinceLastCrossing += haversineDistance(prev.lat, prev.lon, s.lat, s.lon);

    const distToWaypoint = haversineDistance(s.lat, s.lon, wpLat, wpLon);

    // Check if we're approaching the waypoint
    if (traveledSinceLastCrossing > WAYPOINT_MIN_TRAVEL_M && distToWaypoint < WAYPOINT_RETURN_RADIUS_M) {
      // Track closest approach
      if (distToWaypoint < minDist) {
        minDist = distToWaypoint;
        minDistIdx = i;
      }
    } else if (minDistIdx >= 0 && distToWaypoint > WAYPOINT_RETURN_RADIUS_M) {
      // We've passed through — use the closest approach point
      lapNumber++;
      const crossingSample = samples[minDistIdx];

      // Calculate speed stats for this lap
      let maxSpeedMph = 0, maxSpeedKph = 0;
      let minSpeedMph = Infinity, minSpeedKph = Infinity;
      for (let j = lastCrossingIdx; j <= minDistIdx; j++) {
        if (samples[j].speedMph > maxSpeedMph) {
          maxSpeedMph = samples[j].speedMph;
          maxSpeedKph = samples[j].speedKph;
        }
        if (samples[j].speedMph < minSpeedMph && samples[j].speedMph > 1) {
          minSpeedMph = samples[j].speedMph;
          minSpeedKph = samples[j].speedKph;
        }
      }

      laps.push({
        lapNumber,
        startTime: lastCrossingTime,
        endTime: crossingSample.t,
        lapTimeMs: crossingSample.t - lastCrossingTime,
        maxSpeedMph,
        maxSpeedKph,
        minSpeedMph: minSpeedMph === Infinity ? 0 : minSpeedMph,
        minSpeedKph: minSpeedKph === Infinity ? 0 : minSpeedKph,
        startIndex: lastCrossingIdx,
        endIndex: minDistIdx,
      });

      lastCrossingIdx = minDistIdx;
      lastCrossingTime = crossingSample.t;
      traveledSinceLastCrossing = 0;
      minDist = Infinity;
      minDistIdx = -1;
    }
  }

  if (laps.length === 0) return null;

  // Calculate approximate sectors by dividing lap distance into thirds
  for (const lap of laps) {
    let lapDist = 0;
    const cumulativeDist: number[] = [0];
    for (let i = lap.startIndex; i < lap.endIndex && i < samples.length - 1; i++) {
      lapDist += haversineDistance(
        samples[i].lat, samples[i].lon,
        samples[i + 1].lat, samples[i + 1].lon
      );
      cumulativeDist.push(lapDist);
    }

    if (lapDist > 0) {
      const thirdDist = lapDist / 3;
      let s1Time: number | undefined;
      let s2Time: number | undefined;
      let s3Time: number | undefined;

      for (let j = 0; j < cumulativeDist.length; j++) {
        const sampleIdx = lap.startIndex + j;
        if (sampleIdx >= samples.length) break;

        if (!s1Time && cumulativeDist[j] >= thirdDist) {
          s1Time = samples[sampleIdx].t - lap.startTime;
        }
        if (!s2Time && cumulativeDist[j] >= thirdDist * 2) {
          s2Time = samples[sampleIdx].t - (lap.startTime + (s1Time ?? 0));
        }
      }

      if (s1Time && s2Time) {
        s3Time = lap.lapTimeMs - s1Time - s2Time;
        lap.sectors = { s1: s1Time, s2: s2Time, s3: s3Time };
      }
    }
  }

  // Build a virtual course centered on the waypoint
  // Use the waypoint itself as both start/finish points (offset slightly)
  const virtualCourse: Course = {
    name: 'Waypoint',
    startFinishA: { lat: wpLat + 0.00001, lon: wpLon },
    startFinishB: { lat: wpLat - 0.00001, lon: wpLon },
    isUserDefined: false,
  };

  // Build a virtual track
  const virtualTrack: Track = {
    name: 'Unknown Track',
    courses: [virtualCourse],
    isUserDefined: false,
  };

  return {
    track: virtualTrack,
    course: virtualCourse,
    laps,
    isWaypointMode: true,
    waypointNotice: 'Waypoint timing — lower accuracy. Create a track for precise timing.',
  };
}
