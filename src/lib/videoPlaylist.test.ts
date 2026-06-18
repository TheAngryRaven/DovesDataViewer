import { describe, it, expect } from "vitest";
import {
  parseGoProName,
  orderVideoFiles,
  buildPlaylist,
  virtualToLocal,
  localToVirtual,
  planAudioSegments,
  type Playlist,
} from "./videoPlaylist";

describe("parseGoProName", () => {
  it("parses modern AVC names (GH)", () => {
    expect(parseGoProName("GH010042.MP4")).toEqual({ encoding: "GH", chapter: 1, fileNumber: 42 });
    expect(parseGoProName("GH020042.MP4")).toEqual({ encoding: "GH", chapter: 2, fileNumber: 42 });
  });

  it("parses modern HEVC names (GX)", () => {
    expect(parseGoProName("GX011234.mp4")).toEqual({ encoding: "GX", chapter: 1, fileNumber: 1234 });
  });

  it("parses legacy first file (GOPR) as chapter 0", () => {
    expect(parseGoProName("GOPR0042.MP4")).toEqual({ encoding: "GOPR", chapter: 0, fileNumber: 42 });
  });

  it("parses legacy continuation files (GP)", () => {
    expect(parseGoProName("GP010042.MP4")).toEqual({ encoding: "GP", chapter: 1, fileNumber: 42 });
    expect(parseGoProName("GP020042.MP4")).toEqual({ encoding: "GP", chapter: 2, fileNumber: 42 });
  });

  it("is case-insensitive and ignores directory prefixes", () => {
    expect(parseGoProName("/DCIM/100GOPRO/gh010042.mp4")).toEqual({ encoding: "GH", chapter: 1, fileNumber: 42 });
  });

  it("returns null for non-GoPro names", () => {
    expect(parseGoProName("my-race.mp4")).toBeNull();
    expect(parseGoProName("IMG_1234.mov")).toBeNull();
    expect(parseGoProName("GH0042.mp4")).toBeNull(); // too few digits
  });
});

describe("orderVideoFiles", () => {
  const f = (name: string) => ({ name });

  it("orders GoPro chapters in sequence regardless of selection order", () => {
    const ordered = orderVideoFiles([f("GH030042.MP4"), f("GH010042.MP4"), f("GH020042.MP4")]);
    expect(ordered.map((x) => x.name)).toEqual(["GH010042.MP4", "GH020042.MP4", "GH030042.MP4"]);
  });

  it("orders legacy GOPR before GP chapters", () => {
    const ordered = orderVideoFiles([f("GP020042.MP4"), f("GOPR0042.MP4"), f("GP010042.MP4")]);
    expect(ordered.map((x) => x.name)).toEqual(["GOPR0042.MP4", "GP010042.MP4", "GP020042.MP4"]);
  });

  it("groups by recording number then chapter", () => {
    const ordered = orderVideoFiles([f("GH010099.MP4"), f("GH020042.MP4"), f("GH010042.MP4")]);
    expect(ordered.map((x) => x.name)).toEqual(["GH010042.MP4", "GH020042.MP4", "GH010099.MP4"]);
  });

  it("appends non-GoPro files in selection order after GoPro files", () => {
    const ordered = orderVideoFiles([f("b.mp4"), f("GH010042.MP4"), f("a.mp4")]);
    expect(ordered.map((x) => x.name)).toEqual(["GH010042.MP4", "b.mp4", "a.mp4"]);
  });

  it("leaves a single non-GoPro file untouched", () => {
    expect(orderVideoFiles([f("race.mp4")]).map((x) => x.name)).toEqual(["race.mp4"]);
  });
});

describe("buildPlaylist", () => {
  it("computes cumulative start offsets and total duration", () => {
    const pl = buildPlaylist([
      { name: "a", durationSec: 300 },
      { name: "b", durationSec: 280 },
      { name: "c", durationSec: 120 },
    ]);
    expect(pl.chunks.map((c) => c.startOffsetSec)).toEqual([0, 300, 580]);
    expect(pl.totalDuration).toBe(700);
  });

  it("treats invalid/zero durations as 0", () => {
    const pl = buildPlaylist([
      { name: "a", durationSec: NaN },
      { name: "b", durationSec: 100 },
    ]);
    expect(pl.chunks[0].durationSec).toBe(0);
    expect(pl.chunks[1].startOffsetSec).toBe(0);
    expect(pl.totalDuration).toBe(100);
  });

  it("handles an empty input", () => {
    const pl = buildPlaylist([]);
    expect(pl.chunks).toEqual([]);
    expect(pl.totalDuration).toBe(0);
  });
});

describe("virtualToLocal / localToVirtual", () => {
  const pl: Playlist = buildPlaylist([
    { name: "a", durationSec: 300 },
    { name: "b", durationSec: 280 },
    { name: "c", durationSec: 120 },
  ]);

  it("maps within the first chunk", () => {
    expect(virtualToLocal(pl, 100)).toEqual({ index: 0, localSec: 100 });
  });

  it("maps into a middle chunk", () => {
    expect(virtualToLocal(pl, 400)).toEqual({ index: 1, localSec: 100 });
  });

  it("maps a boundary to the start of the next chunk", () => {
    expect(virtualToLocal(pl, 300)).toEqual({ index: 1, localSec: 0 });
    expect(virtualToLocal(pl, 580)).toEqual({ index: 2, localSec: 0 });
  });

  it("clamps below zero and above total", () => {
    expect(virtualToLocal(pl, -50)).toEqual({ index: 0, localSec: 0 });
    expect(virtualToLocal(pl, 999)).toEqual({ index: 2, localSec: 120 });
  });

  it("returns chunk 0 at 0 for an empty playlist", () => {
    expect(virtualToLocal(buildPlaylist([]), 10)).toEqual({ index: 0, localSec: 0 });
  });

  it("round-trips through localToVirtual", () => {
    const { index, localSec } = virtualToLocal(pl, 450);
    expect(localToVirtual(pl, index, localSec)).toBe(450);
  });

  it("localToVirtual clamps the chunk index", () => {
    expect(localToVirtual(pl, 5, 10)).toBe(580 + 10);
    expect(localToVirtual(pl, -1, 10)).toBe(10);
  });
});

describe("planAudioSegments", () => {
  const chunks = [
    { startOffsetSec: 0, durationSec: 300 },
    { startOffsetSec: 300, durationSec: 280 },
    { startOffsetSec: 580, durationSec: 120 },
  ];
  const sr = 48000;

  it("maps a full-range export to one segment per chunk, end-to-end", () => {
    const segs = planAudioSegments(chunks, 0, 700, sr);
    expect(segs).toEqual([
      { index: 0, srcStartSample: 0, lenSamples: 300 * sr, outStartSample: 0 },
      { index: 1, srcStartSample: 0, lenSamples: 280 * sr, outStartSample: 300 * sr },
      { index: 2, srcStartSample: 0, lenSamples: 120 * sr, outStartSample: 580 * sr },
    ]);
  });

  it("handles a range spanning a single boundary (lap export)", () => {
    // 250s..400s crosses the 300s boundary between chunk 0 and chunk 1.
    const segs = planAudioSegments(chunks, 250, 400, sr);
    expect(segs).toEqual([
      { index: 0, srcStartSample: 250 * sr, lenSamples: 50 * sr, outStartSample: 0 },
      { index: 1, srcStartSample: 0, lenSamples: 100 * sr, outStartSample: 50 * sr },
    ]);
  });

  it("omits chunks outside the range", () => {
    const segs = planAudioSegments(chunks, 610, 700, sr);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toEqual({ index: 2, srcStartSample: 30 * sr, lenSamples: 90 * sr, outStartSample: 0 });
  });

  it("returns nothing for an empty or inverted range", () => {
    expect(planAudioSegments(chunks, 100, 100, sr)).toEqual([]);
    expect(planAudioSegments(chunks, 400, 200, sr)).toEqual([]);
    expect(planAudioSegments(chunks, 0, 700, 0)).toEqual([]);
  });
});
