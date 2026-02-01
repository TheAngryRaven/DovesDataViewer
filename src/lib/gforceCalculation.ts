import { GpsSample } from '@/types/racing';

/**
 * G-Force calculation utilities for GPS-derived accelerations
 * 
 * These calculations derive lateral and longitudinal G-forces from GPS data:
 * - Lateral G: centripetal acceleration = v * (dHeading/dt)
 * - Longitudinal G: rate of change of speed = dv/dt
 * 
 * Quality filters applied:
 * - HDOP threshold (poor GPS accuracy samples skipped)
 * - Minimum speed for lateral G (heading unreliable at low speeds)
 * - Maximum heading rate (physically impossible changes rejected)
 * - Time gap detection (filtered teleportation samples detected)
 */

// Clamp value to range
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Normalize heading delta to handle wrap-around (e.g., 359° → 1° = +2° not -358°)
function normalizeHeadingDelta(h2: number | undefined, h1: number | undefined): number {
  if (h2 === undefined || h1 === undefined) return 0;
  let delta = h2 - h1;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

// Configuration constants
const G_FORCE_CONFIG = {
  GRAVITY: 9.80665,        // m/s²
  MAX_G: 3.0,              // reasonable max for karts/racing
  MIN_DT: 0.05,            // minimum time delta in seconds
  MAX_DT: 2.0,             // maximum time delta - larger gaps indicate filtered samples
  MIN_SPEED_FOR_LAT_G: 2.0, // m/s (~4.5 mph) - heading unreliable below this
  MAX_HDOP_FOR_G: 5.0,     // HDOP threshold - above this, GPS accuracy is poor
  MAX_HEADING_RATE: 180,   // degrees/second - physical limit for a kart (spin threshold)
};

/**
 * Calculate lateral and longitudinal G-forces from GPS data
 * Uses central difference derivatives for smoother results
 */
export function calculateAccelerations(samples: GpsSample[]): void {
  const {
    GRAVITY, MAX_G, MIN_DT, MAX_DT,
    MIN_SPEED_FOR_LAT_G, MAX_HDOP_FOR_G, MAX_HEADING_RATE
  } = G_FORCE_CONFIG;
  
  for (let i = 0; i < samples.length; i++) {
    // Use central difference for smoother derivatives
    const prevIdx = Math.max(0, i - 1);
    const nextIdx = Math.min(samples.length - 1, i + 1);
    
    const prev = samples[prevIdx];
    const curr = samples[i];
    const next = samples[nextIdx];
    
    const dt = (next.t - prev.t) / 1000; // seconds
    
    // Check for invalid time deltas
    if (dt < MIN_DT || dt > MAX_DT) {
      // Gap too small or too large (indicates filtered samples or pause)
      curr.extraFields['Lat G'] = 0;
      curr.extraFields['Lon G'] = 0;
      continue;
    }
    
    // Check HDOP quality if available - skip poor accuracy samples
    const currHdop = curr.extraFields['HDOP'];
    if (currHdop !== undefined && currHdop > MAX_HDOP_FOR_G) {
      curr.extraFields['Lat G'] = 0;
      curr.extraFields['Lon G'] = 0;
      continue;
    }
    
    // Longitudinal G: rate of change of speed
    const dv = next.speedMps - prev.speedMps;
    const lonG = (dv / dt) / GRAVITY;
    
    // Lateral G: v * (dHeading/dt)
    let latG = 0;
    
    // Only calculate lateral G if we have valid heading data and sufficient speed
    // GPS heading is unreliable at low speeds (vehicle barely moving)
    if (prev.heading !== undefined && next.heading !== undefined && 
        curr.speedMps >= MIN_SPEED_FOR_LAT_G) {
      
      const dHeading = normalizeHeadingDelta(next.heading, prev.heading);
      const headingRate = Math.abs(dHeading) / dt; // degrees/second
      
      // Sanity check: reject physically impossible heading changes
      // A kart can't turn faster than ~180 deg/s even in a spin
      if (headingRate <= MAX_HEADING_RATE) {
        const yawRate = (dHeading * Math.PI / 180) / dt; // rad/s
        latG = (curr.speedMps * yawRate) / GRAVITY;
      }
    }
    
    // Clamp to reasonable values
    curr.extraFields['Lat G'] = clamp(latG, -MAX_G, MAX_G);
    curr.extraFields['Lon G'] = clamp(lonG, -MAX_G, MAX_G);
  }
}

/**
 * Apply simple moving average smoothing to a field
 * Reduces noise from GPS jitter
 */
export function smoothField(samples: GpsSample[], fieldName: string, windowSize: number = 5): void {
  const halfWindow = Math.floor(windowSize / 2);
  const values = samples.map(s => s.extraFields[fieldName] ?? 0);
  
  for (let i = 0; i < samples.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = i - halfWindow; j <= i + halfWindow; j++) {
      if (j >= 0 && j < samples.length) {
        sum += values[j];
        count++;
      }
    }
    samples[i].extraFields[fieldName] = sum / count;
  }
}

/**
 * Apply G-force calculations and smoothing to samples
 * This is the main entry point for G-force processing
 */
export function applyGForceCalculations(samples: GpsSample[], smoothingWindow: number = 5): void {
  calculateAccelerations(samples);
  smoothField(samples, 'Lat G', smoothingWindow);
  smoothField(samples, 'Lon G', smoothingWindow);
}
