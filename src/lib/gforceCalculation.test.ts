import { describe, it, expect } from "vitest";
import {
  calculateAccelerations,
  smoothField,
  applyGForceCalculations,
} from "./gforceCalculation";
import { STANDARD_GRAVITY_MPS2 } from "./parserUtils";
import type { GpsSample } from "@/types/racing";

// ─── Helpers ────────────────────────────────────────────────────────────────

interface SampleOpts {
  t: number;
  speedMps?: number;
  heading?: number;
  extra?: Record<string, number>;
}

function makeSample(opts: SampleOpts): GpsSample {
  const { t, speedMps = 0, heading, extra = {} } = opts;
  return {
    t,
    lat: 0,
    lon: 0,
    speedMps,
    speedMph: speedMps * 2.23694,
    speedKph: speedMps * 3.6,
    heading,
    extraFields: { ...extra },
  };
}

const G = STANDARD_GRAVITY_MPS2;

// ─── calculateAccelerations ──────────────────────────────────────────────────

describe("calculateAccelerations", () => {
  it("handles empty array without throwing", () => {
    const samples: GpsSample[] = [];
    expect(() => calculateAccelerations(samples)).not.toThrow();
    expect(samples).toEqual([]);
  });

  it("single sample: prev=next=curr → dt=0 → below MIN_DT → zeros", () => {
    // With one sample, prevIdx=nextIdx=0, so dt = 0 < MIN_DT (0.05) → forced zeros.
    const samples = [makeSample({ t: 1000, speedMps: 20 })];
    calculateAccelerations(samples);
    expect(samples[0].extraFields["Lat G"]).toBe(0);
    expect(samples[0].extraFields["Lon G"]).toBe(0);
  });

  it("computes longitudinal G from a constant acceleration", () => {
    // 100ms spacing, speed rising 10 → 12 → 14 m/s. For the middle sample,
    // central difference uses prev (10) and next (14) over dt = 0.2s.
    // dv = 4, dt = 0.2 → accel = 20 m/s² → 20 / 9.80665 ≈ 2.039 G.
    const samples = [
      makeSample({ t: 0, speedMps: 10 }),
      makeSample({ t: 100, speedMps: 12 }),
      makeSample({ t: 200, speedMps: 14 }),
    ];
    calculateAccelerations(samples);
    expect(samples[1].extraFields["Lon G"]).toBeCloseTo(20 / G, 4);
  });

  it("computes lateral G from a steady heading change at speed", () => {
    // Speed 20 m/s, heading 0 → 5 → 10 deg over dt = 0.2s for the middle sample.
    // dHeading (central) = 10 - 0 = 10 deg = 0.17453 rad. yawRate = 0.17453 / 0.2 = 0.87266 rad/s.
    // latG = v * yawRate / g = 20 * 0.87266 / 9.80665 ≈ 1.7796 G.
    const samples = [
      makeSample({ t: 0, speedMps: 20, heading: 0 }),
      makeSample({ t: 100, speedMps: 20, heading: 5 }),
      makeSample({ t: 200, speedMps: 20, heading: 10 }),
    ];
    calculateAccelerations(samples);
    const expected = (20 * ((10 * Math.PI) / 180) / 0.2) / G;
    expect(samples[1].extraFields["Lat G"]).toBeCloseTo(expected, 4);
  });

  it("zeroes lateral G below MIN_SPEED_FOR_LAT_G (2 m/s)", () => {
    // curr.speedMps = 1.5 < 2.0 → lat G not computed (stays 0), but lon G still computed.
    const samples = [
      makeSample({ t: 0, speedMps: 1.0, heading: 0 }),
      makeSample({ t: 100, speedMps: 1.5, heading: 30 }),
      makeSample({ t: 200, speedMps: 2.0, heading: 60 }),
    ];
    calculateAccelerations(samples);
    expect(samples[1].extraFields["Lat G"]).toBe(0);
  });

  it("zeroes lateral G when heading data missing on prev or next", () => {
    const samples = [
      makeSample({ t: 0, speedMps: 20 }), // no heading
      makeSample({ t: 100, speedMps: 20, heading: 5 }),
      makeSample({ t: 200, speedMps: 20, heading: 10 }),
    ];
    calculateAccelerations(samples);
    expect(samples[1].extraFields["Lat G"]).toBe(0);
  });

  it("rejects samples with too-large time gaps (> MAX_DT 2s) → zeros", () => {
    // Middle sample: prev t=0, next t=5000 → dt = 5s > 2s → forced zeros.
    const samples = [
      makeSample({ t: 0, speedMps: 10 }),
      makeSample({ t: 2500, speedMps: 20 }),
      makeSample({ t: 5000, speedMps: 30 }),
    ];
    calculateAccelerations(samples);
    expect(samples[1].extraFields["Lat G"]).toBe(0);
    expect(samples[1].extraFields["Lon G"]).toBe(0);
  });

  it("skips samples with poor HDOP (> MAX_HDOP_FOR_G 5.0)", () => {
    const samples = [
      makeSample({ t: 0, speedMps: 10 }),
      makeSample({ t: 100, speedMps: 12, extra: { HDOP: 8 } }),
      makeSample({ t: 200, speedMps: 14 }),
    ];
    calculateAccelerations(samples);
    expect(samples[1].extraFields["Lat G"]).toBe(0);
    expect(samples[1].extraFields["Lon G"]).toBe(0);
  });

  it("rejects physically impossible heading rate (> MAX_HEADING_RATE 180 deg/s) → latG stays 0", () => {
    // heading 0 → 90 over central dt = 0.2s → 90/0.2 = 450 deg/s > 180 → rejected.
    const samples = [
      makeSample({ t: 0, speedMps: 20, heading: 0 }),
      makeSample({ t: 100, speedMps: 20, heading: 45 }),
      makeSample({ t: 200, speedMps: 20, heading: 90 }),
    ];
    calculateAccelerations(samples);
    expect(samples[1].extraFields["Lat G"]).toBe(0);
  });

  it("clamps longitudinal G to ±3 (MAX_G)", () => {
    // Huge speed jump over 100ms → enormous accel → clamped to +3.
    const samples = [
      makeSample({ t: 0, speedMps: 0 }),
      makeSample({ t: 50, speedMps: 50 }),
      makeSample({ t: 100, speedMps: 100 }),
    ];
    calculateAccelerations(samples);
    expect(samples[1].extraFields["Lon G"]).toBe(3);
  });

  it("clamps negative (braking) longitudinal G to -3", () => {
    const samples = [
      makeSample({ t: 0, speedMps: 100 }),
      makeSample({ t: 50, speedMps: 50 }),
      makeSample({ t: 100, speedMps: 0 }),
    ];
    calculateAccelerations(samples);
    expect(samples[1].extraFields["Lon G"]).toBe(-3);
  });
});

// ─── smoothField ─────────────────────────────────────────────────────────────

describe("smoothField", () => {
  it("handles empty array", () => {
    const samples: GpsSample[] = [];
    expect(() => smoothField(samples, "Lat G")).not.toThrow();
  });

  it("averages within the window (default window 5 → halfWindow 2)", () => {
    const samples = [
      makeSample({ t: 0, extra: { v: 0 } }),
      makeSample({ t: 1, extra: { v: 10 } }),
      makeSample({ t: 2, extra: { v: 20 } }),
      makeSample({ t: 3, extra: { v: 30 } }),
      makeSample({ t: 4, extra: { v: 40 } }),
    ];
    smoothField(samples, "v", 5);
    // Middle index 2: window [0..4] → mean(0,10,20,30,40) = 20.
    expect(samples[2].extraFields["v"]).toBe(20);
    // Index 0: window [0..2] (clamped) → mean(0,10,20) = 10.
    expect(samples[0].extraFields["v"]).toBe(10);
    // Index 4: window [2..4] (clamped) → mean(20,30,40) = 30.
    expect(samples[4].extraFields["v"]).toBe(30);
  });

  it("treats missing field values as 0", () => {
    const samples = [
      makeSample({ t: 0, extra: { v: 10 } }),
      makeSample({ t: 1 }), // no 'v'
      makeSample({ t: 2, extra: { v: 20 } }),
    ];
    smoothField(samples, "v", 3);
    // Index 1: window [0..2] → mean(10, 0, 20) = 10.
    expect(samples[1].extraFields["v"]).toBe(10);
  });

  it("window of 1 leaves values unchanged (halfWindow 0)", () => {
    const samples = [
      makeSample({ t: 0, extra: { v: 5 } }),
      makeSample({ t: 1, extra: { v: 99 } }),
    ];
    smoothField(samples, "v", 1);
    expect(samples[0].extraFields["v"]).toBe(5);
    expect(samples[1].extraFields["v"]).toBe(99);
  });
});

// ─── applyGForceCalculations ─────────────────────────────────────────────────

describe("applyGForceCalculations", () => {
  it("populates and smooths both Lat G and Lon G fields", () => {
    const samples = [
      makeSample({ t: 0, speedMps: 10, heading: 0 }),
      makeSample({ t: 100, speedMps: 12, heading: 5 }),
      makeSample({ t: 200, speedMps: 14, heading: 10 }),
      makeSample({ t: 300, speedMps: 16, heading: 15 }),
      makeSample({ t: 400, speedMps: 18, heading: 20 }),
    ];
    applyGForceCalculations(samples, 5);
    for (const s of samples) {
      expect(typeof s.extraFields["Lat G"]).toBe("number");
      expect(typeof s.extraFields["Lon G"]).toBe("number");
      expect(Number.isFinite(s.extraFields["Lat G"])).toBe(true);
      expect(Number.isFinite(s.extraFields["Lon G"])).toBe(true);
    }
  });

  it("handles empty input gracefully", () => {
    const samples: GpsSample[] = [];
    expect(() => applyGForceCalculations(samples)).not.toThrow();
  });
});
