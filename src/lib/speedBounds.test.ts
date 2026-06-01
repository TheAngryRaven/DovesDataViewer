import { describe, it, expect } from "vitest";
import { computeHeatmapSpeedBoundsMph } from "./speedBounds";

// ─── computeHeatmapSpeedBoundsMph ────────────────────────────────────────────

describe("computeHeatmapSpeedBoundsMph", () => {
  it("returns {0, 1} for empty input", () => {
    expect(computeHeatmapSpeedBoundsMph([])).toEqual({ minSpeed: 0, maxSpeed: 1 });
  });

  it("uses raw min/max for a clean speed series", () => {
    const speeds = [25, 40, 55, 60, 45, 30];
    const { minSpeed, maxSpeed } = computeHeatmapSpeedBoundsMph(speeds);
    expect(minSpeed).toBe(25);
    expect(maxSpeed).toBe(60);
  });

  it("floors maxSpeed at 1 even when all speeds are 0", () => {
    // rawMax = Math.max(...[0,0,0], 1) = 1.
    const { maxSpeed } = computeHeatmapSpeedBoundsMph([0, 0, 0]);
    expect(maxSpeed).toBe(1);
  });

  it("excludes a SHORT low-speed run (<= maxGlitchSamples) from the min bound", () => {
    // 3 zero samples (a glitch, <= default 10) at the start; real driving 30-60.
    // Those zeros are excluded → min should be the lowest real speed (30).
    const speeds = [0, 0, 0, 30, 45, 60, 55, 40, 35];
    const { minSpeed } = computeHeatmapSpeedBoundsMph(speeds);
    expect(minSpeed).toBe(30);
  });

  it("keeps a LONG low-speed run in the min bound (genuine slow section)", () => {
    // 15 consecutive low samples (> default 10) → not a glitch → min stays 0,
    // unless the low ratio is small enough to override (here it's large).
    const lows = new Array(15).fill(0.2);
    const speeds = [...lows, 30, 45, 60];
    const { minSpeed } = computeHeatmapSpeedBoundsMph(speeds);
    expect(minSpeed).toBeCloseTo(0.2, 6);
  });

  it("treats rare low samples (<=5% ratio) as bad data even in a long run", () => {
    // One low sample (0.5) buried in a long array of real speeds. The single low
    // value is below threshold, lowRatio = 1/N is tiny (<=5%) → use the lowest
    // NON-low speed instead.
    const real = new Array(50).fill(0).map((_, i) => 30 + (i % 10)); // 30..39
    const speeds = [...real, 0.5]; // 1 low sample out of 51 → ~2%
    const { minSpeed } = computeHeatmapSpeedBoundsMph(speeds);
    // The 0.5 should be discarded; min becomes the lowest real value (30).
    expect(minSpeed).toBe(30);
  });

  it("does NOT override when low ratio exceeds 5%", () => {
    // 5 low samples out of 50 = 10% > 5% → no rare-data override; the long run
    // (each low sample is its own run of length 1 <= glitch limit, so excluded
    // by glitch logic actually). Use a contiguous long run to keep min low.
    const lows = new Array(15).fill(0.3); // long contiguous run > 10
    const real = new Array(40).fill(50);
    const speeds = [...lows, ...real]; // 15/55 ≈ 27% low
    const { minSpeed } = computeHeatmapSpeedBoundsMph(speeds);
    expect(minSpeed).toBeCloseTo(0.3, 6);
  });

  it("handles a low-speed run that extends to the end of the array", () => {
    // Trailing short low run (3 samples) should be treated as a glitch and excluded.
    const speeds = [40, 55, 60, 45, 30, 0, 0, 0];
    const { minSpeed } = computeHeatmapSpeedBoundsMph(speeds);
    expect(minSpeed).toBe(30);
  });

  it("respects a custom minSpeedThresholdMph", () => {
    // Threshold 5: speeds of 3 are 'low'. A short run of them is excluded.
    const speeds = [3, 3, 20, 40, 60, 50, 30];
    const { minSpeed } = computeHeatmapSpeedBoundsMph(speeds, {
      minSpeedThresholdMph: 5,
    });
    expect(minSpeed).toBe(20);
  });

  it("respects a custom maxGlitchSamples (smaller window keeps longer lows)", () => {
    // 5 leading zeros. With maxGlitchSamples=3, this run (5) is NOT a glitch,
    // so min stays 0 (and 5/8 low ratio is too large for the rare-data override).
    const speeds = [0, 0, 0, 0, 0, 40, 50, 60];
    const { minSpeed } = computeHeatmapSpeedBoundsMph(speeds, {
      maxGlitchSamples: 3,
    });
    expect(minSpeed).toBe(0);
  });

  it("single sample (above threshold) returns that value for both bounds", () => {
    const { minSpeed, maxSpeed } = computeHeatmapSpeedBoundsMph([42]);
    expect(minSpeed).toBe(42);
    expect(maxSpeed).toBe(42);
  });
});
