/**
 * Utilities for reference lap comparison:
 * - Distance-based interpolation
 * - Pace calculation (time delta at equal distance)
 * - Reference speed alignment
 */

import { GpsSample } from '@/types/racing';

interface Point {
  x: number;
  y: number;
}

// Project lat/lon to local planar coordinates (equirectangular approximation)
export function projectToPlane(lat: number, lon: number, centerLat: number, centerLon: number): Point {
  const R = 6371000; // Earth radius in meters
  const x = (lon - centerLon) * Math.PI / 180 * R * Math.cos(centerLat * Math.PI / 180);
  const y = (lat - centerLat) * Math.PI / 180 * R;
  return { x, y };
}

// Calculate distance between two planar points
function distance(p1: Point, p2: Point): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// Calculate cumulative distance array for samples
export function calculateDistanceArray(samples: GpsSample[]): number[] {
  if (samples.length === 0) return [];
  
  // Find center for projection
  const centerLat = samples.reduce((sum, s) => sum + s.lat, 0) / samples.length;
  const centerLon = samples.reduce((sum, s) => sum + s.lon, 0) / samples.length;
  
  const distances: number[] = [0];
  
  for (let i = 1; i < samples.length; i++) {
    const p1 = projectToPlane(samples[i - 1].lat, samples[i - 1].lon, centerLat, centerLon);
    const p2 = projectToPlane(samples[i].lat, samples[i].lon, centerLat, centerLon);
    distances.push(distances[i - 1] + distance(p1, p2));
  }
  
  return distances;
}

// Interpolate a value from reference samples at a given distance
function interpolateAtDistance(
  targetDistance: number,
  refDistances: number[],
  refSamples: GpsSample[],
  getValue: (sample: GpsSample) => number
): number | null {
  if (refDistances.length === 0 || refSamples.length === 0) return null;
  
  const totalRefDistance = refDistances[refDistances.length - 1];
  
  // Clamp to available range
  if (targetDistance < 0) targetDistance = 0;
  if (targetDistance > totalRefDistance) return null; // Beyond reference lap
  
  // Binary search for bracketing indices
  let lo = 0;
  let hi = refDistances.length - 1;
  
  while (lo < hi - 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (refDistances[mid] <= targetDistance) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  
  // Interpolate between lo and hi
  const d1 = refDistances[lo];
  const d2 = refDistances[hi];
  
  if (d2 === d1) return getValue(refSamples[lo]);
  
  const t = (targetDistance - d1) / (d2 - d1);
  const v1 = getValue(refSamples[lo]);
  const v2 = getValue(refSamples[hi]);
  
  return v1 + t * (v2 - v1);
}

/**
 * Calculate pace (time delta vs reference) for each sample in current lap.
 * Positive = slower (behind), Negative = faster (ahead)
 */
export function calculatePace(
  currentSamples: GpsSample[],
  refSamples: GpsSample[]
): (number | null)[] {
  if (currentSamples.length === 0 || refSamples.length === 0) return [];
  
  const currentDistances = calculateDistanceArray(currentSamples);
  const refDistances = calculateDistanceArray(refSamples);
  
  // Current lap start time (normalized to 0)
  const currentStartTime = currentSamples[0].t;
  // Reference lap start time (normalized to 0)
  const refStartTime = refSamples[0].t;
  
  const pace: (number | null)[] = [];
  
  for (let i = 0; i < currentSamples.length; i++) {
    const currentTime = (currentSamples[i].t - currentStartTime) / 1000; // seconds from lap start
    const currentDistance = currentDistances[i];
    
    // Find reference time at same distance
    const refTimeAtDistance = interpolateAtDistance(
      currentDistance,
      refDistances,
      refSamples,
      (s) => (s.t - refStartTime) / 1000 // seconds from ref lap start
    );
    
    if (refTimeAtDistance === null) {
      pace.push(null);
    } else {
      // Pace = current time - reference time at same distance
      // Positive = slower (behind), Negative = faster (ahead)
      pace.push(currentTime - refTimeAtDistance);
    }
  }
  
  return pace;
}

/**
 * Calculate reference speed aligned to current lap's distance progression.
 * Returns speed values (mph or kph based on useKph) for each current sample.
 */
export function calculateReferenceSpeed(
  currentSamples: GpsSample[],
  refSamples: GpsSample[],
  useKph: boolean
): (number | null)[] {
  if (currentSamples.length === 0 || refSamples.length === 0) return [];
  
  const currentDistances = calculateDistanceArray(currentSamples);
  const refDistances = calculateDistanceArray(refSamples);
  
  const refSpeeds: (number | null)[] = [];
  
  for (let i = 0; i < currentSamples.length; i++) {
    const currentDistance = currentDistances[i];
    
    const refSpeed = interpolateAtDistance(
      currentDistance,
      refDistances,
      refSamples,
      (s) => useKph ? s.speedKph : s.speedMph
    );
    
    refSpeeds.push(refSpeed);
  }
  
  return refSpeeds;
}

/**
 * Precompute reference data for a lap.
 */
export interface ReferenceData {
  samples: GpsSample[];
  distances: number[];
  totalDistance: number;
}

export function computeReferenceData(samples: GpsSample[]): ReferenceData {
  const distances = calculateDistanceArray(samples);
  return {
    samples,
    distances,
    totalDistance: distances.length > 0 ? distances[distances.length - 1] : 0
  };
}
