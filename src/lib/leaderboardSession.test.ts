import { describe, expect, it } from "vitest";
import type { Course } from "@/types/racing";
import { buildLeaderboardSession } from "./leaderboardSession";
import type { LeaderboardEntry } from "./leaderboardTypes";

const course: Course = {
  name: "Full CW",
  startFinishA: { lat: 35.0, lon: -97.0 },
  startFinishB: { lat: 35.0, lon: -97.001 },
};

function entry(id: string, name: string, lapTimeMs: number, nSamples = 5): LeaderboardEntry {
  return {
    id,
    userId: `u-${id}`,
    displayName: name,
    trackName: "OKC",
    courseName: "Full CW",
    courseKey: "OKCFull CW",
    direction: null,
    engine: "Rotax",
    engineKey: "rotax",
    engineClassId: null,
    listedWeight: 365,
    listedWeightUnit: "lb",
    lapTimeMs,
    contentHash: `h-${id}`,
    setupPublic: false,
    engineTelemetryPublic: false,
    status: "approved",
    createdAt: "2026-06-26T00:00:00Z",
    data: {
      samples: Array.from({ length: nSamples }, (_, i) => ({
        t: 1000 + i * 1000, // non-zero base to exercise rebasing
        lat: 35 + i * 1e-5,
        lon: -97 + i * 1e-5,
        speedMps: 20,
        speedMph: 40 + i,
        speedKph: 64 + i,
        extraFields: { rpm: 12000 },
      })),
      fieldMappings: [{ index: 0, name: "rpm", enabled: true }],
      course,
      lapStartMs: 1000,
      lapEndMs: 1000 + (nSamples - 1) * 1000,
    },
  };
}

describe("buildLeaderboardSession", () => {
  it("returns null when no entry has samples", () => {
    expect(buildLeaderboardSession([], { courseName: "x", engineLabel: "y" })).toBeNull();
  });

  it("orders laps fastest-first and labels them by submitter", () => {
    const bundle = buildLeaderboardSession(
      [entry("a", "Alice", 65000), entry("b", "Bob", 62000), entry("c", "Cara", 63000)],
      { courseName: "Full CW", engineLabel: "Rotax", weightLabel: "365 lb" },
    )!;
    expect(bundle.laps.map((l) => l.lapNumber)).toEqual([1, 2, 3]);
    expect(bundle.laps.map((l) => l.lapTimeMs)).toEqual([62000, 63000, 65000]);
    expect(bundle.lapLabels).toEqual({ 1: "Bob", 2: "Cara", 3: "Alice" });
  });

  it("stacks samples with cumulative, monotonic timestamps and exact lap indices", () => {
    const bundle = buildLeaderboardSession(
      [entry("a", "Alice", 65000, 3), entry("b", "Bob", 62000, 4)],
      { courseName: "Full CW", engineLabel: "Rotax" },
    )!;
    // Bob (fastest) first: 4 samples then Alice: 3 → 7 total.
    expect(bundle.data.samples.length).toBe(7);
    expect(bundle.laps[0].startIndex).toBe(0);
    expect(bundle.laps[0].endIndex).toBe(3);
    expect(bundle.laps[1].startIndex).toBe(4);
    expect(bundle.laps[1].endIndex).toBe(6);
    // First sample rebased to 0; timestamps monotonically increase.
    expect(bundle.data.samples[0].t).toBe(0);
    const ts = bundle.data.samples.map((s) => s.t);
    expect([...ts].sort((x, y) => x - y)).toEqual(ts);
    // dovex metadata carries the ordered lap times.
    expect(bundle.data.dovexMetadata?.lapTimesMs).toEqual([62000, 65000]);
  });

  it("unions field mappings and carries the descriptor", () => {
    const bundle = buildLeaderboardSession([entry("a", "Alice", 65000)], {
      courseName: "Full CW",
      engineLabel: "Rotax",
      weightLabel: "365 lb",
    })!;
    expect(bundle.data.fieldMappings.map((f) => f.name)).toEqual(["rpm"]);
    expect(bundle.descriptor).toEqual({ courseName: "Full CW", engineLabel: "Rotax", weightLabel: "365 lb" });
    expect(bundle.selection.trackName).toBe("OKC");
  });
});
