import { describe, it, expect } from "vitest";
import {
  overlayId,
  overlayColor,
  OVERLAY_COLORS,
  resolveOverlayLines,
  unionBounds,
} from "./lapOverlays";
import type { GpsSample, Lap } from "@/types/racing";
import type { LapSnapshot } from "./lapSnapshot";

function sample(lat: number, lon: number, t = 0): GpsSample {
  return { t, lat, lon, speedMps: 0, speedMph: 0, speedKph: 0, extraFields: {} };
}

function lap(lapNumber: number, startIndex: number, endIndex: number): Lap {
  return {
    lapNumber,
    startTime: 0,
    endTime: 0,
    lapTimeMs: 60000 + lapNumber,
    maxSpeedMph: 0,
    maxSpeedKph: 0,
    minSpeedMph: 0,
    minSpeedKph: 0,
    startIndex,
    endIndex,
  };
}

// Minimal snapshot: 4 samples, the middle two inside the lap window.
function snapshot(id: string, engine: string): LapSnapshot {
  return {
    id,
    trackName: "T",
    courseName: "C",
    courseKey: "TC",
    engine,
    engineKey: engine.toLowerCase(),
    course: { name: "C", startFinishA: { lat: 0, lon: 0 }, startFinishB: { lat: 0, lon: 0 } } as LapSnapshot["course"],
    lapTimeMs: 62000,
    sourceFileName: "f",
    sourceLapNumber: 1,
    samples: [sample(0, 0, 0), sample(1, 1, 100), sample(2, 2, 200), sample(3, 3, 300)],
    lapStartMs: 100,
    lapEndMs: 200,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("overlayId / overlayColor", () => {
  it("formats ids by kind", () => {
    expect(overlayId("lap", 3)).toBe("lap:3");
    expect(overlayId("snap", "abc")).toBe("snap:abc");
  });

  it("cycles the palette", () => {
    expect(overlayColor(0)).toBe(OVERLAY_COLORS[0]);
    expect(overlayColor(OVERLAY_COLORS.length)).toBe(OVERLAY_COLORS[0]);
    expect(overlayColor(1)).toBe(OVERLAY_COLORS[1]);
  });
});

describe("resolveOverlayLines", () => {
  const sessionSamples = [sample(0, 0), sample(1, 1), sample(2, 2), sample(3, 3), sample(4, 4)];
  const laps = [lap(1, 0, 2), lap(2, 2, 4)];

  it("resolves a lap id to its sample slice", () => {
    const lines = resolveOverlayLines(["lap:2"], { laps, sessionSamples, snapshots: [] });
    expect(lines).toHaveLength(1);
    expect(lines[0].id).toBe("lap:2");
    expect(lines[0].label).toBe("Lap 2");
    expect(lines[0].samples).toHaveLength(3); // indices 2..4
    expect(lines[0].color).toBe(OVERLAY_COLORS[0]);
  });

  it("resolves a snapshot id to its clean lap samples", () => {
    const snap = snapshot("s1", "IAME X30");
    const lines = resolveOverlayLines(["snap:s1"], { laps, sessionSamples, snapshots: [snap] });
    expect(lines).toHaveLength(1);
    expect(lines[0].samples).toHaveLength(2); // the two in-window samples
    expect(lines[0].label.startsWith("IAME X30")).toBe(true);
  });

  it("assigns palette colors by visible output index, skipping unresolved ids", () => {
    const lines = resolveOverlayLines(
      ["lap:99", "lap:1", "lap:2"], // lap:99 doesn't exist
      { laps, sessionSamples, snapshots: [] },
    );
    expect(lines.map((l) => l.id)).toEqual(["lap:1", "lap:2"]);
    expect(lines[0].color).toBe(OVERLAY_COLORS[0]);
    expect(lines[1].color).toBe(OVERLAY_COLORS[1]);
  });

  it("preserves selection order", () => {
    const lines = resolveOverlayLines(["lap:2", "lap:1"], { laps, sessionSamples, snapshots: [] });
    expect(lines.map((l) => l.id)).toEqual(["lap:2", "lap:1"]);
  });

  it("skips degenerate single-point lines and malformed ids", () => {
    const tiny = [lap(5, 0, 0)];
    expect(resolveOverlayLines(["lap:5"], { laps: tiny, sessionSamples, snapshots: [] })).toEqual([]);
    expect(resolveOverlayLines(["bogus"], { laps, sessionSamples, snapshots: [] })).toEqual([]);
  });
});

describe("unionBounds", () => {
  const base = { minLat: 0, maxLat: 1, minLon: 0, maxLon: 1 };

  it("returns base unchanged with no overlays", () => {
    expect(unionBounds(base, [])).toEqual(base);
  });

  it("expands to enclose overlay samples", () => {
    const line = { id: "lap:1", label: "Lap 1", color: "x", samples: [sample(-2, 5), sample(3, -1)] };
    expect(unionBounds(base, [line])).toEqual({ minLat: -2, maxLat: 3, minLon: -1, maxLon: 5 });
  });
});
