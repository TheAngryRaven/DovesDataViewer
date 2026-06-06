/// <reference types="web-bluetooth" />
import { describe, it, expect, vi, afterEach } from "vitest";
import { flashFirmware, type DfuTransport } from "./dfuProtocol";
import type { DfuPackage, DfuProgress } from "./dfuTypes";
import { createMockCharacteristic, flushMicrotasks } from "../__test__/mockBle";

/** Control-point response/receipt frame helpers. */
const response = (op: number, status = 0x01) => new Uint8Array([0x10, op, status]);
const receipt = () => new Uint8Array([0x11, 0, 0, 0, 0]);

function makePackage(imageLen: number): DfuPackage {
  const image = new Uint8Array(imageLen);
  for (let i = 0; i < imageLen; i++) image[i] = i & 0xff;
  return {
    image,
    initPacket: new Uint8Array(14).fill(3),
    meta: {
      binFile: "app.bin",
      datFile: "app.dat",
      dfuVersion: 0.5,
    },
  };
}

function setup() {
  const controlPoint = createMockCharacteristic();
  const packet = createMockCharacteristic();
  const transport: DfuTransport = { controlPoint, packet };
  const written = (c: typeof controlPoint) => c.written.map((u) => Array.from(u));
  return { controlPoint, packet, transport, written };
}

describe("flashFirmware — legacy DFU transfer", () => {
  afterEach(() => vi.useRealTimers());

  it("runs the full sequence and reconstructs the image (with PRN)", async () => {
    const { controlPoint, packet, transport, written } = setup();
    const pkg = makePackage(50); // 3 chunks at size 20 (20/20/10)
    const progress: DfuProgress[] = [];

    const p = flashFirmware(transport, pkg, {
      chunkSize: 20,
      prn: 2,
      onProgress: (x) => progress.push(x),
    });
    await flushMicrotasks();

    // FIFO-queue every expected control-point notification; the state machine
    // consumes them in exactly this order.
    controlPoint.simulate(response(0x01)); // Start
    controlPoint.simulate(response(0x02)); // InitParams
    controlPoint.simulate(receipt()); // after 2 packets
    controlPoint.simulate(response(0x03)); // ReceiveFirmware
    controlPoint.simulate(response(0x04)); // Validate
    await p;

    // Control-point op-code sequence.
    expect(written(controlPoint)).toEqual([
      [0x01, 0x04], // Start, Application
      [0x02, 0x00], // InitParams, Receive
      [0x02, 0x01], // InitParams, Complete
      [0x08, 0x02, 0x00], // PacketReceiptRequest, prn=2
      [0x03], // ReceiveFirmware
      [0x04], // Validate
      [0x05], // ActivateAndReset
    ]);

    // Packet writes: 12-byte size header, 14-byte init packet, then the image.
    expect(Array.from(packet.written[0])).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 50, 0, 0, 0]);
    expect(Array.from(packet.written[1])).toEqual(Array.from(pkg.initPacket));
    const streamed = packet.written.slice(2).reduce<number[]>(
      (acc, u) => acc.concat(Array.from(u)),
      [],
    );
    expect(streamed).toEqual(Array.from(pkg.image));

    // Progress ends at 100% / done.
    const last = progress.at(-1)!;
    expect(last.phase).toBe("done");
    expect(last.percent).toBe(100);
    expect(last.bytesSent).toBe(50);
  });

  it("omits the PRN request and receipts when prn=0", async () => {
    const { controlPoint, transport, written } = setup();
    const p = flashFirmware(transport, makePackage(30), { chunkSize: 20, prn: 0 });
    await flushMicrotasks();

    controlPoint.simulate(response(0x01));
    controlPoint.simulate(response(0x02));
    controlPoint.simulate(response(0x03));
    controlPoint.simulate(response(0x04));
    await p;

    expect(written(controlPoint)).toEqual([
      [0x01, 0x04],
      [0x02, 0x00],
      [0x02, 0x01],
      [0x03],
      [0x04],
      [0x05],
    ]);
  });

  it("rejects with a friendly message on an error status", async () => {
    const { controlPoint, transport } = setup();
    const p = flashFirmware(transport, makePackage(20), { chunkSize: 20, prn: 0 });
    await flushMicrotasks();

    controlPoint.simulate(response(0x01, 0x05)); // CRC error on Start
    await expect(p).rejects.toThrow(/CRC error/);
  });

  it("rejects when a notification is for an unexpected op-code", async () => {
    const { controlPoint, transport } = setup();
    const p = flashFirmware(transport, makePackage(20), { chunkSize: 20, prn: 0 });
    await flushMicrotasks();

    controlPoint.simulate(response(0x02)); // expected Start (0x01)
    await expect(p).rejects.toThrow(/expected 0x1/);
  });

  it("aborts via an AbortSignal", async () => {
    const { controlPoint, transport } = setup();
    const ac = new AbortController();
    const p = flashFirmware(transport, makePackage(20), { signal: ac.signal });
    await flushMicrotasks();

    // Sitting on the first response wait; abort should reject.
    ac.abort();
    await expect(p).rejects.toThrow(/aborted/);
    void controlPoint; // (kept for symmetry / debugging)
  });

  it("times out waiting for a response", async () => {
    vi.useFakeTimers();
    const { transport } = setup();
    const p = flashFirmware(transport, makePackage(20), { responseTimeoutMs: 1000 });
    await flushMicrotasks();

    vi.advanceTimersByTime(1000);
    await expect(p).rejects.toThrow(/Timed out/);
  });
});
