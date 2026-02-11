/**
 * Shared chart utilities used by TelemetryChart and SingleSeriesChart.
 */

/** Field names that should have optional smoothing applied in charts. */
export const G_FORCE_FIELDS = ['Lat G', 'Lon G'];

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
