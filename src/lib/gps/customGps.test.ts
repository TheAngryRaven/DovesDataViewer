import { describe, it, expect, beforeEach } from 'vitest';
import { CustomGps, type GpsObservation, type GpsError } from './customGps';
import { GpsFixQuality } from './gpsFix';

/**
 * A controllable fake `Geolocation` so the source can be driven deterministically
 * with no real device or jsdom support. `emit`/`fail` invoke the registered
 * callbacks synchronously.
 */
class FakeGeolocation {
  successCb: PositionCallback | null = null;
  errorCb: PositionErrorCallback | null = null;
  lastOptions: PositionOptions | undefined;
  watchCalls = 0;
  cleared: number[] = [];
  private nextId = 1;

  watchPosition(success: PositionCallback, error?: PositionErrorCallback | null, options?: PositionOptions): number {
    this.watchCalls++;
    this.successCb = success;
    this.errorCb = error ?? null;
    this.lastOptions = options;
    return this.nextId++;
  }

  clearWatch(id: number): void {
    this.cleared.push(id);
  }

  getCurrentPosition(): void {
    /* unused */
  }

  emit(coords: Partial<GeolocationCoordinates>, timestamp: number): void {
    this.successCb?.({
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
    } as GeolocationPosition);
  }

  fail(code: number, message = ''): void {
    this.errorCb?.({ code, message } as GeolocationPositionError);
  }
}

function makeSource(geo: FakeGeolocation, options = {}) {
  return new CustomGps({ geolocation: geo as unknown as Geolocation, ...options });
}

describe('CustomGps lifecycle', () => {
  let geo: FakeGeolocation;

  beforeEach(() => {
    geo = new FakeGeolocation();
  });

  it('reports unsupported and does not run when no geolocation is available', () => {
    const errors: GpsError[] = [];
    const gps = new CustomGps({ geolocation: null });
    gps.onError((e) => errors.push(e));
    expect(gps.start()).toBe(false);
    expect(gps.running).toBe(false);
    expect(errors).toEqual([{ code: 'unsupported', message: expect.any(String) }]);
  });

  it('starts a high-accuracy, never-cached watch with default options', () => {
    const gps = makeSource(geo);
    expect(gps.start()).toBe(true);
    expect(gps.running).toBe(true);
    expect(geo.watchCalls).toBe(1);
    expect(geo.lastOptions).toEqual({ enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 });
  });

  it('passes through overridden options', () => {
    const gps = makeSource(geo, { enableHighAccuracy: false, maximumAge: 1_000, timeout: 5_000 });
    gps.start();
    expect(geo.lastOptions).toEqual({ enableHighAccuracy: false, maximumAge: 1_000, timeout: 5_000 });
  });

  it('is idempotent on repeated start', () => {
    const gps = makeSource(geo);
    gps.start();
    gps.start();
    expect(geo.watchCalls).toBe(1);
  });

  it('clears the watch on stop and goes not-running', () => {
    const gps = makeSource(geo);
    gps.start();
    gps.stop();
    expect(geo.cleared).toEqual([1]);
    expect(gps.running).toBe(false);
  });

  it('ignores a position that races in after stop', () => {
    const gps = makeSource(geo);
    gps.start();
    gps.stop();
    geo.emit({ latitude: 1, longitude: 1 }, 1_000);
    expect(gps.fixCount).toBe(0);
  });
});

describe('CustomGps capture', () => {
  let geo: FakeGeolocation;
  let gps: CustomGps;
  let seen: GpsObservation[];

  beforeEach(() => {
    geo = new FakeGeolocation();
    gps = makeSource(geo);
    seen = [];
    gps.onFix((o) => seen.push(o));
    gps.start();
  });

  it('emits a normalized observation for the first fix (origin t=0, no motion)', () => {
    geo.emit({ latitude: 45, longitude: -73, accuracy: 4, speed: 10, heading: 90 }, 10_000);
    expect(seen).toHaveLength(1);
    const obs = seen[0];
    expect(obs.fix.seq).toBe(0);
    expect(obs.fix.timestamp).toBe(10_000);
    expect(obs.fix.lat).toBe(45);
    expect(obs.fix.quality).toBe(GpsFixQuality.Good);
    expect(obs.elapsedMs).toBe(0); // first fix is the time origin
    expect(obs.averageHz).toBeNull();
    expect(obs.motion.dtSec).toBeNull();
    // device speed/heading are available even on the first fix
    expect(obs.motion.speedMps).toBe(10);
    expect(obs.motion.speedSource).toBe('device');
    expect(obs.motion.course).toBe(90);
  });

  it('derives motion + rate across fixes and rebases elapsed time to the first', () => {
    geo.emit({ latitude: 45, longitude: 0 }, 10_000);
    geo.emit({ latitude: 45.001, longitude: 0 }, 11_000);
    expect(gps.fixCount).toBe(2);
    const obs = gps.latest!;
    expect(obs.fix.seq).toBe(1);
    expect(obs.elapsedMs).toBe(1_000);
    expect(obs.motion.dtSec).toBe(1);
    expect(obs.motion.instantHz).toBe(1);
    expect(obs.motion.distanceM).toBeGreaterThan(100);
    expect(obs.motion.speedSource).toBe('derived');
    expect(obs.averageHz).toBeCloseTo(1, 6);
  });

  it('exposes observations, latest and a rolling averageHz', () => {
    geo.emit({}, 0);
    geo.emit({}, 1_000);
    geo.emit({}, 2_000);
    expect(gps.fixCount).toBe(3);
    expect(gps.observations).toHaveLength(3);
    expect(gps.latest).toBe(gps.observations[2]);
    expect(gps.averageHz).toBeCloseTo(1, 6);
  });

  it('clear() resets the session so the next fix is seq 0 at t=0', () => {
    geo.emit({}, 5_000);
    geo.emit({}, 6_000);
    gps.clear();
    expect(gps.fixCount).toBe(0);
    expect(gps.averageHz).toBeNull();
    geo.emit({ latitude: 10, longitude: 10 }, 99_000);
    expect(gps.latest!.fix.seq).toBe(0);
    expect(gps.latest!.elapsedMs).toBe(0);
  });

  it('does not retain the buffer when retainBuffer is false, but keeps latest/count', () => {
    const g = new FakeGeolocation();
    const lean = new CustomGps({ geolocation: g as unknown as Geolocation, retainBuffer: false });
    const seenLean: GpsObservation[] = [];
    lean.onFix((o) => seenLean.push(o));
    lean.start();
    g.emit({ latitude: 1, longitude: 1 }, 0);
    g.emit({ latitude: 1.001, longitude: 1 }, 1_000);
    expect(lean.observations).toHaveLength(0); // not retained
    expect(lean.fixCount).toBe(2); // still counted
    expect(lean.latest).toBe(seenLean[1]); // latest still tracked
    expect(lean.averageHz).toBeCloseTo(1, 6); // rate still works
  });

  it('stops delivering to an unsubscribed fix listener', () => {
    const extra: GpsObservation[] = [];
    const unsub = gps.onFix((o) => extra.push(o));
    geo.emit({}, 0);
    unsub();
    geo.emit({}, 1_000);
    expect(extra).toHaveLength(1);
    expect(seen).toHaveLength(2); // the original listener keeps receiving
  });
});

describe('CustomGps errors', () => {
  let geo: FakeGeolocation;
  let gps: CustomGps;
  let errors: GpsError[];

  beforeEach(() => {
    geo = new FakeGeolocation();
    gps = makeSource(geo);
    errors = [];
    gps.onError((e) => errors.push(e));
    gps.start();
  });

  it('maps the W3C error codes', () => {
    geo.fail(1, 'denied');
    geo.fail(2, 'unavailable');
    geo.fail(3, 'timeout');
    geo.fail(99, 'weird');
    expect(errors.map((e) => e.code)).toEqual([
      'permission-denied',
      'position-unavailable',
      'timeout',
      'unknown',
    ]);
    expect(errors[0].message).toBe('denied');
  });

  it('falls back to a default message when the device gives none', () => {
    geo.fail(2, '');
    expect(errors[0].message).toMatch(/unavailable/i);
  });

  it('stops delivering to an unsubscribed error listener', () => {
    const extra: GpsError[] = [];
    const unsub = gps.onError((e) => extra.push(e));
    geo.fail(1, 'a');
    unsub();
    geo.fail(1, 'b');
    expect(extra).toHaveLength(1);
    expect(errors).toHaveLength(2);
  });
});
