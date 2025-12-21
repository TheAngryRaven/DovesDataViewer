// Shared helpers for computing speed bounds used for visualization.

interface SpeedBoundsOptions {
  /** Speeds below this are considered "low speed" for glitch-run detection. */
  minSpeedThresholdMph?: number;
  /** Low-speed runs of length <= this are treated as GPS glitches and excluded from the min bound. */
  maxGlitchSamples?: number;
}

/**
 * Computes min/max speed bounds for heatmaps.
 *
 * This excludes brief low-speed runs from the *minimum* bound, so a few bad samples
 * don't collapse the color scale.
 */
export function computeHeatmapSpeedBoundsMph(
  speedsMph: number[],
  options: SpeedBoundsOptions = {},
): { minSpeed: number; maxSpeed: number } {
  if (speedsMph.length === 0) return { minSpeed: 0, maxSpeed: 1 };

  const rawMin = Math.min(...speedsMph);
  const rawMax = Math.max(...speedsMph, 1);

  const minSpeedThresholdMph = options.minSpeedThresholdMph ?? 1.0;
  // Visualization is more tolerant: treat up to ~10 samples of 0mph as a glitch.
  const maxGlitchSamples = options.maxGlitchSamples ?? 10;

  // Identify short low-speed runs (glitches).
  const glitchIndices = new Set<number>();
  let runStart = -1;

  for (let i = 0; i < speedsMph.length; i++) {
    const isLowSpeed = speedsMph[i] < minSpeedThresholdMph;

    if (isLowSpeed && runStart === -1) {
      runStart = i;
    } else if (!isLowSpeed && runStart !== -1) {
      const runLength = i - runStart;
      if (runLength <= maxGlitchSamples) {
        for (let k = runStart; k < i; k++) glitchIndices.add(k);
      }
      runStart = -1;
    }
  }

  // Handle run extending to end.
  if (runStart !== -1) {
    const runLength = speedsMph.length - runStart;
    if (runLength <= maxGlitchSamples) {
      for (let k = runStart; k < speedsMph.length; k++) glitchIndices.add(k);
    }
  }

  // Compute min excluding glitch indices.
  let filteredMin = Infinity;
  for (let i = 0; i < speedsMph.length; i++) {
    if (glitchIndices.has(i)) continue;
    if (speedsMph[i] < filteredMin) filteredMin = speedsMph[i];
  }

  const lowCount = speedsMph.reduce(
    (acc, s) => (s < minSpeedThresholdMph ? acc + 1 : acc),
    0,
  );

  let minSpeed = filteredMin === Infinity ? rawMin : filteredMin;

  // If very-low-speed samples are rare, treat them as bad data even if the run is long.
  // This keeps the lap heatmap usable when a sensor hiccups for a short portion.
  if (minSpeed < minSpeedThresholdMph) {
    const lowRatio = lowCount / speedsMph.length;
    if (lowRatio > 0 && lowRatio <= 0.05) {
      const nonLow = speedsMph.filter((s) => s >= minSpeedThresholdMph);
      if (nonLow.length > 0) minSpeed = Math.min(...nonLow);
    }
  }

  const maxSpeed = rawMax;

  return { minSpeed, maxSpeed };
}
