/**
 * Shared math, parsing, and validation utilities used across all GPS data parsers.
 */

import type { GpsSample } from '@/types/racing';

// ─── Speed unit conversions ─────────────────────────────────────────────────

export const MPS_TO_MPH = 2.23694;
export const MPS_TO_KPH = 3.6;
export const MPH_TO_MPS = 0.44704;
export const KPH_TO_MPS = 1 / 3.6;
export const KNOTS_TO_MPS = 0.514444;

/** Maximum reasonable speed in m/s (~335 mph). Anything above is a GPS glitch. */
export const MAX_SPEED_MPS = 150;

/** Standard gravity used when normalizing m/s² accelerometer readings to G. */
export const STANDARD_GRAVITY_MPS2 = 9.80665;

/** Build the three-unit speed triple used on every GpsSample. */
export function speedTriple(speedMps: number): { speedMps: number; speedMph: number; speedKph: number } {
  return {
    speedMps,
    speedMph: speedMps * MPS_TO_MPH,
    speedKph: speedMps * MPS_TO_KPH,
  };
}

// ─── Math ───────────────────────────────────────────────────────────────────

/** Clamp a number to [min, max] */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Normalize a heading delta to [-180, 180] to handle wrap-around.
 * e.g., 359° → 1° = +2°, not -358°
 */
export function normalizeHeadingDelta(h2: number | undefined, h1: number | undefined): number {
  if (h2 === undefined || h1 === undefined) return 0;
  let delta = h2 - h1;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

/** Wrap a heading value into [0, 360). */
export function normalizeHeading(heading: number): number {
  let h = heading;
  while (h < 0) h += 360;
  while (h >= 360) h -= 360;
  return h;
}

/** Haversine distance between two GPS coordinates, in meters. */
export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Calculate initial bearing from one GPS point to another, in degrees [0, 360). */
export function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const lat1Rad = lat1 * Math.PI / 180;
  const lat2Rad = lat2 * Math.PI / 180;

  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);

  let bearing = Math.atan2(y, x) * 180 / Math.PI;
  if (bearing < 0) bearing += 360;
  return bearing;
}

/**
 * Check if a GPS sample represents a teleportation glitch.
 * Returns true if the jump is implausibly large for the time elapsed.
 */
export function isTeleportation(
  prevLat: number, prevLon: number, prevT: number,
  lat: number, lon: number, t: number,
  formatName?: string
): boolean {
  const timeDiff = (t - prevT) / 1000;
  if (timeDiff <= 0 || timeDiff >= 10) return false;

  const dist = haversineDistance(prevLat, prevLon, lat, lon);
  const maxDistance = 50 * (timeDiff / 0.04);
  if (dist > maxDistance && dist > 100) {
    if (formatName) {
      console.warn(`${formatName} GPS teleportation: ${dist.toFixed(0)}m in ${timeDiff.toFixed(3)}s`);
    }
    return true;
  }
  return false;
}

// ─── GPS coordinate validation ──────────────────────────────────────────────

/** Why a coordinate pair was rejected, or null if it's valid. */
export type CoordRejectionReason = 'nan' | 'zero' | 'outOfRange' | null;

/**
 * Validate a GPS coordinate pair. Returns null if valid, otherwise the rejection reason.
 *   - 'nan'        — lat or lon is NaN
 *   - 'zero'       — both are 0 (default GPS error value)
 *   - 'outOfRange' — |lat| > 90 or |lon| > 180
 */
export function validateGpsCoords(lat: number, lon: number): CoordRejectionReason {
  if (isNaN(lat) || isNaN(lon)) return 'nan';
  if (lat === 0 && lon === 0) return 'zero';
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return 'outOfRange';
  return null;
}

// ─── CSV parsing ────────────────────────────────────────────────────────────

/**
 * Parse a CSV line, respecting double-quoted fields. Fields are trimmed.
 * Use a single-character delimiter (default `,`).
 */
export function parseCsvLine(line: string, delimiter: string = ','): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Pick the most likely delimiter for a CSV line by counting candidates.
 * Defaults to comma, falls back to semicolon, prefers tab if it wins.
 */
export function detectDelimiter(line: string, candidates: string[] = ['\t', ';', ',']): string {
  let best = ',';
  let bestCount = -1;
  for (const c of candidates) {
    const count = (line.match(new RegExp(c === '\t' ? '\\t' : `\\${c}`, 'g')) || []).length;
    if (count > bestCount) {
      best = c;
      bestCount = count;
    }
  }
  return best;
}

// ─── Accelerometer normalization ────────────────────────────────────────────

/**
 * Normalize a raw accelerometer reading to gravity-units (G).
 * Many loggers export in m/s² rather than G; if the absolute value exceeds
 * `msqThreshold` we assume m/s² and divide by standard gravity.
 * Result is clamped to [-clampG, clampG].
 *
 * @param value raw accelerometer reading from the file
 * @param msqThreshold heuristic: values above this are treated as m/s² (default 5)
 * @param clampG output clamp range (default 5G)
 */
export function normalizeAccelToG(value: number, msqThreshold: number = 5, clampG: number = 5): number {
  const g = Math.abs(value) > msqThreshold ? value / STANDARD_GRAVITY_MPS2 : value;
  return clamp(g, -clampG, clampG);
}

// ─── Bounds ─────────────────────────────────────────────────────────────────

/**
 * Calculate lat/lon bounds in a single pass.
 * Avoids `Math.min(...samples.map(s => s.lat))` which can stack-overflow on
 * large arrays (>~100k samples in some JS engines).
 */
export function calculateBounds(samples: GpsSample[]): { minLat: number; maxLat: number; minLon: number; maxLon: number } {
  if (samples.length === 0) {
    return { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 };
  }
  let minLat = Infinity, maxLat = -Infinity;
  let minLon = Infinity, maxLon = -Infinity;
  for (const s of samples) {
    if (s.lat < minLat) minLat = s.lat;
    if (s.lat > maxLat) maxLat = s.lat;
    if (s.lon < minLon) minLon = s.lon;
    if (s.lon > maxLon) maxLon = s.lon;
  }
  return { minLat, maxLat, minLon, maxLon };
}

// ─── ParserStats helpers ────────────────────────────────────────────────────

export interface RejectedCounts {
  nanFields: number;
  zeroCoords: number;
  outOfRange: number;
  speedCap: number;
  teleportation: number;
  incompleteRow: number;
}

/** Create a zeroed rejection-reason counter. */
export function createRejectedCounter(): RejectedCounts {
  return {
    nanFields: 0,
    zeroCoords: 0,
    outOfRange: 0,
    speedCap: 0,
    teleportation: 0,
    incompleteRow: 0,
  };
}

/**
 * Increment the matching counter for a CoordRejectionReason.
 * Returns true if the reason was non-null (i.e. a rejection happened).
 */
export function recordCoordRejection(rejected: RejectedCounts, reason: CoordRejectionReason): boolean {
  if (reason === null) return false;
  if (reason === 'nan') rejected.nanFields++;
  else if (reason === 'zero') rejected.zeroCoords++;
  else if (reason === 'outOfRange') rejected.outOfRange++;
  return true;
}
