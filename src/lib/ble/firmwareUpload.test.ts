import { describe, it, expect, vi, afterEach } from "vitest";
import { beginFirmwareUpdate, uploadFirmwareImage, applyFirmware } from "./firmwareUpload";
import { createMockConnection, flushMicrotasks, lastWritten } from "./__test__/mockBle";

const written = (c: { written: Uint8Array[] }) =>
  c.written.map((u) => new TextDecoder().decode(u));

describe("beginFirmwareUpdate — CRC handshake", () => {
  afterEach(() => vi.useRealTimers());

  it("sends FWBEGIN:<size>,<crc> and resolves when the echo matches", async () => {
    const conn = createMockConnection();
    const p = beginFirmwareUpdate(conn, 1234, "cbf43926");
    await flushMicrotasks();

    expect(lastWritten(conn.characteristics.fileRequest)).toBe("FWBEGIN:1234,cbf43926");
    conn.characteristics.fileStatus.simulate("FWCRC:cbf43926\n");
    await expect(p).resolves.toBeUndefined();
  });

  it("aborts when the echoed CRC does not match (control channel corrupted)", async () => {
    const conn = createMockConnection();
    const p = beginFirmwareUpdate(conn, 10, "cbf43926");
    await flushMicrotasks();
    conn.characteristics.fileStatus.simulate("FWCRC:deadbeef\n");
    await expect(p).rejects.toThrow(/control channel corrupted/);
  });

  it("rejects on FWERR", async () => {
    const conn = createMockConnection();
    const p = beginFirmwareUpdate(conn, 10, "cbf43926");
    await flushMicrotasks();
    conn.characteristics.fileStatus.simulate("FWERR:BUSY\n");
    await expect(p).rejects.toThrow(/BUSY/);
  });

  it("times out waiting for the echo", async () => {
    vi.useFakeTimers();
    const conn = createMockConnection();
    const p = beginFirmwareUpdate(conn, 10, "cbf43926", { timeoutMs: 1000 });
    await flushMicrotasks();
    vi.advanceTimersByTime(1000);
    await expect(p).rejects.toThrow(/Timed out/);
  });
});

describe("uploadFirmwareImage", () => {
  afterEach(() => vi.useRealTimers());

  function image(n: number) {
    const a = new Uint8Array(n);
    for (let i = 0; i < n; i++) a[i] = i & 0xff;
    return a;
  }

  it("sends FWPUT, streams chunks after FWREADY, and resolves on a matching FWOK", async () => {
    const conn = createMockConnection();
    const img = image(500);
    const progress: number[] = [];
    const p = uploadFirmwareImage(conn, img, "abcd1234", (x) => progress.push(x.sent), {
      chunkSize: 200,
      chunkDelayMs: 0,
    });
    await flushMicrotasks();

    expect(lastWritten(conn.characteristics.fileRequest)).toBe("FWPUT:500");

    conn.characteristics.fileStatus.simulate("FWREADY\n");
    await flushMicrotasks();

    const writes = written(conn.characteristics.fileRequest);
    expect(writes[writes.length - 1]).toBe("FWDONE");
    // 3 chunks (200/200/100) reconstruct the image.
    const chunks = conn.characteristics.fileRequest.written.slice(1, -1);
    const rebuilt = chunks.reduce<number[]>((acc, u) => acc.concat(Array.from(u)), []);
    expect(rebuilt).toEqual(Array.from(img));
    expect(progress.at(-1)).toBe(500);

    conn.characteristics.fileStatus.simulate("FWOK:abcd1234\n");
    await expect(p).resolves.toBeUndefined();
  });

  it("rejects when the device-stored CRC does not match", async () => {
    const conn = createMockConnection();
    const p = uploadFirmwareImage(conn, image(50), "abcd1234", undefined, {
      chunkSize: 240,
      chunkDelayMs: 0,
    });
    await flushMicrotasks();
    conn.characteristics.fileStatus.simulate("FWREADY\n");
    await flushMicrotasks();
    conn.characteristics.fileStatus.simulate("FWOK:0000ffff\n");
    await expect(p).rejects.toThrow(/stored CRC 0000ffff, expected abcd1234/);
  });

  it("rejects on FWERR during upload", async () => {
    const conn = createMockConnection();
    const p = uploadFirmwareImage(conn, image(50), "abcd1234", undefined, {
      chunkDelayMs: 0,
    });
    await flushMicrotasks();
    conn.characteristics.fileStatus.simulate("FWERR:WRITE_FAIL\n");
    await expect(p).rejects.toThrow(/WRITE_FAIL/);
  });
});

describe("applyFirmware", () => {
  afterEach(() => vi.useRealTimers());

  it("sends FWAPPLY, reports staging progress, and resolves on FWAPPLIED", async () => {
    const conn = createMockConnection();
    const progress: number[] = [];
    const p = applyFirmware(conn, (pct) => progress.push(pct));
    await flushMicrotasks();

    expect(lastWritten(conn.characteristics.fileRequest)).toBe("FWAPPLY");
    conn.characteristics.fileStatus.simulate("FWSTAGE:25\n");
    conn.characteristics.fileStatus.simulate("FWSTAGE:80\n");
    conn.characteristics.fileStatus.simulate("FWAPPLIED\n");

    await expect(p).resolves.toBeUndefined();
    expect(progress).toEqual([25, 80]);
  });

  it("rejects on FWERR during install", async () => {
    const conn = createMockConnection();
    const p = applyFirmware(conn);
    await flushMicrotasks();
    conn.characteristics.fileStatus.simulate("FWERR:FLASH_FAIL\n");
    await expect(p).rejects.toThrow(/FLASH_FAIL/);
  });
});
