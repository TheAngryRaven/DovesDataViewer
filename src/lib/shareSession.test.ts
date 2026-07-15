import { describe, it, expect } from "vitest";
import { buildSharedSessionBundle } from "./shareSession";
import { calculateBounds } from "./parserUtils";
import type { Course, GpsSample, ParsedData } from "@/types/racing";

// ─── Fixtures (crossing geometry cribbed from lapCalculation.test.ts) ─────────

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

const course: Course = {
  name: "Club Circuit",
  startFinishA: { lat: 0.0001, lon: 0 },
  startFinishB: { lat: -0.0001, lon: 0 },
  isUserDefined: true,
};

/** N east-going S/F crossings, `intervalMs` apart → N-1 laps. */
function makeRacePath(numCrossings: number, intervalMs: number): GpsSample[] {
  const samples: GpsSample[] = [];
  let t = 0;
  samples.push(makeSample(t, 0, -0.001));
  for (let i = 0; i < numCrossings; i++) {
    t += intervalMs / 4;
    samples.push(makeSample(t, 0, 0.001));
    if (i < numCrossings - 1) {
      t += intervalMs / 4;
      samples.push(makeSample(t, 0.01, 0.001));
      t += intervalMs / 4;
      samples.push(makeSample(t, 0.01, -0.001));
      t += intervalMs / 4;
      samples.push(makeSample(t, 0, -0.001));
    }
  }
  return samples;
}

function makeParsed(samples: GpsSample[]): ParsedData {
  return {
    samples,
    fieldMappings: [],
    bounds: calculateBounds(samples),
    duration: samples.length ? samples[samples.length - 1].t - samples[0].t : 0,
  };
}

// ─── buildSharedSessionBundle ─────────────────────────────────────────────────

describe("buildSharedSessionBundle", () => {
  it("detects real laps against the frozen course", () => {
    const parsed = makeParsed(makeRacePath(4, 60_000)); // 4 crossings → 3 laps
    const bundle = buildSharedSessionBundle(parsed, {
      course,
      trackName: "Local Kart Club",
      courseName: "Club Circuit",
    });

    expect(bundle.laps).toHaveLength(3);
    expect(bundle.laps[0].lapNumber).toBe(1);
    expect(bundle.data).toBe(parsed);
    expect(bundle.selection).toMatchObject({
      trackName: "Local Kart Club",
      courseName: "Club Circuit",
    });
    // Selection carries the normalized frozen course, not a name lookup.
    expect(bundle.selection.course.startFinishA).toEqual(course.startFinishA);
  });

  it("uses real lap numbers (no per-lap labels)", () => {
    const bundle = buildSharedSessionBundle(makeParsed(makeRacePath(3, 60_000)), {
      course,
      trackName: "T",
      courseName: "C",
    });
    expect(bundle.lapLabels).toEqual({});
  });

  it("builds the driver/date descriptor", () => {
    const when = new Date(Date.UTC(2026, 6, 1));
    const bundle = buildSharedSessionBundle(makeParsed(makeRacePath(3, 60_000)), {
      course,
      trackName: "T",
      courseName: "Club Circuit",
      driverName: "DoveRacer",
      sessionDate: when,
    });
    expect(bundle.descriptor.courseName).toBe("Club Circuit");
    expect(bundle.descriptor.driverLabel).toBe("DoveRacer");
    expect(bundle.descriptor.dateLabel).toBe(when.toLocaleDateString());
    expect(bundle.descriptor.engineLabel).toBeUndefined();
  });

  it("omits driver/date when the share has neither", () => {
    const bundle = buildSharedSessionBundle(makeParsed(makeRacePath(3, 60_000)), {
      course,
      trackName: "T",
      courseName: "C",
      driverName: null,
      sessionDate: null,
    });
    expect(bundle.descriptor.driverLabel).toBeUndefined();
    expect(bundle.descriptor.dateLabel).toBeUndefined();
  });

  it("still yields a bundle when no laps are detected (full-trace view)", () => {
    // A path that never crosses the S/F line.
    const parsed = makeParsed([makeSample(0, 0.02, -0.001), makeSample(1000, 0.02, 0.001)]);
    const bundle = buildSharedSessionBundle(parsed, {
      course,
      trackName: "T",
      courseName: "C",
    });
    expect(bundle.laps).toEqual([]);
    expect(bundle.data.samples).toHaveLength(2);
  });
});
