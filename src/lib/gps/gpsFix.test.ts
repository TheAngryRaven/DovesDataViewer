import { describe, it, expect } from 'vitest';
import {
  GpsFixQuality,
  FIX_QUALITY_THRESHOLDS,
  NO_MOTION,
  classifyFixQuality,
  createGpsFix,
  deriveMotion,
  averageHz,
  type GpsFix,
} from './gpsFix';

/** Build a `GpsFix` directly for derivation tests. */
function fix(partial: Partial<GpsFix> & Pick<GpsFix, 'timestamp' | 'lat' | 'lon'>): GpsFix {
  return {
    seq: 0,
    altitude: null,
    accuracy: 5,
    altitudeAccuracy: null,
    speed: null,
    heading: null,
    quality: GpsFixQuality.Good,
    ...partial,
  };
}

/** Build a browser `GeolocationPosition` for `createGpsFix` tests. */
function position(
  coords: Partial<GeolocationCoordinates>,
  timestamp = 1_000,
): GeolocationPosition {
  return {
    timestamp,
    coords: {
      latitude: 45,
      longitude: -73,
      altitude: null,
      accuracy: 5,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      ...coords,
    } as GeolocationCoordinates,
  } as GeolocationPosition;
}

describe('classifyFixQuality', () => {
  it('buckets by horizontal accuracy boundaries', () => {
    expect(classifyFixQuality(FIX_QUALITY_THRESHOLDS.excellent)).toBe(GpsFixQuality.Excellent);
    expect(classifyFixQuality(FIX_QUALITY_THRESHOLDS.excellent + 0.01)).toBe(GpsFixQuality.Good);
    expect(classifyFixQuality(FIX_QUALITY_THRESHOLDS.good)).toBe(GpsFixQuality.Good);
    expect(classifyFixQuality(FIX_QUALITY_THRESHOLDS.good + 0.01)).toBe(GpsFixQuality.Fair);
    expect(classifyFixQuality(FIX_QUALITY_THRESHOLDS.fair)).toBe(GpsFixQuality.Fair);
    expect(classifyFixQuality(FIX_QUALITY_THRESHOLDS.fair + 0.01)).toBe(GpsFixQuality.Poor);
    expect(classifyFixQuality(100)).toBe(GpsFixQuality.Poor);
  });

  it('treats missing / non-finite / negative accuracy as NoFix', () => {
    expect(classifyFixQuality(null)).toBe(GpsFixQuality.NoFix);
    expect(classifyFixQuality(undefined)).toBe(GpsFixQuality.NoFix);
    expect(classifyFixQuality(NaN)).toBe(GpsFixQuality.NoFix);
    expect(classifyFixQuality(Infinity)).toBe(GpsFixQuality.NoFix);
    expect(classifyFixQuality(-1)).toBe(GpsFixQuality.NoFix);
  });

  it('classifies a perfect 0 m accuracy as Excellent', () => {
    expect(classifyFixQuality(0)).toBe(GpsFixQuality.Excellent);
  });
});

describe('createGpsFix', () => {
  it('maps every coordinate field and the sequence/timestamp', () => {
    const f = createGpsFix(
      position(
        {
          latitude: 12.34,
          longitude: 56.78,
          altitude: 100,
          accuracy: 4,
          altitudeAccuracy: 8,
          speed: 9,
          heading: 270,
        },
        4_242,
      ),
      7,
    );
    expect(f).toEqual({
      seq: 7,
      timestamp: 4_242,
      lat: 12.34,
      lon: 56.78,
      altitude: 100,
      accuracy: 4,
      altitudeAccuracy: 8,
      speed: 9,
      heading: 270,
      quality: GpsFixQuality.Good,
    });
  });

  it('preserves nulls the device omits', () => {
    const f = createGpsFix(position({ altitude: null, speed: null, heading: null, altitudeAccuracy: null }), 0);
    expect(f.altitude).toBeNull();
    expect(f.speed).toBeNull();
    expect(f.heading).toBeNull();
    expect(f.altitudeAccuracy).toBeNull();
  });

  it('forces NoFix for structurally invalid coordinates, ignoring accuracy', () => {
    expect(createGpsFix(position({ latitude: NaN, accuracy: 1 }), 0).quality).toBe(GpsFixQuality.NoFix);
    expect(createGpsFix(position({ latitude: 0, longitude: 0, accuracy: 1 }), 0).quality).toBe(GpsFixQuality.NoFix);
    expect(createGpsFix(position({ latitude: 200, accuracy: 1 }), 0).quality).toBe(GpsFixQuality.NoFix);
  });
});

describe('deriveMotion', () => {
  it('returns NO_MOTION shape for the first fix with no device values', () => {
    const m = deriveMotion(null, fix({ timestamp: 0, lat: 0, lon: 0 }));
    expect(m).toEqual(NO_MOTION);
  });

  it('uses device speed/heading on the first fix when present', () => {
    const m = deriveMotion(null, fix({ timestamp: 0, lat: 0, lon: 0, speed: 12, heading: 90 }));
    expect(m.speedMps).toBe(12);
    expect(m.speedSource).toBe('device');
    expect(m.course).toBe(90);
    expect(m.courseSource).toBe('device');
    expect(m.dtSec).toBeNull();
    expect(m.instantHz).toBeNull();
  });

  it('derives dt, Hz, distance, speed and course between two fixes', () => {
    // ~111 m due north over 1 s.
    const prev = fix({ timestamp: 0, lat: 45, lon: 0 });
    const cur = fix({ timestamp: 1_000, lat: 45.001, lon: 0 });
    const m = deriveMotion(prev, cur);
    expect(m.dtSec).toBe(1);
    expect(m.instantHz).toBe(1);
    expect(m.distanceM).toBeGreaterThan(100);
    expect(m.distanceM).toBeLessThan(120);
    expect(m.speedMps).toBeCloseTo(m.distanceM!, 6);
    expect(m.speedSource).toBe('derived');
    expect(m.course).toBeCloseTo(0, 1); // due north
    expect(m.courseSource).toBe('derived');
  });

  it('prefers device speed/heading over derived when both exist', () => {
    const prev = fix({ timestamp: 0, lat: 45, lon: 0 });
    const cur = fix({ timestamp: 1_000, lat: 45.001, lon: 0, speed: 30, heading: 123 });
    const m = deriveMotion(prev, cur);
    expect(m.speedMps).toBe(30);
    expect(m.speedSource).toBe('device');
    expect(m.course).toBe(123);
    expect(m.courseSource).toBe('device');
  });

  it('guards a zero-gap duplicate callback (no Infinity)', () => {
    const prev = fix({ timestamp: 1_000, lat: 1, lon: 1 });
    const cur = fix({ timestamp: 1_000, lat: 1.0001, lon: 1 });
    const m = deriveMotion(prev, cur);
    expect(m.dtSec).toBe(0);
    expect(m.instantHz).toBeNull();
    expect(m.speedMps).toBeNull();
    expect(m.speedSource).toBe('none');
  });

  it('leaves course null and source none when the device did not move', () => {
    const prev = fix({ timestamp: 0, lat: 10, lon: 10 });
    const cur = fix({ timestamp: 1_000, lat: 10, lon: 10 });
    const m = deriveMotion(prev, cur);
    expect(m.distanceM).toBe(0);
    expect(m.course).toBeNull();
    expect(m.courseSource).toBe('none');
    expect(m.speedMps).toBe(0); // derived 0 m / 1 s
    expect(m.speedSource).toBe('derived');
  });

  it('ignores a negative device speed and falls back to derived', () => {
    const prev = fix({ timestamp: 0, lat: 45, lon: 0 });
    const cur = fix({ timestamp: 1_000, lat: 45.001, lon: 0, speed: -1 });
    const m = deriveMotion(prev, cur);
    expect(m.speedSource).toBe('derived');
    expect(m.speedMps).toBeGreaterThan(0);
  });

  it('normalizes an out-of-range device heading into [0,360)', () => {
    const m = deriveMotion(null, fix({ timestamp: 0, lat: 0, lon: 0, heading: 450 }));
    expect(m.course).toBe(90);
  });
});

describe('averageHz', () => {
  it('returns null with fewer than two timestamps', () => {
    expect(averageHz([])).toBeNull();
    expect(averageHz([100])).toBeNull();
  });

  it('returns null when the span is zero (all identical)', () => {
    expect(averageHz([5, 5, 5])).toBeNull();
  });

  it('averages over the timestamp span (5 @ 1 Hz → 1 Hz)', () => {
    expect(averageHz([0, 1_000, 2_000, 3_000, 4_000])).toBe(1);
  });

  it('only spans the most recent `window` timestamps', () => {
    // A huge initial gap, then 4 fast 10 Hz fixes; window=5 ignores the slow gap.
    const ts = [0, 100_000, 100_100, 100_200, 100_300, 100_400];
    expect(averageHz(ts, 5)).toBeCloseTo(10, 6);
  });
});
