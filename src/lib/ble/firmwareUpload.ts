/// <reference types="web-bluetooth" />

import type { BleConnection } from "./types";
import { bleLog } from "./internal";

/**
 * SD-staged firmware-update protocol (web → logger), built on the existing
 * `0x1820` file service (NOT the Chrome-blocklisted DFU service). Commands are
 * written to `fileRequest` (`0x2A3E`); responses arrive on `fileStatus`
 * (`0x2A40`). CRC is CRC-32/IEEE as an 8-char lowercase hex string.
 *
 * Paranoid handshake (see `docs/plans/firmware-sdcard-ota.md`):
 *   1. `beginFirmwareUpdate` — `FWBEGIN:<size>,<crc>,<variant>` → device echoes
 *      `FWCRC:<crc>`; we abort unless the echo matches (verifies the control
 *      channel before any upload).
 *   2. `uploadFirmwareImage` — `FWPUT:<size>` → `FWREADY` → stream chunks →
 *      `FWDONE` → device re-CRCs the stored file → `FWOK:<crc>` / `FWERR:<reason>`.
 *   3. `applyFirmware` — `FWAPPLY` → `FWSTAGE:<pct>` … → `FWAPPLIED` (or the
 *      device simply disconnects as it resets into the new image).
 *
 * These wire tokens are the contract the logger firmware implements.
 */

const encoder = new TextEncoder();
const decode = (v: DataView | null | undefined) => new TextDecoder().decode(v!);
const lines = (raw: string) => raw.split("\n").map((l) => l.trim()).filter(Boolean);

export interface FirmwareUploadProgress {
  /** Image bytes written so far. */
  sent: number;
  /** Total image bytes. */
  total: number;
}

export interface BeginOptions {
  timeoutMs?: number;
}

export interface UploadOptions {
  /** Bytes per chunk write. Default 240 (fits a negotiated 247-byte MTU). */
  chunkSize?: number;
  /** Delay between chunk writes (ms), for device stability. Default 10. */
  chunkDelayMs?: number;
  /** Per-step response timeout (ms). Default 15000. */
  timeoutMs?: number;
}

export interface ApplyOptions {
  /** Response timeout (ms); staging + flashing can be slow. Default 60000. */
  timeoutMs?: number;
}

/**
 * Step 1 — announce the image (size + expected CRC + target variant) and require
 * the device to echo the CRC back unchanged. The device also rejects here
 * (`FWERR:VARIANT`) if `variant` doesn't match its own build, so a wrong-variant
 * image fails *before* the upload. Rejects on echo mismatch (control channel
 * corrupted), `FWERR:*`, or timeout.
 */
export async function beginFirmwareUpdate(
  connection: BleConnection,
  size: number,
  crcHex: string,
  variant: string,
  options: BeginOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 10000;
  const expected = crcHex.toLowerCase();

  // eslint-disable-next-line no-async-promise-executor -- inner try/catch handles rejection; matches the other BLE protocol modules
  return new Promise(async (resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const handle = (event: Event) => {
      const raw = decode((event.target as BluetoothRemoteGATTCharacteristic).value);
      bleLog("FWBEGIN status:", raw);
      for (const line of lines(raw)) {
        if (line.startsWith("FWCRC:")) {
          const echoed = line.substring(6).trim().toLowerCase();
          cleanup();
          if (echoed === expected) resolve();
          else
            reject(
              new Error(
                `Device echoed CRC ${echoed}, expected ${expected} — control channel corrupted, aborting`,
              ),
            );
          return;
        }
        if (line.startsWith("FWERR:")) {
          cleanup();
          reject(new Error(`Firmware handshake failed: ${line.substring(6)}`));
          return;
        }
      }
    };

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      connection.characteristics.fileStatus.removeEventListener(
        "characteristicvaluechanged",
        handle,
      );
    };

    try {
      await connection.characteristics.fileStatus.startNotifications();
      connection.characteristics.fileStatus.addEventListener(
        "characteristicvaluechanged",
        handle,
      );
      await connection.characteristics.fileRequest.writeValue(
        encoder.encode(`FWBEGIN:${size},${expected},${variant}`),
      );
      timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for the device to echo the firmware CRC"));
      }, timeoutMs);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

/**
 * Step 2 — upload the image to SD, then require the device to confirm the stored
 * file's CRC matches `crcHex`. Rejects on CRC mismatch, `FWERR:*`, or timeout.
 */
export async function uploadFirmwareImage(
  connection: BleConnection,
  image: Uint8Array,
  crcHex: string,
  onProgress?: (p: FirmwareUploadProgress) => void,
  options: UploadOptions = {},
): Promise<void> {
  const chunkSize = options.chunkSize ?? 240;
  const chunkDelayMs = options.chunkDelayMs ?? 10;
  const timeoutMs = options.timeoutMs ?? 15000;
  const expected = crcHex.toLowerCase();

  // eslint-disable-next-line no-async-promise-executor -- inner try/catch handles rejection; matches the other BLE protocol modules
  return new Promise(async (resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let phase: "waiting_ready" | "uploading" | "waiting_ok" = "waiting_ready";

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      connection.characteristics.fileStatus.removeEventListener(
        "characteristicvaluechanged",
        handle,
      );
    };
    // Watchdog: (re)start a single timeout. The upload resets it on every chunk,
    // so a large image never trips it — only an actual stall (no progress for
    // `timeoutMs`) does.
    const arm = (message: string) => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        cleanup();
        reject(new Error(message));
      }, timeoutMs);
    };

    const handle = (event: Event) => {
      const raw = decode((event.target as BluetoothRemoteGATTCharacteristic).value);
      bleLog("FWPUT status:", raw, "phase:", phase);
      for (const line of lines(raw)) {
        if (line === "FWREADY" && phase === "waiting_ready") {
          phase = "uploading";
          sendChunks().catch((err) => {
            cleanup();
            reject(err);
          });
          return;
        }
        if (line.startsWith("FWOK:") && phase === "waiting_ok") {
          const stored = line.substring(5).trim().toLowerCase();
          cleanup();
          if (stored === expected) resolve();
          else
            reject(new Error(`Device stored CRC ${stored}, expected ${expected}`));
          return;
        }
        if (line.startsWith("FWERR:")) {
          cleanup();
          reject(new Error(`Firmware upload failed: ${line.substring(6)}`));
          return;
        }
      }
    };

    const sendChunks = async () => {
      for (let i = 0; i < image.length; i += chunkSize) {
        const chunk = image.subarray(i, Math.min(i + chunkSize, image.length));
        await connection.characteristics.fileRequest.writeValue(chunk);
        onProgress?.({ sent: Math.min(i + chunkSize, image.length), total: image.length });
        // Progress resets the watchdog — only a real stall trips it.
        arm("Timed out during firmware upload — the device stopped responding");
        if (chunkDelayMs > 0) await new Promise((r) => setTimeout(r, chunkDelayMs));
      }
      await connection.characteristics.fileRequest.writeValue(encoder.encode("FWDONE"));
      phase = "waiting_ok";
      arm("Timed out waiting for on-device CRC verification");
    };

    try {
      await connection.characteristics.fileStatus.startNotifications();
      connection.characteristics.fileStatus.addEventListener(
        "characteristicvaluechanged",
        handle,
      );
      await connection.characteristics.fileRequest.writeValue(
        encoder.encode(`FWPUT:${image.length}`),
      );
      arm("Timed out waiting for the device to accept the firmware upload");
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

/**
 * Step 3 — install the staged image. Reports staging progress (0–100) via
 * `onProgress` and resolves on `FWAPPLIED` **or** the device disconnecting (the
 * reset into the new firmware — a single-bank apply may reboot without delivering
 * `FWAPPLIED`). Rejects on `FWERR:*` or timeout.
 */
export async function applyFirmware(
  connection: BleConnection,
  onProgress?: (percent: number) => void,
  options: ApplyOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 60000;

  // eslint-disable-next-line no-async-promise-executor -- inner try/catch handles rejection; matches the other BLE protocol modules
  return new Promise(async (resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const arm = () => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out during firmware install"));
      }, timeoutMs);
    };

    // The install ends with the device resetting into the new firmware. A
    // single-bank apply can't reliably emit FWAPPLIED + flush it over BLE right
    // before it tears down the SoftDevice and reboots, so we also treat the
    // disconnect (the reset itself) as success.
    const onDisconnect = () => {
      cleanup();
      resolve();
    };

    const handle = (event: Event) => {
      const raw = decode((event.target as BluetoothRemoteGATTCharacteristic).value);
      bleLog("FWAPPLY status:", raw);
      for (const line of lines(raw)) {
        if (line.startsWith("FWSTAGE:")) {
          const pct = parseInt(line.substring(8), 10);
          if (!Number.isNaN(pct)) onProgress?.(pct);
          arm(); // progress resets the watchdog
          return;
        }
        if (line === "FWAPPLIED") {
          cleanup();
          resolve();
          return;
        }
        if (line.startsWith("FWERR:")) {
          cleanup();
          reject(new Error(`Firmware install failed: ${line.substring(6)}`));
          return;
        }
      }
    };

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      connection.characteristics.fileStatus.removeEventListener(
        "characteristicvaluechanged",
        handle,
      );
      connection.device.removeEventListener?.("gattserverdisconnected", onDisconnect);
    };

    try {
      await connection.characteristics.fileStatus.startNotifications();
      connection.characteristics.fileStatus.addEventListener(
        "characteristicvaluechanged",
        handle,
      );
      connection.device.addEventListener?.("gattserverdisconnected", onDisconnect);
      await connection.characteristics.fileRequest.writeValue(encoder.encode("FWAPPLY"));
      arm();
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
