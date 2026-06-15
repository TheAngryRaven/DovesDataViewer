import { describe, it, expect } from 'vitest';
import { observationToSample } from './observationSample';
import { GpsFixQuality } from './gpsFix';
import type { GpsObservation } from './customGps';

function obs(over: Partial<GpsObservation['fix']>, motion: Partial<GpsObservation['motion']>, elapsedMs = 0): GpsObservation {
  return {
    fix: {
      seq: 0,
      timestamp: 1_000,
      lat: 45,
      lon: -73,
      altitude: null,
      accuracy: 5,
      altitudeAccuracy: null,
      speed: null,
      heading: null,
      quality: GpsFixQuality.Good,
      ...over,
    },
    motion: {
      dtSec: null,
      instantHz: null,
      distanceM: null,
      speedMps: null,
      speedSource: 'none',
      course: null,
      courseSource: 'none',
      ...motion,
    },
    elapsedMs,
    averageHz: null,
  };
}

describe('observationToSample', () => {
  it('maps elapsed time, position, speed (all units) and heading', () => {
    const s = observationToSample(obs({ lat: 10, lon: 20 }, { speedMps: 25, course: 90 }, 1_500));
    expect(s.t).toBe(1_500);
    expect(s.lat).toBe(10);
    expect(s.lon).toBe(20);
    expect(s.speedMps).toBe(25);
    expect(s.speedMph).toBeCloseTo(25 * 2.23694, 4);
    expect(s.speedKph).toBeCloseTo(25 * 3.6, 4);
    expect(s.heading).toBe(90);
  });

  it('uses 0 speed and undefined heading when motion is unknown', () => {
    const s = observationToSample(obs({}, {}));
    expect(s.speedMps).toBe(0);
    expect(s.speedMph).toBe(0);
    expect(s.heading).toBeUndefined();
  });

  it('carries accuracy + altitude into canonical extraFields', () => {
    const s = observationToSample(obs({ accuracy: 3.2, altitude: 120, altitudeAccuracy: 6 }, {}));
    expect(s.extraFields.h_acc).toBe(3.2);
    expect(s.extraFields.altitude).toBe(120);
    expect(s.extraFields.v_acc).toBe(6);
  });

  it('omits altitude/v_acc when the device did not report them', () => {
    const s = observationToSample(obs({ altitude: null, altitudeAccuracy: null }, {}));
    expect('altitude' in s.extraFields).toBe(false);
    expect('v_acc' in s.extraFields).toBe(false);
  });
});
