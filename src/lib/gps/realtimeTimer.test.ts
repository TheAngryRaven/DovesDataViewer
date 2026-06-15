import { describe, it, expect } from 'vitest';
import { RealtimeLapTimer, EMPTY_TIMING_STATE } from './realtimeTimer';
import type { GpsSample, Course, Track } from '@/types/racing';

function makeSample(t: number, lat: number, lon: number, speedMps = 20): GpsSample {
  return { t, lat, lon, speedMps, speedMph: speedMps * 2.23694, speedKph: speedMps * 3.6, extraFields: {} };
}

/** S/F line: vertical at lon=0, lat ∈ [-0.0001, 0.0001] (mirrors lapCalculation tests). */
const sfCourse: Course = {
  name: 'TestCourse',
  startFinishA: { lat: 0.0001, lon: 0 },
  startFinishB: { lat: -0.0001, lon: 0 },
  isUserDefined: false,
};

/**
 * 3-major course: S/F (lon=0) + sector 2 (lon=0.003) + sector 3 (lon=0.006),
 * mirrors the sector fixture in lapCalculation.test.ts.
 */
const sectorCourse: Course = {
  name: "SectorCourse",
  startFinishA: { lat: 0.0001, lon: 0 },
  startFinishB: { lat: -0.0001, lon: 0 },
  sector2: { a: { lat: 0.0001, lon: 0.003 }, b: { lat: -0.0001, lon: 0.003 } },
  sector3: { a: { lat: 0.0001, lon: 0.006 }, b: { lat: -0.0001, lon: 0.006 } },
};

/** One sector-aware lap crossing S/F → S2 → S3 → loop back, like the lap-calc tests. */
function makeSectorLap(startT: number, lapDur: number, speedMps = 20): GpsSample[] {
  return [
    makeSample(startT, 0, -0.001, speedMps),
    makeSample(startT + lapDur * 0.1, 0, 0.001, speedMps), // cross S/F
    makeSample(startT + lapDur * 0.2, 0, 0.002, speedMps),
    makeSample(startT + lapDur * 0.3, 0, 0.004, speedMps), // cross S2
    makeSample(startT + lapDur * 0.4, 0, 0.005, speedMps),
    makeSample(startT + lapDur * 0.5, 0, 0.007, speedMps), // cross S3
    makeSample(startT + lapDur * 0.6, 0.01, 0.007, speedMps),
    makeSample(startT + lapDur * 0.8, 0.01, -0.001, speedMps),
    makeSample(startT + lapDur, 0, -0.001, speedMps),
  ];
}

/** Densely-sampled sector path: same loop shape as makeSectorLap, interpolated
 *  to `stepMs` spacing so it exercises the recompute throttle. */
function denseSectorPath(numLaps: number, lapDur: number, stepMs: number): GpsSample[] {
  // [lap-fraction, lat, lon] keyframes (S/F→S2→S3→loop back), matching makeSectorLap.
  const pts: Array<[number, number, number]> = [
    [0.0, 0, -0.001],
    [0.1, 0, 0.001],
    [0.2, 0, 0.002],
    [0.3, 0, 0.004],
    [0.4, 0, 0.005],
    [0.5, 0, 0.007],
    [0.6, 0.01, 0.007],
    [0.8, 0.01, -0.001],
    [1.0, 0, -0.001],
  ];
  const out: GpsSample[] = [];
  const total = numLaps * lapDur;
  for (let t = 0; t <= total; t += stepMs) {
    const lapT = (t % lapDur) / lapDur;
    let i = 0;
    while (i < pts.length - 2 && pts[i + 1][0] < lapT) i++;
    const [f0, lat0, lon0] = pts[i];
    const [f1, lat1, lon1] = pts[i + 1];
    const u = Math.min(1, Math.max(0, (lapT - f0) / (f1 - f0 || 1)));
    out.push(makeSample(t, lat0 + (lat1 - lat0) * u, lon0 + (lon1 - lon0) * u));
  }
  return out;
}

/** N east-going S/F crossings → N-1 laps. */
function makeRacePath(numCrossings: number, intervalMs: number, speedMps = 20): GpsSample[] {
  const samples: GpsSample[] = [];
  let t = 0;
  samples.push(makeSample(t, 0, -0.001, speedMps));
  for (let i = 0; i < numCrossings; i++) {
    t += intervalMs / 4;
    samples.push(makeSample(t, 0, 0.001, speedMps));
    if (i < numCrossings - 1) {
      t += intervalMs / 4;
      samples.push(makeSample(t, 0.01, 0.001, speedMps));
      t += intervalMs / 4;
      samples.push(makeSample(t, 0.01, -0.001, speedMps));
      t += intervalMs / 4;
      samples.push(makeSample(t, 0, -0.001, speedMps));
    }
  }
  return samples;
}

describe('RealtimeLapTimer — no course', () => {
  it('returns the empty state with live speed before a course is known', () => {
    const timer = new RealtimeLapTimer([]); // no tracks → never detects
    const state = timer.update(makeSample(0, 1, 1, 15));
    expect(state.courseName).toBeNull();
    expect(state.lapCount).toBe(0);
    expect(state.speedMph).toBeCloseTo(15 * 2.23694, 4);
  });

  it('exposes a stable EMPTY_TIMING_STATE shape', () => {
    expect(EMPTY_TIMING_STATE.lapCount).toBe(0);
    expect(EMPTY_TIMING_STATE.majorSectors).toEqual([]);
  });
});

describe('RealtimeLapTimer — locked course, incremental feed', () => {
  it('counts completed laps and tracks best/last as samples stream in', () => {
    const timer = new RealtimeLapTimer();
    timer.lockCourse(sfCourse, 'Test Track');
    const path = makeRacePath(3, 60_000); // 3 crossings → 2 laps
    let state = timer.getState();
    for (const s of path) state = timer.update(s);

    expect(state.courseName).toBe('TestCourse');
    expect(state.trackName).toBe('Test Track');
    expect(state.lapCount).toBe(2);
    expect(state.bestLapMs).toBeCloseTo(60_000, -1); // 60 s lap, ±5 ms
    expect(state.lastLapMs).toBeCloseTo(60_000, -1);
    expect(state.bestLapNumber).not.toBeNull();
  });

  it('reports a non-negative in-progress current lap time', () => {
    const timer = new RealtimeLapTimer();
    timer.lockCourse(sfCourse);
    let state = timer.getState();
    for (const s of makeRacePath(2, 40_000)) state = timer.update(s);
    expect(state.lapCount).toBe(1);
    expect(state.currentLapMs).not.toBeNull();
    // In-progress lap = time since the last crossing — bounded, not the whole session.
    expect(state.currentLapMs!).toBeGreaterThan(0);
    expect(state.currentLapMs!).toBeLessThan(40_000);
  });

  it('has no major-sector rollup for a start/finish-only course', () => {
    const timer = new RealtimeLapTimer();
    timer.lockCourse(sfCourse);
    let state = timer.getState();
    for (const s of makeRacePath(3, 60_000)) state = timer.update(s);
    expect(state.majorSectors).toEqual([]);
  });

  it('keeps completed laps stable across further updates (idempotent recompute)', () => {
    const timer = new RealtimeLapTimer();
    timer.lockCourse(sfCourse);
    for (const s of makeRacePath(3, 60_000)) timer.update(s);
    const before = timer.getState().lapCount;
    // extra stationary sample at the last position shouldn't drop laps
    timer.update(makeSample(200_000, 0, 0.001, 0));
    expect(timer.getState().lapCount).toBe(before);
  });
});

describe("RealtimeLapTimer — track proximity (log-only when far)", () => {
  const farTrack: Track = {
    name: "Far",
    courses: [{ name: "c", startFinishA: { lat: 40, lon: 40 }, startFinishB: { lat: 40, lon: 40.001 } }],
  };
  const nearTrack: Track = {
    name: "Near",
    courses: [{ name: "c", startFinishA: { lat: 0, lon: 0 }, startFinishB: { lat: 0.0001, lon: 0 } }],
  };

  it("reports nearKnownTrack = null until tracks have loaded", () => {
    const timer = new RealtimeLapTimer(); // setTracks never called
    expect(timer.update(makeSample(0, 0, 0, 10)).nearKnownTrack).toBeNull();
  });

  it("flags far-from-track and keeps logging (no course, speed still shown)", () => {
    const timer = new RealtimeLapTimer();
    timer.setTracks([farTrack]);
    let state = timer.getState();
    for (let i = 0; i < 12; i++) state = timer.update(makeSample(i * 1000, 0, 0.0001 * i, 10));
    expect(state.nearKnownTrack).toBe(false);
    expect(state.courseName).toBeNull();
    expect(state.isWaypointMode).toBe(false); // far → don't even waypoint-time
    expect(state.speedMph).toBeGreaterThan(0);
  });

  it("does not flag far when within range of a known track", () => {
    const timer = new RealtimeLapTimer();
    timer.setTracks([nearTrack]);
    let state = timer.getState();
    for (let i = 0; i < 12; i++) state = timer.update(makeSample(i * 1000, 0, 0.0001 * i, 10));
    expect(state.nearKnownTrack).toBe(true);
  });

  it("nearTrack() probes proximity without feeding the timer", () => {
    const timer = new RealtimeLapTimer();
    expect(timer.nearTrack(0, 0.0005)).toBeNull(); // tracks not loaded yet
    timer.setTracks([nearTrack]); // start/finish at (0, 0)
    expect(timer.nearTrack(0, 0.0005)).toBe(true); // ~55 m away
    expect(timer.nearTrack(40, 40)).toBe(false);
    expect(timer.getSamples()).toHaveLength(0); // pure probe — nothing recorded
  });

  it("nearestTrackName() names the nearby track (or null when far / not loaded)", () => {
    const timer = new RealtimeLapTimer();
    expect(timer.nearestTrackName(0, 0.0005)).toBeNull(); // tracks not loaded yet
    timer.setTracks([nearTrack]); // start/finish at (0, 0)
    expect(timer.nearestTrackName(0, 0.0005)).toBe("Near"); // ~55 m away
    expect(timer.nearestTrackName(40, 40)).toBeNull(); // far → no name
  });
});

describe("RealtimeLapTimer — 3-major course (sectors, optimal, delta)", () => {
  function runSectorLaps(n: number, lapDur = 30_000): RealtimeLapTimer {
    const timer = new RealtimeLapTimer();
    timer.lockCourse(sectorCourse, "Sector Track");
    for (let i = 0; i < n; i++) {
      for (const s of makeSectorLap(i * lapDur, lapDur)) timer.update(s);
    }
    return timer;
  }

  it("rolls up the three major sectors with last + best", () => {
    const state = runSectorLaps(3).getState();
    expect(state.lapCount).toBe(2);
    expect(state.majorSectors).toHaveLength(3);
    for (const sec of state.majorSectors) {
      expect(sec.best).not.toBeNull();
      expect(sec.last).not.toBeNull();
      expect(sec.best!).toBeGreaterThan(0);
      // best is never slower than the last lap's value for that sector
      expect(sec.best!).toBeLessThanOrEqual(sec.last!);
    }
  });

  it("surfaces an optimal lap (sum of best segments) once laps complete", () => {
    const state = runSectorLaps(3).getState();
    expect(state.optimalMs).not.toBeNull();
    expect(state.optimalMs!).toBeGreaterThan(0);
    // optimal is never slower than the best actual lap
    expect(state.optimalMs!).toBeLessThanOrEqual(state.bestLapMs!);
  });

  it("still counts laps correctly at a high sample rate (recompute throttle)", () => {
    // Densely-sampled (100 ms steps, below the 200 ms heavy-recompute gap) but
    // realistic 30 s laps: most fixes skip the full recompute, yet laps must
    // still be detected at the next recompute.
    const timer = new RealtimeLapTimer();
    timer.lockCourse(sectorCourse, "Sector Track");
    for (const s of denseSectorPath(3, 30_000, 100)) timer.update(s);
    const state = timer.getState();
    expect(state.lapCount).toBe(2);
    expect(state.majorSectors.every((s) => s.best != null)).toBe(true);
  });

  it("computes a live delta vs the best lap once a reference exists", () => {
    const timer = new RealtimeLapTimer();
    timer.lockCourse(sectorCourse, "Sector Track");
    // First lap: no reference yet → delta null.
    let state = timer.getState();
    for (const s of makeSectorLap(0, 30_000)) state = timer.update(s);
    expect(state.deltaSec).toBeNull();
    // Drive a second lap partway → a best lap now exists, delta is a number.
    const partial = makeSectorLap(30_000, 30_000).slice(0, 5);
    for (const s of partial) state = timer.update(s);
    expect(state.bestLapMs).not.toBeNull();
    expect(typeof state.deltaSec).toBe("number");
  });
});
