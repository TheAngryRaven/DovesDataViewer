import { describe, expect, it } from "vitest";
import type { Course, GpsSample } from "@/types/racing";
import type { LapSnapshot } from "@/lib/lapSnapshot";
import {
  buildEntryData,
  contentHashForSnapshot,
  defaultListedWeight,
  isValidListedWeight,
} from "./leaderboardSubmission";

const course: Course = {
  name: "Full CW",
  startFinishA: { lat: 35.0, lon: -97.0 },
  startFinishB: { lat: 35.0, lon: -97.001 },
};

function sample(t: number, extra: Record<string, number>): GpsSample {
  return { t, lat: 35 + t * 1e-6, lon: -97 + t * 1e-6, speedMps: 20, speedMph: 44, speedKph: 72, extraFields: extra };
}

function snap(overrides: Partial<LapSnapshot> = {}): LapSnapshot {
  const samples = [
    sample(0, { rpm: 11000, lat_g: 0.5 }),
    sample(1000, { rpm: 12000, lat_g: 0.8 }),
    sample(2000, { rpm: 11500, lat_g: 0.2 }),
  ];
  return {
    id: "snap-1",
    trackName: "OKC",
    courseName: "Full CW",
    courseKey: "OKCFull CW",
    engine: "Rotax",
    engineKey: "rotax",
    course,
    lapTimeMs: 62000,
    sourceFileName: "s.dove",
    sourceLapNumber: 3,
    recordedAt: 1700000000000,
    samples,
    lapStartMs: 0,
    lapEndMs: 2000,
    vehicle: { id: "v1", name: "Kart", number: 7, weight: 365, weightUnit: "lb" },
    setup: { id: "setup-1" } as LapSnapshot["setup"],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("contentHashForSnapshot", () => {
  it("is stable for identical snapshots and varies with lap time", () => {
    expect(contentHashForSnapshot(snap())).toBe(contentHashForSnapshot(snap()));
    expect(contentHashForSnapshot(snap())).not.toBe(contentHashForSnapshot(snap({ lapTimeMs: 61000 })));
  });
});

describe("buildEntryData privacy", () => {
  it("never includes setup data", () => {
    expect("setup" in buildEntryData(snap(), { engineTelemetryPublic: false })).toBe(false);
    expect("setup" in buildEntryData(snap(), { engineTelemetryPublic: true })).toBe(false);
  });

  it("strips engine-telemetry channels by default", () => {
    const data = buildEntryData(snap(), { engineTelemetryPublic: false });
    for (const s of data.samples) {
      expect(s.extraFields.rpm).toBeUndefined();
      expect(s.extraFields.lat_g).toBeDefined(); // non-engine channel kept
    }
    expect(data.fieldMappings.map((f) => f.name)).toContain("lat_g");
    expect(data.fieldMappings.map((f) => f.name)).not.toContain("rpm");
  });

  it("keeps engine telemetry when shared", () => {
    const data = buildEntryData(snap(), { engineTelemetryPublic: true });
    expect(data.samples[0].extraFields.rpm).toBe(11000);
    expect(data.fieldMappings.map((f) => f.name)).toContain("rpm");
  });
});

describe("listed weight", () => {
  it("defaults to the vehicle weight when present", () => {
    expect(defaultListedWeight(snap())).toEqual({ weight: 365, unit: "lb" });
  });
  it("is null when the vehicle has no weight", () => {
    expect(defaultListedWeight(snap({ vehicle: { id: "v", name: "k", number: 1 } })).weight).toBeNull();
  });
  it("validates positive numbers only", () => {
    expect(isValidListedWeight(365)).toBe(true);
    expect(isValidListedWeight(0)).toBe(false);
    expect(isValidListedWeight(null)).toBe(false);
  });
});
