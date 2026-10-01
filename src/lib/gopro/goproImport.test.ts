import { describe, it, expect, vi } from "vitest";
import { extractGoProTelemetry, goProSessionFileName, importGoProVideo, isGoProVideoBuffer, isGoProVideoFile, parseGoProVideoFile } from "./goproImport";
import { buildGoProMp4, gps5Payload } from "./testFixtures";
import { parseDatalogContent, parseDatalogFile } from "@/lib/datalogParser";
import { stageGoProVideo, takeStagedGoProVideo } from "./videoHandoff";

const fix = (i: number) => ({ lat: 33.5 + i * 1e-4, lon: -117.7 + i * 1e-4, alt: 100, speed2d: 15 });

/** A chapter of `seconds` one-fix payloads with a real GPSU on each. */
function chapter(name: string, seconds: number, startUtc = "240615143025.000"): File {
  const base = Date.UTC(2024, 5, 15, 14, 30, 25);
  const payloads = Array.from({ length: seconds }, (_, s) => {
    const d = new Date(base + s * 1000);
    const gpsu = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}${String(d.getUTCSeconds()).padStart(2, "0")}.000`;
    return gps5Payload([fix(s), fix(s + 0.5)], { gpsu: startUtc === "240615143025.000" ? gpsu : startUtc });
  });
  return new File([buildGoProMp4({ payloads })], name, { type: "video/mp4" });
}

describe("isGoProVideoFile / goProSessionFileName", () => {
  it("gates on the container extension only", () => {
    expect(isGoProVideoFile("GH010042.MP4")).toBe(true);
    expect(isGoProVideoFile("clip.mov")).toBe(true);
    expect(isGoProVideoFile("GS010042.360")).toBe(true);
    expect(isGoProVideoFile("session.dovex")).toBe(false);
    expect(isGoProVideoFile("GH010042.LRV")).toBe(false);
  });

  it("names the saved session after the first chapter", () => {
    expect(goProSessionFileName("GH010042.MP4")).toBe("GH010042.dove");
    expect(goProSessionFileName("DCIM/100GOPRO/GX020042.MP4")).toBe("GX020042.dove");
  });

  it("recognises an in-memory MP4", () => {
    expect(isGoProVideoBuffer(buildGoProMp4({ payloads: [] }))).toBe(true);
    expect(isGoProVideoBuffer(new ArrayBuffer(2))).toBe(false);
  });
});

describe("extractGoProTelemetry", () => {
  it("stitches chapters in GoPro order with cumulative time offsets", async () => {
    const onProgress = vi.fn();
    const result = await extractGoProTelemetry([chapter("GH020042.MP4", 2), chapter("GH010042.MP4", 3)], onProgress);
    expect(result.chapters.map((f) => f.name)).toEqual(["GH010042.MP4", "GH020042.MP4"]);
    expect(result.rowCount).toBe(10);
    expect(result.syncOffsetMs).toBe(0);
    const stamps = result.csv.trim().split("\n").slice(1).map((l) => Number(l.split(",")[0]));
    // Chapter 2 starts 3 s (chapter 1's movie duration) after chapter 1's first fix.
    expect(stamps[6] - stamps[0]).toBe(3000);
    expect(stamps.every((s, i) => i === 0 || s > stamps[i - 1])).toBe(true);
    expect(onProgress).toHaveBeenLastCalledWith({ chapter: 2, chapters: 2, done: 2, total: 2 });
  });

  it("rejects a video without a telemetry track", async () => {
    const plain = new File([buildGoProMp4({ payloads: [], withVideoTrack: true })], "phone.mp4");
    // An empty gpmd table is still "a track" — no fixes is the error there;
    // a file that is not ISO-BMFF at all has no track.
    await expect(extractGoProTelemetry([plain])).rejects.toThrow(/satellite lock/);
    await expect(extractGoProTelemetry([new File(["hello"], "x.mp4")])).rejects.toThrow(/No GoPro telemetry track/);
    await expect(extractGoProTelemetry([])).rejects.toThrow(/No video/);
  });
});

describe("parser integration", () => {
  it("parseGoProVideoFile yields Dove-shaped samples", async () => {
    const data = await parseGoProVideoFile(chapter("GH010042.MP4", 2));
    expect(data.samples).toHaveLength(4);
    expect(data.samples[1].t).toBe(500);
    expect(data.samples[0].extraFields).toMatchObject({ HDOP: 1.5, Altitude: 100 });
  });

  it("the async router accepts a GoPro video and the sync router refuses the bytes", async () => {
    const data = await parseDatalogFile(chapter("GH010042.MP4", 2));
    expect(data.samples).toHaveLength(4);
    expect(data.fieldMappings.some((f) => f.name === "hdop")).toBe(true);
    expect(() => parseDatalogContent(buildGoProMp4({ payloads: [] }))).toThrow(/parseDatalogFile/);
  });

  it("importGoProVideo returns the session file, blob and video handoff inputs", async () => {
    const files = [chapter("GH010042.MP4", 2), chapter("GH020042.MP4", 1)];
    const result = await importGoProVideo(files);
    expect(result.fileName).toBe("GH010042.dove");
    expect(await result.blob.text()).toBe(result.csv);
    expect(result.chapters).toEqual(files);
    const data = parseDatalogContent(result.csv);
    expect(data.samples).toHaveLength(6);
  });
});

describe("videoHandoff", () => {
  it("hands the staged video to exactly the session it was staged for, once", () => {
    const staged = { sessionFileName: "GH010042.dove", files: [{ name: "GH010042.MP4", file: new File([], "GH010042.MP4") }], syncOffsetMs: -250 };
    stageGoProVideo(staged);
    expect(takeStagedGoProVideo("other.dove")).toBeNull();
    expect(takeStagedGoProVideo("GH010042.dove")).toBe(staged);
    expect(takeStagedGoProVideo("GH010042.dove")).toBeNull();
  });
});
