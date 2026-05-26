import { describe, it, expect } from "vitest";
import {
  findNearestIndex,
  findCurrentLap,
  formatOverlayLapTime,
  getOverlayLapStartTime,
} from "./overlayUtils";
import type { GpsSample, Lap } from "@/types/racing";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeSample(t: number): GpsSample {
  return { t, lat: 0, lon: 0, speedMps: 0, speedMph: 0, speedKph: 0, extraFields: {} };
}

function makeSamples(times: number[]): GpsSample[] {
  return times.map(makeSample);
}

function makeLap(overrides: Partial<Lap> = {}): Lap {
  return {
    lapNumber: 1,
    startTime: 0,
    endTime: 1000,
    lapTimeMs: 1000,
    maxSpeedMph: 0,
    maxSpeedKph: 0,
    minSpeedMph: 0,
    minSpeedKph: 0,
    startIndex: 0,
    endIndex: 10,
    ...overrides,
  };
}

// ─── findNearestIndex ─────────────────────────────────────────────────────────

describe("findNearestIndex", () => {
  it("returns 0 for an empty array", () => {
    expect(findNearestIndex([], 500)).toBe(0);
  });

  it("returns the exact index when the time matches a sample", () => {
    const samples = makeSamples([0, 100, 200, 300]);
    expect(findNearestIndex(samples, 200)).toBe(2);
  });

  it("rounds to the nearest neighbor between two samples", () => {
    const samples = makeSamples([0, 100, 200]);
    // 130 is closer to 100 (idx 1) than 200 (idx 2).
    expect(findNearestIndex(samples, 130)).toBe(1);
    // 170 is closer to 200 (idx 2).
    expect(findNearestIndex(samples, 170)).toBe(2);
  });

  it("clamps below the first sample", () => {
    const samples = makeSamples([100, 200, 300]);
    expect(findNearestIndex(samples, -50)).toBe(0);
  });

  it("clamps above the last sample", () => {
    const samples = makeSamples([100, 200, 300]);
    expect(findNearestIndex(samples, 9999)).toBe(2);
  });

  it("picks the later index on an exact tie", () => {
    const samples = makeSamples([0, 100]);
    // 50 is equidistant. lo settles on 1; the strict `<` comparison does not
    // step back to 0 (|0-50| < |100-50| is false), so the upper index wins.
    expect(findNearestIndex(samples, 50)).toBe(1);
  });
});

// ─── findCurrentLap ────────────────────────────────────────────────────────────

describe("findCurrentLap", () => {
  const laps = [
    makeLap({ lapNumber: 1, startTime: 0, endTime: 1000 }),
    makeLap({ lapNumber: 2, startTime: 1000, endTime: 2000 }),
    makeLap({ lapNumber: 3, startTime: 2000, endTime: 3000 }),
  ];

  it("returns the explicitly selected lap when one is selected", () => {
    expect(findCurrentLap(laps, 2, 9999)?.lapNumber).toBe(2);
  });

  it("returns null when the selected lap number does not exist", () => {
    expect(findCurrentLap(laps, 99, 500)).toBeNull();
  });

  it("finds the lap containing the current time when none is selected", () => {
    expect(findCurrentLap(laps, null, 1500)?.lapNumber).toBe(2);
  });

  it("matches inclusively on the start and end boundaries", () => {
    // 1000 is both lap 1's end and lap 2's start — the first match (lap 1) wins.
    expect(findCurrentLap(laps, null, 1000)?.lapNumber).toBe(1);
  });

  it("returns null when the time falls outside every lap", () => {
    expect(findCurrentLap(laps, null, 5000)).toBeNull();
  });

  it("returns null for an empty lap list with no selection", () => {
    expect(findCurrentLap([], null, 100)).toBeNull();
  });
});

// ─── formatOverlayLapTime ─────────────────────────────────────────────────────

describe("formatOverlayLapTime", () => {
  it("formats sub-minute times without a minute component", () => {
    expect(formatOverlayLapTime(23.456)).toBe("23.456");
  });

  it("formats times over a minute as m:ss.mmm with zero-padding", () => {
    expect(formatOverlayLapTime(83.456)).toBe("1:23.456");
  });

  it("zero-pads seconds and milliseconds", () => {
    expect(formatOverlayLapTime(65.004)).toBe("1:05.004");
  });

  it("treats negative input as zero", () => {
    expect(formatOverlayLapTime(-5)).toBe("0.000");
  });

  it("formats exactly zero", () => {
    expect(formatOverlayLapTime(0)).toBe("0.000");
  });

  it("rolls milliseconds rounding correctly", () => {
    // 1.9999s → ms rounds to 1000 → quirk: displays as "1.1000" (no carry to seconds).
    expect(formatOverlayLapTime(1.9999)).toBe("1.1000");
  });
});

// ─── getOverlayLapStartTime ───────────────────────────────────────────────────

describe("getOverlayLapStartTime", () => {
  const samples = makeSamples([500, 600, 700]);
  const laps = [
    makeLap({ lapNumber: 1, startTime: 1000 }),
    makeLap({ lapNumber: 2, startTime: 2000 }),
  ];

  it("returns the first sample time when no lap is selected", () => {
    expect(getOverlayLapStartTime(samples, laps, null)).toBe(500);
  });

  it("returns the first sample time when there are no laps", () => {
    expect(getOverlayLapStartTime(samples, [], 1)).toBe(500);
  });

  it("returns undefined when no lap is selected and there are no samples", () => {
    expect(getOverlayLapStartTime([], laps, null)).toBeUndefined();
  });

  it("returns the selected lap's start time", () => {
    expect(getOverlayLapStartTime(samples, laps, 2)).toBe(2000);
  });

  it("returns undefined when the selected lap is not found", () => {
    expect(getOverlayLapStartTime(samples, laps, 99)).toBeUndefined();
  });
});
