import { describe, expect, it } from "vitest";
import { DEFAULT_CALIBRATION, forwardCorner, normalizeDeg, type CornerPills, type PillCalibration } from "./model";
import { DEFAULT_SOLVE_OPTIONS, findSetups, nearestAngles, type SolveOptions } from "./inverse";

const cal = (over: Partial<PillCalibration> = {}): PillCalibration => ({
  ...DEFAULT_CALIBRATION,
  ...over,
});

const noSnap: SolveOptions = { ...DEFAULT_SOLVE_OPTIONS, snapHoles: false };

describe("findSetups", () => {
  it("round-trips targets sampled from the forward model", () => {
    const c = cal({ nXMm: 0.4, nYMm: -0.2, gamma0Deg: -0.4 });
    const samples: CornerPills[] = [
      { sTop: 3, sBot: 3, thetaTopDeg: 30, thetaBotDeg: 200 },
      { sTop: 5, sBot: 2, thetaTopDeg: 300, thetaBotDeg: 45 },
      { sTop: 1, sBot: 4, thetaTopDeg: 120, thetaBotDeg: 350 },
    ];
    for (const p of samples) {
      const target = forwardCorner(c, p, "left");
      const [best] = findSetups(c, { camberDeg: target.camberDeg, casterDeg: target.casterDeg }, "left", noSnap);
      expect(best).toBeDefined();
      expect(best.residualDeg).toBeLessThan(0.05);
      const check = forwardCorner(c, best.pills, "left");
      expect(check.camberDeg).toBeCloseTo(target.camberDeg, 2);
      expect(check.casterDeg).toBeCloseTo(target.casterDeg, 2);
    }
  });

  it("hole-snapped solutions land on the hole grid with a bounded residual", () => {
    const c = cal();
    const target = forwardCorner(c, { sTop: 4, sBot: 2, thetaTopDeg: 100, thetaBotDeg: 10 }, "left");
    const sols = findSetups(c, { camberDeg: target.camberDeg, casterDeg: target.casterDeg }, "left", {
      ...DEFAULT_SOLVE_OPTIONS,
      snapHoles: true,
    });
    expect(sols.length).toBeGreaterThan(0);
    const step = 360 / c.holeCount;
    for (const s of sols) {
      expect(normalizeDeg(s.pills.thetaTopDeg) % step).toBeCloseTo(0, 6);
      expect(normalizeDeg(s.pills.thetaBotDeg) % step).toBeCloseTo(0, 6);
    }
  });

  it("falls back to closest-achievable for a target far outside the envelope", () => {
    const sols = findSetups(cal(), { camberDeg: 45, casterDeg: 0 }, "left", noSnap);
    expect(sols.length).toBeGreaterThan(0);
    // Nothing can actually reach 45° of camber, so every candidate is a
    // projection onto its pair's annulus rather than an exact solve.
    expect(sols.every((s) => s.exact)).toBe(false);
    expect(sols.every((s) => s.residualDeg > 1)).toBe(true);
  });

  it("solves the one-pill degenerate cases", () => {
    const c = cal();
    // Only the top pill offset: e.g. size 3 top at 90° with bottom size 0.
    const topOnly = forwardCorner(c, { sTop: 3, sBot: 0, thetaTopDeg: 90, thetaBotDeg: 0 }, "left");
    const solsTop = findSetups(c, { camberDeg: topOnly.camberDeg, casterDeg: topOnly.casterDeg }, "left", noSnap);
    expect(solsTop.some((s) => s.residualDeg < 0.05)).toBe(true);
    const botOnly = forwardCorner(c, { sTop: 0, sBot: 3, thetaTopDeg: 0, thetaBotDeg: 45 }, "left");
    const solsBot = findSetups(c, { camberDeg: botOnly.camberDeg, casterDeg: botOnly.casterDeg }, "left", noSnap);
    expect(solsBot.some((s) => s.residualDeg < 0.05)).toBe(true);
  });

  it("raising the OEM weight never prefers bigger pills at equal residual", () => {
    const c = cal();
    const target = { camberDeg: 0, casterDeg: 0 }; // exactly reachable by any equal pair at equal angles
    const oemHeavy = findSetups(c, target, "left", { ...noSnap, weights: { track: 0, oem: 10 } });
    const best = oemHeavy[0];
    expect(best.pills.sTop + best.pills.sBot).toBe(0);
  });

  it("mirrorRight solutions still verify through the forward model on the right", () => {
    const c = cal({ mirrorRight: true });
    const p: CornerPills = { sTop: 4, sBot: 1, thetaTopDeg: 77, thetaBotDeg: 300 };
    const target = forwardCorner(c, p, "right");
    const [best] = findSetups(c, { camberDeg: target.camberDeg, casterDeg: target.casterDeg }, "right", noSnap);
    expect(best.residualDeg).toBeLessThan(0.05);
  });
});

describe("nearestAngles", () => {
  const current: CornerPills = { sTop: 3, sBot: 3, thetaTopDeg: 0, thetaBotDeg: 0 };

  it("hits an in-envelope target exactly", () => {
    const c = cal();
    const goal = forwardCorner(c, { sTop: 3, sBot: 3, thetaTopDeg: 60, thetaBotDeg: 240 }, "left");
    const solved = nearestAngles(c, current, { camberDeg: goal.camberDeg, casterDeg: goal.casterDeg }, "left", false);
    const check = forwardCorner(c, solved, "left");
    expect(check.camberDeg).toBeCloseTo(goal.camberDeg, 4);
    expect(check.casterDeg).toBeCloseTo(goal.casterDeg, 4);
  });

  it("projects an out-of-reach target onto the envelope boundary", () => {
    const c = cal();
    const solved = nearestAngles(c, current, { camberDeg: 30, casterDeg: 0 }, "left", false);
    const check = forwardCorner(c, solved, "left");
    // Max lateral offset = e[3]+e[3] = 3 mm → max camber = atan(3/110).
    const maxCamber = Math.atan2(2 * c.eMm[3], c.hMm) * (180 / Math.PI);
    expect(check.camberDeg).toBeCloseTo(maxCamber, 3);
    expect(Number.isFinite(check.casterDeg)).toBe(true);
  });

  it("keeps the dead pill's angle when one size is 0", () => {
    const c = cal();
    const cur: CornerPills = { sTop: 3, sBot: 0, thetaTopDeg: 10, thetaBotDeg: 45 };
    const solved = nearestAngles(c, cur, { camberDeg: 0.5, casterDeg: 0.2 }, "left", false);
    expect(solved.thetaBotDeg).toBe(45);
  });

  it("returns current settings unchanged when both pills are size 0", () => {
    const c = cal();
    const cur: CornerPills = { sTop: 0, sBot: 0, thetaTopDeg: 0, thetaBotDeg: 0 };
    expect(nearestAngles(c, cur, { camberDeg: 1, casterDeg: 1 }, "left", false)).toBe(cur);
  });

  it("snaps to the hole grid when requested", () => {
    const c = cal();
    const goal = forwardCorner(c, { sTop: 3, sBot: 3, thetaTopDeg: 61, thetaBotDeg: 239 }, "left");
    const solved = nearestAngles(c, current, { camberDeg: goal.camberDeg, casterDeg: goal.casterDeg }, "left", true);
    const step = 360 / c.holeCount;
    expect(normalizeDeg(solved.thetaTopDeg) % step).toBeCloseTo(0, 6);
    expect(normalizeDeg(solved.thetaBotDeg) % step).toBeCloseTo(0, 6);
  });
});

describe("findSetups — out-of-reach targets", () => {
  it("returns ranked closest-achievable candidates instead of nothing", () => {
    const c = cal();
    // Max lateral pill offset is e[5]+e[5] = 5 mm, so 30° of camber is far
    // outside every pair's envelope.
    const results = findSetups(c, { camberDeg: 30, casterDeg: 0 }, "left", noSnap);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.exact)).toBe(false);
    // Best candidate should be the largest-offset pair pushing hardest at it.
    const best = results[0];
    const maxCamber = Math.atan2(2 * c.eMm[5], c.hMm) * (180 / Math.PI);
    expect(forwardCorner(c, best.pills, "left").camberDeg).toBeLessThanOrEqual(maxCamber + 1e-6);
  });

  it("flags reachable targets as exact", () => {
    const c = cal();
    const target = forwardCorner(c, { sTop: 3, sBot: 3, thetaTopDeg: 40, thetaBotDeg: 210 }, "left");
    const [best] = findSetups(c, { camberDeg: target.camberDeg, casterDeg: target.casterDeg }, "left", noSnap);
    expect(best.exact).toBe(true);
  });

  it("solves a target that lands exactly on the built-in alignment", () => {
    // R ≈ 0: equal-eccentricity pairs cancel at any shared angle. This used to
    // fall through the |R| < 1e-9 guard and return nothing at all.
    const c = cal({ nXMm: 0.4, nYMm: -0.2 });
    const neutral = forwardCorner(c, { sTop: 2, sBot: 2, thetaTopDeg: 0, thetaBotDeg: 0 }, "left");
    const results = findSetups(c, { camberDeg: neutral.camberDeg, casterDeg: neutral.casterDeg }, "left", noSnap);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].residualDeg).toBeLessThan(1e-6);
    expect(results[0].exact).toBe(true);
  });
});

describe("nearestAngles — annulus boundaries", () => {
  it("reaches the inner limit when the BOTTOM pill is the larger one", () => {
    // e_b > e_t: the pair's minimum contribution points opposite the shared
    // angle, so the elbow-straight fallback has to flip both angles by π.
    const c = cal({ nXMm: 0, nYMm: 0, gamma0Deg: 0 });
    const cur: CornerPills = { sTop: 1, sBot: 5, thetaTopDeg: 0, thetaBotDeg: 0 };
    // Aim at dead-neutral, which the |e_t − e_b| = 2 mm inner limit excludes.
    const solved = nearestAngles(c, cur, { camberDeg: 0, casterDeg: 0 }, "left", false);
    const check = forwardCorner(c, solved, "left");
    const rMin = Math.abs(c.eMm[1] - c.eMm[5]);
    expect(Math.hypot(check.dXMm - c.nXMm, check.dYMm - c.nYMm)).toBeCloseTo(rMin, 6);
  });

  it("reaches the outer limit exactly", () => {
    const c = cal({ nXMm: 0, nYMm: 0, gamma0Deg: 0 });
    const cur: CornerPills = { sTop: 4, sBot: 4, thetaTopDeg: 0, thetaBotDeg: 0 };
    const solved = nearestAngles(c, cur, { camberDeg: 45, casterDeg: 0 }, "left", false);
    const check = forwardCorner(c, solved, "left");
    const rMax = c.eMm[4] + c.eMm[4];
    expect(Math.hypot(check.dXMm - c.nXMm, check.dYMm - c.nYMm)).toBeCloseTo(rMax, 6);
  });
});
