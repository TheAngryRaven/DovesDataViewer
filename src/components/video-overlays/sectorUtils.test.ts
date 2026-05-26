import { describe, it, expect } from "vitest";
import {
  SECTOR_COLORS,
  computeBestSectors,
  computeSectorSegments,
  type SectorStatus,
} from "./sectorUtils";
import type { Lap, GpsSample } from "@/types/racing";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeSample(t: number): GpsSample {
  return { t, lat: 0, lon: 0, speedMps: 0, speedMph: 0, speedKph: 0, extraFields: {} };
}

/** Build a contiguous samples array with t = index * step (ms). */
function makeSamples(count: number, step = 100): GpsSample[] {
  return Array.from({ length: count }, (_, i) => makeSample(i * step));
}

function makeLap(overrides: Partial<Lap> = {}): Lap {
  return {
    lapNumber: 2,
    startTime: 0,
    endTime: 3000,
    lapTimeMs: 3000,
    maxSpeedMph: 0,
    maxSpeedKph: 0,
    minSpeedMph: 0,
    minSpeedKph: 0,
    startIndex: 0,
    endIndex: 30,
    sectors: { s1: 1000, s2: 1000, s3: 1000 },
    ...overrides,
  };
}

// ─── SECTOR_COLORS ──────────────────────────────────────────────────────────

describe("SECTOR_COLORS", () => {
  it("defines a color for every SectorStatus", () => {
    const statuses: SectorStatus[] = ["outlap", "first", "best", "slower", "active"];
    for (const s of statuses) {
      expect(SECTOR_COLORS[s]).toMatch(/^rgba\(/);
    }
  });

  it("uses purple for best, red for slower, green for first", () => {
    expect(SECTOR_COLORS.best).toContain("168, 85, 247");
    expect(SECTOR_COLORS.slower).toContain("239, 68, 68");
    expect(SECTOR_COLORS.first).toContain("34, 197, 94");
  });
});

// ─── computeBestSectors ──────────────────────────────────────────────────────

describe("computeBestSectors", () => {
  it("returns Infinity for every sector when no laps", () => {
    expect(computeBestSectors([])).toEqual({ s1: Infinity, s2: Infinity, s3: Infinity });
  });

  it("ignores laps without sectors", () => {
    const laps = [makeLap({ sectors: undefined })];
    expect(computeBestSectors(laps)).toEqual({ s1: Infinity, s2: Infinity, s3: Infinity });
  });

  it("picks the minimum across laps per sector independently", () => {
    const laps = [
      makeLap({ sectors: { s1: 1200, s2: 900, s3: 1100 } }),
      makeLap({ sectors: { s1: 1000, s2: 950, s3: 1050 } }),
      makeLap({ sectors: { s1: 1100, s2: 800, s3: 1200 } }),
    ];
    expect(computeBestSectors(laps)).toEqual({ s1: 1000, s2: 800, s3: 1050 });
  });

  it("handles partial sector data (undefined fields skipped)", () => {
    const laps = [
      makeLap({ sectors: { s1: 1000 } }),
      makeLap({ sectors: { s2: 500 } }),
    ];
    expect(computeBestSectors(laps)).toEqual({ s1: 1000, s2: 500, s3: Infinity });
  });
});

// ─── computeSectorSegments ───────────────────────────────────────────────────

describe("computeSectorSegments", () => {
  it("returns a single outlap fallback when lap is null", () => {
    const samples = makeSamples(10);
    const result = computeSectorSegments(samples, null, 0, []);
    expect(result).toEqual([{ status: "outlap", startIdx: 0, endIdx: 9 }]);
  });

  it("returns a single outlap fallback when lap has no sectors", () => {
    const samples = makeSamples(10);
    const lap = makeLap({ sectors: undefined });
    const result = computeSectorSegments(samples, lap, 0, [lap]);
    expect(result).toEqual([{ status: "outlap", startIdx: 0, endIdx: 9 }]);
  });

  it("marks the in-progress sector as 'active' and the rest as 'outlap'", () => {
    // s1=s2=s3=1000ms, lapStart=0. currentTime=500 → still in sector 1.
    const samples = makeSamples(31);
    const lap = makeLap();
    const result = computeSectorSegments(samples, lap, 500, [lap]);
    expect(result).toHaveLength(3);
    expect(result[0].status).toBe("active");
    expect(result[1].status).toBe("outlap");
    expect(result[2].status).toBe("outlap");
  });

  it("colors a completed sector 'best' when it matches the best time (faster-than-reference)", () => {
    // Current lap s1=1000 and the best s1 across laps is also 1000 → best.
    const samples = makeSamples(31);
    const lap = makeLap({ lapNumber: 3, sectors: { s1: 1000, s2: 1000, s3: 1000 } });
    const reference = makeLap({ lapNumber: 2, sectors: { s1: 1000, s2: 900, s3: 800 } });
    // currentTime past all crossings (3000) → all sectors complete.
    const result = computeSectorSegments(samples, lap, 3000, [lap, reference]);
    expect(result[0].status).toBe("best"); // s1 1000 <= best 1000
  });

  it("colors a completed sector 'slower' when it is above the best time", () => {
    const samples = makeSamples(31);
    const lap = makeLap({ lapNumber: 3, sectors: { s1: 1200, s2: 1200, s3: 1200 } });
    const reference = makeLap({ lapNumber: 2, sectors: { s1: 1000, s2: 900, s3: 800 } });
    const result = computeSectorSegments(samples, lap, 3000, [lap, reference]);
    expect(result[0].status).toBe("slower"); // s1 1200 > best 1000
    expect(result[1].status).toBe("slower");
    expect(result[2].status).toBe("slower");
  });

  it("marks completed sectors as 'first' on the very first lap (no reference yet)", () => {
    // isFirstLap && sectorTime === bestTime → first (green). On lap 1 it is its own best.
    const samples = makeSamples(31);
    const lap = makeLap({ lapNumber: 1, sectors: { s1: 1000, s2: 1000, s3: 1000 } });
    const result = computeSectorSegments(samples, lap, 3000, [lap]);
    expect(result[0].status).toBe("first");
    expect(result[1].status).toBe("first");
    expect(result[2].status).toBe("first");
  });

  it("treats a zero/undefined sector time as outlap", () => {
    const samples = makeSamples(31);
    // s1 missing → sector 1 is outlap regardless of time.
    const lap = makeLap({ sectors: { s2: 1000, s3: 1000 } });
    const result = computeSectorSegments(samples, lap, 3000, [lap]);
    expect(result[0].status).toBe("outlap");
  });

  it("transitions sector 1 active → complete as currentTime crosses the s2 boundary", () => {
    const samples = makeSamples(31);
    const lap = makeLap({ lapNumber: 2, sectors: { s1: 1000, s2: 1000, s3: 1000 } });
    const reference = makeLap({ lapNumber: 1, sectors: { s1: 1000, s2: 1000, s3: 1000 } });

    // Just before s2 crossing (1000) — sector 1 active.
    const before = computeSectorSegments(samples, lap, 999, [lap, reference]);
    expect(before[0].status).toBe("active");

    // Exactly at the crossing — sector 1 complete (currentTime < s2CrossingTime is false).
    const at = computeSectorSegments(samples, lap, 1000, [lap, reference]);
    expect(at[0].status).not.toBe("active");
  });

  it("returns indices within the sample range and ordered start<=end", () => {
    const samples = makeSamples(31);
    const lap = makeLap();
    const result = computeSectorSegments(samples, lap, 1500, [lap]);
    for (const seg of result) {
      expect(seg.startIdx).toBeGreaterThanOrEqual(0);
      expect(seg.endIdx).toBeLessThanOrEqual(samples.length - 1);
      expect(seg.startIdx).toBeLessThanOrEqual(seg.endIdx);
    }
  });
});
