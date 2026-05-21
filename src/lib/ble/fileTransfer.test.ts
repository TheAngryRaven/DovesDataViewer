import { describe, it, expect, vi, afterEach } from "vitest";
import { requestFileList, downloadFile } from "./fileTransfer";
import { createMockConnection, flushMicrotasks, lastWritten } from "./__test__/mockBle";

afterEach(() => vi.useRealTimers());

// ─── LIST ────────────────────────────────────────────────────────────────────

describe("requestFileList — LIST protocol", () => {
  it("sends 'LIST' on fileRequest", async () => {
    const conn = createMockConnection();
    const promise = requestFileList(conn);
    await flushMicrotasks();

    expect(lastWritten(conn.characteristics.fileRequest)).toBe("LIST");

    conn.characteristics.fileList.simulate("END");
    await promise;
  });

  it("parses 'name:size|name:size|...' format on END (END as its own notification)", async () => {
    const conn = createMockConnection();
    const promise = requestFileList(conn);
    await flushMicrotasks();

    // Real device sends END as its own short notification (it's 3 bytes,
    // well under MTU). Data is accumulated across earlier notifications.
    conn.characteristics.fileList.simulate("LOG_001.dove:1024|LOG_002.dove:2048|");
    conn.characteristics.fileList.simulate("END");

    await expect(promise).resolves.toEqual([
      { name: "LOG_001.dove", size: 1024 },
      { name: "LOG_002.dove", size: 2048 },
    ]);
  });

  it("filters out SETTINGS.JSON from the returned list", async () => {
    const conn = createMockConnection();
    const promise = requestFileList(conn);
    await flushMicrotasks();

    conn.characteristics.fileList.simulate("LOG_001.dove:100|SETTINGS.json:50|LOG_002.dove:200|");
    conn.characteristics.fileList.simulate("END");

    await expect(promise).resolves.toEqual([
      { name: "LOG_001.dove", size: 100 },
      { name: "LOG_002.dove", size: 200 },
    ]);
  });

  it("accumulates list across multiple chunked notifications (small BLE MTU)", async () => {
    const conn = createMockConnection();
    const promise = requestFileList(conn);
    await flushMicrotasks();

    // Simulate the small MTU case — entries split across notifications.
    // END still arrives as its own notification.
    conn.characteristics.fileList.simulate("LOG_001.dove:1024|LOG_");
    conn.characteristics.fileList.simulate("002.dove:2048|LOG_003.dove:");
    conn.characteristics.fileList.simulate("4096|");
    conn.characteristics.fileList.simulate("END");

    await expect(promise).resolves.toEqual([
      { name: "LOG_001.dove", size: 1024 },
      { name: "LOG_002.dove", size: 2048 },
      { name: "LOG_003.dove", size: 4096 },
    ]);
  });

  it("BUG (documented): drops data if END arrives batched in the same notification", async () => {
    // The current protocol detects END via `chunk.includes("END")`, then parses
    // the PREVIOUSLY-accumulated `fileListBuffer` — without first appending the
    // current chunk. If the device ever batches "data|END" into one
    // notification (it doesn't today; END is its own 3-byte packet), the data
    // portion of that final chunk is lost.
    //
    // Fix would be: always accumulate first, then check for END, and strip
    // trailing |END from the assembled buffer.
    const conn = createMockConnection();
    const promise = requestFileList(conn);
    await flushMicrotasks();

    conn.characteristics.fileList.simulate("LOG_FIRST.dove:100|");
    conn.characteristics.fileList.simulate("LOG_LOST.dove:200|END");

    // Current (buggy) behavior: only the first chunk's data is parsed.
    // LOG_LOST.dove is silently dropped.
    await expect(promise).resolves.toEqual([
      { name: "LOG_FIRST.dove", size: 100 },
    ]);
  });

  it("resolves with [] for an empty file list (just 'END')", async () => {
    const conn = createMockConnection();
    const promise = requestFileList(conn);
    await flushMicrotasks();

    conn.characteristics.fileList.simulate("END");

    await expect(promise).resolves.toEqual([]);
  });

  it("safety-resolves after 2s of silence (no END marker)", async () => {
    vi.useFakeTimers();
    const conn = createMockConnection();
    const promise = requestFileList(conn);
    await flushMicrotasks();

    // Device sends partial data then goes silent — protocol waits 2s then
    // resolves with what it has
    conn.characteristics.fileList.simulate("LOG_A.dove:50|");
    vi.advanceTimersByTime(2000);

    await expect(promise).resolves.toEqual([{ name: "LOG_A.dove", size: 50 }]);
  });

  it("rejects with timeout if no response in 10s", async () => {
    vi.useFakeTimers();
    const conn = createMockConnection();
    const promise = requestFileList(conn);
    await flushMicrotasks();

    vi.advanceTimersByTime(10000);

    await expect(promise).rejects.toThrow(/Timeout/);
  });
});

// ─── GET ─────────────────────────────────────────────────────────────────────

describe("downloadFile — GET protocol", () => {
  it("sends 'GET:<filename>' on fileRequest", async () => {
    const conn = createMockConnection();
    const promise = downloadFile(conn, "LOG_001.dove");
    await flushMicrotasks();

    expect(lastWritten(conn.characteristics.fileRequest)).toBe("GET:LOG_001.dove");

    conn.characteristics.fileStatus.simulate("SIZE:0");
    conn.characteristics.fileStatus.simulate("DONE");
    await promise;
  });

  it("subscribes to both fileData (chunks) and fileStatus (control) notifications", async () => {
    const conn = createMockConnection();
    const promise = downloadFile(conn, "x.dove");
    await flushMicrotasks();

    expect(conn.characteristics.fileData.notificationsStarted).toBe(true);
    expect(conn.characteristics.fileStatus.notificationsStarted).toBe(true);

    conn.characteristics.fileStatus.simulate("SIZE:0");
    conn.characteristics.fileStatus.simulate("DONE");
    await promise;
  });

  it("resolves with concatenated file bytes on DONE", async () => {
    const conn = createMockConnection();
    const promise = downloadFile(conn, "hello.dove");
    await flushMicrotasks();

    conn.characteristics.fileStatus.simulate("SIZE:5");
    conn.characteristics.fileData.simulate(new Uint8Array([0x68, 0x65, 0x6c])); // "hel"
    conn.characteristics.fileData.simulate(new Uint8Array([0x6c, 0x6f])); // "lo"
    conn.characteristics.fileStatus.simulate("DONE");

    const result = await promise;
    expect(new TextDecoder().decode(result)).toBe("hello");
  });

  it("handles SIZE arriving as a separate notification from the first data chunk", async () => {
    const conn = createMockConnection();
    const promise = downloadFile(conn, "f");
    await flushMicrotasks();

    conn.characteristics.fileStatus.simulate("SIZE:4");
    conn.characteristics.fileData.simulate(new Uint8Array([1, 2, 3, 4]));
    conn.characteristics.fileStatus.simulate("DONE");

    const result = await promise;
    expect(Array.from(result)).toEqual([1, 2, 3, 4]);
  });

  it("rejects on ERROR status (e.g., device can't open the file)", async () => {
    const conn = createMockConnection();
    const promise = downloadFile(conn, "missing.dove");
    await flushMicrotasks();

    conn.characteristics.fileStatus.simulate("ERROR");

    await expect(promise).rejects.toThrow(/Error opening file/);
  });

  it("rejects with timeout after 5 minutes if transfer never completes", async () => {
    vi.useFakeTimers();
    const conn = createMockConnection();
    const promise = downloadFile(conn, "stalled.dove");
    await flushMicrotasks();

    conn.characteristics.fileStatus.simulate("SIZE:1000000");
    vi.advanceTimersByTime(300_000);

    await expect(promise).rejects.toThrow(/Download timeout/);
  });

  it("calls onProgress with received/total/percent as chunks arrive", async () => {
    const conn = createMockConnection();
    const onProgress = vi.fn();
    const promise = downloadFile(conn, "f.dove", onProgress);
    await flushMicrotasks();

    conn.characteristics.fileStatus.simulate("SIZE:10");
    conn.characteristics.fileData.simulate(new Uint8Array([1, 2, 3, 4, 5]));

    // Yield to rAF macrotask
    await new Promise((r) => setTimeout(r, 5));

    expect(onProgress).toHaveBeenCalled();
    const call = onProgress.mock.calls.at(-1)![0];
    expect(call.received).toBe(5);
    expect(call.total).toBe(10);
    expect(call.percent).toBe(50);

    conn.characteristics.fileData.simulate(new Uint8Array([6, 7, 8, 9, 10]));
    conn.characteristics.fileStatus.simulate("DONE");
    await promise;
  });

  it("calls onStatusChange at key transitions", async () => {
    const conn = createMockConnection();
    const onStatus = vi.fn();
    const promise = downloadFile(conn, "f.dove", undefined, onStatus);
    await flushMicrotasks();

    // Initial "Requesting" status fires before the await
    expect(onStatus).toHaveBeenCalledWith(expect.stringMatching(/Requesting/));

    onStatus.mockClear();
    conn.characteristics.fileStatus.simulate("SIZE:0");
    expect(onStatus).toHaveBeenCalledWith(expect.stringMatching(/Receiving f\.dove/));

    conn.characteristics.fileStatus.simulate("DONE");
    await promise;
  });

  it("does not corrupt data when chunks reuse the underlying ArrayBuffer", async () => {
    // Real Web Bluetooth reuses the DataView's underlying buffer across
    // notifications, so the protocol must COPY each chunk on receipt.
    // We mimic that contract here: send a Uint8Array, mutate it after,
    // verify the result still has the original bytes.
    const conn = createMockConnection();
    const promise = downloadFile(conn, "buf.dove");
    await flushMicrotasks();

    conn.characteristics.fileStatus.simulate("SIZE:3");
    const reused = new Uint8Array([10, 20, 30]);
    conn.characteristics.fileData.simulate(reused);
    // Mutate the source — the protocol should have copied already
    reused[0] = 99;
    reused[1] = 99;
    reused[2] = 99;
    conn.characteristics.fileStatus.simulate("DONE");

    const result = await promise;
    expect(Array.from(result)).toEqual([10, 20, 30]);
  });
});
