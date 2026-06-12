import { describe, it, expect } from "vitest";
import { autoDetectCourse } from "./courseDetection";
import type { GpsSample, Track, Course } from "@/types/racing";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeSample(t: number, lat: number, lon: number, speedMps = 20): GpsSample {
  return {
    t, lat, lon,
    speedMps,
    speedMph: speedMps * 2.23694,
    speedKph: speedMps * 3.6,
    extraFields: {},
  };
}

/**
 * Build a path of N east-going S/F crossings centered at the given track origin.
 * The S/F line at the track is assumed to be vertical at the origin's lon, with
 * tiny lat extent ±0.0001. Path:
 *   - Start at (origin.lat, origin.lon - 0.001) west of line
 *   - Cross by jumping to (origin.lat, origin.lon + 0.001)
 *   - Loop north to (origin.lat + 0.01, ...) → west → south back to start
 */
function makeRacePathAtTrack(
  origin: { lat: number; lon: number },
  numCrossings: number,
  intervalMs: number,
  speedMps = 20,
): GpsSample[] {
  const samples: GpsSample[] = [];
  let t = 0;
  samples.push(makeSample(t, origin.lat, origin.lon - 0.001, speedMps));

  for (let i = 0; i < numCrossings; i++) {
    t += intervalMs / 4;
    samples.push(makeSample(t, origin.lat, origin.lon + 0.001, speedMps));
    if (i < numCrossings - 1) {
      t += intervalMs / 4;
      samples.push(makeSample(t, origin.lat + 0.01, origin.lon + 0.001, speedMps));
      t += intervalMs / 4;
      samples.push(makeSample(t, origin.lat + 0.01, origin.lon - 0.001, speedMps));
      t += intervalMs / 4;
      samples.push(makeSample(t, origin.lat, origin.lon - 0.001, speedMps));
    }
  }
  return samples;
}

/** Sector-aware lap that crosses S/F → S2 → S3 going east each lap. */
function makeSectorLap(origin: { lat: number; lon: number }, startT: number, lapDur: number): GpsSample[] {
  return [
    makeSample(startT, origin.lat, origin.lon - 0.001),
    makeSample(startT + lapDur * 0.1, origin.lat, origin.lon + 0.001), // cross S/F
    makeSample(startT + lapDur * 0.2, origin.lat, origin.lon + 0.002),
    makeSample(startT + lapDur * 0.3, origin.lat, origin.lon + 0.004), // cross S2
    makeSample(startT + lapDur * 0.4, origin.lat, origin.lon + 0.005),
    makeSample(startT + lapDur * 0.5, origin.lat, origin.lon + 0.007), // cross S3
    makeSample(startT + lapDur * 0.6, origin.lat + 0.01, origin.lon + 0.007),
    makeSample(startT + lapDur * 0.8, origin.lat + 0.01, origin.lon - 0.001),
    makeSample(startT + lapDur, origin.lat, origin.lon - 0.001),
  ];
}

const okcOrigin = { lat: 35.4, lon: -97.3 };

function makeTrack(opts: {
  name?: string;
  shortName?: string;
  origin?: { lat: number; lon: number };
  courses?: Course[];
} = {}): Track {
  const origin = opts.origin ?? okcOrigin;
  return {
    name: opts.name ?? "OKC Kart Center",
    shortName: opts.shortName ?? "OKC",
    courses: opts.courses ?? [{
      name: "Full",
      // makeRacePathAtTrack's loop is ~2.6 km (~8500 ft) per lap: 0.002° east,
      // 0.01° north, back. Must sit within the enforced 25% length tolerance.
      lengthFt: 8500,
      startFinishA: { lat: origin.lat + 0.0001, lon: origin.lon },
      startFinishB: { lat: origin.lat - 0.0001, lon: origin.lon },
    }],
  };
}

// ─── Degenerate inputs ───────────────────────────────────────────────────────

describe("autoDetectCourse - degenerate inputs", () => {
  it("returns null for empty samples", () => {
    expect(autoDetectCourse([], [makeTrack()])).toBeNull();
  });

  it("returns null when fewer than 10 samples", () => {
    const samples = Array.from({ length: 5 }, (_, i) => makeSample(i * 1000, okcOrigin.lat, okcOrigin.lon));
    expect(autoDetectCourse(samples, [makeTrack()])).toBeNull();
  });

  it("returns null when no tracks provided", () => {
    const samples = makeRacePathAtTrack(okcOrigin, 3, 10000);
    expect(autoDetectCourse(samples, [])).toBeNull();
  });

  it("returns null when all samples are invalid (0,0 or out of range)", () => {
    const samples = Array.from({ length: 20 }, (_, i) => makeSample(i * 1000, 0, 0));
    expect(autoDetectCourse(samples, [makeTrack()])).toBeNull();
  });
});

// ─── Track matching ──────────────────────────────────────────────────────────

describe("autoDetectCourse - track matching", () => {
  it("matches the nearest track within 5 miles", () => {
    const samples = makeRacePathAtTrack(okcOrigin, 3, 10000);
    const result = autoDetectCourse(samples, [makeTrack()]);
    expect(result).not.toBeNull();
    expect(result!.track.shortName).toBe("OKC");
    expect(result!.isWaypointMode).toBe(false);
  });

  it("picks the closer track when two are in range", () => {
    const farther = makeTrack({ name: "Far", shortName: "FAR", origin: { lat: 35.5, lon: -97.3 } });
    const closer = makeTrack({ name: "Close", shortName: "CLOSE", origin: okcOrigin });
    const samples = makeRacePathAtTrack(okcOrigin, 3, 10000);
    const result = autoDetectCourse(samples, [farther, closer]);
    expect(result!.track.shortName).toBe("CLOSE");
  });

  it("falls back to waypoint mode when no track is within 5 miles", () => {
    // Track at OKC, samples at New York
    const samples = makeRacePathAtTrack({ lat: 40.7, lon: -74.0 }, 3, 10000);
    const result = autoDetectCourse(samples, [makeTrack()]);
    expect(result).not.toBeNull();
    expect(result!.isWaypointMode).toBe(true);
    expect(result!.track.name).toBe("Unknown Track");
  });
});

// ─── Course matching ─────────────────────────────────────────────────────────

describe("autoDetectCourse - course matching", () => {
  it("returns the only course on a single-course track", () => {
    const samples = makeRacePathAtTrack(okcOrigin, 3, 10000);
    const result = autoDetectCourse(samples, [makeTrack()]);
    expect(result!.course.name).toBe("Full");
  });

  it("returns laps produced by the chosen course", () => {
    const samples = makeRacePathAtTrack(okcOrigin, 4, 10000);
    const result = autoDetectCourse(samples, [makeTrack()]);
    // 4 crossings → 3 laps
    expect(result!.laps).toHaveLength(3);
  });

  it("prefers the course with closer lengthFt match", () => {
    // makeRacePathAtTrack produces ~8500ft per lap (the loop goes 1km north,
    // 200m east-west, 1km south at lat=35.4°).
    const origin = okcOrigin;
    const trackWithTwoCourses: Track = {
      name: "OKC", shortName: "OKC",
      courses: [
        { // Bad match — ~190% off
          name: "Long",
          lengthFt: 25000,
          startFinishA: { lat: origin.lat + 0.0001, lon: origin.lon },
          startFinishB: { lat: origin.lat - 0.0001, lon: origin.lon },
        },
        { // Good match — ~6% off
          name: "CloseMatch",
          lengthFt: 9000,
          startFinishA: { lat: origin.lat + 0.0001, lon: origin.lon },
          startFinishB: { lat: origin.lat - 0.0001, lon: origin.lon },
        },
      ],
    };
    const samples = makeRacePathAtTrack(origin, 3, 10000);
    const result = autoDetectCourse(samples, [trackWithTwoCourses]);
    expect(result!.course.name).toBe("CloseMatch");
  });

  it("prefers a course with known lengthFt over one without", () => {
    const origin = okcOrigin;
    const trackWithMixedCourses: Track = {
      name: "OKC", shortName: "OKC",
      courses: [
        { // No length
          name: "Unknown",
          startFinishA: { lat: origin.lat + 0.0001, lon: origin.lon },
          startFinishB: { lat: origin.lat - 0.0001, lon: origin.lon },
        },
        { // Known length, terrible match (course is 10000ft, actual ~150ft)
          name: "Known",
          lengthFt: 10000,
          startFinishA: { lat: origin.lat + 0.0001, lon: origin.lon },
          startFinishB: { lat: origin.lat - 0.0001, lon: origin.lon },
        },
      ],
    };
    const samples = makeRacePathAtTrack(origin, 3, 10000);
    const result = autoDetectCourse(samples, [trackWithMixedCourses]);
    // Sort prefers known-length even when the match is poor
    expect(result!.course.name).toBe("Known");
  });

  it("rejects a course outside the 25% tolerance and falls back to waypoint mode", () => {
    // The documented tolerance is enforced: a wildly wrong length means wrong
    // sector lines, so the session must not be tagged with that course.
    const origin = okcOrigin;
    const badMatchTrack: Track = {
      name: "OKC", shortName: "OKC",
      courses: [{
        name: "WayTooLong",
        lengthFt: 50000, // ~5x the actual ~8500ft per lap → ~83% off
        startFinishA: { lat: origin.lat + 0.0001, lon: origin.lon },
        startFinishB: { lat: origin.lat - 0.0001, lon: origin.lon },
      }],
    };
    const samples = makeRacePathAtTrack(origin, 3, 10000);
    const result = autoDetectCourse(samples, [badMatchTrack]);
    expect(result?.course.name).not.toBe("WayTooLong");
    expect(result === null || result.isWaypointMode).toBe(true);
  });

  it("accepts a course just inside the 25% tolerance", () => {
    const origin = okcOrigin;
    const nearMissTrack: Track = {
      name: "OKC", shortName: "OKC",
      courses: [{
        name: "NearMiss",
        lengthFt: 10300, // ~21% above the actual ~8500ft — inside tolerance
        startFinishA: { lat: origin.lat + 0.0001, lon: origin.lon },
        startFinishB: { lat: origin.lat - 0.0001, lon: origin.lon },
      }],
    };
    const samples = makeRacePathAtTrack(origin, 3, 10000);
    const result = autoDetectCourse(samples, [nearMissTrack])!;
    expect(result.course.name).toBe("NearMiss");
    expect(result.isWaypointMode).toBe(false);
  });

  it("populates lengthMatchDiff with the actual fractional difference for good matches", () => {
    const origin = okcOrigin;
    const goodMatchTrack: Track = {
      name: "OKC", shortName: "OKC",
      courses: [{
        name: "Good",
        lengthFt: 9000, // close to actual ~8500ft → ~6% off
        startFinishA: { lat: origin.lat + 0.0001, lon: origin.lon },
        startFinishB: { lat: origin.lat - 0.0001, lon: origin.lon },
      }],
    };
    const samples = makeRacePathAtTrack(origin, 3, 10000);
    const result = autoDetectCourse(samples, [goodMatchTrack])!;
    expect(result.lengthMatchDiff!).toBeLessThan(0.1);
  });

  it("leaves lengthMatchDiff undefined when the matched course has no lengthFt", () => {
    const origin = okcOrigin;
    const unknownLengthTrack: Track = {
      name: "OKC", shortName: "OKC",
      courses: [{
        name: "Unmeasured",
        startFinishA: { lat: origin.lat + 0.0001, lon: origin.lon },
        startFinishB: { lat: origin.lat - 0.0001, lon: origin.lon },
      }],
    };
    const samples = makeRacePathAtTrack(origin, 3, 10000);
    const result = autoDetectCourse(samples, [unknownLengthTrack])!;
    expect(result.lengthMatchDiff).toBeUndefined();
  });

  it("leaves lengthMatchDiff undefined for waypoint mode results", () => {
    // No track nearby → waypoint fallback
    const samples = makeWaypointPath({ lat: 40.7, lon: -74.0 }, 3, 60000, 15);
    const result = autoDetectCourse(samples, [makeTrack()])!;
    expect(result.isWaypointMode).toBe(true);
    expect(result.lengthMatchDiff).toBeUndefined();
  });

  it("falls back to waypoint mode when no course produces laps", () => {
    // Track is nearby but the path never crosses any course's S/F line
    const origin = okcOrigin;
    const offCourseTrack = makeTrack({
      courses: [{
        name: "OffSet",
        lengthFt: 700,
        startFinishA: { lat: origin.lat + 0.05, lon: origin.lon + 0.05 }, // far from path
        startFinishB: { lat: origin.lat + 0.05, lon: origin.lon + 0.05001 },
      }],
    });
    const samples = makeRacePathAtTrack(origin, 3, 10000);
    const result = autoDetectCourse(samples, [offCourseTrack]);
    expect(result).not.toBeNull();
    expect(result!.isWaypointMode).toBe(true);
  });
});

// ─── Direction detection (where the bugs are) ────────────────────────────────

describe("autoDetectCourse - direction detection", () => {
  function makeSectorTrack(origin: { lat: number; lon: number } = okcOrigin): Track {
    return {
      name: "OKC", shortName: "OKC",
      courses: [{
        name: "Full",
        // makeSectorLap's loop is ~3.7 km (~12000 ft) per lap; the reverse
        // sweep fixture is ~13800 ft — both within the 25% tolerance.
        lengthFt: 12000,
        startFinishA: { lat: origin.lat + 0.0001, lon: origin.lon },
        startFinishB: { lat: origin.lat - 0.0001, lon: origin.lon },
        sector2: { a: { lat: origin.lat + 0.0001, lon: origin.lon + 0.003 }, b: { lat: origin.lat - 0.0001, lon: origin.lon + 0.003 } },
        sector3: { a: { lat: origin.lat + 0.0001, lon: origin.lon + 0.006 }, b: { lat: origin.lat - 0.0001, lon: origin.lon + 0.006 } },
      }],
    };
  }

  it("returns undefined direction when course has no sectors", () => {
    const samples = makeRacePathAtTrack(okcOrigin, 3, 10000);
    const result = autoDetectCourse(samples, [makeTrack()]); // course without sectors
    expect(result!.direction).toBeUndefined();
  });

  it("returns 'forward' when sectors compute correctly (path crosses S/F → S2 → S3 → S/F)", () => {
    const lapDur = 20000;
    const samples = [
      ...makeSectorLap(okcOrigin, 0, lapDur),
      ...makeSectorLap(okcOrigin, lapDur, lapDur),
      ...makeSectorLap(okcOrigin, lapDur * 2, lapDur),
    ];
    const result = autoDetectCourse(samples, [makeSectorTrack()]);
    expect(result!.direction).toBe("forward");
  });

  it("returns undefined direction when sectors aren't crossed (no false 'reverse' claim)", () => {
    // Path crosses S/F east but loops back via lat=0.01 — never reaches S2
    // (lon+0.003) or S3 (lon+0.006). Forward direction, but the racing line
    // doesn't intersect the sector lines.
    // Previous bug: returned 'reverse' (false positive — "no sectors = reverse").
    // Fix: detectSectorOrder returns undefined when either sector line is
    // never crossed, so we honestly admit we don't know.
    const samples = makeRacePathAtTrack(okcOrigin, 3, 10000);
    const result = autoDetectCourse(samples, [makeSectorTrack()]);
    expect(result!.direction).toBeUndefined();
  });

  it("returns 'reverse' when sectors are crossed in S3-before-S2 order", () => {
    // Build a westward-traversing path: starts east of all lines, sweeps west
    // crossing S3 first, then S2, then S/F. Two such sweeps produce 1 lap.
    const o = okcOrigin;
    const samples = [
      // Sweep 1
      makeSample(0, o.lat, o.lon + 0.01),
      makeSample(1000, o.lat, o.lon + 0.005),    // cross S3 going west
      makeSample(2000, o.lat, o.lon + 0.002),    // cross S2 going west
      makeSample(3000, o.lat, o.lon - 0.001),    // cross S/F going west
      // Loop back east via high lat (no crossings)
      makeSample(7000, o.lat + 0.01, o.lon - 0.001),
      makeSample(8000, o.lat + 0.01, o.lon + 0.01),
      makeSample(9000, o.lat, o.lon + 0.01),
      // Sweep 2
      makeSample(10000, o.lat, o.lon + 0.005),
      makeSample(11000, o.lat, o.lon + 0.002),
      makeSample(12000, o.lat, o.lon - 0.001),
      // Loop back for any remaining state
      makeSample(16000, o.lat + 0.01, o.lon - 0.001),
      makeSample(17000, o.lat + 0.01, o.lon + 0.01),
      makeSample(18000, o.lat, o.lon + 0.01),
    ];
    const result = autoDetectCourse(samples, [makeSectorTrack()]);
    expect(result).not.toBeNull();
    expect(result!.direction).toBe("reverse");
  });
});

// ─── Waypoint mode ───────────────────────────────────────────────────────────

/**
 * Build a waypoint-mode test path: samples make a loop returning near the
 * start. Speed must hit 30 MPH (≈13.4 m/s) for the waypoint to drop.
 *
 * Loop pattern: north 50m → east 50m → south 50m → west back to start.
 * Repeats `numLoops` times, each loop taking `loopDurMs`.
 */
function makeWaypointPath(
  origin: { lat: number; lon: number },
  numLoops: number,
  loopDurMs: number,
  speedMps = 15, // > 13.4 = 30 mph
): GpsSample[] {
  const samples: GpsSample[] = [];
  let t = 0;
  // Equator-relative meters → degrees
  const mToLat = 1 / 111195;
  const mToLon = 1 / (111195 * Math.cos(origin.lat * Math.PI / 180));
  for (let lap = 0; lap < numLoops; lap++) {
    samples.push(makeSample(t, origin.lat, origin.lon, speedMps));
    t += loopDurMs * 0.25;
    samples.push(makeSample(t, origin.lat + 50 * mToLat, origin.lon, speedMps));
    t += loopDurMs * 0.25;
    samples.push(makeSample(t, origin.lat + 50 * mToLat, origin.lon + 50 * mToLon, speedMps));
    t += loopDurMs * 0.25;
    samples.push(makeSample(t, origin.lat, origin.lon + 50 * mToLon, speedMps));
    t += loopDurMs * 0.25;
  }
  // Final sample at origin to close the last loop
  samples.push(makeSample(t, origin.lat, origin.lon, speedMps));
  return samples;
}

describe("autoDetectCourse - waypoint mode", () => {
  it("returns null waypoint result when speed never reaches 30 MPH", () => {
    // Track nowhere near, all samples at slow speed
    const slowSamples = makeWaypointPath({ lat: 40.7, lon: -74.0 }, 3, 60000, 5);
    const result = autoDetectCourse(slowSamples, [makeTrack()]);
    expect(result).toBeNull();
  });

  it("creates a waypoint result with isWaypointMode=true when no track is near", () => {
    const samples = makeWaypointPath({ lat: 40.7, lon: -74.0 }, 3, 60000, 15);
    const result = autoDetectCourse(samples, [makeTrack()]);
    expect(result).not.toBeNull();
    expect(result!.isWaypointMode).toBe(true);
    expect(result!.track.name).toBe("Unknown Track");
    expect(result!.waypointNotice).toContain("Waypoint");
  });

  it("detects multiple laps when path returns near the waypoint repeatedly", () => {
    const samples = makeWaypointPath({ lat: 40.7, lon: -74.0 }, 3, 60000, 15);
    const result = autoDetectCourse(samples, [makeTrack()]);
    expect(result!.laps.length).toBeGreaterThan(0);
  });

  it("waypoint mode lap numbers start at 1 and increment", () => {
    const samples = makeWaypointPath({ lat: 40.7, lon: -74.0 }, 3, 60000, 15);
    const result = autoDetectCourse(samples, [makeTrack()]);
    const lapNumbers = result!.laps.map((l) => l.lapNumber);
    expect(lapNumbers[0]).toBe(1);
    for (let i = 1; i < lapNumbers.length; i++) {
      expect(lapNumbers[i]).toBe(lapNumbers[i - 1] + 1);
    }
  });

  it("waypoint mode populates a virtual course centered on the waypoint", () => {
    const origin = { lat: 40.7, lon: -74.0 };
    const samples = makeWaypointPath(origin, 3, 60000, 15);
    const result = autoDetectCourse(samples, [makeTrack()])!;
    const course = result.course;
    // Virtual course S/F is offset by ±0.00001° from the waypoint
    expect(course.startFinishA.lat).toBeCloseTo(origin.lat, 3);
    expect(course.startFinishB.lat).toBeCloseTo(origin.lat, 3);
    expect(course.startFinishA.lat).not.toBe(course.startFinishB.lat); // offsets differ
  });
});
