/**
 * Tests for the bundled-sample seeding. The sample is treated as an ordinary
 * file: ensureSampleFile must fetch + persist the blob once and (idempotently)
 * tag it with the sample track/course, fixed display name, and isSample flag —
 * without clobbering metadata a later auto-detect adds (start time, fastest lap).
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { freshIndexedDB } from "./__test__/idb";
import {
  ensureSampleFile,
  isSampleFileName,
  SAMPLE_FILE_NAME,
  SAMPLE_DISPLAY_NAME,
} from "./sampleData";
import { getFile, getFileMetadata, updateFileMetadata } from "./fileStorage";

beforeEach(() => freshIndexedDB());
afterEach(() => vi.restoreAllMocks());

describe("isSampleFileName", () => {
  it("matches the sample log name and nothing else", () => {
    expect(isSampleFileName(SAMPLE_FILE_NAME)).toBe(true);
    expect(isSampleFileName("some-other.dovex")).toBe(false);
  });
});

describe("ensureSampleFile", () => {
  it("fetches and persists the blob + sample metadata on first run", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["sample-bytes"]),
    });
    vi.stubGlobal("fetch", fetchMock);

    const blob = await ensureSampleFile();
    expect(blob).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Persisted as a real file.
    const stored = await getFile(SAMPLE_FILE_NAME);
    expect(stored).not.toBeNull();

    // Tagged so the browser groups + labels it like the sample.
    const meta = await getFileMetadata(SAMPLE_FILE_NAME);
    expect(meta?.isSample).toBe(true);
    expect(meta?.displayName).toBe(SAMPLE_DISPLAY_NAME);
    expect(meta?.trackName).toBe("Orlando Kart Center");
    expect(meta?.courseName).toBe("Normal");
  });

  it("does not re-fetch when the blob already exists", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["sample-bytes"]),
    });
    vi.stubGlobal("fetch", fetchMock);

    await ensureSampleFile();
    await ensureSampleFile();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves auto-detect fields added after seeding", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["sample-bytes"]),
    }));

    await ensureSampleFile();
    // Simulate the normal load path tagging start time + fastest lap.
    await updateFileMetadata(SAMPLE_FILE_NAME, {
      sessionStartTime: 12345,
      fastestLapMs: 55604,
      fastestLapNumber: 11,
    });

    // Re-seeding must not wipe those out, nor the sample tags.
    await ensureSampleFile();
    const meta = await getFileMetadata(SAMPLE_FILE_NAME);
    expect(meta?.sessionStartTime).toBe(12345);
    expect(meta?.fastestLapMs).toBe(55604);
    expect(meta?.isSample).toBe(true);
    expect(meta?.displayName).toBe(SAMPLE_DISPLAY_NAME);
  });

  it("returns null and seeds nothing when the fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const blob = await ensureSampleFile();
    expect(blob).toBeNull();
    expect(await getFile(SAMPLE_FILE_NAME)).toBeNull();
  });
});
