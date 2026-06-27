import { describe, it, expect } from "vitest";
import {
  calculateLaps,
  computeLapSectors,
  formatLapTime,
  formatSectorTime,
  calculateOptimalLap,
} from "./lapCalculation";
import type { GpsSample, Course, Lap } from "@/types/racing";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Build a single GpsSample with sensible defaults. */
function makeSample(t: number, lat: number, lon: number, speedMps = 20): GpsSample {
  return {
    t,
    lat,
    lon,
    speedMps,
    speedMph: speedMps * 2.23694,
    speedKph: speedMps * 3.6,
    extraFields: {},
  };
}

/**
 * S/F line: vertical at lon=0, lat ∈ [-0.0001, 0.0001].
 * Path crosses it going east each lap, then loops far north (lat=0.01) to
 * return west — high lat keeps the return-leg outside the S/F line's lat range.
 */
const sfCourse: Course = {
  name: "TestCourse",
  startFinishA: { lat: 0.0001, lon: 0 },
  startFinishB: { lat: -0.0001, lon: 0 },
  isUserDefined: false,
};

/**
 * Build a race path with `numCrossings` east-going crossings of the S/F line,
 * spaced `intervalMs` apart.
 *
 *   - First sample at (0, -0.001), t=startTime
 *   - Each crossing: jump east to (0, 0.001) → segment crosses S/F at fraction 0.5
 *   - Between crossings: loop NE → NW → SW at lat=0.01 (well outside line range)
 *
 * For `numCrossings = N`, the returned samples produce exactly N-1 laps.
 */
function makeRacePath(numCrossings: number, intervalMs: number, startTime = 0, speedMps = 20): GpsSample[] {
  const samples: GpsSample[] = [];
  let t = startTime;
  samples.push(makeSample(t, 0, -0.001, speedMps));

  for (let i = 0; i < numCrossings; i++) {
    t += intervalMs / 4;
    samples.push(makeSample(t, 0, 0.001, speedMps)); // east cross
    if (i < numCrossings - 1) {
      t += intervalMs / 4;
      samples.push(makeSample(t, 0.01, 0.001, speedMps)); // NE
      t += intervalMs / 4;
      samples.push(makeSample(t, 0.01, -0.001, speedMps)); // NW
      t += intervalMs / 4;
      samples.push(makeSample(t, 0, -0.001, speedMps)); // back west
    }
  }
  return samples;
}

// ─── calculateLaps: degenerate inputs ────────────────────────────────────────

describe("calculateLaps - degenerate inputs", () => {
  it("returns [] for empty samples", () => {
    expect(calculateLaps([], sfCourse)).toEqual([]);
  });

  it("returns [] for a single sample", () => {
    expect(calculateLaps([makeSample(0, 0, -0.001)], sfCourse)).toEqual([]);
  });

  it("returns [] when path never crosses S/F", () => {
    const samples = [
      makeSample(0, 0, -0.001),
      makeSample(1000, 0, -0.002), // stays west
      makeSample(2000, 0.01, -0.002), // goes north
      makeSample(3000, 0, -0.001), // back south
    ];
    expect(calculateLaps(samples, sfCourse)).toEqual([]);
  });

  it("returns [] with only one crossing (need 2 for a lap)", () => {
    // 2 crossings produce 1 lap, so 1 crossing produces 0
    const samples = makeRacePath(1, 10000);
    expect(calculateLaps(samples, sfCourse)).toEqual([]);
  });
});

// ─── calculateLaps: basic lap counting ───────────────────────────────────────

describe("calculateLaps - lap counting", () => {
  it("produces 1 lap from 2 same-direction crossings >5s apart", () => {
    const samples = makeRacePath(2, 10000);
    const laps = calculateLaps(samples, sfCourse);
    expect(laps).toHaveLength(1);
    expect(laps[0].lapNumber).toBe(1);
  });

  it("produces 2 laps from 3 crossings", () => {
    const samples = makeRacePath(3, 10000);
    const laps = calculateLaps(samples, sfCourse);
    expect(laps).toHaveLength(2);
    expect(laps.map((l) => l.lapNumber)).toEqual([1, 2]);
  });

  it("produces N-1 laps from N consistent crossings", () => {
    const samples = makeRacePath(6, 10000);
    expect(calculateLaps(samples, sfCourse)).toHaveLength(5);
  });

  it("lap time ≈ interval between successive crossings", () => {
    const samples = makeRacePath(3, 10000);
    const laps = calculateLaps(samples, sfCourse);
    expect(laps[0].lapTimeMs).toBeCloseTo(10000, -1); // ±5ms tolerance for fraction-based crossing time
    expect(laps[1].lapTimeMs).toBeCloseTo(10000, -1);
  });

  it("startTime/endTime are crossing times, not raw sample times", () => {
    const samples = makeRacePath(2, 10000);
    const lap = calculateLaps(samples, sfCourse)[0];
    // First crossing in fixture spans samples[0..1] (t=0..2500), midpoint t=1250
    expect(lap.startTime).toBeCloseTo(1250, -1);
  });

  it("startIndex/endIndex point at the sample before each crossing", () => {
    const samples = makeRacePath(3, 10000);
    const laps = calculateLaps(samples, sfCourse);
    // Crossings happen between sample[0]↔sample[1] and sample[4]↔sample[5]
    expect(laps[0].startIndex).toBe(0);
    expect(laps[0].endIndex).toBe(4);
  });
});

// ─── calculateLaps: debounce and direction filtering ─────────────────────────

describe("calculateLaps - debounce + direction", () => {
  it("debounces crossings within MIN_CROSSING_INTERVAL_MS (5000ms)", () => {
    // Build a path where two east-going crossings happen 4s apart — second should be filtered
    const samples = [
      makeSample(0, 0, -0.001),
      makeSample(1000, 0, 0.001), // east cross at t=500
      makeSample(2000, 0.01, 0.001), // up north, no cross
      makeSample(3000, 0.01, -0.001), // west at high lat, no cross
      makeSample(4000, 0, -0.001), // back south
      makeSample(5000, 0, 0.001), // east cross at t=4500 — 4s after first → DEBOUNCED
      makeSample(6000, 0.01, 0.001),
      makeSample(7000, 0.01, -0.001),
      makeSample(8000, 0, -0.001),
      makeSample(15000, 0, 0.001), // east cross at t=11500 — 11s after first → accepted
    ];
    const laps = calculateLaps(samples, sfCourse);
    // Crossings: t=500 (accepted) → t=4500 (debounced) → t=11500 (accepted) = 1 lap, ~11000ms
    expect(laps).toHaveLength(1);
    expect(laps[0].lapTimeMs).toBeCloseTo(11000, -1);
  });

  it("rejects opposite-direction crossings (locks direction after first)", () => {
    // Path: west → east → west → east → west → east
    // The west-going crossings should be ignored entirely; only east-going count
    const samples = [
      makeSample(0, 0, -0.001),
      makeSample(1000, 0, 0.001), // east cross @ t=500
      makeSample(10000, 0, -0.001), // segment B→C goes west — would-be opposite crossing
      makeSample(20000, 0, 0.001), // east cross @ t=15000
      makeSample(30000, 0, -0.001), // west again
      makeSample(40000, 0, 0.001), // east cross @ t=35000
    ];
    const laps = calculateLaps(samples, sfCourse);
    // Only east-going crossings count: t=500, t=15000, t=35000 → 2 laps
    expect(laps).toHaveLength(2);
  });

  it("recovers from a first-crossing direction glitch when majority crossings agree", () => {
    // Setup: 1 wrong-direction glitch at t=500, then 3 clean east crossings.
    // Old behavior: glitch locked direction to west, all 3 east crossings rejected
    //   → 1 west crossing total → 0 laps detected.
    // New behavior: majority direction (east) wins, glitch discarded
    //   → 3 east crossings → 2 laps detected.
    const samples = [
      makeSample(0, 0, 0.001),         // east of line
      makeSample(1000, 0, -0.001),     // GLITCH: west cross @ t=500

      makeSample(11000, 0, 0.001),     // east cross @ t=6000
      makeSample(12000, 0.01, 0.001),
      makeSample(13000, 0.01, -0.001),
      makeSample(14000, 0, -0.001),

      makeSample(20000, 0, 0.001),     // east cross @ t=17000
      makeSample(21000, 0.01, 0.001),
      makeSample(22000, 0.01, -0.001),
      makeSample(23000, 0, -0.001),

      makeSample(30000, 0, 0.001),     // east cross @ t=26500
    ];
    const laps = calculateLaps(samples, sfCourse);
    expect(laps).toHaveLength(2);
  });

  it("majority-direction filter still works on reverse-direction sessions", () => {
    // 3 west-going crossings → 2 reverse laps (no eastern majority to flip)
    const samples = [
      makeSample(0, 0, 0.001),
      makeSample(1000, 0, -0.001),  // west cross @ t=500
      makeSample(10000, 0.01, -0.001),
      makeSample(11000, 0.01, 0.001),
      makeSample(12000, 0, 0.001),
      makeSample(13000, 0, -0.001), // west cross @ t=12500
      makeSample(20000, 0.01, -0.001),
      makeSample(21000, 0.01, 0.001),
      makeSample(22000, 0, 0.001),
      makeSample(23000, 0, -0.001), // west cross @ t=22500
    ];
    const laps = calculateLaps(samples, sfCourse);
    expect(laps).toHaveLength(2);
  });
});

// ─── calculateLaps: speed stats ──────────────────────────────────────────────

describe("calculateLaps - speed stats", () => {
  it("computes maxSpeedMph from the highest speed sample within the lap", () => {
    const samples = makeRacePath(2, 10000, 0, 20);
    samples[2].speedMps = 50;
    samples[2].speedMph = 50 * 2.23694;
    samples[2].speedKph = 50 * 3.6;
    const lap = calculateLaps(samples, sfCourse)[0];
    expect(lap.maxSpeedMph).toBeCloseTo(50 * 2.23694, 2);
  });

  it("computes minSpeedMph from the lowest speed sample (above glitch threshold)", () => {
    const samples = makeRacePath(2, 10000, 0, 20);
    samples[2].speedMps = 5;
    samples[2].speedMph = 5 * 2.23694;
    samples[2].speedKph = 5 * 3.6;
    const lap = calculateLaps(samples, sfCourse)[0];
    expect(lap.minSpeedMph).toBeCloseTo(5 * 2.23694, 2);
  });

  it("filters out a short low-speed run (≤3 samples) as a glitch for minSpeed", () => {
    // Path with a 2-sample run at 0 mph — should be excluded from min speed calc
    const samples = makeRacePath(2, 10000, 0, 20);
    // Inject 2 consecutive near-zero samples (a "glitch")
    samples[2].speedMps = 0; samples[2].speedMph = 0; samples[2].speedKph = 0;
    samples[3].speedMps = 0; samples[3].speedMph = 0; samples[3].speedKph = 0;
    const lap = calculateLaps(samples, sfCourse)[0];
    // Min speed should NOT be 0 — the glitch run was filtered
    expect(lap.minSpeedMph).toBeGreaterThan(1);
  });

  it("includes a longer low-speed run (>3 samples) as legitimate slow data", () => {
    // 4-sample run at 0 mph — should NOT be filtered (it's genuine slow data)
    const samples = makeRacePath(2, 20000, 0, 20);
    // Inject 4 consecutive zero-speed samples by extending the lap with extras
    samples.splice(2, 0,
      makeSample(samples[1].t + 100, 0.01, 0.001, 0),
      makeSample(samples[1].t + 200, 0.01, 0.001, 0),
      makeSample(samples[1].t + 300, 0.01, 0.001, 0),
      makeSample(samples[1].t + 400, 0.01, 0.001, 0),
    );
    const lap = calculateLaps(samples, sfCourse)[0];
    // Min speed reaches 0 because a 4+ sample slow run is treated as real
    expect(lap.minSpeedMph).toBe(0);
  });

  it("returns 0 for minSpeed when no non-glitch low samples exist", () => {
    // All samples high speed; minSpeed should be the lowest real value
    const samples = makeRacePath(2, 10000, 0, 30);
    const lap = calculateLaps(samples, sfCourse)[0];
    expect(lap.minSpeedMph).toBeGreaterThan(0);
    expect(lap.minSpeedMph).toBeCloseTo(30 * 2.23694, 2);
  });
});

// ─── calculateLaps: sectors ──────────────────────────────────────────────────

/**
 * Course with sector lines. Sector 2 at lon=0.003, sector 3 at lon=0.006.
 * Path that crosses all three lines going east each lap:
 *   S/F (lon=0) → S2 (lon=0.003) → S3 (lon=0.006) → loop north → back west
 */
const sectorCourse: Course = {
  name: "TestSectorCourse",
  startFinishA: { lat: 0.0001, lon: 0 },
  startFinishB: { lat: -0.0001, lon: 0 },
  sector2: { a: { lat: 0.0001, lon: 0.003 }, b: { lat: -0.0001, lon: 0.003 } },
  sector3: { a: { lat: 0.0001, lon: 0.006 }, b: { lat: -0.0001, lon: 0.006 } },
};

/** One sector-aware lap with S/F at t=N*lapDur+500, S2 at +2500, S3 at +4500, S/F again at next lap */
function makeSectorLap(startT: number, lapDur: number, speedMps = 20): GpsSample[] {
  return [
    makeSample(startT, 0, -0.001, speedMps),
    makeSample(startT + lapDur * 0.1, 0, 0.001, speedMps), // cross S/F
    makeSample(startT + lapDur * 0.2, 0, 0.002, speedMps),
    makeSample(startT + lapDur * 0.3, 0, 0.004, speedMps), // cross S2 (between lon=0.002 and 0.004)
    makeSample(startT + lapDur * 0.4, 0, 0.005, speedMps),
    makeSample(startT + lapDur * 0.5, 0, 0.007, speedMps), // cross S3 (between lon=0.005 and 0.007)
    makeSample(startT + lapDur * 0.6, 0.01, 0.007, speedMps), // north
    makeSample(startT + lapDur * 0.8, 0.01, -0.001, speedMps), // west at high lat
    makeSample(startT + lapDur, 0, -0.001, speedMps), // back to start
  ];
}

describe("calculateLaps - sectors", () => {
  it("omits sectors field when course has no sector lines", () => {
    const samples = makeRacePath(2, 10000);
    const lap = calculateLaps(samples, sfCourse)[0];
    expect(lap.sectors).toBeUndefined();
  });

  it("computes s1/s2/s3 when both sector lines are present and crossed in order", () => {
    const samples = [...makeSectorLap(0, 10000), ...makeSectorLap(10000, 10000)];
    const laps = calculateLaps(samples, sectorCourse);
    expect(laps).toHaveLength(1);
    const lap = laps[0];
    expect(lap.sectors).toBeDefined();
    expect(lap.sectors!.s1).toBeGreaterThan(0);
    expect(lap.sectors!.s2).toBeGreaterThan(0);
    expect(lap.sectors!.s3).toBeGreaterThan(0);
    // s1+s2+s3 should equal lap time
    expect(lap.sectors!.s1! + lap.sectors!.s2! + lap.sectors!.s3!).toBeCloseTo(lap.lapTimeMs, -1);
  });

  it("emits all-undefined sectors when sector lines not crossed within lap", () => {
    // Use a path that crosses S/F but not the sector lines (stays west of S2/S3)
    const samples = makeRacePath(2, 10000);
    const laps = calculateLaps(samples, sectorCourse);
    expect(laps).toHaveLength(1);
    expect(laps[0].sectors).toBeDefined();
    expect(laps[0].sectors!.s1).toBeUndefined();
    expect(laps[0].sectors!.s2).toBeUndefined();
    expect(laps[0].sectors!.s3).toBeUndefined();
  });

  it("computes fine-grained sectorTimes for a sub-sector and rolls them up to the majors", () => {
    // Same geometry as sectorCourse, but with an extra sub-sector at lon=0.0015
    // splitting the first major sector. Order: S/F, sub(1.1), major2, major3.
    const subSectorCourse: Course = {
      name: "TestSubSectorCourse",
      startFinishA: { lat: 0.0001, lon: 0 },
      startFinishB: { lat: -0.0001, lon: 0 },
      sectors: [
        { line: { a: { lat: 0.0001, lon: 0.0015 }, b: { lat: -0.0001, lon: 0.0015 } }, major: false },
        { line: { a: { lat: 0.0001, lon: 0.003 }, b: { lat: -0.0001, lon: 0.003 } }, major: true },
        { line: { a: { lat: 0.0001, lon: 0.006 }, b: { lat: -0.0001, lon: 0.006 } }, major: true },
      ],
    };
    const samples = [...makeSectorLap(0, 10000), ...makeSectorLap(10000, 10000)];
    const lap = calculateLaps(samples, subSectorCourse)[0];

    // 4 timing lines → 4 fine-grained segments, all crossed in order.
    expect(lap.sectorTimes).toHaveLength(4);
    expect(lap.sectorTimes!.every((t) => t !== undefined && t > 0)).toBe(true);
    expect(lap.sectorBoundaries).toHaveLength(4);

    // The major rollup matches the plain (no sub-sector) course exactly: the
    // sub-sector only splits S1 into two segments that sum back to it.
    const plain = calculateLaps(samples, sectorCourse)[0];
    expect(lap.sectors!.s1).toBeCloseTo(plain.sectors!.s1!, -1);
    expect(lap.sectors!.s2).toBeCloseTo(plain.sectors!.s2!, -1);
    expect(lap.sectors!.s3).toBeCloseTo(plain.sectors!.s3!, -1);
    // The two sub-segments of S1 sum to S1.
    expect(lap.sectorTimes![0]! + lap.sectorTimes![1]!).toBeCloseTo(lap.sectors!.s1!, -1);
  });
});

describe("computeLapSectors", () => {
  it("returns empty when the course defines no sectors", () => {
    const samples = makeRacePath(2, 10000);
    expect(computeLapSectors(samples, sfCourse)).toEqual({});
  });

  it("computes sector splits for a pre-delimited lap slice (anchored at index 0)", () => {
    // A clean lap whose first sample IS the lap start (just past S/F), crossing
    // S2 (lon 0.003) then S3 (lon 0.006) before looping back — exactly the shape
    // a leaderboard entry feeds in (no lead-in for start/finish re-detection).
    const lap = [
      makeSample(0, 0, 0.0005),
      makeSample(1000, 0, 0.002),
      makeSample(2000, 0, 0.004), // cross S2
      makeSample(3000, 0, 0.005),
      makeSample(4000, 0, 0.007), // cross S3
      makeSample(5000, 0.01, 0.007),
      makeSample(7000, 0.01, -0.001),
      makeSample(9000, 0, -0.0005),
    ];
    const sec = computeLapSectors(lap, sectorCourse);
    expect(sec.sectors).toBeDefined();
    expect(sec.sectors!.s1).toBeGreaterThan(0);
    expect(sec.sectors!.s2).toBeGreaterThan(0);
    expect(sec.sectors!.s3).toBeGreaterThan(0);
    expect(sec.sectorTimes).toHaveLength(3);
    expect(sec.sectorBoundaries![0]).toBe(0); // lap start anchored at the slice start
  });
});

// ─── formatLapTime ───────────────────────────────────────────────────────────

describe("formatLapTime", () => {
  it("formats 0 ms as 0:00.000", () => {
    expect(formatLapTime(0)).toBe("0:00.000");
  });

  it("formats sub-minute times as 0:SS.sss", () => {
    expect(formatLapTime(12345)).toBe("0:12.345");
  });

  it("formats exactly 1 minute as 1:00.000", () => {
    expect(formatLapTime(60000)).toBe("1:00.000");
  });

  it("formats 1:05.432 correctly", () => {
    expect(formatLapTime(65432)).toBe("1:05.432");
  });

  it("formats over-an-hour times by overflowing the minutes field", () => {
    // No special hour handling — 61:01.500
    expect(formatLapTime(3661500)).toBe("61:01.500");
  });

  it("pads sub-10-second times with leading zero", () => {
    expect(formatLapTime(5432)).toBe("0:05.432");
  });
});

// ─── formatSectorTime ────────────────────────────────────────────────────────

describe("formatSectorTime", () => {
  it("formats 0 ms as 0.000", () => {
    expect(formatSectorTime(0)).toBe("0.000");
  });

  it("formats milliseconds as ss.sss", () => {
    expect(formatSectorTime(12345)).toBe("12.345");
  });

  it("formats exactly 1 second as 1.000", () => {
    expect(formatSectorTime(1000)).toBe("1.000");
  });
});

// ─── calculateOptimalLap ─────────────────────────────────────────────────────

function makeLap(lapNumber: number, lapTimeMs: number, sectors?: { s1?: number; s2?: number; s3?: number }): Lap {
  // calculateOptimalLap reads the fine-grained sectorTimes; for a classic
  // 3-major course that is just [s1, s2, s3].
  const sectorTimes = sectors ? [sectors.s1, sectors.s2, sectors.s3] : undefined;
  return {
    lapNumber, lapTimeMs,
    startTime: 0, endTime: lapTimeMs,
    maxSpeedMph: 60, maxSpeedKph: 96,
    minSpeedMph: 10, minSpeedKph: 16,
    startIndex: 0, endIndex: 0,
    sectors,
    sectorTimes,
  };
}

describe("calculateOptimalLap", () => {
  it("returns null when no laps", () => {
    expect(calculateOptimalLap([])).toBeNull();
  });

  it("returns null when no lap has all three sectors", () => {
    const laps = [
      makeLap(1, 60000, { s1: 20000, s2: undefined, s3: 20000 }),
      makeLap(2, 60000, undefined),
    ];
    expect(calculateOptimalLap(laps)).toBeNull();
  });

  it("returns single lap's sectors when only one full-sector lap exists", () => {
    const laps = [makeLap(1, 60000, { s1: 20000, s2: 18000, s3: 22000 })];
    const result = calculateOptimalLap(laps);
    expect(result).not.toBeNull();
    expect(result!.bestSegments).toEqual([20000, 18000, 22000]);
    expect(result!.optimalTimeMs).toBe(60000);
  });

  it("picks the best sector from each lap independently", () => {
    const laps = [
      makeLap(1, 60000, { s1: 19000, s2: 20000, s3: 21000 }), // best S1
      makeLap(2, 60000, { s1: 21000, s2: 18000, s3: 21000 }), // best S2
      makeLap(3, 60000, { s1: 21000, s2: 20000, s3: 19000 }), // best S3
    ];
    const result = calculateOptimalLap(laps)!;
    expect(result.bestSegments).toEqual([19000, 18000, 19000]);
    expect(result.optimalTimeMs).toBe(19000 + 18000 + 19000);
  });

  it("computes deltaToFastest as (fastestActualLap - optimal)", () => {
    const laps = [
      makeLap(1, 60000, { s1: 19000, s2: 20000, s3: 21000 }),
      makeLap(2, 58000, { s1: 21000, s2: 18000, s3: 19000 }), // fastest
    ];
    const result = calculateOptimalLap(laps)!;
    expect(result.optimalTimeMs).toBe(19000 + 18000 + 19000); // 56000
    expect(result.deltaToFastest).toBe(58000 - 56000); // 2000
  });

  it("takes the best of each segment independently, even from partial laps", () => {
    // The ideal lap uses the best time achieved in each segment regardless of
    // whether that lap completed every segment — a real S1 still counts.
    const laps = [
      makeLap(1, 60000, { s1: 17000, s2: 22000, s3: undefined }), // S1 still counts
      makeLap(2, 60000, { s1: 20000, s2: 20000, s3: 20000 }),
    ];
    const result = calculateOptimalLap(laps)!;
    expect(result.bestSegments).toEqual([17000, 20000, 20000]);
    expect(result.optimalTimeMs).toBe(57000);
  });

  it("returns null when a segment was never completed in any lap", () => {
    const laps = [
      makeLap(1, 60000, { s1: 17000, s2: 22000, s3: undefined }),
      makeLap(2, 60000, { s1: 20000, s2: 20000, s3: undefined }),
    ];
    expect(calculateOptimalLap(laps)).toBeNull(); // S3 never completed
  });

  it("considers ALL laps for fastest, even those without full sectors", () => {
    // deltaToFastest uses all laps' lapTimeMs, not just full-sector ones
    const laps = [
      makeLap(1, 50000, undefined), // fastest, but no sectors
      makeLap(2, 60000, { s1: 20000, s2: 20000, s3: 20000 }),
    ];
    const result = calculateOptimalLap(laps)!;
    expect(result.optimalTimeMs).toBe(60000);
    expect(result.deltaToFastest).toBe(50000 - 60000); // negative — fastest beats theoretical optimal
  });
});
