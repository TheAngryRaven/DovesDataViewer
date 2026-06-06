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
 * (Web Bluetooth `requestDevice`).
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
