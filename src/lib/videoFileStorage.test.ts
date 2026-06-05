/**
 * IndexedDB tests for videoFileStorage — stored exported-video blobs per session.
 * Covers save + load (blob + metadata), the blob-free metadata readers
 * (getSessionVideoMeta / listSessionVideos), the existence check, and delete.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { freshIndexedDB } from "./__test__/idb";
import {
  saveSessionVideo,
  loadSessionVideo,
  deleteSessionVideo,
  hasSessionVideo,
  getSessionVideoMeta,
  listSessionVideos,
} from "./videoFileStorage";

beforeEach(() => freshIndexedDB());

describe("videoFileStorage", () => {
  it("saves and loads a video blob with its metadata", async () => {
    await saveSessionVideo("s.dove", new Blob(["video-bytes"]), "clip.mp4", "lap", true, 3);
    const loaded = await loadSessionVideo("s.dove");
    expect(loaded).not.toBeNull();
    expect(await loaded!.blob.text()).toBe("video-bytes");
    expect(loaded!.meta).toMatchObject({
      videoFileName: "clip.mp4",
      exportType: "lap",
      hasOverlays: true,
      lapNumber: 3,
      size: 11,
    });
  });

  it("returns null when loading a session with no stored video", async () => {
    expect(await loadSessionVideo("none.dove")).toBeNull();
  });

  it("reports existence via hasSessionVideo", async () => {
    expect(await hasSessionVideo("s.dove")).toBe(false);
    await saveSessionVideo("s.dove", new Blob(["x"]), "c.mp4");
    expect(await hasSessionVideo("s.dove")).toBe(true);
  });

  it("returns metadata without the blob via getSessionVideoMeta", async () => {
    await saveSessionVideo("s.dove", new Blob(["abcd"]), "c.mp4", "session", false);
    const meta = await getSessionVideoMeta("s.dove");
    expect(meta).toMatchObject({ videoFileName: "c.mp4", exportType: "session", size: 4 });
    expect(meta).not.toHaveProperty("videoBlob");
  });

  it("defaults exportType to 'raw' and hasOverlays to false", async () => {
    await saveSessionVideo("s.dove", new Blob(["x"]), "c.mp4");
    expect(await getSessionVideoMeta("s.dove")).toMatchObject({ exportType: "raw", hasOverlays: false });
  });

  it("lists all stored videos as blob-free metadata", async () => {
    await saveSessionVideo("a.dove", new Blob(["aa"]), "a.mp4");
    await saveSessionVideo("b.dove", new Blob(["bbbb"]), "b.mp4");
    const list = await listSessionVideos();
    expect(list.map((m) => m.sessionFileName).sort()).toEqual(["a.dove", "b.dove"]);
    expect(list[0]).not.toHaveProperty("videoBlob");
  });

  it("deletes a stored video", async () => {
    await saveSessionVideo("s.dove", new Blob(["x"]), "c.mp4");
    await deleteSessionVideo("s.dove");
    expect(await hasSessionVideo("s.dove")).toBe(false);
  });
});
