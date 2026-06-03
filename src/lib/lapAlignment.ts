/**
 * Pure rigid-registration ("drift alignment") for the multi-lap map overlay.
 *
 * Laps recorded in different sessions / on different loggers carry a slowly
 * varying GPS offset, so their racing lines sit a few meters apart on the map
 * even when the driver took the same line. This finds the best-fit rigid
 * transform (translation + rotation) that lays an overlay lap onto the current
 * lap, cancelling that offset while preserving the real line shape.
 *
 * It is a **map-only** concern: the charts compare by cumulative distance, which
 * is invariant under a rigid transform, so aligned and raw overlays plot
 * identically there. Same-session laps share a receiver (no relative drift) and
 * are intentionally never transformed by callers.
 *
 * Correspondence: both laps start at the start-finish line, so resampling each
 * to the same number of points by fractional arc length pairs equivalent track
 * positions. The optimal 2D rotation then has a closed form (no SVD needed).
 */

import { GpsSample } from "@/types/racing";
import { projectToPlane } from "./referenceUtils";
import { EARTH_RADIUS_M } from "./parserUtils";

const DEG = Math.PI / 180;

interface Point {
  x: number;
  y: number;
}

export interface RigidTransform {
  cos: number;
  sin: number;
  tx: number;
  ty: number;
}

/** Number of correspondence points used to fit the transform. */
const CORRESPONDENCE_POINTS = 100;
/** Beyond this fitted rotation, treat the correspondence as unreliable (reversed
 *  / partial lap) and drop the rotation, keeping translation only. */
const MAX_ROTATION_RAD = 30 * DEG;

/** Resample a planar polyline to exactly `n` points, evenly by arc length. */
export function resampleToCount(pts: Point[], n: number): Point[] {
  if (pts.length === 0 || n <= 0) return [];
  if (pts.length === 1) return Array.from({ length: n }, () => ({ ...pts[0] }));

  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const total = cum[cum.length - 1];
  if (total === 0) return Array.from({ length: n }, () => ({ ...pts[0] }));

  const out: Point[] = [];
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const target = (k / (n - 1)) * total;
    while (seg < pts.length - 2 && cum[seg + 1] < target) seg++;
    const segLen = cum[seg + 1] - cum[seg];
    const f = segLen > 0 ? (target - cum[seg]) / segLen : 0;
    out.push({
      x: pts[seg].x + f * (pts[seg + 1].x - pts[seg].x),
      y: pts[seg].y + f * (pts[seg + 1].y - pts[seg].y),
    });
  }
  return out;
}

/**
 * Optimal rigid transform mapping `src` onto `dst` (paired, same length) in the
 * least-squares sense. `rotate: false` (or an implausibly large fitted angle)
 * yields a translation-only fit. Rotation matrix is [[cos,-sin],[sin,cos]].
 */
export function computeRigidTransform(src: Point[], dst: Point[], rotate = true): RigidTransform {
  const n = Math.min(src.length, dst.length);
  if (n === 0) return { cos: 1, sin: 0, tx: 0, ty: 0 };

  let sx = 0, sy = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    sx += src[i].x; sy += src[i].y; dx += dst[i].x; dy += dst[i].y;
  }
  sx /= n; sy /= n; dx /= n; dy /= n;

  let cos = 1, sin = 0;
  if (rotate) {
    let num = 0, den = 0; // num = Σ(s×d), den = Σ(s·d) on centered coords
    for (let i = 0; i < n; i++) {
      const sxc = src[i].x - sx, syc = src[i].y - sy;
      const dxc = dst[i].x - dx, dyc = dst[i].y - dy;
      num += sxc * dyc - syc * dxc;
      den += sxc * dxc + syc * dyc;
    }
    const theta = Math.atan2(num, den);
    if (Math.abs(theta) <= MAX_ROTATION_RAD) {
      cos = Math.cos(theta);
      sin = Math.sin(theta);
    }
  }

  // t = centroid_dst − R·centroid_src
  const tx = dx - (cos * sx - sin * sy);
  const ty = dy - (sin * sx + cos * sy);
  return { cos, sin, tx, ty };
}

/**
 * Return a copy of `overlay` with its lat/lon rigidly transformed to best-fit
 * `reference`. No-op (returns the input) when either lap is too short to fit.
 */
export function alignLapToReference(
  overlay: GpsSample[],
  reference: GpsSample[],
  opts: { rotate?: boolean } = {},
): GpsSample[] {
  if (overlay.length < 3 || reference.length < 3) return overlay;

  const centerLat = reference.reduce((s, p) => s + p.lat, 0) / reference.length;
  const centerLon = reference.reduce((s, p) => s + p.lon, 0) / reference.length;

  const oProj = overlay.map((s) => projectToPlane(s.lat, s.lon, centerLat, centerLon));
  const rProj = reference.map((s) => projectToPlane(s.lat, s.lon, centerLat, centerLon));

  const tf = computeRigidTransform(
    resampleToCount(oProj, CORRESPONDENCE_POINTS),
    resampleToCount(rProj, CORRESPONDENCE_POINTS),
    opts.rotate ?? true,
  );

  const cosLat = Math.cos(centerLat * DEG);
  return overlay.map((s, i) => {
    const p = oProj[i];
    const x = tf.cos * p.x - tf.sin * p.y + tf.tx;
    const y = tf.sin * p.x + tf.cos * p.y + tf.ty;
    return {
      ...s,
      lat: centerLat + y / (DEG * EARTH_RADIUS_M),
      lon: centerLon + x / (DEG * EARTH_RADIUS_M * cosLat),
    };
  });
}
