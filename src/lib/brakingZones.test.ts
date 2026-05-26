import { describe, it, expect } from "vitest";
import {
  DEFAULT_BRAKING_CONFIG,
  detectBrakingZones,
  computeBrakingGSeries,
  computeBrakingGSeriesSG,
  gToBrakePercent,
} from "./brakingZones";
import type { GpsSample } from "@/types/racing";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build samples from an mph series, spaced `dtMs` apart. Braking zone detection
 * derives deceleration from `speedMph`, so that's the field that matters here.
 */
function makeSamples(speedsMph: number[], dtMs = 100): GpsSample[] {
  return speedsMph.map((mph, i) => ({
    t: i * dtMs,
    lat: 28.5 + i * 1e-5, // near a real Florida track
    lon: -81.4 + i * 1e-5,
    speedMps: mph * 0.44704,
    speedMph: mph,
    speedKph: mph * 1.60934,
    extraFields: {},
  }));
}

// ─── DEFAULT_BRAKING_CONFIG ────────────────────────────────────────────────────

describe("DEFAULT_BRAKING_CONFIG", () => {
  it("matches the documented defaults", () => {
    expect(DEFAULT_BRAKING_CONFIG).toEqual({
      entryThresholdG: -0.25,
      exitThresholdG: -0.1,
      minDurationMs: 120,
      smoothingAlpha: 0.4,
    });
  });
});

// ─── detectBrakingZones ────────────────────────────────────────────────────────

describe("detectBrakingZones", () => {
  it("returns [] for fewer than 3 samples", () => {
    expect(detectBrakingZones([])).toEqual([]);
    expect(detectBrakingZones(makeSamples([40, 30]))).toEqual([]);
  });

  it("returns [] for a steady-speed run (no deceleration)", () => {
    const samples = makeSamples([40, 40, 40, 40, 40, 40]);
    expect(detectBrakingZones(samples)).toEqual([]);
  });

  it("returns [] for pure acceleration", () => {
    const samples = makeSamples([20, 25, 30, 35, 40, 45, 50]);
    expect(detectBrakingZones(samples)).toEqual([]);
  });

  it("detects a clear hard-braking event", () => {
    // Cruise at 60 then brake hard to 20 over several samples, then steady.
    // Each 100ms drop of ~8mph ≈ 3.58 m/s over 0.1s = 35.8 m/s² ≈ 3.6G (clamped to 3).
    const samples = makeSamples([
      60, 60, 60, // cruising
      52, 44, 36, 28, 20, // braking
      20, 20, 20, // settled
    ]);
    const zones = detectBrakingZones(samples);
    expect(zones.length).toBeGreaterThanOrEqual(1);
    const z = zones[0];
    expect(z.speedDeltaMps).toBeLessThan(0); // lost speed
    expect(z.durationMs).toBeGreaterThanOrEqual(DEFAULT_BRAKING_CONFIG.minDurationMs);
    expect(z.path.length).toBeGreaterThanOrEqual(2);
    // Path endpoints align with start/end coords.
    expect(z.path[0]).toEqual({ lat: z.start.lat, lon: z.start.lon });
    expect(z.path[z.path.length - 1]).toEqual({ lat: z.end.lat, lon: z.end.lon });
  });

  it("discards braking events shorter than minDurationMs", () => {
    // A single hard 100ms decel dip. With minDurationMs=120 the zone (one step,
    // 100ms) is too short and should be dropped.
    const samples = makeSamples([60, 60, 40, 60, 60, 60, 60]);
    const zones = detectBrakingZones(samples);
    expect(zones.length).toBe(0);
  });

  it("respects a relaxed minDurationMs that admits a short zone", () => {
    const samples = makeSamples([60, 60, 50, 40, 30, 30, 30]);
    const zones = detectBrakingZones(samples, {
      ...DEFAULT_BRAKING_CONFIG,
      minDurationMs: 50,
    });
    expect(zones.length).toBeGreaterThanOrEqual(1);
  });

  it("closes a braking zone that extends to the end of samples", () => {
    // Braking continuously through the final sample.
    const samples = makeSamples([60, 58, 50, 42, 34, 26, 18, 12]);
    const zones = detectBrakingZones(samples, {
      ...DEFAULT_BRAKING_CONFIG,
      minDurationMs: 50,
    });
    expect(zones.length).toBeGreaterThanOrEqual(1);
    // Last zone should end on the final sample.
    const last = zones[zones.length - 1];
    expect(last.end.t).toBe(samples[samples.length - 1].t);
  });

  it("ignores low-speed samples (both below MIN_SPEED 2 m/s ≈ 4.5 mph)", () => {
    // Crawl from 4 → 0 mph: both samples under the min-speed gate → no braking zone.
    const samples = makeSamples([4, 3, 2, 1, 0, 0, 0]);
    expect(detectBrakingZones(samples)).toEqual([]);
  });

  it("ends an open braking zone when a GPS time gap appears", () => {
    // Braking, then a >2s gap (invalid dt) mid-event; if the pre-gap portion was
    // long enough it gets recorded, otherwise dropped — either way the function
    // must not throw and must reset state.
    const samples: GpsSample[] = makeSamples([60, 54, 46, 38, 30], 100);
    // Insert a large time jump on the next sample (gap = 5s > MAX_DT 2s).
    const tail = makeSamples([30, 30, 30], 100).map((s, i) => ({
      ...s,
      t: samples[samples.length - 1].t + 5000 + i * 100,
    }));
    const combined = [...samples, ...tail];
    expect(() => detectBrakingZones(combined)).not.toThrow();
  });
});

// ─── computeBrakingGSeries ─────────────────────────────────────────────────────

describe("computeBrakingGSeries", () => {
  it("returns [] for empty input", () => {
    expect(computeBrakingGSeries([])).toEqual([]);
  });

  it("returns one value per sample, starting with 0", () => {
    const samples = makeSamples([40, 38, 36, 34, 32]);
    const series = computeBrakingGSeries(samples);
    expect(series.length).toBe(samples.length);
    expect(series[0]).toBe(0);
  });

  it("produces negative G during deceleration", () => {
    const samples = makeSamples([60, 52, 44, 36, 28, 20]);
    const series = computeBrakingGSeries(samples);
    // After the first sample, the smoothed G should trend negative.
    expect(series[series.length - 1]).toBeLessThan(0);
  });

  it("produces positive G during acceleration", () => {
    const samples = makeSamples([20, 28, 36, 44, 52, 60]);
    const series = computeBrakingGSeries(samples);
    expect(series[series.length - 1]).toBeGreaterThan(0);
  });

  it("carries the previous value forward across a GPS time gap", () => {
    const samples = makeSamples([60, 52, 44], 100);
    // Append a sample 5s later (gap > MAX_DT) — its G should equal the prior smoothed value.
    samples.push({
      ...makeSamples([36])[0],
      t: samples[samples.length - 1].t + 5000,
    });
    const series = computeBrakingGSeries(samples);
    expect(series.length).toBe(4);
    expect(series[3]).toBe(series[2]); // carried forward
  });

  it("carries forward when both samples are below the min speed gate", () => {
    const samples = makeSamples([4, 3, 2, 1], 100);
    const series = computeBrakingGSeries(samples);
    // All deltas gated out → series stays at the seed 0.
    expect(series.every((g) => g === 0)).toBe(true);
  });

  it("clamps raw acceleration to ±3G physical limit", () => {
    // Impossible instantaneous drop → clamped magnitude not exceeding 3.
    const samples = makeSamples([120, 20, 20], 100);
    const series = computeBrakingGSeries(samples);
    for (const g of series) {
      expect(Math.abs(g)).toBeLessThanOrEqual(3 + 1e-9);
    }
  });
});

// ─── computeBrakingGSeriesSG ───────────────────────────────────────────────────

describe("computeBrakingGSeriesSG", () => {
  it("falls back to the EMA series for datasets smaller than the window", () => {
    // 5 samples, default window 25 → falls back to computeBrakingGSeries.
    const samples = makeSamples([60, 52, 44, 36, 28]);
    const sg = computeBrakingGSeriesSG(samples);
    const ema = computeBrakingGSeries(samples);
    expect(sg).toEqual(ema);
  });

  it("returns one value per sample for a long series", () => {
    // 40 samples decelerating — enough for the SG window (default 25).
    const speeds = Array.from({ length: 40 }, (_, i) => Math.max(20, 60 - i));
    const samples = makeSamples(speeds, 100);
    const sg = computeBrakingGSeriesSG(samples);
    expect(sg.length).toBe(samples.length);
    sg.forEach((g) => {
      expect(Number.isFinite(g)).toBe(true);
      expect(Math.abs(g)).toBeLessThanOrEqual(3 + 1e-9);
    });
  });

  it("reports negative G while braking on a long decel ramp", () => {
    const speeds = Array.from({ length: 40 }, (_, i) => Math.max(15, 70 - 1.2 * i));
    const samples = makeSamples(speeds, 100);
    const sg = computeBrakingGSeriesSG(samples);
    // Mid-ramp (still decelerating, above the min-speed gate) should read negative.
    expect(sg[15]).toBeLessThan(0);
  });

  it("zeroes G where speed is below the min-speed gate", () => {
    // 30 samples all crawling under MIN_SPEED (≈4.5 mph).
    const samples = makeSamples(new Array(30).fill(3), 100);
    const sg = computeBrakingGSeriesSG(samples);
    expect(sg.every((g) => g === 0)).toBe(true);
  });
});

// ─── gToBrakePercent ───────────────────────────────────────────────────────────

describe("gToBrakePercent", () => {
  it("maps positive/zero G to 0% (acceleration is not braking)", () => {
    expect(gToBrakePercent([0, 0.5, 2])).toEqual([0, 0, 0]);
  });

  it("maps -maxG to 100%", () => {
    expect(gToBrakePercent([-1.5], 1.5)).toEqual([100]);
  });

  it("maps half of maxG to 50%", () => {
    expect(gToBrakePercent([-0.75], 1.5)).toEqual([50]);
  });

  it("clamps decel beyond maxG to 100%", () => {
    expect(gToBrakePercent([-3], 1.5)).toEqual([100]);
  });

  it("respects a custom maxG", () => {
    // -0.5G with maxG 1.0 → 50%.
    expect(gToBrakePercent([-0.5], 1.0)).toEqual([50]);
  });

  it("maps an empty series to an empty array", () => {
    expect(gToBrakePercent([])).toEqual([]);
  });

  it("processes a mixed series elementwise", () => {
    expect(gToBrakePercent([0, -0.75, 1, -1.5], 1.5)).toEqual([0, 50, 0, 100]);
  });
});
