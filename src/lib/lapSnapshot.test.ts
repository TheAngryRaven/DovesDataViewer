import { describe, expect, it } from "vitest";
import type { Course, GpsSample, Lap } from "@/types/racing";
import {
  buildSnapshot, fastestLap, makeCourseKey, makeSnapshotId, normalizeEngine,
  snapshotLapSamples, snapshotPromptKind, SNAPSHOT_BUFFER_MS,
} from "./lapSnapshot";

const course: Course = {
  name: "Full CW",
  startFinishA: { lat: 35.0, lon: -97.0 },
  startFinishB: { lat: 35.0, lon: -97.001 },
};

// 31 samples at 1s intervals, t = 0..30000.
function makeSamples(): GpsSample[] {
  return Array.from({ length: 31 }, (_, i) => ({
    t: i * 1000,
    lat: 35 + i * 1e-5,
    lon: -97 + i * 1e-5,
    speedMps: 20,
    speedMph: 44.7,
    speedKph: 72,
    extraFields: {},
  }));
}

function makeLap(startIndex: number, endIndex: number, samples: GpsSample[], lapNumber = 1): Lap {
  return {
    lapNumber,
    startTime: samples[startIndex].t,
    endTime: samples[endIndex].t,
    lapTimeMs: samples[endIndex].t - samples[startIndex].t,
    maxSpeedMph: 44.7, maxSpeedKph: 72, minSpeedMph: 0, minSpeedKph: 0,
    startIndex, endIndex,
  };
}

describe("normalizeEngine", () => {
  it("trims and lowercases", () => {
    expect(normalizeEngine("  Rotax Max ")).toBe("rotax max");
  });
});

describe("key helpers", () => {
  it("derives a stable id from course + engine", () => {
    const ck = makeCourseKey("OKC", "Full CW");
    const id = makeSnapshotId(ck, normalizeEngine("Rotax"));
    expect(id).toBe(makeSnapshotId(makeCourseKey("OKC", "Full CW"), "rotax"));
  });

  it("distinguishes different courses and engines", () => {
    const a = makeSnapshotId(makeCourseKey("OKC", "Full CW"), "rotax");
    const b = makeSnapshotId(makeCourseKey("OKC", "Full CCW"), "rotax");
    const c = makeSnapshotId(makeCourseKey("OKC", "Full CW"), "tm");
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe("buildSnapshot", () => {
  const samples = makeSamples();
  const lap = makeLap(10, 20, samples); // lap t = 10000..20000

  it("captures the lap with a 5s buffer on each side, clamped to the data", () => {
    const snap = buildSnapshot({
      lap, samples, course, trackName: "OKC", courseName: "Full CW",
      engine: "Rotax", sourceFileName: "s.dove",
    });
    // Buffer reaches exactly ±5000ms: t 5000..25000 (21 samples).
    expect(snap.samples[0].t).toBe(lap.startTime - SNAPSHOT_BUFFER_MS);
    expect(snap.samples[snap.samples.length - 1].t).toBe(lap.endTime + SNAPSHOT_BUFFER_MS);
    expect(snap.lapStartMs).toBe(10000);
    expect(snap.lapEndMs).toBe(20000);
    expect(snap.id).toBe(makeSnapshotId(makeCourseKey("OKC", "Full CW"), "rotax"));
    expect(snap.engine).toBe("Rotax");
    expect(snap.engineKey).toBe("rotax");
    expect(snap.lapTimeMs).toBe(10000);
  });

  it("does not run past the start/end of the sample array", () => {
    const earlyLap = makeLap(0, 3, samples);
    const snap = buildSnapshot({
      lap: earlyLap, samples, course, trackName: "OKC", courseName: "Full CW",
      engine: "X", sourceFileName: "s.dove",
    });
    expect(snap.samples[0].t).toBe(0); // clamped to the first sample
  });

  it("preserves createdAt when replacing an existing snapshot", () => {
    const snap = buildSnapshot({
      lap, samples, course, trackName: "OKC", courseName: "Full CW",
      engine: "Rotax", sourceFileName: "s.dove", createdAt: 12345, now: 99999,
    });
    expect(snap.createdAt).toBe(12345);
    expect(snap.updatedAt).toBe(99999);
  });

  it("trims the buffer back to the clean lap for overlay comparison", () => {
    const snap = buildSnapshot({
      lap, samples, course, trackName: "OKC", courseName: "Full CW",
      engine: "Rotax", sourceFileName: "s.dove",
    });
    const clean = snapshotLapSamples(snap);
    expect(clean[0].t).toBe(10000);
    expect(clean[clean.length - 1].t).toBe(20000);
    expect(clean.length).toBe(11);
  });
});

describe("fastestLap", () => {
  it("returns the min lapTimeMs lap, or null when empty", () => {
    const samples = makeSamples();
    const laps = [makeLap(0, 10, samples, 1), makeLap(0, 5, samples, 2), makeLap(0, 8, samples, 3)];
    expect(fastestLap(laps)?.lapNumber).toBe(2);
    expect(fastestLap([])).toBeNull();
  });
});

describe("snapshotPromptKind", () => {
  it("prompts 'new' when nothing exists", () => {
    expect(snapshotPromptKind(60000, null)).toBe("new");
  });
  it("prompts 'faster' only when the candidate beats the existing", () => {
    expect(snapshotPromptKind(59000, { lapTimeMs: 60000 })).toBe("faster");
    expect(snapshotPromptKind(60000, { lapTimeMs: 60000 })).toBeNull();
    expect(snapshotPromptKind(61000, { lapTimeMs: 60000 })).toBeNull();
  });
});
