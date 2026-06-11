/**
 * Unit tests for shared chart utilities (TelemetryChart / SingleSeriesChart).
 *
 * These are pure helpers: smoothing-window sizing, moving-average smoothing,
 * and the GPS speed-glitch detection + interpolation used to bridge short
 * dropouts where the receiver briefly reports near-zero speed.
 */

import { describe, it, expect } from "vitest";
import {
  computeSmoothingWindowSize,
  applySmoothingToValues,
  detectSpeedGlitchIndices,
  interpolateGlitchSpeed,
  numericExtent,
} from "./chartUtils";

// ─── numericExtent ──────────────────────────────────────────────────────────

describe("numericExtent", () => {
  it("finds min and max of a plain numeric array", () => {
    expect(numericExtent([3, -1, 7, 0])).toEqual({ min: -1, max: 7 });
  });

  it("skips null, undefined, and NaN entries", () => {
    expect(numericExtent([null, 5, undefined, NaN, 2])).toEqual({ min: 2, max: 5 });
  });

  it("returns null when nothing numeric remains", () => {
    expect(numericExtent([])).toBeNull();
    expect(numericExtent([null, undefined, NaN])).toBeNull();
  });

  it("handles a single-element array", () => {
    expect(numericExtent([42])).toEqual({ min: 42, max: 42 });
  });

  it("does not stack-overflow on very large arrays (regression for Math.max(...arr))", () => {
    // Math.max(...arr) throws RangeError above ~65k elements on mobile Safari
    // (~125k in V8) — a 2-hour 20 Hz session viewed as All Laps exceeds that.
    const big = new Array<number>(200_000);
    for (let i = 0; i < big.length; i++) big[i] = Math.sin(i) * 100;
    const extent = numericExtent(big);
    expect(extent).not.toBeNull();
    expect(extent!.min).toBeGreaterThanOrEqual(-100);
    expect(extent!.max).toBeLessThanOrEqual(100);
  });
});

// ─── computeSmoothingWindowSize ─────────────────────────────────────────────

describe("computeSmoothingWindowSize", () => {
  it("returns 1 (no smoothing) when disabled, regardless of strength", () => {
    expect(computeSmoothingWindowSize(false, 0)).toBe(1);
    expect(computeSmoothingWindowSize(false, 100)).toBe(1);
  });

  it("maps strength 0 to a window of 1 (still effectively no smoothing)", () => {
    expect(computeSmoothingWindowSize(true, 0)).toBe(1);
  });

  it("maps strength 100 to the maximum window of 15", () => {
    expect(computeSmoothingWindowSize(true, 100)).toBe(15);
  });

  it("scales monotonically and floors to an integer between the extremes", () => {
    // 1 + 0.5*14 = 8
    expect(computeSmoothingWindowSize(true, 50)).toBe(8);
    const w25 = computeSmoothingWindowSize(true, 25);
    const w75 = computeSmoothingWindowSize(true, 75);
    expect(w25).toBeLessThan(w75);
    expect(Number.isInteger(w25)).toBe(true);
  });
});

// ─── applySmoothingToValues ─────────────────────────────────────────────────

describe("applySmoothingToValues", () => {
  it("returns the input unchanged for window sizes <= 1", () => {
    const vals = [1, 2, 3];
    expect(applySmoothingToValues(vals, 1)).toBe(vals);
    expect(applySmoothingToValues(vals, 0)).toBe(vals);
  });

  it("averages over a symmetric window, clamping at the edges", () => {
    // window 3 → halfWindow 1
    const out = applySmoothingToValues([0, 10, 20, 30], 3);
    // i=0: mean(0,10)=5; i=1: mean(0,10,20)=10; i=2: mean(10,20,30)=20; i=3: mean(20,30)=25
    expect(out).toEqual([5, 10, 20, 25]);
  });

  it("preserves undefined gaps and skips them when averaging neighbors", () => {
    const out = applySmoothingToValues([10, undefined, 30], 3);
    expect(out[1]).toBeUndefined();
    // i=0: mean(10) = 10 (the undefined neighbor is skipped)
    expect(out[0]).toBe(10);
    // i=2: mean(30) = 30
    expect(out[2]).toBe(30);
  });

  it("falls back to the original value when no neighbors are defined", () => {
    // A lone defined value surrounded by undefineds with window > 1
    const out = applySmoothingToValues([undefined, 42, undefined], 3);
    expect(out[1]).toBe(42);
  });
});

// ─── detectSpeedGlitchIndices ───────────────────────────────────────────────

describe("detectSpeedGlitchIndices", () => {
  it("flags a short low-speed run bounded by normal speeds", () => {
    // indices 2,3 dip to ~0 then recover — a 2-sample glitch (<= 3)
    const speeds = [30, 30, 0.2, 0.1, 30, 30];
    const glitches = detectSpeedGlitchIndices(speeds);
    expect([...glitches].sort((a, b) => a - b)).toEqual([2, 3]);
  });

  it("ignores low-speed runs longer than maxGlitchSamples (a real stop)", () => {
    // 4 consecutive low samples > default max of 3 → a genuine stop, not a glitch
    const speeds = [30, 0.1, 0.1, 0.1, 0.1, 30];
    expect(detectSpeedGlitchIndices(speeds).size).toBe(0);
  });

  it("flags a trailing low-speed run that never recovers (within the cap)", () => {
    const speeds = [30, 30, 0.2, 0.1];
    expect([...detectSpeedGlitchIndices(speeds)].sort((a, b) => a - b)).toEqual([2, 3]);
  });

  it("honors a custom threshold and max-run length", () => {
    const speeds = [30, 4, 4, 30];
    // default threshold 1.0 wouldn't catch 4; raise it to 5 with max 2
    expect([...detectSpeedGlitchIndices(speeds, 5, 2)].sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it("returns an empty set when nothing dips below threshold", () => {
    expect(detectSpeedGlitchIndices([30, 31, 32]).size).toBe(0);
  });
});

// ─── interpolateGlitchSpeed ─────────────────────────────────────────────────

describe("interpolateGlitchSpeed", () => {
  it("uses the next valid speed when there is no prior valid value", () => {
    const speeds = [0.1, 0.1, 25];
    const glitches = new Set([0, 1]);
    // lastValidSpeed null → look forward to the first non-glitch (index 2 = 25)
    expect(interpolateGlitchSpeed(0, speeds, glitches, null, -1)).toBe(25);
  });

  it("linearly interpolates between the last and next valid speeds", () => {
    // glitch at index 2; last valid 10 @ idx1, next valid 30 @ idx4
    const speeds = [10, 10, 0.1, 0.1, 30];
    const glitches = new Set([2, 3]);
    // progress = (2-1)/(4-1) = 1/3 → 10 + (30-10)/3 = 16.666…
    expect(interpolateGlitchSpeed(2, speeds, glitches, 10, 1)).toBeCloseTo(16.6667, 3);
  });

  it("holds the last valid speed when no later valid sample exists", () => {
    const speeds = [10, 0.1, 0.1];
    const glitches = new Set([1, 2]);
    // no next valid → nextValidSpeed stays lastValidSpeed (10), so result is 10
    expect(interpolateGlitchSpeed(1, speeds, glitches, 10, 0)).toBe(10);
  });

  it("falls back to the sample's own value when it is the only one and unprimed", () => {
    const speeds = [0.5];
    const glitches = new Set([0]);
    expect(interpolateGlitchSpeed(0, speeds, glitches, null, -1)).toBe(0.5);
  });
});
