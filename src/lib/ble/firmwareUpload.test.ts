import { describe, it, expect, vi, afterEach } from "vitest";
import { beginFirmwareUpdate, uploadFirmwareImage, applyFirmware } from "./firmwareUpload";
import { createMockConnection, flushMicrotasks, lastWritten } from "./__test__/mockBle";

const written = (c: { written: Uint8Array[] }) =>
  c.written.map((u) => new TextDecoder().decode(u));

describe("beginFirmwareUpdate — CRC handshake", () => {
  afterEach(() => vi.useRealTimers());

  it("sends FWBEGIN:<size>,<crc>,<variant> and resolves when the echo matches", async () => {
    const conn = createMockConnection();
    const p = beginFirmwareUpdate(conn, 1234, "cbf43926", "sense");
    await flushMicrotasks();

    expect(lastWritten(conn.characteristics.fileRequest)).toBe("FWBEGIN:1234,cbf43926,sense");
    conn.characteristics.fileStatus.simulate("FWCRC:cbf43926\n");
    await expect(p).resolves.toBeUndefined();
  });

  it("aborts when the echoed CRC does not match (control channel corrupted)", async () => {
    const conn = createMockConnection();
    const p = beginFirmwareUpdate(conn, 10, "cbf43926", "sense");
    await flushMicrotasks();
    conn.characteristics.fileStatus.simulate("FWCRC:deadbeef\n");
    await expect(p).rejects.toThrow(/control channel corrupted/);
  });

  it("rejects on FWERR (e.g. a variant mismatch at handshake)", async () => {
    const conn = createMockConnection();
    const p = beginFirmwareUpdate(conn, 10, "cbf43926", "nonsense");
    await flushMicrotasks();
    conn.characteristics.fileStatus.simulate("FWERR:VARIANT\n");
    await expect(p).rejects.toThrow(/VARIANT/);
  });

  it("times out waiting for the echo", async () => {
    vi.useFakeTimers();
    const conn = createMockConnection();
    const p = beginFirmwareUpdate(conn, 10, "cbf43926", "sense", { timeoutMs: 1000 });
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

  it("keeps a long upload alive (watchdog resets per chunk, no total-time cap)", async () => {
    const conn = createMockConnection();
    const img = image(1000); // 5 chunks at 200B
    const p = uploadFirmwareImage(conn, img, "abcd1234", undefined, {
      chunkSize: 200,
      chunkDelayMs: 120,
      timeoutMs: 400,
    });
    await flushMicrotasks();
    conn.characteristics.fileStatus.simulate("FWREADY\n");
    // ~600ms of upload (5×120ms) exceeds timeoutMs (400), but each inter-chunk
    // gap is < 400ms — the per-chunk watchdog must keep it alive (the old single
    // FWPUT timeout would have fired mid-upload).
    await new Promise((r) => setTimeout(r, 720));
    conn.characteristics.fileStatus.simulate("FWOK:abcd1234\n");
    await expect(p).resolves.toBeUndefined();
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

  it("resolves when the device disconnects after FWAPPLY (reset = apply)", async () => {
    const conn = createMockConnection();
    // Give the device an event target so we can fire gattserverdisconnected.
    const device = new EventTarget() as unknown as BluetoothDevice;
    conn.device = device;
    const p = applyFirmware(conn);
    await flushMicrotasks();

    expect(lastWritten(conn.characteristics.fileRequest)).toBe("FWAPPLY");
    // The device may reset (and reboot into the new firmware) without ever
    // delivering FWAPPLIED — the disconnect itself is the success signal.
    device.dispatchEvent(new Event("gattserverdisconnected"));
    await expect(p).resolves.toBeUndefined();
  });
});
