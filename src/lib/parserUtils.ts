/**
 * Shared math and filtering utilities used across all GPS data parsers.
 */

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

/** Maximum reasonable speed in m/s (~335 mph). Anything above is a GPS glitch. */
export const MAX_SPEED_MPS = 150;
