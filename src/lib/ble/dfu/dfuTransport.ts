/// <reference types="web-bluetooth" />

/**
 * Web Bluetooth I/O for entering and connecting to DFU mode.
 *
 * Two distinct device sessions are involved:
 *   1. The *running app* exposes the Adafruit buttonless DFU service — writing
 *      `START_DFU` (0x01) to its control point reboots the board into the
 *      bootloader (the firmware sets GPREGRET=0xB1 and resets).
 *   2. The *bootloader* re-advertises the same DFU service for the actual
 *      transfer; we reconnect to it and hand a {@link DfuTransport} to
 *      `flashFirmware`.
 *
 * These are thin Web Bluetooth wrappers (hardware-dependent), so they aren't
 * unit-tested; the testable transfer logic lives in `dfuProtocol.ts`.
 */

import {
  DFU_CONTROL_POINT_UUID,
  DFU_PACKET_UUID,
  DFU_SERVICE_UUID,
  DfuOpCode,
} from "./dfuTypes";
import type { DfuTransport } from "./dfuProtocol";

/**
 * Trigger buttonless DFU on the currently-connected app server. Writes
 * `START_DFU` to the app-mode DFU control point; the device disconnects and
 * reboots into its bootloader. Resolves once the command is written — callers
 * should then wait for `gattserverdisconnected` and reconnect via
 * {@link connectToDfu}.
 */
export async function triggerDfuMode(
  server: BluetoothRemoteGATTServer,
): Promise<void> {
  const service = await server.getPrimaryService(DFU_SERVICE_UUID);
  const controlPoint = await service.getCharacteristic(DFU_CONTROL_POINT_UUID);
  // Best-effort: enabling notifications first matches nRF tooling behavior.
  try {
    await controlPoint.startNotifications();
  } catch {
    // Not all stacks require/allow this on the app-mode characteristic.
  }
  await controlPoint.writeValue(new Uint8Array([DfuOpCode.Start]));
}

/** Result of connecting to a device in bootloader/DFU mode. */
export interface DfuConnection {
  device: BluetoothDevice;
  server: BluetoothRemoteGATTServer;
  transport: DfuTransport;
}

/**
 * Prompt the user to pick the device now advertising in DFU mode, connect, and
 * resolve the control-point + packet characteristics. Requires a user gesture
 * (Web Bluetooth `requestDevice`). Prefer {@link connectToDfuDevice} when the
 * original device object is still in hand — it avoids a second picker.
 */
export async function connectToDfu(
  onStatusChange?: (status: string) => void,
): Promise<DfuConnection> {
  const updateStatus = onStatusChange ?? (() => {});

  updateStatus("Scanning for device in DFU mode...");
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [DFU_SERVICE_UUID] }],
  });

  updateStatus("Connecting to bootloader...");
  const server = await device.gatt!.connect();
  const service = await server.getPrimaryService(DFU_SERVICE_UUID);

  updateStatus("Preparing transfer...");
  const [controlPoint, packet] = await Promise.all([
    service.getCharacteristic(DFU_CONTROL_POINT_UUID),
    service.getCharacteristic(DFU_PACKET_UUID),
  ]);

  return { device, server, transport: { controlPoint, packet } };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ConnectToDfuOptions {
  /** Delay before the first reconnect attempt (let the board reboot). */
  initialDelayMs?: number;
  /** Number of reconnect attempts. */
  attempts?: number;
  /** Delay between attempts. */
  intervalMs?: number;
}

/**
 * Reconnect to a device that has just rebooted into its bootloader, reusing the
 * **existing** {@link BluetoothDevice} (already permission-granted) — so no
 * second `requestDevice` gesture is needed. The Adafruit bootloader re-advertises
 * the same DFU service on the same identity, so retrying `gatt.connect()` picks
 * it up once it's back. Resolves the control-point + packet characteristics.
 */
export async function connectToDfuDevice(
  device: BluetoothDevice,
  onStatusChange?: (status: string) => void,
  options: ConnectToDfuOptions = {},
): Promise<DfuConnection> {
  const updateStatus = onStatusChange ?? (() => {});
  const { initialDelayMs = 2000, attempts = 20, intervalMs = 1000 } = options;

  // Ensure the stale app-mode link is torn down before reconnecting.
  if (device.gatt?.connected) {
    try {
      device.gatt.disconnect();
    } catch {
      // ignore — already gone
    }
  }

  updateStatus("Waiting for bootloader...");
  await sleep(initialDelayMs);

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const server = await device.gatt!.connect();
      const service = await server.getPrimaryService(DFU_SERVICE_UUID);
      const [controlPoint, packet] = await Promise.all([
        service.getCharacteristic(DFU_CONTROL_POINT_UUID),
        service.getCharacteristic(DFU_PACKET_UUID),
      ]);
      updateStatus("Connected to bootloader");
      return { device, server, transport: { controlPoint, packet } };
    } catch (error) {
      lastError = error;
      try {
        device.gatt?.disconnect();
      } catch {
        // ignore
      }
      await sleep(intervalMs);
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Could not connect to the device in DFU mode: ${detail}`);
}
