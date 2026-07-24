import { describe, expect, it } from "vitest";
import {
  DEFAULT_CALIBRATION,
  forwardCorner,
  holeIndex,
  normalizeDeg,
  pillContribution,
  snapToHole,
  type CornerPills,
  type PillCalibration,
} from "./model";

const cal = (over: Partial<PillCalibration> = {}): PillCalibration => ({
  ...DEFAULT_CALIBRATION,
  ...over,
});

const pills = (over: Partial<CornerPills> = {}): CornerPills => ({
  sTop: 3,
  sBot: 3,
  thetaTopDeg: 0,
  thetaBotDeg: 0,
  ...over,
});

describe("forwardCorner", () => {
  it("concentric pills reproduce only the built-in geometry", () => {
    const c = cal({ gamma0Deg: -0.4, nXMm: 1, nYMm: -0.5 });
    const r = forwardCorner(c, pills({ sTop: 0, sBot: 0 }), "left");
    expect(r.camberDeg).toBeCloseTo(-0.4 + Math.atan2(-0.5, c.hMm) * (180 / Math.PI), 6);
    expect(r.casterDeg).toBeCloseTo(Math.atan2(-1, c.hMm) * (180 / Math.PI), 6);
    expect(r.trackDeltaMm).toBeCloseTo(0, 9);
    expect(r.wheelbaseDeltaMm).toBeCloseTo(0, 9);
  });

  it("angle is irrelevant for a size-0 pill", () => {
    const a = forwardCorner(cal(), pills({ sTop: 0, thetaTopDeg: 0 }), "left");
    const b = forwardCorner(cal(), pills({ sTop: 0, thetaTopDeg: 123 }), "left");
    expect(a.camberDeg).toBeCloseTo(b.camberDeg, 9);
    expect(a.casterDeg).toBeCloseTo(b.casterDeg, 9);
  });

  it("equal pills at equal angles cancel (top minus bottom)", () => {
    const r = forwardCorner(cal(), pills({ thetaTopDeg: 77, thetaBotDeg: 77 }), "left");
    expect(r.camberDeg).toBeCloseTo(0, 9);
    expect(r.casterDeg).toBeCloseTo(0, 9);
    expect(r.dXMm).toBeCloseTo(0, 9);
    expect(r.dYMm).toBeCloseTo(0, 9);
  });

  it("top pill outboard (θ=90°) adds positive camber; sign flag flips it", () => {
    const p = pills({ sBot: 0, thetaTopDeg: 90 });
    const r = forwardCorner(cal(), p, "left");
    expect(r.camberDeg).toBeGreaterThan(0);
    const flipped = forwardCorner(cal({ signCamber: -1 }), p, "left");
    expect(flipped.camberDeg).toBeCloseTo(-r.camberDeg, 9);
  });

  it("top pill forward (θ=0°) gives negative caster (top leading); sign flag flips", () => {
    const p = pills({ sBot: 0, thetaTopDeg: 0 });
    const r = forwardCorner(cal(), p, "left");
    expect(r.casterDeg).toBeLessThan(0);
    const flipped = forwardCorner(cal({ signCaster: -1 }), p, "left");
    expect(flipped.casterDeg).toBeCloseTo(-r.casterDeg, 9);
  });

  it("identical dials on both sides are symmetric by default", () => {
    const p = pills({ thetaTopDeg: 33, thetaBotDeg: 210 });
    const left = forwardCorner(cal(), p, "left");
    const right = forwardCorner(cal(), p, "right");
    expect(right.camberDeg).toBeCloseTo(left.camberDeg, 9);
    expect(right.casterDeg).toBeCloseTo(left.casterDeg, 9);
  });

  it("mirrorRight negates the lateral (camber) axis on the right, keeps caster", () => {
    const c = cal({ mirrorRight: true });
    const p = pills({ sBot: 0, thetaTopDeg: 90 });
    const left = forwardCorner(c, p, "left");
    const right = forwardCorner(c, p, "right");
    expect(right.camberDeg).toBeCloseTo(-left.camberDeg, 9);
    expect(right.casterDeg).toBeCloseTo(left.casterDeg, 9);
  });

  it("camberMm is the gauge-span tangent of camber", () => {
    const c = cal();
    const r = forwardCorner(c, pills({ sBot: 0, thetaTopDeg: 90 }), "left");
    expect(r.camberMm).toBeCloseTo(c.lRimMm * Math.tan((r.camberDeg * Math.PI) / 180), 6);
  });

  it("Δtrack/Δwheelbase split by wheelFrac at cardinal angles", () => {
    const c = cal({ wheelFrac: 0.7 });
    const et = c.eMm[3];
    const outboard = forwardCorner(c, pills({ thetaTopDeg: 90, thetaBotDeg: 90 }), "left");
    expect(outboard.trackDeltaMm).toBeCloseTo(0.7 * et + 0.3 * et, 9);
    expect(outboard.wheelbaseDeltaMm).toBeCloseTo(0, 9);
    const forward = forwardCorner(c, pills({ thetaTopDeg: 0, thetaBotDeg: 0 }), "left");
    expect(forward.wheelbaseDeltaMm).toBeCloseTo(et, 9);
    expect(forward.trackDeltaMm).toBeCloseTo(0, 9);
  });
});

describe("pillContribution", () => {
  it("inverts the forward map's D vector", () => {
    const c = cal({ nXMm: 0.8, nYMm: -0.3, gamma0Deg: -0.4 });
    const p = pills({ thetaTopDeg: 40, thetaBotDeg: 260 });
    const fwd = forwardCorner(c, p, "left");
    const { rX, rY } = pillContribution(c, fwd.camberDeg, fwd.casterDeg);
    expect(rX).toBeCloseTo(fwd.dXMm - c.nXMm, 6);
    expect(rY).toBeCloseTo(fwd.dYMm - c.nYMm, 6);
  });
});

describe("angles & holes", () => {
  it("normalizeDeg wraps into [0, 360)", () => {
    expect(normalizeDeg(-30)).toBeCloseTo(330);
    expect(normalizeDeg(360)).toBeCloseTo(0);
    expect(normalizeDeg(725)).toBeCloseTo(5);
  });

  it("snapToHole snaps to the 18° grid for 20 holes and wraps", () => {
    expect(snapToHole(10, 20)).toBeCloseTo(18);
    expect(snapToHole(8, 20)).toBeCloseTo(0);
    expect(snapToHole(355, 20)).toBeCloseTo(0);
  });

  it("snapToHole with holeCount 0 is identity (mod 360)", () => {
    expect(snapToHole(123.4, 0)).toBeCloseTo(123.4);
    expect(snapToHole(-10, 0)).toBeCloseTo(350);
  });

  it("holeIndex reports the nearest hole", () => {
    expect(holeIndex(18, 20)).toBe(1);
    expect(holeIndex(355, 20)).toBe(0);
    expect(holeIndex(90, 20)).toBe(5);
  });
});
