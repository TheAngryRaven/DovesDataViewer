import { SectorLine } from '@/types/racing';

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

/**
 * Haversine distance in meters between two lat/lon points.
 */
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Find the nearest track to a GPS point. Returns the track if within threshold (default 2km).
 */
export function findNearestTrack(
  lat: number, lon: number,
  tracks: { name: string; courses: { startFinishA: { lat: number; lon: number } }[] }[],
  thresholdMeters = 2000
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
