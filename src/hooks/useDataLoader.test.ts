import { describe, expect, it } from "vitest";
import { detectionMetadataPatch, dragMetadataPatch } from "./useDataLoader";

const laps = [
  { lapNumber: 1, lapTimeMs: 65000 },
  { lapNumber: 2, lapTimeMs: 62000 },
  { lapNumber: 3, lapTimeMs: 63000 },
];

describe("detectionMetadataPatch (auto-detect tagging)", () => {
  it("tags track + course with the start time and fastest lap", () => {
    const start = new Date(2026, 1, 12, 11, 15);
    expect(detectionMetadataPatch("OKC", "CW", laps, start)).toEqual({
      trackName: "OKC",
      courseName: "CW",
      sessionStartTime: start.getTime(),
      fastestLapMs: 62000,
      fastestLapNumber: 2,
    });
  });

  it("omits the start time when the parser gave no date", () => {
    const patch = detectionMetadataPatch("OKC", "CW", laps, undefined);
    expect(patch.sessionStartTime).toBeUndefined();
    expect(patch).toMatchObject({ trackName: "OKC", courseName: "CW", fastestLapMs: 62000 });
  });

  it("omits fastest-lap fields when there are no laps", () => {
    const patch = detectionMetadataPatch("OKC", "CW", [], new Date(0));
    expect(patch.fastestLapMs).toBeUndefined();
    expect(patch.fastestLapNumber).toBeUndefined();
    expect(patch).toMatchObject({ trackName: "OKC", courseName: "CW", sessionStartTime: 0 });
  });
});

describe("dragMetadataPatch (drag-session tagging)", () => {
  const runs = [
    { lapNumber: 1, lapTimeMs: 13400 },
    { lapNumber: 2, lapTimeMs: 12900 },
    { lapNumber: 3, lapTimeMs: 4200, incomplete: true }, // short window, aborted pass
  ];

  it("stores the distance, start time, and fastest complete run", () => {
    const start = new Date(2026, 7, 28, 19, 30);
    expect(dragMetadataPatch(1320, runs, start)).toEqual({
      dragDistanceFt: 1320,
      sessionStartTime: start.getTime(),
      fastestLapMs: 12900,
      fastestLapNumber: 2,
    });
  });

  it("never caches an incomplete run's window as the fastest lap", () => {
    const patch = dragMetadataPatch(1320, runs);
    expect(patch.fastestLapNumber).toBe(2);
    expect(patch.fastestLapMs).toBe(12900);
    expect(patch.sessionStartTime).toBeUndefined();
  });

  it("clears the fastest-lap badge when no run completes the distance", () => {
    const patch = dragMetadataPatch(1320, [{ lapNumber: 1, lapTimeMs: 4200, incomplete: true }]);
    expect(patch.dragDistanceFt).toBe(1320);
    expect("fastestLapMs" in patch).toBe(true);
    expect(patch.fastestLapMs).toBeUndefined();
    expect(patch.fastestLapNumber).toBeUndefined();
  });
});
