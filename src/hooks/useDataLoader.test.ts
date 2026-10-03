import { describe, expect, it } from "vitest";
import type { Lap, TrackCourseSelection } from "@/types/racing";
import { applyCourselessLaps, detectionMetadataPatch, dragMetadataPatch } from "./useDataLoader";

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

describe("applyCourselessLaps (drag / waypoint pre-application)", () => {
  function sink(initial: TrackCourseSelection | null) {
    const state = { selection: initial, laps: [] as Lap[], selected: null as number | null };
    return {
      state,
      setSelection: (sel: TrackCourseSelection | null) => { state.selection = sel; },
      setLaps: (l: Lap[]) => { state.laps = l; },
      setSelectedLapNumber: (n: number | null) => { state.selected = n; },
    };
  }
  const lap = (lapNumber: number, lapTimeMs: number, incomplete?: boolean) =>
    ({ lapNumber, lapTimeMs, ...(incomplete ? { incomplete } : {}) }) as Lap;

  it("clears a course selection carried over from the previous file", () => {
    // Regression: a drag log opened after a circuit session kept that course
    // selected, so canSnapshot stayed live and a run could replace the course PB.
    const s = sink({ trackName: "OKC", courseName: "CW", course: {} as TrackCourseSelection["course"] });
    applyCourselessLaps(s, [lap(1, 13400), lap(2, 12900)]);
    expect(s.state.selection).toBeNull();
    expect(s.state.laps).toHaveLength(2);
    expect(s.state.selected).toBe(2);
  });

  it("selects the fastest complete run, never an incomplete one", () => {
    const s = sink(null);
    applyCourselessLaps(s, [lap(1, 4200, true), lap(2, 12900)]);
    expect(s.state.selected).toBe(2);
    applyCourselessLaps(s, [lap(1, 4200, true)]);
    expect(s.state.selected).toBeNull();
  });
});
