import { describe, expect, it } from "vitest";
import { DEFAULT_CALIBRATION, DEFAULT_TOE, forwardCorner, type PillCalibration } from "./model";
import {
  ENVELOPE_BUCKET_COUNT,
  colorBucket,
  colorForBucket,
  colorMetric,
  singlePillLoci,
  sweepEnvelope,
} from "./envelope";

const cal: PillCalibration = { ...DEFAULT_CALIBRATION };

describe("sweepEnvelope", () => {
  it("emits (360/step)^2 points", () => {
    expect(sweepEnvelope(cal, 3, 3, "left", 10)).toHaveLength(36 * 36);
  });

  it("every point is honest — refeeding its angles reproduces its coordinates", () => {
    const points = sweepEnvelope(cal, 4, 2, "left", 30);
    for (const p of points) {
      const r = forwardCorner(cal, { sTop: 4, sBot: 2, thetaTopDeg: p.thetaTopDeg, thetaBotDeg: p.thetaBotDeg }, "left");
      expect(r.camberDeg).toBeCloseTo(p.camberDeg, 9);
      expect(r.casterDeg).toBeCloseTo(p.casterDeg, 9);
    }
  });

  it("camber stays within the analytic annulus bound", () => {
    const points = sweepEnvelope(cal, 3, 3, "left", 6);
    const bound = Math.atan2(cal.eMm[3] * 2, cal.hMm) * (180 / Math.PI) + 1e-6;
    for (const p of points) {
      expect(Math.abs(p.camberDeg)).toBeLessThanOrEqual(bound);
    }
  });

  it("is deterministic", () => {
    expect(sweepEnvelope(cal, 2, 5, "right", 20)).toEqual(sweepEnvelope(cal, 2, 5, "right", 20));
  });
});

describe("singlePillLoci", () => {
  it("closes both loops", () => {
    const { top, bottom } = singlePillLoci(cal, 3, 3, "left", 10);
    expect(top[0].x).toBeCloseTo(top[top.length - 1].x, 9);
    expect(top[0].y).toBeCloseTo(top[top.length - 1].y, 9);
    expect(bottom[0].x).toBeCloseTo(bottom[bottom.length - 1].x, 9);
  });
});

describe("color mapping", () => {
  it("buckets clamp to the valid range", () => {
    expect(colorBucket(-5, 0, 10)).toBe(0);
    expect(colorBucket(15, 0, 10)).toBe(ENVELOPE_BUCKET_COUNT - 1);
    expect(colorBucket(5, 0, 10)).toBe(Math.floor(0.5 * ENVELOPE_BUCKET_COUNT));
  });

  it("degenerate extent maps everything to bucket 0", () => {
    expect(colorBucket(3, 3, 3)).toBe(0);
  });

  it("every bucket yields a valid rgb() color, red end to green end", () => {
    for (let b = 0; b < ENVELOPE_BUCKET_COUNT; b++) {
      expect(colorForBucket(b)).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
    }
    const low = colorForBucket(0).match(/\d+/g)!.map(Number);
    const high = colorForBucket(ENVELOPE_BUCKET_COUNT - 1).match(/\d+/g)!.map(Number);
    expect(low[0]).toBeGreaterThan(low[1]); // red-dominant
    expect(high[1]).toBeGreaterThan(high[0]); // green-dominant
  });

  it("resultantToe metric shifts with static toe and fore-aft coupling", () => {
    const p = sweepEnvelope(cal, 3, 3, "left", 90)[1];
    const base = colorMetric(p, "resultantToe", cal, { ...DEFAULT_TOE, leftToeMm: -2 }, "left");
    const moreOut = colorMetric(p, "resultantToe", cal, { ...DEFAULT_TOE, leftToeMm: -3 }, "left");
    expect(moreOut).toBeCloseTo(base - 1, 9);
    expect(colorMetric(p, "trackDelta", cal, DEFAULT_TOE, "left")).toBe(p.trackDeltaMm);
    expect(colorMetric(p, "thetaTop", cal, DEFAULT_TOE, "left")).toBe(p.thetaTopDeg);
  });
});
