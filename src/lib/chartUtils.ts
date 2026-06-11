/**
 * Shared chart utilities used by TelemetryChart and SingleSeriesChart.
 */

/** Canonical channel ids for GPS-derived G-force (optional smoothing applied). */
export const G_FORCE_FIELDS_GPS = ['lat_g', 'lon_g'];

/** Canonical channel ids for hardware accelerometer G-force fields. */
export const G_FORCE_FIELDS_HW = ['accel_x', 'accel_y'];

/** All G-force field names (for smoothing detection). */
export const G_FORCE_FIELDS = [...G_FORCE_FIELDS_GPS, ...G_FORCE_FIELDS_HW];

/** Which G-force source the user prefers in the analysis charts. */
export type GForceSource = 'gps' | 'hw';

/**
 * Min/max of a numeric series via a plain loop. `Math.min(...values)` spreads
 * the array onto the call stack and throws RangeError above ~65k elements
 * (mobile Safari; ~125k in V8) — a 2-hour 20 Hz session easily exceeds that,
 * and the charts compute extents inside the draw effect on every cursor tick.
 * Skips null/undefined/NaN entries; returns null when nothing numeric remains.
 */
export function numericExtent(
  values: ReadonlyArray<number | null | undefined>,
): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  let found = false;
  for (const v of values) {
    if (v === null || v === undefined || Number.isNaN(v)) continue;
    found = true;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return found ? { min, max } : null;
}

/**
 * Map a smoothing strength (0-100) to a window size for moving average.
 * Returns odd numbers for symmetric smoothing. Range: 1-15.
 */
export function computeSmoothingWindowSize(enabled: boolean, strength: number): number {
  if (!enabled) return 1;
  return Math.max(1, Math.floor(1 + (strength / 100) * 14));
}

/**
 * Apply moving average smoothing to an array of values.
 * Undefined values are preserved as-is (gaps in data).
 */
export function applySmoothingToValues(values: (number | undefined)[], windowSize: number): (number | undefined)[] {
  if (windowSize <= 1) return values;

  const halfWindow = Math.floor(windowSize / 2);
  const result: (number | undefined)[] = new Array(values.length);

  for (let i = 0; i < values.length; i++) {
    if (values[i] === undefined) {
      result[i] = undefined;
      continue;
    }

    let sum = 0;
    let count = 0;
    for (let j = i - halfWindow; j <= i + halfWindow; j++) {
      if (j >= 0 && j < values.length && values[j] !== undefined) {
        sum += values[j]!;
        count++;
      }
    }
    result[i] = count > 0 ? sum / count : values[i];
  }

  return result;
}

/**
 * Detect short runs of near-zero speed that are GPS glitches,
 * returning a Set of sample indices that should be interpolated through.
 */
export function detectSpeedGlitchIndices(
  speeds: number[],
  minSpeedThreshold: number = 1.0,
  maxGlitchSamples: number = 3
): Set<number> {
  const indices = new Set<number>();
  let runStart = -1;

  for (let i = 0; i < speeds.length; i++) {
    const isLowSpeed = speeds[i] < minSpeedThreshold;

    if (isLowSpeed && runStart === -1) {
      runStart = i;
    } else if (!isLowSpeed && runStart !== -1) {
      if (i - runStart <= maxGlitchSamples) {
        for (let j = runStart; j < i; j++) indices.add(j);
      }
      runStart = -1;
    }
  }
  if (runStart !== -1 && speeds.length - runStart <= maxGlitchSamples) {
    for (let j = runStart; j < speeds.length; j++) indices.add(j);
  }

  return indices;
}

/**
 * Interpolate a speed value at a glitch index using surrounding valid values.
 */
export function interpolateGlitchSpeed(
  index: number,
  speeds: number[],
  glitchIndices: Set<number>,
  lastValidSpeed: number | null,
  lastValidIndex: number
): number {
  if (lastValidSpeed === null) {
    // Find the next valid speed
    for (let j = index + 1; j < speeds.length; j++) {
      if (!glitchIndices.has(j)) return speeds[j];
    }
    return speeds[index];
  }

  let nextValidSpeed = lastValidSpeed;
  let nextValidIndex = speeds.length - 1;
  for (let j = index + 1; j < speeds.length; j++) {
    if (!glitchIndices.has(j)) {
      nextValidSpeed = speeds[j];
      nextValidIndex = j;
      break;
    }
  }

  const progress = (index - lastValidIndex) / Math.max(1, nextValidIndex - lastValidIndex);
  return lastValidSpeed + (nextValidSpeed - lastValidSpeed) * progress;
}
