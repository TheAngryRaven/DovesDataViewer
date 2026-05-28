/**
 * Position-based lap delta (gap to a reference lap), ported from the
 * DovesLapTimer firmware design (issue #29) and adapted for offline/web use.
 *
 * Why this exists: the legacy `calculatePace` in referenceUtils aligns laps by
 * *cumulative distance*, which accumulates GPS noise and assumes both laps trace
 * the same path length — it drifts, worst at lap end where the headline gap is
 * read. This module instead:
 *
 *   1. Resamples the reference lap to a uniform arc-length grid (one point per
 *      `sampleMeters` of travel) — independent of GPS rate and lap duration,
 *      with uniform spatial resolution. This is the canonical representation.
 *   2. For each native current-lap fix, projects its position onto the nearest
 *      reference *segment* (interpolating the closest point, so the gap doesn't
 *      snap between grid points) and takes
 *          delta = currentElapsed - referenceElapsedAtClosestPoint.
 *      A monotonic windowed search keeps the match advancing, which defeats
 *      hairpins / self-crossings / start-finish proximity.
 *
 * The output `delta` is per native current sample, so it is a drop-in for the
 * existing `paceData` contract. `matchIndex`/`matchFrac` expose the alignment
 * map (current fix -> reference position) for cross-lap channel comparison.
 */

import { GpsSample } from "@/types/racing";
import { projectToPlane, calculatePace } from "./referenceUtils";

interface Point {
  x: number;
  y: number;
}

/** Reference lap resampled to a uniform arc-length grid. */
export interface ResampledLap {
  /** Projection origin (shared frame for matching current fixes). */
  centerLat: number;
  centerLon: number;
  /** Planar coordinates, one per grid point. */
  xy: Point[];
  /** Elapsed time from lap start (ms) at each grid point. */
  elapsedMs: number[];
  /** Cumulative arc length (m) at each grid point: 0, N, 2N, … */
  cumDist: number[];
  /** Grid point -> nearest native sample index (for channel lookup). */
  nativeIdx: number[];
  /** Grid spacing (m). */
  sampleMeters: number;
}

export interface DeltaOptions {
  /** How far back along the reference the windowed search may look (m). */
  lookBackMeters?: number;
  /** How far forward along the reference the windowed search may look (m). */
  lookForwardMeters?: number;
  /** Reject |delta| beyond this many seconds as impossible. */
  sanitySeconds?: number;
  /** EMA weight on history (issue #29 convention: s = alpha*s + (1-alpha)*raw). */
  alpha?: number;
  /** Forward-backward smoothing to remove the EMA's phase lag (offline analysis). */
  zeroLag?: boolean;
  /** Null out matches whose perpendicular distance exceeds this (m); off when null. */
  maxMatchMeters?: number | null;
}

export interface DeltaResult {
  /** Smoothed gap in seconds, per native current sample (+ = behind reference). */
  delta: (number | null)[];
  /** Unsmoothed gap in seconds. */
  rawDelta: (number | null)[];
  /** Matched reference grid index (segment start) per current sample. */
  matchIndex: number[];
  /** Fraction 0..1 along the matched segment. */
  matchFrac: number[];
  /**
   * True when the reference lap appears to have been recorded in the OPPOSITE
   * direction of travel. The monotonic search can't rewind through the
   * reference's arc, so such a reference would yield meaningless deltas — we
   * null them out and flag it instead of reporting silent garbage.
   */
  reversed: boolean;
}

const DEFAULTS: Required<Omit<DeltaOptions, "maxMatchMeters">> & { maxMatchMeters: number | null } = {
  lookBackMeters: 25,
  lookForwardMeters: 250,
  sanitySeconds: 120,
  alpha: 0.3,
  zeroLag: true,
  maxMatchMeters: null,
};

function emptyResampled(sampleMeters: number): ResampledLap {
  return { centerLat: 0, centerLon: 0, xy: [], elapsedMs: [], cumDist: [], nativeIdx: [], sampleMeters };
}

/**
 * Resample a lap to a uniform arc-length grid of `sampleMeters` spacing.
 * The grid is independent of the source GPS rate: the same path sampled at
 * different rates yields (nearly) the same grid.
 */
export function resampleByDistance(samples: GpsSample[], sampleMeters: number): ResampledLap {
  const n = samples.length;
  if (n === 0 || sampleMeters <= 0) return emptyResampled(sampleMeters);

  const centerLat = samples.reduce((s, p) => s + p.lat, 0) / n;
  const centerLon = samples.reduce((s, p) => s + p.lon, 0) / n;
  const proj = samples.map((s) => projectToPlane(s.lat, s.lon, centerLat, centerLon));
  const t0 = samples[0].t;

  const nativeCum: number[] = [0];
  for (let i = 1; i < n; i++) {
    nativeCum.push(nativeCum[i - 1] + Math.hypot(proj[i].x - proj[i - 1].x, proj[i].y - proj[i - 1].y));
  }
  const total = nativeCum[n - 1];

  const xy: Point[] = [];
  const elapsedMs: number[] = [];
  const cumDist: number[] = [];
  const nativeIdx: number[] = [];

  // Degenerate lap (single point or no movement): one grid point.
  if (n === 1 || total === 0) {
    xy.push({ ...proj[0] });
    elapsedMs.push(0);
    cumDist.push(0);
    nativeIdx.push(0);
    return { centerLat, centerLon, xy, elapsedMs, cumDist, nativeIdx, sampleMeters };
  }

  let seg = 0;
  for (let d = 0; d <= total + 1e-6; d += sampleMeters) {
    const target = Math.min(d, total);
    while (seg < n - 2 && nativeCum[seg + 1] < target) seg++;
    const segLen = nativeCum[seg + 1] - nativeCum[seg];
    const frac = segLen > 0 ? (target - nativeCum[seg]) / segLen : 0;
    xy.push({
      x: proj[seg].x + frac * (proj[seg + 1].x - proj[seg].x),
      y: proj[seg].y + frac * (proj[seg + 1].y - proj[seg].y),
    });
    const e0 = samples[seg].t - t0;
    const e1 = samples[seg + 1].t - t0;
    elapsedMs.push(e0 + frac * (e1 - e0));
    cumDist.push(target);
    nativeIdx.push(frac < 0.5 ? seg : seg + 1);
  }

  return { centerLat, centerLon, xy, elapsedMs, cumDist, nativeIdx, sampleMeters };
}

/** One causal EMA pass (issue #29 convention), holding the last value across null gaps. */
function emaPass(arr: (number | null)[], alpha: number): (number | null)[] {
  let s: number | null = null;
  const out: (number | null)[] = [];
  for (const v of arr) {
    if (v == null) {
      out.push(s);
      continue;
    }
    s = s == null ? v : alpha * s + (1 - alpha) * v;
    out.push(s);
  }
  return out;
}

/**
 * Smooth a raw delta sequence. Causal EMA by default; with `zeroLag`, a second
 * backward pass is averaged in to cancel the phase lag (preferred for offline
 * charts where we have the whole lap).
 */
export function smoothDelta(raw: (number | null)[], alpha = DEFAULTS.alpha, zeroLag = DEFAULTS.zeroLag): (number | null)[] {
  const fwd = emaPass(raw, alpha);
  if (!zeroLag) return fwd;
  const bwd = emaPass([...fwd].reverse(), alpha).reverse();
  return fwd.map((v, i) => {
    const b = bwd[i];
    if (v == null) return b ?? null;
    if (b == null) return v;
    return (v + b) / 2;
  });
}

/**
 * Detect a reference recorded in the opposite direction of travel. Probe the
 * current lap at coarse intervals, find each probe's GLOBAL nearest reference
 * grid index, and check whether those indices trend up (same direction) or down
 * (reversed) as the current lap progresses. Steps are unwrapped around the loop
 * so the start/finish wrap doesn't masquerade as a reversal.
 */
function referenceIsReversed(current: GpsSample[], ref: ResampledLap): boolean {
  const R = ref.xy.length;
  if (R < 4 || current.length < 4) return false;
  const probes = Math.min(16, current.length);
  const idxs: number[] = [];
  for (let s = 0; s < probes; s++) {
    const ci = Math.floor((s / (probes - 1)) * (current.length - 1));
    const p = projectToPlane(current[ci].lat, current[ci].lon, ref.centerLat, ref.centerLon);
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < R; k++) {
      const dx = p.x - ref.xy[k].x;
      const dy = p.y - ref.xy[k].y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    idxs.push(best);
  }
  let up = 0;
  let down = 0;
  for (let i = 1; i < idxs.length; i++) {
    let d = idxs[i] - idxs[i - 1];
    if (d > R / 2) d -= R; // unwrap forward across the loop seam
    else if (d < -R / 2) d += R; // unwrap backward across the loop seam
    if (d > 0) up++;
    else if (d < 0) down++;
  }
  // Reversed only when downward steps clearly dominate, so a noisy/partial lap
  // doesn't trip the guard.
  return down > up * 2;
}

/**
 * Compute the position-based gap of `current` versus a resampled reference lap.
 * Returns one delta per native current sample (drop-in for `paceData`).
 */
export function computePositionDelta(
  current: GpsSample[],
  ref: ResampledLap,
  opts: DeltaOptions = {},
): DeltaResult {
  const o = { ...DEFAULTS, ...opts };
  const m = current.length;
  const rawDelta: (number | null)[] = new Array(m).fill(null);
  const matchIndex: number[] = new Array(m).fill(0);
  const matchFrac: number[] = new Array(m).fill(0);

  const R = ref.xy.length;
  if (m === 0 || R < 2) {
    return { delta: rawDelta.slice(), rawDelta, matchIndex, matchFrac, reversed: false };
  }

  // A reverse-direction reference can't be aligned by the forward monotonic
  // search — bail with null deltas rather than emitting misleading pace numbers.
  if (referenceIsReversed(current, ref)) {
    return { delta: rawDelta.slice(), rawDelta, matchIndex, matchFrac, reversed: true };
  }

  const lookBackPts = Math.max(1, Math.ceil(o.lookBackMeters / ref.sampleMeters));
  const lookForwardPts = Math.max(1, Math.ceil(o.lookForwardMeters / ref.sampleMeters));
  const t0 = current[0].t;
  let lastK = 0;

  for (let i = 0; i < m; i++) {
    const p = projectToPlane(current[i].lat, current[i].lon, ref.centerLat, ref.centerLon);
    const lo = Math.max(0, lastK - lookBackPts);
    const hi = Math.min(R - 2, lastK + lookForwardPts);

    let bestK = lo;
    let bestT = 0;
    let bestDist2 = Infinity;
    for (let k = lo; k <= hi; k++) {
      const ax = ref.xy[k].x;
      const ay = ref.xy[k].y;
      const vx = ref.xy[k + 1].x - ax;
      const vy = ref.xy[k + 1].y - ay;
      const len2 = vx * vx + vy * vy;
      let tt = len2 > 0 ? ((p.x - ax) * vx + (p.y - ay) * vy) / len2 : 0;
      tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
      const dx = p.x - (ax + tt * vx);
      const dy = p.y - (ay + tt * vy);
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist2) {
        bestDist2 = d2;
        bestK = k;
        bestT = tt;
      }
    }

    matchIndex[i] = bestK;
    matchFrac[i] = bestT;
    lastK = bestK;

    if (o.maxMatchMeters != null && Math.sqrt(bestDist2) > o.maxMatchMeters) continue;

    const refElapsed = ref.elapsedMs[bestK] + bestT * (ref.elapsedMs[bestK + 1] - ref.elapsedMs[bestK]);
    const d = (current[i].t - t0 - refElapsed) / 1000;
    rawDelta[i] = Math.abs(d) > o.sanitySeconds ? null : d;
  }

  return { delta: smoothDelta(rawDelta, o.alpha, o.zeroLag), rawDelta, matchIndex, matchFrac, reversed: false };
}

export type DeltaMethod = "position" | "distance";

export interface PaceOptions {
  method: DeltaMethod;
  /** Arc-length grid spacing for the position method (m). */
  sampleMeters: number;
  zeroLag?: boolean;
  alpha?: number;
}

/**
 * Compute pace (gap-to-reference per native current sample) using the configured
 * method. "position" resamples the reference to an arc-length grid and projects
 * each current fix onto it (issue #29); "distance" is the legacy cumulative-
 * distance interpolation. Output shape is identical, so it's a drop-in for the
 * existing `paceData` contract regardless of method.
 */
export function computeLapPace(
  current: GpsSample[],
  reference: GpsSample[],
  opts: PaceOptions,
): (number | null)[] {
  if (opts.method === "distance") return calculatePace(current, reference);
  const ref = resampleByDistance(reference, opts.sampleMeters);
  return computePositionDelta(current, ref, { zeroLag: opts.zeroLag ?? true, alpha: opts.alpha }).delta;
}
