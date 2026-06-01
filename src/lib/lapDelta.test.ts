import { describe, it, expect } from "vitest";
import { EARTH_RADIUS_M } from "./parserUtils";
import { resampleByDistance, computePositionDelta, smoothDelta, computeLapPace } from "./lapDelta";
import { calculatePace } from "./referenceUtils";
import type { GpsSample } from "@/types/racing";

// Build a straight lap heading north: positions are spaced `spacingM` apart and
// timestamped every `dtMs`. Varying only latitude makes planar distance equal to
// the latitude delta in meters, so geometry is exactly known.
const BASE_LAT = 45;
const BASE_LON = 9;
const M_PER_DEG_LAT = (Math.PI / 180) * EARTH_RADIUS_M;

function makeSample(distM: number, t: number, latShiftM = 0): GpsSample {
  return {
    t,
    lat: BASE_LAT + (distM + latShiftM) / M_PER_DEG_LAT,
    lon: BASE_LON,
    speedMps: 0,
    speedMph: 0,
    speedKph: 0,
    extraFields: {},
  };
}

function lineLap(points: number, spacingM: number, dtMs: number, t0 = 0): GpsSample[] {
  return Array.from({ length: points }, (_, i) => makeSample(i * spacingM, t0 + i * dtMs));
}

describe("resampleByDistance", () => {
  it("produces a uniform arc-length grid with linear time for constant speed", () => {
    // 100 m lap, points every 1 m, 10 ms apart (=> 100 m/s, 1000 ms total).
    const lap = lineLap(101, 1, 10);
    const r = resampleByDistance(lap, 2);

    // cumDist steps of exactly 2 m, ending at 100 m.
    expect(r.cumDist[0]).toBe(0);
    expect(r.cumDist[1]).toBeCloseTo(2, 6);
    expect(r.cumDist[r.cumDist.length - 1]).toBeCloseTo(100, 3);
    expect(r.xy.length).toBe(r.cumDist.length);

    // Constant speed => elapsed time linear in distance: 10 ms/m.
    for (let k = 0; k < r.cumDist.length; k++) {
      expect(r.elapsedMs[k]).toBeCloseTo(r.cumDist[k] * 10, 3);
    }
  });

  it("is independent of source GPS rate (same path, different sampling)", () => {
    // Same 100 m path at 100 m/s, sampled coarsely (5 m) vs finely (1 m).
    const coarse = resampleByDistance(lineLap(21, 5, 50), 2);
    const fine = resampleByDistance(lineLap(101, 1, 10), 2);

    expect(coarse.cumDist.length).toBe(fine.cumDist.length);
    for (let k = 0; k < fine.cumDist.length; k++) {
      expect(coarse.cumDist[k]).toBeCloseTo(fine.cumDist[k], 3);
      expect(coarse.elapsedMs[k]).toBeCloseTo(fine.elapsedMs[k], 1);
    }
  });

  it("handles degenerate laps without throwing", () => {
    expect(resampleByDistance([], 2).xy).toHaveLength(0);
    expect(resampleByDistance(lineLap(1, 1, 10), 2).xy).toHaveLength(1);
  });
});

describe("computePositionDelta", () => {
  it("reports ~zero gap for a lap compared against itself", () => {
    const lap = lineLap(101, 1, 10);
    const ref = resampleByDistance(lap, 2);
    const { delta } = computePositionDelta(lap, ref);

    for (const d of delta) {
      expect(d).not.toBeNull();
      expect(Math.abs(d as number)).toBeLessThan(0.02);
    }
  });

  it("shows a growing positive gap for a uniformly slower lap", () => {
    const ref = resampleByDistance(lineLap(101, 1, 10), 2); // 10 ms/m
    const slow = lineLap(101, 1, 11); // 11 ms/m => 10% slower
    const { delta, rawDelta } = computePositionDelta(slow, ref);

    // Monotonic non-decreasing gap, ending near 0.1 * 1000 ms = 0.1 s.
    const last = rawDelta[rawDelta.length - 1] as number;
    expect(last).toBeCloseTo(0.1, 2);
    expect(delta[0] as number).toBeLessThan(delta[delta.length - 1] as number);
  });

  it("shows a negative gap for a faster lap", () => {
    const ref = resampleByDistance(lineLap(101, 1, 11), 2);
    const fast = lineLap(101, 1, 10);
    const { rawDelta } = computePositionDelta(fast, ref);
    expect(rawDelta[rawDelta.length - 1] as number).toBeLessThan(0);
  });

  it("interpolates the closest point along a segment (no grid snapping)", () => {
    // Coarse 10 m reference; current fixes fall between grid points.
    const ref = resampleByDistance(lineLap(101, 1, 10), 10);
    const current = lineLap(101, 1, 10).map((s, i) => makeSample(i + 0.5, s.t)); // +0.5 m offset
    const { matchFrac } = computePositionDelta(current, ref);
    // Some matches must be fractional — proof we project onto the segment.
    expect(matchFrac.some((f) => f > 0.05 && f < 0.95)).toBe(true);
  });

  it("rejects impossible gaps via the sanity guard", () => {
    const ref = resampleByDistance(lineLap(101, 1, 10), 2);
    const slow = lineLap(101, 1, 11); // gap grows toward ~0.1 s
    const { rawDelta } = computePositionDelta(slow, ref, { sanitySeconds: 0.05 });
    // Late-lap gaps exceed the 0.05 s guard and are nulled; early ones survive.
    expect(rawDelta.some((d) => d === null)).toBe(true);
    expect(rawDelta.some((d) => d !== null)).toBe(true);
  });

  it("does not flag a same-direction reference as reversed", () => {
    const ref = resampleByDistance(lineLap(101, 1, 10), 2);
    expect(computePositionDelta(lineLap(101, 1, 10), ref).reversed).toBe(false);
  });

  it("flags a reverse-direction reference and nulls the deltas instead of emitting garbage", () => {
    // Reference runs south→north; the current lap runs north→south on the same
    // line — the same course driven the other way.
    const ref = resampleByDistance(lineLap(101, 1, 10), 2);
    const reverse = Array.from({ length: 101 }, (_, i) => makeSample(100 - i, i * 10));
    const res = computePositionDelta(reverse, ref);
    expect(res.reversed).toBe(true);
    expect(res.delta.every((d) => d === null)).toBe(true);
  });
});

describe("computeLapPace", () => {
  it("delegates to the legacy distance method when selected", () => {
    const current = lineLap(101, 1, 11);
    const reference = lineLap(101, 1, 10);
    const viaSelector = computeLapPace(current, reference, { method: "distance", sampleMeters: 2 });
    expect(viaSelector).toEqual(calculatePace(current, reference));
  });

  it("uses the position method by resampling + projecting", () => {
    const current = lineLap(101, 1, 10);
    const reference = lineLap(101, 1, 10);
    const pace = computeLapPace(current, reference, { method: "position", sampleMeters: 2 });
    expect(pace).toHaveLength(current.length);
    for (const d of pace) expect(Math.abs((d as number) ?? 0)).toBeLessThan(0.02);
  });
});

describe("smoothDelta", () => {
  it("leaves a constant signal unchanged", () => {
    const out = smoothDelta([1, 1, 1, 1, 1], 0.3, true);
    for (const v of out) expect(v).toBeCloseTo(1, 6);
  });

  it("holds the last value across null gaps and survives leading nulls", () => {
    const out = smoothDelta([null, 2, null, 2], 0.5, false);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeCloseTo(2, 6);
    expect(out[2]).toBeCloseTo(2, 6); // held across the gap
  });
});
