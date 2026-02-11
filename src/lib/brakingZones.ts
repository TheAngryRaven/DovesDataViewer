import { GpsSample } from '@/types/racing';

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
    if (dtS < 0.01 || dtS > 2.0) {
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
    const accelMps2 = (speedMpsCurr - speedMpsPrev) / dtS;
    const accelG = accelMps2 / GRAVITY_MPS2;

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

    if (dtS < 0.01 || dtS > 2.0) {
      result.push(smoothedAccelG); // carry forward during gaps
      continue;
    }

    const speedMpsCurr = curr.speedMph * 0.44704;
    const speedMpsPrev = prev.speedMph * 0.44704;
    const accelG = (speedMpsCurr - speedMpsPrev) / dtS / GRAVITY_MPS2;

    if (i === 1) {
      smoothedAccelG = accelG;
    } else {
      smoothedAccelG = config.smoothingAlpha * accelG + (1 - config.smoothingAlpha) * smoothedAccelG;
    }
    result.push(smoothedAccelG);
  }
  return result;
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
