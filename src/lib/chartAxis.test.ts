import { describe, it, expect } from "vitest";
import { EARTH_RADIUS_M } from "./parserUtils";
import {
  buildChartAxis,
  computeAxisPositions,
  formatAxisDistance,
  formatAxisTime,
} from "./chartAxis";
import type { GpsSample } from "@/types/racing";

const BASE_LAT = 45;
const BASE_LON = 9;
const M_PER_DEG_LAT = (Math.PI / 180) * EARTH_RADIUS_M;

// Sample whose planar distance from the origin equals `distM` (lat-only shift),
// timestamped at `t` ms — so both axis quantities are exactly known.
function makeSample(distM: number, t: number): GpsSample {
  return {
    t,
    lat: BASE_LAT + distM / M_PER_DEG_LAT,
    lon: BASE_LON,
    speedMps: 0,
    speedMph: 0,
    speedKph: 0,
    extraFields: {},
  };
}

describe("computeAxisPositions", () => {
  it("returns elapsed-time fractions in time mode", () => {
    // Non-uniform timestamps: 0, 100, 400 ms.
    const samples = [makeSample(0, 0), makeSample(10, 100), makeSample(20, 400)];
    const pos = computeAxisPositions(samples, "time");
    expect(pos[0]).toBe(0);
    expect(pos[1]).toBeCloseTo(0.25, 6);
    expect(pos[2]).toBe(1);
  });

  it("returns cumulative-distance fractions in distance mode", () => {
    // Distances 0, 10, 40 m but evenly timed — distance axis must follow space.
    const samples = [makeSample(0, 0), makeSample(10, 100), makeSample(40, 200)];
    const pos = computeAxisPositions(samples, "distance");
    expect(pos[0]).toBe(0);
    expect(pos[1]).toBeCloseTo(0.25, 4);
    expect(pos[2]).toBeCloseTo(1, 6);
  });

  it("is monotonic non-decreasing and bounded to [0,1]", () => {
    const samples = Array.from({ length: 50 }, (_, i) => makeSample(i * i, i * 17));
    for (const mode of ["time", "distance"] as const) {
      const pos = computeAxisPositions(samples, mode);
      expect(pos[0]).toBe(0);
      expect(pos[pos.length - 1]).toBeCloseTo(1, 6);
      for (let i = 1; i < pos.length; i++) {
        expect(pos[i]).toBeGreaterThanOrEqual(pos[i - 1]);
        expect(pos[i]).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it("falls back to a linear index ramp when the quantity has no span", () => {
    // Stationary trace (zero distance) and identical timestamps (zero duration).
    const stationary = [makeSample(0, 0), makeSample(0, 0), makeSample(0, 0)];
    expect(computeAxisPositions(stationary, "distance")).toEqual([0, 0.5, 1]);
    expect(computeAxisPositions(stationary, "time")).toEqual([0, 0.5, 1]);
  });

  it("handles empty and single-sample inputs", () => {
    expect(computeAxisPositions([], "time")).toEqual([]);
    expect(computeAxisPositions([makeSample(0, 0)], "distance")).toEqual([0]);
  });
});

describe("buildChartAxis.indexAt", () => {
  it("inverts fracAt to the nearest sample", () => {
    const samples = [makeSample(0, 0), makeSample(10, 100), makeSample(40, 200)];
    const axis = buildChartAxis(samples, "distance", { useMetricDistance: true });
    // Round-trip every sample's own fraction back to its index.
    samples.forEach((_, i) => expect(axis.indexAt(axis.fracAt(i))).toBe(i));
    // A fraction just past the midpoint snaps to the closer endpoint sample.
    expect(axis.indexAt(0.24)).toBe(1);
    expect(axis.indexAt(0)).toBe(0);
    expect(axis.indexAt(1)).toBe(2);
  });

  it("clamps out-of-range fractions", () => {
    const samples = [makeSample(0, 0), makeSample(10, 100)];
    const axis = buildChartAxis(samples, "time", { useMetricDistance: false });
    expect(axis.indexAt(-5)).toBe(0);
    expect(axis.indexAt(5)).toBe(1);
  });
});

describe("buildChartAxis.label", () => {
  it("labels time mode as m:ss across the axis", () => {
    const samples = [makeSample(0, 0), makeSample(10, 90_000)]; // 90 s span
    const axis = buildChartAxis(samples, "time", { useMetricDistance: false });
    expect(axis.label(0)).toBe("0:00");
    expect(axis.label(1)).toBe("1:30");
  });

  it("labels distance mode in the distance-unit family", () => {
    const samples = [makeSample(0, 0), makeSample(100, 1000)]; // 100 m span
    const metric = buildChartAxis(samples, "distance", { useMetricDistance: true });
    expect(metric.label(0)).toBe("0 m");
    expect(metric.label(1)).toBe("100 m");

    const imperial = buildChartAxis(samples, "distance", { useMetricDistance: false });
    expect(imperial.label(1)).toBe("328 ft");
  });
});

describe("buildChartAxis absolute labels (fullSamples + rangeStart)", () => {
  // Full lap: 11 points, 10 m apart (0..100 m), 1 s apart (0..10 s).
  const fullLap = Array.from({ length: 11 }, (_, i) => makeSample(i * 10, i * 1000));

  it("labels a cropped window in absolute distance from the lap start", () => {
    const window = fullLap.slice(3, 7); // 30 m .. 60 m
    const axis = buildChartAxis(window, "distance", { useMetricDistance: true, fullSamples: fullLap, rangeStart: 3 });
    // Window still fills the canvas (data fractions span 0..1)...
    expect(axis.fracAt(0)).toBe(0);
    expect(axis.fracAt(3)).toBeCloseTo(1, 6);
    // ...but tick labels are anchored at the start-finish line.
    expect(axis.label(0)).toBe("30 m");
    expect(axis.label(1)).toBe("60 m");
    expect(axis.label(0.5)).toBe("45 m");
  });

  it("labels a cropped window in absolute time from the lap start", () => {
    const window = fullLap.slice(4, 9); // 4 s .. 8 s
    const axis = buildChartAxis(window, "time", { useMetricDistance: false, fullSamples: fullLap, rangeStart: 4 });
    expect(axis.label(0)).toBe("0:04");
    expect(axis.label(1)).toBe("0:08");
  });

  it("anchors at 0 when the window starts at the lap origin", () => {
    const window = fullLap.slice(0, 5); // 0 m .. 40 m
    const axis = buildChartAxis(window, "distance", { useMetricDistance: true, fullSamples: fullLap, rangeStart: 0 });
    expect(axis.label(0)).toBe("0 m");
    expect(axis.label(1)).toBe("40 m");
  });
});

describe("format helpers", () => {
  it("formats time as m:ss", () => {
    expect(formatAxisTime(0)).toBe("0:00");
    expect(formatAxisTime(65)).toBe("1:05");
  });

  it("switches distance units past a full km / mile", () => {
    expect(formatAxisDistance(500, true)).toBe("500 m");
    expect(formatAxisDistance(1500, true)).toBe("1.50 km");
    expect(formatAxisDistance(304.8, false)).toBe("1000 ft");
    expect(formatAxisDistance(1609.344, false)).toBe("1.00 mi");
  });
});
