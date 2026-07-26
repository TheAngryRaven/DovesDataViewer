// Pill alignment inverse solvers (plan 0011).
//
// Both solvers reduce to a two-circle (two-link) intersection: the pills must
// jointly contribute the horizontal kingpin delta R = D*(target) − n, where the
// top pill adds e_t·û(θ_t) and the bottom subtracts e_b·û(θ_b). Feasible iff
// |R| lies inside the annulus [|e_t−e_b|, e_t+e_b]; inside it there are two
// "elbow" solutions.

import {
  forwardCorner,
  localRadToDial,
  normalizeDeg,
  pillContribution,
  snapToHole,
  PILL_SIZES,
  type CornerPills,
  type CornerResult,
  type PillCalibration,
  type PillSize,
  type Side,
} from "./model";

export interface SetupTarget {
  camberDeg: number;
  /** Omitted → hold the current caster (solver substitutes it). */
  casterDeg: number;
}

export interface SolveOptions {
  snapHoles: boolean;
  /** Cost weights: residual is always weight 1. */
  weights: { track: number; oem: number };
  topN: number;
}

export const DEFAULT_SOLVE_OPTIONS: SolveOptions = {
  snapHoles: true,
  weights: { track: 0.3, oem: 0.05 },
  topN: 8,
};

export interface SetupCandidate {
  pills: CornerPills;
  result: CornerResult;
  /** Achieved-vs-target distance in (camber, caster) degrees. */
  residualDeg: number;
  cost: number;
  /**
   * True when the target lay inside this pill pair's reachable annulus. False
   * marks a "closest achievable" candidate produced by projecting an
   * out-of-reach target onto the annulus. (Hole snapping can still leave a
   * residual on an exact candidate — `residualDeg` is the honest measure.)
   */
  exact: boolean;
}

/** Tolerance (mm) for the degenerate one-pill cases where |R| must equal e exactly. */
const ONE_PILL_TOL_MM = 0.05;

/**
 * Two-circle intersection in the local frame. Returns candidate
 * [thetaTopRad, thetaBotRad] pairs (0–2 solutions, or the degenerate forms).
 */
function intersectLocal(et: number, eb: number, rX: number, rY: number): Array<[number, number]> {
  const rMag = Math.hypot(rX, rY);
  const phiR = Math.atan2(rY, rX);

  if (et === 0 && eb === 0) {
    return rMag < 1e-6 ? [[0, 0]] : [];
  }
  if (eb === 0) {
    return Math.abs(rMag - et) < ONE_PILL_TOL_MM ? [[phiR, 0]] : [];
  }
  if (et === 0) {
    // −e_b·û(θ_b) must equal R → θ_b points opposite R.
    return Math.abs(rMag - eb) < ONE_PILL_TOL_MM ? [[0, phiR + Math.PI]] : [];
  }

  if (rMag < 1e-9) {
    // R ≈ 0 — the target IS the built-in alignment, so the two pills must
    // cancel each other. Equal eccentricities do that at any shared angle
    // (0 is as good as any); unequal ones can never sum to zero.
    return Math.abs(et - eb) < 1e-9 ? [[0, 0]] : [];
  }

  const c = (et * et - eb * eb - rMag * rMag) / (2 * eb);
  const cosArg = c / rMag;
  // Reject genuinely out-of-annulus targets, but tolerate the float dust that
  // lands |cos| a few ulps past 1 exactly ON the annulus boundary — those are
  // real single-solution configurations, not infeasible ones.
  if (Math.abs(cosArg) > 1 + 1e-9) return [];
  const acosArg = Math.min(1, Math.max(-1, cosArg));
  const out: Array<[number, number]> = [];
  for (const s of [1, -1]) {
    const tb = phiR + s * Math.acos(acosArg);
    const tt = Math.atan2(rY + eb * Math.sin(tb), rX + eb * Math.cos(tb));
    out.push([tt, tb]);
  }
  return out;
}

/**
 * Radially project R onto the reachable annulus [|eₜ−e_b|, eₜ+e_b].
 * Returns null when R already lies inside it (nothing to project) or when its
 * direction is undefined (|R| ≈ 0), leaving the caller's own handling in place.
 */
function projectToAnnulus(
  et: number,
  eb: number,
  rX: number,
  rY: number,
): [number, number] | null {
  const rMag = Math.hypot(rX, rY);
  if (rMag < 1e-9) return null;
  const clamped = Math.min(Math.max(rMag, Math.abs(et - eb)), et + eb);
  if (clamped === rMag) return null;
  return [(rX / rMag) * clamped, (rY / rMag) * clamped];
}

/**
 * Find Setup: rank every pill combination for a camber/caster target. Pairs
 * that can reach the target exactly are solved directly; pairs that can't
 * contribute their closest achievable setting instead (flagged `exact: false`)
 * so an out-of-reach target still returns a ranked "nearest" list rather than
 * nothing. Hole-snap happens BEFORE scoring, so residuals reflect what the
 * user can physically set.
 */
export function findSetups(
  cal: PillCalibration,
  target: SetupTarget,
  side: Side,
  opts: SolveOptions = DEFAULT_SOLVE_OPTIONS,
): SetupCandidate[] {
  const { rX, rY } = pillContribution(cal, target.camberDeg, target.casterDeg);

  const seen = new Set<string>();
  const sols: SetupCandidate[] = [];

  for (const sTop of PILL_SIZES) {
    for (const sBot of PILL_SIZES) {
      const et = cal.eMm[sTop];
      const eb = cal.eMm[sBot];
      let solutions = intersectLocal(et, eb, rX, rY);
      let exact = true;
      if (solutions.length === 0) {
        const projected = projectToAnnulus(et, eb, rX, rY);
        if (projected) {
          solutions = intersectLocal(et, eb, projected[0], projected[1]);
          exact = false;
        }
      }
      for (const [ttLocal, tbLocal] of solutions) {
        let thetaTopDeg = localRadToDial(cal, side, ttLocal);
        let thetaBotDeg = localRadToDial(cal, side, tbLocal);
        if (opts.snapHoles) {
          thetaTopDeg = snapToHole(thetaTopDeg, cal.holeCount);
          thetaBotDeg = snapToHole(thetaBotDeg, cal.holeCount);
        }
        // Concentric pills contribute nothing — pin their angle to 0 so
        // equivalent solutions dedupe.
        if (et === 0) thetaTopDeg = 0;
        if (eb === 0) thetaBotDeg = 0;

        const key = `${sTop}/${sBot}/${thetaTopDeg.toFixed(1)}/${thetaBotDeg.toFixed(1)}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const pills: CornerPills = { sTop, sBot, thetaTopDeg, thetaBotDeg };
        const result = forwardCorner(cal, pills, side);
        const residualDeg = Math.hypot(
          result.camberDeg - target.camberDeg,
          result.casterDeg - target.casterDeg,
        );
        const cost =
          residualDeg +
          opts.weights.track * Math.abs(result.trackDeltaMm) +
          opts.weights.oem * (sTop + sBot);
        sols.push({ pills, result, residualDeg, cost, exact });
      }
    }
  }

  return sols.sort((a, b) => a.cost - b.cost).slice(0, opts.topN);
}

/** Shortest signed angular distance a→b in degrees (−180, 180]. */
function angDistDeg(a: number, b: number): number {
  const d = normalizeDeg(b - a);
  return d > 180 ? d - 360 : d;
}

/**
 * Drag-solve: with pill sizes FIXED, the angles that get closest to a target.
 * An out-of-reach target is projected radially onto the reachable annulus, so
 * this never fails — the envelope marker always lands somewhere physical.
 * Of the two elbow solutions, prefers the one nearest the current angles.
 */
export function nearestAngles(
  cal: PillCalibration,
  current: CornerPills,
  target: { camberDeg: number; casterDeg: number },
  side: Side,
  snapHoles: boolean,
): CornerPills {
  const et = cal.eMm[current.sTop];
  const eb = cal.eMm[current.sBot];
  if (et === 0 && eb === 0) return current;

  let { rX, rY } = pillContribution(cal, target.camberDeg, target.casterDeg);
  let rMag = Math.hypot(rX, rY);

  const rMin = Math.abs(et - eb);
  const rMax = et + eb;
  const clamped = Math.min(Math.max(rMag, rMin), rMax);
  if (clamped !== rMag) {
    if (rMag < 1e-9) {
      // Zero target vector but the annulus excludes zero: keep the current
      // direction so the projection is stable instead of jumping to +x.
      const cur = forwardCorner(cal, current, side);
      const phi = Math.atan2(cur.dYMm - cal.nYMm, cur.dXMm - cal.nXMm);
      rX = clamped * Math.cos(phi);
      rY = clamped * Math.sin(phi);
    } else {
      rX = (rX / rMag) * clamped;
      rY = (rY / rMag) * clamped;
    }
    rMag = clamped;
  }

  const candidates = intersectLocal(et, eb, rX, rY);
  if (candidates.length === 0) {
    // Boundary numerics: land exactly on the elbow-straight configuration.
    // Outer limit — the pills oppose, summing to eₜ + e_b along R. Inner limit
    // — they align; since the pair contributes eₜ·û(θₜ) − e_b·û(θ_b), a LARGER
    // bottom pill makes that difference point opposite the shared direction,
    // so both angles flip by π to keep the contribution pointing along R.
    const phi = Math.atan2(rY, rX);
    if (rMag >= rMax - 1e-9) candidates.push([phi, phi + Math.PI]);
    else if (et >= eb) candidates.push([phi, phi]);
    else candidates.push([phi + Math.PI, phi + Math.PI]);
  }

  let best: CornerPills = current;
  let bestDist = Infinity;
  for (const [ttLocal, tbLocal] of candidates) {
    let thetaTopDeg = et === 0 ? current.thetaTopDeg : localRadToDial(cal, side, ttLocal);
    let thetaBotDeg = eb === 0 ? current.thetaBotDeg : localRadToDial(cal, side, tbLocal);
    if (snapHoles) {
      thetaTopDeg = snapToHole(thetaTopDeg, cal.holeCount);
      thetaBotDeg = snapToHole(thetaBotDeg, cal.holeCount);
    }
    const dist =
      Math.abs(angDistDeg(current.thetaTopDeg, thetaTopDeg)) +
      Math.abs(angDistDeg(current.thetaBotDeg, thetaBotDeg));
    if (dist < bestDist) {
      bestDist = dist;
      best = { ...current, thetaTopDeg, thetaBotDeg };
    }
  }
  return best;
}
