import { SectorLine } from '@/types/racing';
import { haversineDistance, METERS_TO_FEET } from '@/lib/parserUtils';

/**
 * Default radius (meters) within which a GPS sample is considered to belong
 * to a given track. ~5 miles — matches the documented course-detection range.
 */
export const DEFAULT_TRACK_SEARCH_RADIUS_M = 8047;

/** Parse sector line coordinates from string form fields. Returns undefined if any value is NaN. */
export function parseSectorLine(sector: { aLat: string; aLon: string; bLat: string; bLon: string }): SectorLine | undefined {
  const aLat = parseFloat(sector.aLat);
  const aLon = parseFloat(sector.aLon);
  const bLat = parseFloat(sector.bLat);
  const bLon = parseFloat(sector.bLon);
  if (isNaN(aLat) || isNaN(aLon) || isNaN(bLat) || isNaN(bLon)) return undefined;
  return { a: { lat: aLat, lon: aLon }, b: { lat: bLat, lon: bLon } };
}

/**
 * Abbreviate a track name for display.
 * 
 * Rules:
 * - If track name contains multiple words (split on whitespace), take the 
 *   FIRST LETTER of each word and uppercase.
 *   "Orlando Kart Center" -> "OKC"
 * - If track name is a single word, take the first 4 characters and uppercase.
 *   "Bushnell" -> "BUSH"
 *   If word length < 4, use the entire word uppercased.
 */
export function abbreviateTrackName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '';
  
  const words = trimmed.split(/\s+/);
  
  if (words.length > 1) {
    // Multiple words: take first letter of each
    return words.map(w => w.charAt(0).toUpperCase()).join('');
  } else {
    // Single word: take first 4 chars (or less if shorter)
    const word = words[0];
    return word.slice(0, 4).toUpperCase();
  }
}

/**
 * Get display name for a track. Uses shortName if available, falls back to abbreviation.
 */
export function getTrackDisplayName(track: { name: string; shortName?: string }): string {
  return track.shortName || abbreviateTrackName(track.name);
}

/** Max length for a track short name (matches the `short_name VARCHAR(8)` column). */
export const MAX_SHORT_NAME_LENGTH = 8;

/**
 * Derive a valid short name from a long track name: builds on
 * `abbreviateTrackName`, then strips to alphanumerics and caps at
 * `MAX_SHORT_NAME_LENGTH`. Used to auto-fill the short-name field during track
 * creation and as a fallback when submitting a track that never got one.
 * Returns '' only when the name has no alphanumeric content.
 */
export function deriveShortName(name: string): string {
  const abbr = abbreviateTrackName(name).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (abbr) return abbr.slice(0, MAX_SHORT_NAME_LENGTH);
  const raw = name.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return raw.slice(0, MAX_SHORT_NAME_LENGTH);
}


/**
 * Find the nearest track to a GPS point. Returns the track if within threshold (default 2km).
 */
export function findNearestTrack(
  lat: number, lon: number,
  tracks: { name: string; courses: { startFinishA: { lat: number; lon: number } }[] }[],
  thresholdMeters = DEFAULT_TRACK_SEARCH_RADIUS_M,
): typeof tracks[number] | null {
  let best: typeof tracks[number] | null = null;
  let bestDist = Infinity;
  for (const track of tracks) {
    for (const course of track.courses) {
      const dist = haversineDistance(lat, lon, course.startFinishA.lat, course.startFinishA.lon);
      if (dist < bestDist) {
        bestDist = dist;
        best = track;
      }
    }
  }
  return bestDist <= thresholdMeters ? best : null;
}

/**
 * Calculate the total length of a polyline in meters.
 */
export function calculatePolylineLength(points: Array<{ lat: number; lon: number }>): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineDistance(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
  }
  return total;
}

/**
 * Format a distance in meters to a compact ft / m string.
 */
export function formatTrackLength(meters: number): string {
  const feet = meters * METERS_TO_FEET;
  return `${Math.round(feet).toLocaleString()} ft / ${Math.round(meters).toLocaleString()} m`;
}

/**
 * Resample a polyline to evenly spaced points.
 * Walks along the path segment-by-segment, emitting a new interpolated
 * point every `spacingMeters` meters. Always includes the first point.
 */
export function resamplePolyline(
  points: Array<{ lat: number; lon: number }>,
  spacingMeters = 5
): Array<{ lat: number; lon: number }> {
  if (points.length < 2) return [...points];

  const result: Array<{ lat: number; lon: number }> = [{ ...points[0] }];
  let carry = 0; // distance carried over from previous segment

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const segDist = haversineDistance(prev.lat, prev.lon, curr.lat, curr.lon);
    if (segDist === 0) continue;

    let walked = carry;
    while (walked + spacingMeters <= segDist) {
      walked += spacingMeters;
      const t = walked / segDist;
      result.push({
        lat: prev.lat + t * (curr.lat - prev.lat),
        lon: prev.lon + t * (curr.lon - prev.lon),
      });
    }
    carry = segDist - walked;
  }

  return result;
}
