import { describe, it, expect, vi } from "vitest";
import { bufferByteSource, isIsoBmff, readGpmdTrack, readSamples, resolveSamples } from "./mp4Boxes";
import { buildGoProMp4, gps5Payload } from "./testFixtures";

const payloads = [
  gps5Payload([{ lat: 33.5, lon: -117.7, alt: 100, speed2d: 10 }]),
  gps5Payload([{ lat: 33.51, lon: -117.71, alt: 101, speed2d: 11 }]),
  gps5Payload([{ lat: 33.52, lon: -117.72, alt: 102, speed2d: 12 }]),
];

describe("isIsoBmff", () => {
  it("recognises an ftyp box and rejects other bytes", () => {
    expect(isIsoBmff(buildGoProMp4({ payloads }))).toBe(true);
    expect(isIsoBmff(new TextEncoder().encode("timestamp,lat,lng,speed_mph\n").buffer)).toBe(false);
    expect(isIsoBmff(new ArrayBuffer(4))).toBe(false);
  });
});

describe("readGpmdTrack", () => {
  it("finds the gpmd track in a camera-style file (moov after mdat) and times the payloads", async () => {
    const file = buildGoProMp4({ payloads, timescale: 1000, durationsTicks: [1000, 1000, 500], creationEpochMs: 1_718_461_825_000 });
    const track = await readGpmdTrack(bufferByteSource(file));
    expect(track).not.toBeNull();
    expect(track!.samples).toHaveLength(3);
    expect(track!.samples.map((s) => s.timeSec)).toEqual([0, 1, 2]);
    expect(track!.samples.map((s) => s.durationSec)).toEqual([1, 1, 0.5]);
    expect(track!.samples.map((s) => s.size)).toEqual(payloads.map((p) => p.byteLength));
    expect(track!.movieDurationSec).toBeCloseTo(2.5, 6);
    expect(track!.creationEpochMs).toBe(1_718_461_825_000);
  });

  it("handles moov-first files, a leading video track and co64 tables", async () => {
    const file = buildGoProMp4({ payloads, moovFirst: true, withVideoTrack: true, co64: true });
    const track = await readGpmdTrack(bufferByteSource(file));
    expect(track!.samples).toHaveLength(3);
    const bytes = await readSamples(bufferByteSource(file), track!.samples);
    expect(new Uint8Array(bytes[1])).toEqual(payloads[1]);
  });

  it("returns null for an MP4 without a gpmd track and for non-MP4 bytes", async () => {
    const file = buildGoProMp4({ payloads: [], withVideoTrack: true });
    // Empty gpmd sample table still counts as the track; strip it by building without payloads
    const track = await readGpmdTrack(bufferByteSource(file));
    expect(track?.samples ?? []).toEqual([]);
    expect(await readGpmdTrack(bufferByteSource(new TextEncoder().encode("not an mp4 at all, really").buffer))).toBeNull();
    expect(await readGpmdTrack(bufferByteSource(new ArrayBuffer(3)))).toBeNull();
  });

  it("caps a hostile uniform stsz count against the file size instead of allocating it", async () => {
    // Regression (SEC-1): a ~4-billion-entry uniform stsz used to hang/OOM the tab.
    const file = buildGoProMp4({ payloads, uniformStsz: { size: 1, count: 0xffff_fffe } });
    const track = await readGpmdTrack(bufferByteSource(file));
    // Three one-sample chunks bound what resolves; the cap bounds what is allocated.
    expect(track!.samples).toHaveLength(3);
    expect(track!.samples.every((s) => s.size === 1)).toBe(true);
  });

  it("leaves the creation time undefined when the camera wrote none", async () => {
    const track = await readGpmdTrack(bufferByteSource(buildGoProMp4({ payloads })));
    expect(track!.creationEpochMs).toBeUndefined();
  });
});

describe("readSamples", () => {
  it("returns every payload's bytes in order and reports progress per batch", async () => {
    const file = buildGoProMp4({ payloads });
    const src = bufferByteSource(file);
    const track = (await readGpmdTrack(src))!;
    const onProgress = vi.fn();
    const bytes = await readSamples(src, track.samples, onProgress, 2);
    expect(bytes.map((b) => new Uint8Array(b))).toEqual(payloads);
    expect(onProgress.mock.calls).toEqual([[2, 3], [3, 3]]);
  });
});

describe("resolveSamples", () => {
  it("expands multi-sample chunks and stsc runs", () => {
    const samples = resolveSamples(
      { sizes: [10, 20, 30, 40], chunkOffsets: [100, 500], chunkRuns: [[1, 3], [2, 1]], timeRuns: [[4, 250]] },
      1000,
    );
    expect(samples.map((s) => s.offset)).toEqual([100, 110, 130, 500]);
    expect(samples.map((s) => s.timeSec)).toEqual([0, 0.25, 0.5, 0.75]);
  });

  it("returns nothing for an empty or unscaled table", () => {
    expect(resolveSamples({ sizes: [], chunkOffsets: [], chunkRuns: [], timeRuns: [] }, 1000)).toEqual([]);
    expect(resolveSamples({ sizes: [1], chunkOffsets: [0], chunkRuns: [[1, 1]], timeRuns: [[1, 1]] }, 0)).toEqual([]);
  });
});
