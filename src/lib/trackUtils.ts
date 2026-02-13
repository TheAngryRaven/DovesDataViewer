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
