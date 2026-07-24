// Envelope sweep for the camber/caster scatter plot (plan 0011).
//
// For a fixed pair of pill sizes, sweep both pill angles over a grid and
// forward-map each combination. ~32k trig evals at the default 2° step —
// cheap enough to run synchronously in JS; the component memoizes on
// (calibration, sizes, side) so it only reruns when those change.

import {
  forwardCorner,
  type CornerPills,
  type PillCalibration,
  type PillSize,
  type Side,
  type ToeState,
  type EnvelopeColorMode,
} from "./model";
import { effectiveToeMm } from "./toe";

export interface EnvelopePoint {
  camberDeg: number;
  casterDeg: number;
  thetaTopDeg: number;
  thetaBotDeg: number;
  trackDeltaMm: number;
  wheelbaseDeltaMm: number;
}

export function sweepEnvelope(
  cal: PillCalibration,
  sTop: PillSize,
  sBot: PillSize,
  side: Side,
  stepDeg = 2,
): EnvelopePoint[] {
  const n = Math.max(1, Math.round(360 / stepDeg));
  const points: EnvelopePoint[] = new Array(n * n);
  const pills: CornerPills = { sTop, sBot, thetaTopDeg: 0, thetaBotDeg: 0 };
  let i = 0;
  for (let a = 0; a < n; a++) {
    pills.thetaTopDeg = a * stepDeg;
    for (let b = 0; b < n; b++) {
      pills.thetaBotDeg = b * stepDeg;
      const r = forwardCorner(cal, pills, side);
      points[i++] = {
        camberDeg: r.camberDeg,
        casterDeg: r.casterDeg,
        thetaTopDeg: pills.thetaTopDeg,
        thetaBotDeg: pills.thetaBotDeg,
        trackDeltaMm: r.trackDeltaMm,
        wheelbaseDeltaMm: r.wheelbaseDeltaMm,
      };
    }
  }
  return points;
}

/** The two single-pill loci circles: rotate one pill, hold the other at 0°. */
export function singlePillLoci(
  cal: PillCalibration,
  sTop: PillSize,
  sBot: PillSize,
  side: Side,
  stepDeg = 4,
): { top: Array<{ x: number; y: number }>; bottom: Array<{ x: number; y: number }> } {
  const n = Math.max(1, Math.round(360 / stepDeg)) + 1; // +1 closes the loop
  const top: Array<{ x: number; y: number }> = new Array(n);
  const bottom: Array<{ x: number; y: number }> = new Array(n);
  for (let i = 0; i < n; i++) {
    const theta = i * stepDeg;
    const rt = forwardCorner(cal, { sTop, sBot, thetaTopDeg: theta, thetaBotDeg: 0 }, side);
    const rb = forwardCorner(cal, { sTop, sBot, thetaTopDeg: 0, thetaBotDeg: theta }, side);
    top[i] = { x: rt.camberDeg, y: rt.casterDeg };
    bottom[i] = { x: rb.camberDeg, y: rb.casterDeg };
  }
  return { top, bottom };
}

// ---------------------------------------------------------------------------
// Color metric — points are bucketed so the canvas pays ≤ BUCKET_COUNT
// fillStyle changes for the whole cloud.
// ---------------------------------------------------------------------------

export const ENVELOPE_BUCKET_COUNT = 20;

/** The metric value a point contributes under a color mode. */
export function colorMetric(p: EnvelopePoint, mode: EnvelopeColorMode, cal: PillCalibration, toe: ToeState, side: Side): number {
  switch (mode) {
    case "trackDelta":
      return p.trackDeltaMm;
    case "thetaTop":
      return p.thetaTopDeg;
    case "resultantToe":
      // Heuristic: static toe plus a linear drift with fore-aft kingpin shift.
      return effectiveToeMm(toe, side, cal) + cal.toeCouplingMmPerMm * p.wheelbaseDeltaMm;
  }
}

/** Quantize a metric value into a bucket index [0, ENVELOPE_BUCKET_COUNT). */
export function colorBucket(value: number, min: number, max: number): number {
  if (!(max > min)) return 0;
  const ratio = (value - min) / (max - min);
  return Math.min(ENVELOPE_BUCKET_COUNT - 1, Math.max(0, Math.floor(ratio * ENVELOPE_BUCKET_COUNT)));
}

/**
 * Bucket → CSS color, red→yellow→green (low→high), matching the reference
 * app's resultant-toe ramp. Same 3-stop piecewise-linear shape as
 * lib/speedHeatmap's getSpeedColor, re-derived here because that one is
 * speed-typed and direction-reversed.
 */
export function colorForBucket(bucket: number): string {
  const ratio = ENVELOPE_BUCKET_COUNT <= 1 ? 0 : bucket / (ENVELOPE_BUCKET_COUNT - 1);
  let r: number;
  let g: number;
  let b: number;
  if (ratio < 0.5) {
    // red (200,40,40) → yellow (230,200,60)
    const t = ratio / 0.5;
    r = Math.round(200 + 30 * t);
    g = Math.round(40 + 160 * t);
    b = Math.round(40 + 20 * t);
  } else {
    // yellow (230,200,60) → green (60,170,70)
    const t = (ratio - 0.5) / 0.5;
    r = Math.round(230 - 170 * t);
    g = Math.round(200 - 30 * t);
    b = Math.round(60 + 10 * t);
  }
  return `rgb(${r},${g},${b})`;
}
