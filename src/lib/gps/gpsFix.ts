/**
 * Custom GPS fix model — the structured record that replaces an NMEA sentence
 * for the phone-as-datalogger pipeline.
 *
 * The physical DovesDataLogger reads a GPS chip that emits NMEA (`$GxRMC` +
 * `$GxGGA`) and logs records carrying lat/lon, speed, course, satellites, HDOP
 * and a fix-quality flag. The browser Geolocation API gives us a richer-typed
 * but narrower payload: no satellite count, no HDOP, no constellation — but it
 * does give a horizontal `accuracy` (a 68%-confidence radius in meters) that is
 * the practical analog of HDOP. So rather than synthesize fake NMEA strings, the
 * phone source emits this typed `GpsFix` object: one normalized fix per
 * Geolocation callback, exactly the way one NMEA epoch yields one logger record.
 *
 * This module is pure (no DOM side effects beyond reading a passed-in
 * `GeolocationPosition`) so it is fully unit-testable. Cross-fix derivation
 * (rate, derived speed/course) lives in `deriveMotion`; the stateful source that
 * strings fixes together is `CustomGps` (`customGps.ts`). No lap-timing logic
 * lives here — this is the data layer only.
 */
import {
  haversineDistance,
  calculateBearing,
  validateGpsCoords,
  normalizeHeading,
} from '@/lib/parserUtils';

/**
 * Fix-quality bucket — the phone analog of the NMEA GGA fix-quality flag. The
 * browser doesn't report satellites/HDOP, so quality is classified from the
 * horizontal accuracy radius (smaller = better). `NoFix` also covers structurally
 * invalid coordinates (NaN / null-island / out-of-range).
 */
export enum GpsFixQuality {
  NoFix = 'no-fix',
  Poor = 'poor',
  Fair = 'fair',
  Good = 'good',
  Excellent = 'excellent',
}

/**
 * Inclusive upper bounds (meters of horizontal accuracy) for each quality bucket.
 * Anything worse than `fair` is `poor`. Tuned for consumer-phone GNSS where a
 * clear-sky fix is ~3–5 m and an obstructed/assisted fix is 20 m+.
 */
export const FIX_QUALITY_THRESHOLDS = {
  excellent: 3,
  good: 8,
  fair: 20,
} as const;

/**
 * One normalized GPS fix — the NMEA-sentence replacement. Self-contained: it
 * carries everything a single Geolocation callback gives us, plus a monotonic
 * sequence number and a derived quality bucket. Raw only — no cross-fix
 * derivation (see `GpsFixMotion`).
 */
export interface GpsFix {
  /** Monotonic 0-based sequence number assigned by the source. */
  seq: number;
  /** Fix time, epoch milliseconds (`GeolocationPosition.timestamp`). */
  timestamp: number;
  /** WGS84 latitude, degrees. */
  lat: number;
  /** WGS84 longitude, degrees. */
  lon: number;
  /** Meters above the WGS84 ellipsoid, or null when the device omits it. */
  altitude: number | null;
  /** Horizontal accuracy (68% radius), meters. The HDOP analog. */
  accuracy: number;
  /** Vertical accuracy, meters, or null when the device omits it. */
  altitudeAccuracy: number | null;
  /** Device-reported ground speed, m/s, or null. */
  speed: number | null;
  /** Device-reported heading/course, degrees [0,360), or null. */
  heading: number | null;
  /** Quality bucket derived from `accuracy` (and coordinate validity). */
  quality: GpsFixQuality;
}

/** Where a resolved motion value came from. */
export type MotionSource = 'device' | 'derived' | 'none';

/**
 * Cross-fix derived motion: the quantities the Geolocation API does not reliably
 * give us, computed from the previous fix. Speed and course prefer the device's
 * own value and fall back to point-to-point math (the device returns null for
 * both on many phones, especially when stationary or on desktop).
 */
export interface GpsFixMotion {
  /** Seconds since the previous fix, or null for the first fix. */
  dtSec: number | null;
  /** Instantaneous rate (1/dtSec), Hz — null for the first/zero-gap fix. */
  instantHz: number | null;
  /** Great-circle meters traveled since the previous fix, or null. */
  distanceM: number | null;
  /** Best ground speed, m/s: device value, else derived, else null. */
  speedMps: number | null;
  speedSource: MotionSource;
  /** Best course/heading, degrees [0,360): device, else bearing, else null. */
  course: number | null;
  courseSource: MotionSource;
}

/** A motion record with nothing derived (first fix / reset). */
export const NO_MOTION: GpsFixMotion = {
  dtSec: null,
  instantHz: null,
  distanceM: null,
  speedMps: null,
  speedSource: 'none',
  course: null,
  courseSource: 'none',
};

/** Classify a horizontal-accuracy radius (m) into a quality bucket. */
export function classifyFixQuality(accuracy: number | null | undefined): GpsFixQuality {
  if (accuracy == null || !Number.isFinite(accuracy) || accuracy < 0) return GpsFixQuality.NoFix;
  if (accuracy <= FIX_QUALITY_THRESHOLDS.excellent) return GpsFixQuality.Excellent;
  if (accuracy <= FIX_QUALITY_THRESHOLDS.good) return GpsFixQuality.Good;
  if (accuracy <= FIX_QUALITY_THRESHOLDS.fair) return GpsFixQuality.Fair;
  return GpsFixQuality.Poor;
}

/**
 * Build a normalized `GpsFix` from a browser `GeolocationPosition`. Pure — the
 * sequence number is supplied by the caller (the source owns the counter).
 * Structurally invalid coordinates force `quality: NoFix` regardless of the
 * reported accuracy.
 */
export function createGpsFix(position: GeolocationPosition, seq: number): GpsFix {
  const c = position.coords;
  const coordsInvalid = validateGpsCoords(c.latitude, c.longitude) !== null;
  return {
    seq,
    timestamp: position.timestamp,
    lat: c.latitude,
    lon: c.longitude,
    altitude: c.altitude,
    accuracy: c.accuracy,
    altitudeAccuracy: c.altitudeAccuracy,
    speed: c.speed,
    heading: c.heading,
    quality: coordsInvalid ? GpsFixQuality.NoFix : classifyFixQuality(c.accuracy),
  };
}

/** A non-negative finite device speed (m/s), or null. */
function deviceSpeedOf(fix: GpsFix): number | null {
  return fix.speed != null && Number.isFinite(fix.speed) && fix.speed >= 0 ? fix.speed : null;
}

/** A finite device heading normalized to [0,360), or null. */
function deviceHeadingOf(fix: GpsFix): number | null {
  return fix.heading != null && Number.isFinite(fix.heading) ? normalizeHeading(fix.heading) : null;
}

/**
 * Derive cross-fix motion for `cur` relative to `prev`. With no previous fix,
 * only the device's own (if any) speed/heading are available. A zero or negative
 * time gap (a duplicate callback) yields no rate/derived speed — guarded so the
 * result never contains Infinity/NaN.
 */
export function deriveMotion(prev: GpsFix | null, cur: GpsFix): GpsFixMotion {
  const deviceSpeed = deviceSpeedOf(cur);
  const deviceHeading = deviceHeadingOf(cur);

  if (!prev) {
    return {
      dtSec: null,
      instantHz: null,
      distanceM: null,
      speedMps: deviceSpeed,
      speedSource: deviceSpeed != null ? 'device' : 'none',
      course: deviceHeading,
      courseSource: deviceHeading != null ? 'device' : 'none',
    };
  }

  const dtSec = (cur.timestamp - prev.timestamp) / 1000;
  const distanceM = haversineDistance(prev.lat, prev.lon, cur.lat, cur.lon);
  const moving = dtSec > 0;
  const derivedSpeed = moving ? distanceM / dtSec : null;
  const derivedCourse = distanceM > 0 ? calculateBearing(prev.lat, prev.lon, cur.lat, cur.lon) : null;

  const speedMps = deviceSpeed ?? derivedSpeed;
  const course = deviceHeading ?? derivedCourse;

  return {
    dtSec,
    instantHz: moving ? 1 / dtSec : null,
    distanceM,
    speedMps,
    speedSource: deviceSpeed != null ? 'device' : derivedSpeed != null ? 'derived' : 'none',
    course,
    courseSource: deviceHeading != null ? 'device' : derivedCourse != null ? 'derived' : 'none',
  };
}

/**
 * Average rate (Hz) over the most recent `window` timestamps, derived from their
 * total span (not a mean of per-gap rates, which over-weights short gaps).
 * Returns null until at least two timestamps exist or when the span is zero.
 */
export function averageHz(timestamps: number[], window = 20): number | null {
  if (timestamps.length < 2) return null;
  const recent = timestamps.slice(-window);
  const span = (recent[recent.length - 1] - recent[0]) / 1000;
  if (span <= 0) return null;
  return (recent.length - 1) / span;
}
