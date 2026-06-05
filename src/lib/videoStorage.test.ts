/**
 * IndexedDB tests for videoStorage — per-session video sync records. Covers the
 * save/load/delete round-trip and the legacy→new overlay-settings migration that
 * loadVideoSync applies on read.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { freshIndexedDB } from "./__test__/idb";
import {
  saveVideoSync,
  loadVideoSync,
  deleteVideoSync,
  type VideoSyncRecord,
} from "./videoStorage";

beforeEach(() => freshIndexedDB());

describe("videoStorage round-trip", () => {
  it("saves and loads a sync record", async () => {
    const rec: VideoSyncRecord = {
      sessionFileName: "s.dove",
      syncOffsetMs: 1500,
      videoFileName: "clip.mp4",
      isLocked: true,
    };
    await saveVideoSync(rec);
    const loaded = await loadVideoSync("s.dove");
    expect(loaded).toMatchObject({ syncOffsetMs: 1500, videoFileName: "clip.mp4", isLocked: true });
  });

  it("returns undefined for a session with no sync record", async () => {
    expect(await loadVideoSync("none.dove")).toBeUndefined();
  });

  it("deletes a sync record", async () => {
    await saveVideoSync({ sessionFileName: "s.dove", syncOffsetMs: 0, videoFileName: "c.mp4" });
    await deleteVideoSync("s.dove");
    expect(await loadVideoSync("s.dove")).toBeUndefined();
  });

  it("migrates legacy overlay settings to the new overlays-array shape on load", async () => {
    // Persist a record carrying the OLD overlay format, then read it back.
    const legacy = {
      sessionFileName: "s.dove",
      syncOffsetMs: 0,
      videoFileName: "c.mp4",
      overlaySettings: {
        showSpeed: true,
        overlaysLocked: true,
        positions: { speed: { x: 3, y: 3 } },
      },
    } as unknown as VideoSyncRecord;
    await saveVideoSync(legacy);

    const loaded = await loadVideoSync("s.dove");
    const settings = loaded!.overlaySettings!;
    expect(Array.isArray(settings.overlays)).toBe(true);
    expect(settings.overlays).toHaveLength(1);
    expect(settings.overlays[0]).toMatchObject({ dataSource: "speed", type: "digital" });
  });

  it("passes through already-migrated overlay settings unchanged", async () => {
    await saveVideoSync({
      sessionFileName: "s.dove",
      syncOffsetMs: 0,
      videoFileName: "c.mp4",
      overlaySettings: { overlaysLocked: false, overlays: [] },
    });
    const loaded = await loadVideoSync("s.dove");
    expect(loaded!.overlaySettings).toMatchObject({ overlaysLocked: false, overlays: [] });
  });
});
