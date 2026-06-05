/**
 * IndexedDB CRUD tests for fileStorage — raw log blobs + per-file metadata.
 *
 * Runs against fake-indexeddb (reset per test). The headline behavior is
 * `updateFileMetadata`'s read-merge-write: a partial patch must never clobber
 * untouched tags (track/course/kart/setup), which is the whole reason it exists.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { freshIndexedDB } from "./__test__/idb";
import {
  saveFile,
  getFile,
  listFiles,
  deleteFile,
  saveFileMetadata,
  getFileMetadata,
  updateFileMetadata,
  listAllMetadata,
  getStorageEstimate,
  type FileMetadata,
} from "./fileStorage";

beforeEach(() => freshIndexedDB());

// ─── Blob storage ───────────────────────────────────────────────────────────

describe("file blobs", () => {
  it("round-trips a saved blob by name", async () => {
    await saveFile("session.dove", new Blob(["timestamp,lat,lng"]));
    const blob = await getFile("session.dove");
    expect(blob).not.toBeNull();
    expect(await blob!.text()).toBe("timestamp,lat,lng");
  });

  it("returns null for a missing file", async () => {
    expect(await getFile("nope.dove")).toBeNull();
  });

  it("overwrites a file on re-save (keyed by name)", async () => {
    await saveFile("a.dove", new Blob(["v1"]));
    await saveFile("a.dove", new Blob(["v2"]));
    expect(await (await getFile("a.dove"))!.text()).toBe("v2");
    expect(await listFiles()).toHaveLength(1);
  });

  it("lists files newest-first with size + savedAt", async () => {
    await saveFile("old.dove", new Blob(["aaaa"]));
    await new Promise((r) => setTimeout(r, 2));
    await saveFile("new.dove", new Blob(["bb"]));
    const files = await listFiles();
    expect(files.map((f) => f.name)).toEqual(["new.dove", "old.dove"]);
    expect(files[0].size).toBe(2);
    expect(files[1].size).toBe(4);
  });

  it("deletes a file", async () => {
    await saveFile("gone.dove", new Blob(["x"]));
    await deleteFile("gone.dove");
    expect(await getFile("gone.dove")).toBeNull();
    expect(await listFiles()).toHaveLength(0);
  });
});

// ─── Metadata: save / get / list ────────────────────────────────────────────

describe("file metadata", () => {
  const base: FileMetadata = {
    fileName: "s.dove",
    trackName: "OKC",
    courseName: "CW",
  };

  it("saves and reads a metadata record", async () => {
    await saveFileMetadata(base);
    expect(await getFileMetadata("s.dove")).toMatchObject({ trackName: "OKC", courseName: "CW" });
  });

  it("returns null for missing metadata", async () => {
    expect(await getFileMetadata("missing")).toBeNull();
  });

  it("lists all metadata records", async () => {
    await saveFileMetadata(base);
    await saveFileMetadata({ ...base, fileName: "s2.dove", trackName: "BMP" });
    const all = await listAllMetadata();
    expect(all).toHaveLength(2);
    expect(all.map((m) => m.fileName).sort()).toEqual(["s.dove", "s2.dove"]);
  });
});

// ─── updateFileMetadata (read-merge-write) ──────────────────────────────────

describe("updateFileMetadata — partial merge", () => {
  it("creates a fresh record (defaulting track/course to empty) when none exists", async () => {
    const merged = await updateFileMetadata("new.dove", { fastestLapMs: 62000 });
    expect(merged).toMatchObject({
      fileName: "new.dove",
      trackName: "",
      courseName: "",
      fastestLapMs: 62000,
    });
  });

  it("preserves untouched tags when patching one field", async () => {
    await saveFileMetadata({
      fileName: "s.dove",
      trackName: "OKC",
      courseName: "CW",
      sessionKartId: "kart-1",
      sessionSetupId: "setup-1",
    });
    // Patch only the fastest lap — track/course/kart/setup must survive.
    const merged = await updateFileMetadata("s.dove", { fastestLapMs: 61000, fastestLapNumber: 4 });
    expect(merged).toMatchObject({
      trackName: "OKC",
      courseName: "CW",
      sessionKartId: "kart-1",
      sessionSetupId: "setup-1",
      fastestLapMs: 61000,
      fastestLapNumber: 4,
    });
    // And it's persisted, not just returned.
    expect(await getFileMetadata("s.dove")).toMatchObject({ sessionKartId: "kart-1", fastestLapMs: 61000 });
  });

  it("lets a patch override an existing field without dropping the rest", async () => {
    await saveFileMetadata({ fileName: "s.dove", trackName: "OKC", courseName: "CW", sessionEngine: "X30" });
    const merged = await updateFileMetadata("s.dove", { courseName: "Reverse" });
    expect(merged.courseName).toBe("Reverse");
    expect(merged.trackName).toBe("OKC");
    expect(merged.sessionEngine).toBe("X30");
  });
});

// ─── getStorageEstimate ─────────────────────────────────────────────────────

describe("getStorageEstimate", () => {
  it("returns null (or an estimate) without throwing when the API is absent", async () => {
    const est = await getStorageEstimate();
    expect(est === null || typeof est.used === "number").toBe(true);
  });
});
