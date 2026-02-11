import { GpsSample } from '@/types/racing';
import savitzkyGolay from 'ml-savitzky-golay';

export interface BrakingZone {
  start: { lat: number; lon: number; t: number; speedMps: number };
  end: { lat: number; lon: number; t: number; speedMps: number };
  path: Array<{ lat: number; lon: number }>;
  durationMs: number;
  speedDeltaMps: number;
}

export interface BrakingZoneConfig {
  entryThresholdG: number;    // e.g., -0.25
  exitThresholdG: number;     // e.g., -0.10
  minDurationMs: number;      // e.g., 120
  smoothingAlpha: number;     // e.g., 0.4
}

export const DEFAULT_BRAKING_CONFIG: BrakingZoneConfig = {
  entryThresholdG: -0.25,
  exitThresholdG: -0.10,
  minDurationMs: 120,
  smoothingAlpha: 0.4,
};

const GRAVITY_MPS2 = 9.80665;
const MIN_SPEED_MPS = 2.0;      // Below this, accel is too noisy (matches gforceCalculation)
const MAX_SPEED_MPS = 150;       // Reject GPS glitch speeds (matches speed sanity check)
const MIN_DT_S = 0.02;           // Supports GPS up to 50Hz
const MAX_DT_S = 2.0;            // Maximum time delta (GPS gap)
const MAX_ACCEL_G = 3.0;         // Clamp raw accel to ±3G (matches gforceCalculation)

type BrakingState = 'COASTING' | 'BRAKING';

/**
 * Detect discrete braking zones using a hysteresis-based state machine.
 * Uses scalar speed to calculate longitudinal acceleration (deceleration).
 */
export function detectBrakingZones(
  samples: GpsSample[],
  config: BrakingZoneConfig = DEFAULT_BRAKING_CONFIG
): BrakingZone[] {
  if (samples.length < 3) return [];

  const { entryThresholdG, exitThresholdG, minDurationMs, smoothingAlpha } = config;

  const zones: BrakingZone[] = [];
  let state: BrakingState = 'COASTING';
  let zoneStartIndex = 0;
  let smoothedAccelG = 0;

  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const curr = samples[i];

    // Calculate time delta in seconds
    const dtMs = curr.t - prev.t;
    const dtS = dtMs / 1000;

    // Skip samples with invalid time deltas (GPS gaps or too fast)
    if (dtS < MIN_DT_S || dtS > MAX_DT_S) {
      // If we were braking during a gap, end the zone at the previous sample
      if (state === 'BRAKING') {
        const zoneEnd = samples[i - 1];
        const zoneStart = samples[zoneStartIndex];
        const duration = zoneEnd.t - zoneStart.t;
        
        if (duration >= minDurationMs) {
          zones.push(createZone(samples, zoneStartIndex, i - 1));
        }
        state = 'COASTING';
      }
      continue;
    }

    // Calculate longitudinal acceleration from scalar speed change
    const speedMpsCurr = curr.speedMph * 0.44704; // mph to m/s
    const speedMpsPrev = prev.speedMph * 0.44704;

    // Speed sanity: reject impossible speeds or too-slow samples
    if (speedMpsCurr > MAX_SPEED_MPS || speedMpsPrev > MAX_SPEED_MPS) continue;
    if (speedMpsCurr < MIN_SPEED_MPS && speedMpsPrev < MIN_SPEED_MPS) continue;

    const accelG = Math.max(-MAX_ACCEL_G, Math.min(MAX_ACCEL_G,
      (speedMpsCurr - speedMpsPrev) / dtS / GRAVITY_MPS2
    ));

    // Apply exponential smoothing
    if (i === 1) {
      smoothedAccelG = accelG;
    } else {
      smoothedAccelG = smoothingAlpha * accelG + (1 - smoothingAlpha) * smoothedAccelG;
    }

    // State machine with hysteresis
    if (state === 'COASTING') {
      if (smoothedAccelG < entryThresholdG) {
        // Enter braking zone
        zoneStartIndex = i;
        state = 'BRAKING';
      }
    } else if (state === 'BRAKING') {
      if (smoothedAccelG > exitThresholdG) {
        // Exit braking zone
        const zoneStart = samples[zoneStartIndex];
        const zoneEnd = curr;
        const duration = zoneEnd.t - zoneStart.t;

        if (duration >= minDurationMs) {
          zones.push(createZone(samples, zoneStartIndex, i));
        }
        state = 'COASTING';
      }
    }
  }

  // Handle zone that extends to end of samples
  if (state === 'BRAKING') {
    const zoneStart = samples[zoneStartIndex];
    const zoneEnd = samples[samples.length - 1];
    const duration = zoneEnd.t - zoneStart.t;

    if (duration >= minDurationMs) {
      zones.push(createZone(samples, zoneStartIndex, samples.length - 1));
    }
  }

  return zones;
}

/**
 * Compute a continuous smoothed longitudinal acceleration (G) series.
 * Returns one value per sample using the same EMA math as detectBrakingZones.
 */
export function computeBrakingGSeries(
  samples: GpsSample[],
  config: BrakingZoneConfig = DEFAULT_BRAKING_CONFIG
): number[] {
  if (samples.length === 0) return [];
  const result: number[] = [0]; // first sample has no delta
  let smoothedAccelG = 0;

  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const curr = samples[i];
    const dtS = (curr.t - prev.t) / 1000;

    // Reject bad time deltas
    if (dtS < MIN_DT_S || dtS > MAX_DT_S) {
      result.push(smoothedAccelG); // carry forward during gaps
      continue;
    }

    const speedMpsCurr = curr.speedMph * 0.44704;
    const speedMpsPrev = prev.speedMph * 0.44704;

    // Speed sanity: reject impossible speeds (GPS glitch)
    if (speedMpsCurr > MAX_SPEED_MPS || speedMpsPrev > MAX_SPEED_MPS) {
      result.push(smoothedAccelG);
      continue;
    }

    // Speed gate: below minimum, accel is unreliable
    if (speedMpsCurr < MIN_SPEED_MPS && speedMpsPrev < MIN_SPEED_MPS) {
      result.push(smoothedAccelG);
      continue;
    }

    // Raw longitudinal acceleration, clamped to physical limits
    const rawAccelG = Math.max(-MAX_ACCEL_G, Math.min(MAX_ACCEL_G,
      (speedMpsCurr - speedMpsPrev) / dtS / GRAVITY_MPS2
    ));

    // EMA smoothing
    if (i === 1) {
      smoothedAccelG = rawAccelG;
    } else {
      smoothedAccelG = config.smoothingAlpha * rawAccelG + (1 - config.smoothingAlpha) * smoothedAccelG;
    }
    result.push(smoothedAccelG);
  }
  return result;
}

/**
 * Compute a smooth longitudinal acceleration (G) series using Savitzky-Golay filter.
 * Fits a local cubic polynomial to speed data and differentiates analytically —
 * producing a smooth derivative in one step with no phase lag (per NREL / IFAC 2019 research).
 */
export function computeBrakingGSeriesSG(
  samples: GpsSample[],
  windowSize: number = 25
): number[] {
  if (samples.length < windowSize) return computeBrakingGSeries(samples); // fallback for tiny datasets

  // Ensure odd window size
  const ws = windowSize % 2 === 0 ? windowSize + 1 : windowSize;

  // Extract speed in m/s
  const speedMps = samples.map(s => {
    const v = s.speedMph * 0.44704;
    return (v > MAX_SPEED_MPS || v < 0) ? 0 : v;
  });

  // Compute median time step for h
  const dts: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const dt = (samples[i].t - samples[i - 1].t) / 1000;
    if (dt > 0 && dt < MAX_DT_S) dts.push(dt);
  }
  if (dts.length === 0) return new Array(samples.length).fill(0);
  dts.sort((a, b) => a - b);
  const h = dts[Math.floor(dts.length / 2)];

  // Import is at top of file — use dynamic require pattern
  // SG filter: derivative=1 gives dSpeed/dt directly
  const sgResult = savitzkyGolay(speedMps, h, {
    derivative: 1,
    windowSize: ws,
    polynomial: 3,
    pad: 'post',
    padValue: 'replicate',
  });

  // Convert to G and apply gates
  return sgResult.map((dvdt: number, i: number) => {
    const speedMs = speedMps[i];
    if (speedMs < MIN_SPEED_MPS) return 0;
    const g = dvdt / GRAVITY_MPS2;
    return Math.max(-MAX_ACCEL_G, Math.min(MAX_ACCEL_G, g));
  });
}

/**
 * Create a BrakingZone object from sample indices
 */
function createZone(samples: GpsSample[], startIdx: number, endIdx: number): BrakingZone {
  const startSample = samples[startIdx];
  const endSample = samples[endIdx];

  // Build path from all GPS points in the zone
  const path: Array<{ lat: number; lon: number }> = [];
  for (let i = startIdx; i <= endIdx; i++) {
    path.push({ lat: samples[i].lat, lon: samples[i].lon });
  }

  const startSpeedMps = startSample.speedMph * 0.44704;
  const endSpeedMps = endSample.speedMph * 0.44704;

  return {
    start: {
      lat: startSample.lat,
      lon: startSample.lon,
      t: startSample.t,
      speedMps: startSpeedMps,
    },
    end: {
      lat: endSample.lat,
      lon: endSample.lon,
      t: endSample.t,
      speedMps: endSpeedMps,
    },
    path,
    durationMs: endSample.t - startSample.t,
    speedDeltaMps: endSpeedMps - startSpeedMps, // Negative = speed lost
  };
}
