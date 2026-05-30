import { describe, expect, it } from "vitest";
import { detectionMetadataPatch } from "./useDataLoader";

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
