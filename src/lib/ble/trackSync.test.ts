import { describe, it, expect, vi, afterEach } from "vitest";
import {
  requestTrackFileList,
  downloadTrackFile,
  uploadTrackFile,
  deleteTrackFile,
} from "./trackSync";
import { createMockConnection, flushMicrotasks, lastWritten, writeCount } from "./__test__/mockBle";

afterEach(() => vi.useRealTimers());

// ─── TLIST ───────────────────────────────────────────────────────────────────

describe("requestTrackFileList — TLIST protocol", () => {
  it("sends 'TLIST' and resolves with filenames on TEND", async () => {
    const conn = createMockConnection();
    const promise = requestTrackFileList(conn);
    await flushMicrotasks();

    expect(lastWritten(conn.characteristics.fileRequest)).toBe("TLIST");

    conn.characteristics.fileStatus.simulate("TFILE:OKC.json\nTFILE:TEST.json\nTEND\n");

    await expect(promise).resolves.toEqual(["OKC.json", "TEST.json"]);
  });

  it("resolves with [] when device has no track files (just TEND)", async () => {
    const conn = createMockConnection();
    const promise = requestTrackFileList(conn);
    await flushMicrotasks();

    conn.characteristics.fileStatus.simulate("TEND\n");

    await expect(promise).resolves.toEqual([]);
  });

  it("accumulates TFILE entries across multiple notifications", async () => {
    const conn = createMockConnection();
    const promise = requestTrackFileList(conn);
    await flushMicrotasks();

    conn.characteristics.fileStatus.simulate("TFILE:a.json\n");
    conn.characteristics.fileStatus.simulate("TFILE:b.json\nTFILE:c.json\n");
    conn.characteristics.fileStatus.simulate("TEND\n");

    await expect(promise).resolves.toEqual(["a.json", "b.json", "c.json"]);
  });

  it("safety-resolves with collected entries after 3s of silence (no TEND)", async () => {
    vi.useFakeTimers();
    const conn = createMockConnection();
    const promise = requestTrackFileList(conn);
    await flushMicrotasks();

    conn.characteristics.fileStatus.simulate("TFILE:OKC.json\n");
    vi.advanceTimersByTime(3000);

    await expect(promise).resolves.toEqual(["OKC.json"]);
  });

  it("rejects with timeout if no response in 10s", async () => {
    vi.useFakeTimers();
    const conn = createMockConnection();
    const promise = requestTrackFileList(conn);
    await flushMicrotasks();

    vi.advanceTimersByTime(10000);

    await expect(promise).rejects.toThrow(/Timeout/);
  });
});

// ─── TGET ────────────────────────────────────────────────────────────────────

describe("downloadTrackFile — TGET protocol", () => {
  it("sends 'TGET:<name>' and resolves with concatenated file bytes on DONE", async () => {
    const conn = createMockConnection();
    const promise = downloadTrackFile(conn, "OKC.json");
    await flushMicrotasks();

    expect(lastWritten(conn.characteristics.fileRequest)).toBe("TGET:OKC.json");

    // Device protocol: SIZE on fileStatus → bytes on fileData → DONE on fileStatus
    conn.characteristics.fileStatus.simulate("SIZE:11\n");
    conn.characteristics.fileData.simulate(new Uint8Array([104, 101, 108, 108, 111])); // "hello"
    conn.characteristics.fileData.simulate(new Uint8Array([45, 119, 111, 114, 108, 100])); // "-world"
    conn.characteristics.fileStatus.simulate("DONE\n");

    const result = await promise;
    expect(new TextDecoder().decode(result)).toBe("hello-world");
  });

  it("handles SIZE arriving in the same notification as the first DONE check", async () => {
    const conn = createMockConnection();
    const promise = downloadTrackFile(conn, "x.json");
    await flushMicrotasks();

    conn.characteristics.fileStatus.simulate("SIZE:3\n");
    conn.characteristics.fileData.simulate(new Uint8Array([65, 66, 67]));
    conn.characteristics.fileStatus.simulate("DONE\n");

    const result = await promise;
    expect(Array.from(result)).toEqual([65, 66, 67]);
  });

  it("rejects on TERR:<reason> with the error message", async () => {
    const conn = createMockConnection();
    const promise = downloadTrackFile(conn, "missing.json");
    await flushMicrotasks();

    conn.characteristics.fileStatus.simulate("TERR:FILE_NOT_FOUND\n");

    await expect(promise).rejects.toThrow("FILE_NOT_FOUND");
  });

  it("rejects on generic ERROR line", async () => {
    const conn = createMockConnection();
    const promise = downloadTrackFile(conn, "broken.json");
    await flushMicrotasks();

    conn.characteristics.fileStatus.simulate("ERROR\n");

    await expect(promise).rejects.toThrow(/Error downloading track file/);
  });

  it("rejects with timeout after 60s if the transfer never completes", async () => {
    vi.useFakeTimers();
    const conn = createMockConnection();
    const promise = downloadTrackFile(conn, "stalled.json");
    await flushMicrotasks();

    conn.characteristics.fileStatus.simulate("SIZE:1000\n");
    // No data ever arrives
    vi.advanceTimersByTime(60000);

    await expect(promise).rejects.toThrow(/timeout/i);
  });

  it("invokes the progress callback when chunks arrive", async () => {
    // Progress is throttled via requestAnimationFrame (polyfilled to
    // setTimeout(0) in vitest.setup.ts). Run with real timers and let the
    // macrotask queue drain naturally.
    const conn = createMockConnection();
    const onProgress = vi.fn();
    const promise = downloadTrackFile(conn, "f.json", onProgress);
    await flushMicrotasks();

    conn.characteristics.fileStatus.simulate("SIZE:6\n");
    conn.characteristics.fileData.simulate(new Uint8Array([1, 2, 3]));

    // Yield to the macrotask queue so the rAF callback runs
    await new Promise((r) => setTimeout(r, 5));
    expect(onProgress).toHaveBeenCalled();
    const lastProgressCall = onProgress.mock.calls.at(-1)![0];
    expect(lastProgressCall.received).toBe(3);
    expect(lastProgressCall.total).toBe(6);
    expect(lastProgressCall.percent).toBe(50);

    conn.characteristics.fileData.simulate(new Uint8Array([4, 5, 6]));
    conn.characteristics.fileStatus.simulate("DONE\n");
    await promise;
  });
});

// ─── TPUT ────────────────────────────────────────────────────────────────────

describe("uploadTrackFile — TPUT protocol", () => {
  it("sends 'TPUT:<name>' first, waits for TREADY, then sends chunks + TDONE, resolves on TOK", async () => {
    const conn = createMockConnection();
    const data = new Uint8Array(Array.from({ length: 100 }, (_, i) => i));
    const promise = uploadTrackFile(conn, "new.json", data);
    await flushMicrotasks();

    // Phase 1: TPUT command sent, awaiting TREADY
    expect(lastWritten(conn.characteristics.fileRequest)).toBe("TPUT:new.json");
    const writesBeforeReady = writeCount(conn.characteristics.fileRequest);
    expect(writesBeforeReady).toBe(1);

    // Phase 2: send TREADY → protocol starts uploading 64-byte chunks
    conn.characteristics.fileStatus.simulate("TREADY\n");
    // The protocol's sendChunks() runs async with 10ms inter-chunk delay; let
    // it complete. 100 bytes / 64 = 2 chunks + TDONE = 3 more writes.
    await vi.waitFor(
      () => expect(writeCount(conn.characteristics.fileRequest)).toBe(1 + 2 + 1),
      { timeout: 1000 },
    );

    // Final write should be 'TDONE'
    expect(lastWritten(conn.characteristics.fileRequest)).toBe("TDONE");

    // Phase 3: device acknowledges with TOK → resolves
    conn.characteristics.fileStatus.simulate("TOK\n");
    await expect(promise).resolves.toBeUndefined();
  });

  it("rejects on TERR before TREADY (device refuses to accept upload)", async () => {
    const conn = createMockConnection();
    const promise = uploadTrackFile(conn, "bad.json", new Uint8Array([1, 2, 3]));
    await flushMicrotasks();

    conn.characteristics.fileStatus.simulate("TERR:DISK_FULL\n");

    await expect(promise).rejects.toThrow("DISK_FULL");
  });

  it("rejects on TERR after TREADY (device errors mid-upload)", async () => {
    const conn = createMockConnection();
    const promise = uploadTrackFile(conn, "x.json", new Uint8Array([1, 2]));
    await flushMicrotasks();

    conn.characteristics.fileStatus.simulate("TREADY\n");
    // Wait for sendChunks to complete and send TDONE
    await vi.waitFor(() => expect(lastWritten(conn.characteristics.fileRequest)).toBe("TDONE"));

    conn.characteristics.fileStatus.simulate("TERR:WRITE_FAILED\n");

    await expect(promise).rejects.toThrow("WRITE_FAILED");
  });

  it("rejects with timeout if TREADY never arrives (10s)", async () => {
    vi.useFakeTimers();
    const conn = createMockConnection();
    const promise = uploadTrackFile(conn, "ghosted.json", new Uint8Array([1]));
    await flushMicrotasks();

    vi.advanceTimersByTime(10000);

    await expect(promise).rejects.toThrow(/Timeout/);
  });
});

// ─── TDEL ────────────────────────────────────────────────────────────────────

describe("deleteTrackFile — TDEL protocol", () => {
  it("sends 'TDEL:<name>' and resolves on TOK", async () => {
    const conn = createMockConnection();
    const promise = deleteTrackFile(conn, "old.json");
    await flushMicrotasks();

    expect(lastWritten(conn.characteristics.fileRequest)).toBe("TDEL:old.json");

    conn.characteristics.fileStatus.simulate("TOK\n");

    await expect(promise).resolves.toBeUndefined();
  });

  it("rejects on TERR with the error message", async () => {
    const conn = createMockConnection();
    const promise = deleteTrackFile(conn, "locked.json");
    await flushMicrotasks();

    conn.characteristics.fileStatus.simulate("TERR:READ_ONLY\n");

    await expect(promise).rejects.toThrow("READ_ONLY");
  });

  it("rejects with timeout after 10s of no response", async () => {
    vi.useFakeTimers();
    const conn = createMockConnection();
    const promise = deleteTrackFile(conn, "x.json");
    await flushMicrotasks();

    vi.advanceTimersByTime(10000);

    await expect(promise).rejects.toThrow(/Timeout/);
  });
});
