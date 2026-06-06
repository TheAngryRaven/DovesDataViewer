/// <reference types="web-bluetooth" />

import type { BleConnection } from "./types";
import { SERVICE_UUID, FILE_LIST_CHAR, FILE_REQUEST_CHAR, FILE_DATA_CHAR, FILE_STATUS_CHAR } from "./internal";
import { DFU_SERVICE_UUID } from "./dfu/dfuTypes";
import { DIS_SERVICE_UUID } from "./dfu/version";

/** Check if Web Bluetooth is available in the current browser. */
export function isBleSupported(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

/** Connect to the DovesLapTimer device and return a populated BleConnection. */
export async function connectToDevice(
  onStatusChange?: (status: string) => void,
): Promise<BleConnection> {
  const updateStatus = onStatusChange || (() => {});

  updateStatus("Scanning for devices...");

  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [SERVICE_UUID] }],
    // DIS (firmware version/variant) + the buttonless DFU service must be listed
    // so they're reachable on this same connection (version check + reboot-to-DFU).
    optionalServices: [DIS_SERVICE_UUID, DFU_SERVICE_UUID],
  });

  updateStatus("Connecting...");
  const server = await device.gatt!.connect();

  updateStatus("Getting service...");
  const service = await server.getPrimaryService(SERVICE_UUID);

  updateStatus("Getting characteristics...");
  const fileList = await service.getCharacteristic(FILE_LIST_CHAR);
  const fileRequest = await service.getCharacteristic(FILE_REQUEST_CHAR);
  const fileData = await service.getCharacteristic(FILE_DATA_CHAR);
  const fileStatus = await service.getCharacteristic(FILE_STATUS_CHAR);

  // Brief delay for stability
  await new Promise((resolve) => setTimeout(resolve, 500));

  updateStatus("Connected!");

  return {
    device,
    server,
    service,
    characteristics: {
      fileList,
      fileRequest,
      fileData,
      fileStatus,
    },
  };
}

/** Disconnect from the device. Safe to call when already disconnected. */
export function disconnect(connection: BleConnection): void {
  if (connection.device && connection.device.gatt?.connected) {
    connection.device.gatt.disconnect();
  }
}
