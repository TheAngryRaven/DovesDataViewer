/// <reference types="web-bluetooth" />

/**
 * Legacy (SDK-11-era) Nordic DFU transfer state machine over Web Bluetooth.
 *
 * Drives the Adafruit nRF52 bootloader's DFU service: control-point op-codes +
 * a write-no-response packet characteristic. The transfer is sequential and
 * flow-controlled by packet-receipt notifications (PRN). Written against a
 * minimal {@link DfuTransport} so it's unit-testable with a mocked CP/Packet
 * pair (see `dfuProtocol.test.ts`).
 *
 * Sequence (application image):
 *   1. CP  ← [Start, Application]
 *   2. PKT ← [sd=0, bl=0, app=len]   (12 bytes LE)   → await Response(Start)
 *   3. CP  ← [InitParams, Receive] ; PKT ← init packet ; CP ← [InitParams, Complete]
 *                                                       → await Response(InitParams)
 *   4. CP  ← [PacketReceiptRequest, prn]              (skip if prn=0)
 *   5. CP  ← [ReceiveFirmware] ; stream image, await a receipt every `prn`
 *                                                       → await Response(ReceiveFirmware)
 *   6. CP  ← [Validate]                                → await Response(Validate)
 *   7. CP  ← [ActivateAndReset]   (device reboots; no response)
 */

import {
  DfuImageType,
  DfuInitParam,
  DfuOpCode,
  DfuResponseStatus,
  type DfuPackage,
  type DfuProgress,
} from "./dfuTypes";

/** Minimal characteristic pair the DFU transfer drives. */
export interface DfuTransport {
  /** DFU control point (write op-codes, notify responses/receipts). */
  controlPoint: BluetoothRemoteGATTCharacteristic;
  /** DFU packet (write-without-response: sizes, init packet, firmware). */
  packet: BluetoothRemoteGATTCharacteristic;
}

export interface FlashFirmwareOptions {
  onProgress?: (progress: DfuProgress) => void;
  /** Bytes per firmware packet write. Default 20 (safe min-MTU payload). */
  chunkSize?: number;
  /** Packet-receipt-notification interval, in packets. 0 disables. Default 8. */
  prn?: number;
  /** Per-step control-point response timeout (ms). Default 10000. */
  responseTimeoutMs?: number;
  /** Abort the flash (best-effort; safe — the bootloader stays flashable). */
  signal?: AbortSignal;
}

const DEFAULT_CHUNK_SIZE = 20;
const DEFAULT_PRN = 8;
const DEFAULT_RESPONSE_TIMEOUT_MS = 10_000;

/** Human-readable text for a legacy DFU response status byte. */
function statusMessage(status: number): string {
  switch (status) {
    case DfuResponseStatus.Success:
      return "success";
    case DfuResponseStatus.InvalidState:
      return "invalid state";
    case DfuResponseStatus.NotSupported:
      return "operation not supported";
    case DfuResponseStatus.DataSizeExceedsLimit:
      return "data size exceeds limit";
    case DfuResponseStatus.CrcError:
      return "CRC error";
    case DfuResponseStatus.OperationFailed:
      return "operation failed";
    default:
      return `unknown status 0x${status.toString(16)}`;
  }
}

/** Serialize an unsigned 32-bit little-endian value. */
function u32le(value: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, value >>> 0, true);
  return buf;
}

/** Build the 12-byte image-size packet: [softdevice=0, bootloader=0, app=len]. */
function buildSizePacket(appLength: number): Uint8Array {
  const out = new Uint8Array(12);
  out.set(u32le(0), 0);
  out.set(u32le(0), 4);
  out.set(u32le(appLength), 8);
  return out;
}

/**
 * FIFO reader for control-point notifications. The transfer is strictly
 * sequential, so a single in-flight waiter is sufficient; anything that arrives
 * while no one is waiting is queued.
 */
class ControlPointReader {
  private readonly queue: Uint8Array[] = [];
  private resolver: ((value: Uint8Array) => void) | null = null;

  constructor(private readonly char: BluetoothRemoteGATTCharacteristic) {}

  private readonly listener = (event: Event) => {
    const target = event.target as BluetoothRemoteGATTCharacteristic;
    const dv = target.value;
    if (!dv) return;
    // Copy out of the (reused) notification buffer.
    const bytes = new Uint8Array(dv.byteLength);
    bytes.set(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength));
    if (this.resolver) {
      const resolve = this.resolver;
      this.resolver = null;
      resolve(bytes);
    } else {
      this.queue.push(bytes);
    }
  };

  async start(): Promise<void> {
    await this.char.startNotifications();
    this.char.addEventListener("characteristicvaluechanged", this.listener);
  }

  stop(): void {
    this.char.removeEventListener("characteristicvaluechanged", this.listener);
  }

  next(timeoutMs: number, signal?: AbortSignal): Promise<Uint8Array> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise<Uint8Array>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.resolver = null;
        signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        cleanup();
        reject(new Error("Firmware update aborted"));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for a DFU response"));
      }, timeoutMs);
      this.resolver = (value) => {
        cleanup();
        resolve(value);
      };
      if (signal) {
        if (signal.aborted) return onAbort();
        signal.addEventListener("abort", onAbort);
      }
    });
  }
}

/** Write to the packet characteristic (prefer write-without-response). */
async function writePacket(
  char: BluetoothRemoteGATTCharacteristic,
  data: Uint8Array,
): Promise<void> {
  const c = char as BluetoothRemoteGATTCharacteristic & {
    writeValueWithoutResponse?: (d: BufferSource) => Promise<void>;
  };
  if (typeof c.writeValueWithoutResponse === "function") {
    await c.writeValueWithoutResponse(data);
  } else {
    await c.writeValue(data);
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Firmware update aborted");
}

/**
 * Flash an application image to a device already in DFU/bootloader mode.
 * Resolves once the activate-and-reset command is sent (the device reboots).
 */
export async function flashFirmware(
  transport: DfuTransport,
  pkg: DfuPackage,
  options: FlashFirmwareOptions = {},
): Promise<void> {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const prn = options.prn ?? DEFAULT_PRN;
  const timeout = options.responseTimeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS;
  const { signal, onProgress } = options;
  const { controlPoint, packet } = transport;
  const { image, initPacket } = pkg;
  const total = image.byteLength;

  const reader = new ControlPointReader(controlPoint);

  const emit = (phase: DfuProgress["phase"], bytesSent: number) => {
    onProgress?.({
      phase,
      bytesSent,
      totalBytes: total,
      percent: total > 0 ? Math.round((bytesSent / total) * 100) : 0,
    });
  };

  const expectResponse = async (op: DfuOpCode): Promise<void> => {
    const res = await reader.next(timeout, signal);
    if (res[0] !== DfuOpCode.Response) {
      throw new Error(
        `Unexpected DFU notification 0x${(res[0] ?? 0).toString(16)} (expected a response)`,
      );
    }
    if (res[1] !== op) {
      throw new Error(
        `DFU response for op 0x${(res[1] ?? 0).toString(16)} (expected 0x${op.toString(16)})`,
      );
    }
    if (res[2] !== DfuResponseStatus.Success) {
      throw new Error(`DFU ${DfuOpCode[op]} failed: ${statusMessage(res[2] ?? 0)}`);
    }
  };

  try {
    await reader.start();
    throwIfAborted(signal);

    // 1–2. Start DFU (application) + image sizes.
    emit("starting", 0);
    await controlPoint.writeValue(
      new Uint8Array([DfuOpCode.Start, DfuImageType.Application]),
    );
    await writePacket(packet, buildSizePacket(total));
    await expectResponse(DfuOpCode.Start);

    // 3. Init packet.
    emit("init", 0);
    await controlPoint.writeValue(
      new Uint8Array([DfuOpCode.InitParams, DfuInitParam.ReceiveInitPacket]),
    );
    await writePacket(packet, initPacket);
    await controlPoint.writeValue(
      new Uint8Array([DfuOpCode.InitParams, DfuInitParam.InitPacketComplete]),
    );
    await expectResponse(DfuOpCode.InitParams);

    // 4. Configure packet-receipt notifications (flow control).
    if (prn > 0) {
      await controlPoint.writeValue(
        new Uint8Array([DfuOpCode.PacketReceiptRequest, prn & 0xff, (prn >> 8) & 0xff]),
      );
    }

    // 5. Stream the firmware image.
    emit("transferring", 0);
    await controlPoint.writeValue(new Uint8Array([DfuOpCode.ReceiveFirmware]));

    let sent = 0;
    let packetsSinceReceipt = 0;
    for (let offset = 0; offset < total; offset += chunkSize) {
      throwIfAborted(signal);
      await writePacket(packet, image.subarray(offset, offset + chunkSize));
      sent = Math.min(offset + chunkSize, total);
      packetsSinceReceipt++;

      if (prn > 0 && packetsSinceReceipt >= prn) {
        packetsSinceReceipt = 0;
        const receipt = await reader.next(timeout, signal);
        // A response here means the device errored mid-transfer.
        if (receipt[0] === DfuOpCode.Response) {
          throw new Error(`DFU transfer failed: ${statusMessage(receipt[2] ?? 0)}`);
        }
        emit("transferring", sent);
      } else if (prn === 0) {
        emit("transferring", sent);
      }
    }
    await expectResponse(DfuOpCode.ReceiveFirmware);
    emit("transferring", total);

    // 6. Validate.
    emit("validating", total);
    await controlPoint.writeValue(new Uint8Array([DfuOpCode.Validate]));
    await expectResponse(DfuOpCode.Validate);

    // 7. Activate + reset (device reboots into the new firmware; no response).
    emit("activating", total);
    await controlPoint.writeValue(new Uint8Array([DfuOpCode.ActivateAndReset]));
    emit("done", total);
  } finally {
    reader.stop();
  }
}
