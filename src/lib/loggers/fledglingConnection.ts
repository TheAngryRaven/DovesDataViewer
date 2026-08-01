/**
 * PerchWerks Fledgling adapter — wraps a Web Bluetooth `BleConnection` in the
 * generic `LoggerConnection` surface. This is the only transport wired today;
 * MyChron (Wi-Fi via the native shell) and Alfano (BLE) will add sibling
 * adapters that satisfy the same interface.
 *
 * Importing this module pulls the BLE protocol in, so only the lazy Fledgling
 * download flow should reference it — never the eager picker.
 */

import { type BleConnection, requestFileList, downloadFile, disconnect } from "@/lib/ble";
import { createBleDeviceDetails } from "./bleDetails";
import type { LoggerConnection } from "./types";

/** Adapt a live Fledgling BLE connection to the generic logger interface. */
export function createFledglingConnection(ble: BleConnection): LoggerConnection {
  return {
    kind: "fledgling",
    displayName: ble.device.name ?? "PerchWerks Fledgling",
    supportsDeviceDetails: true,
    details: createBleDeviceDetails(ble),
    listLogs: (onStatus) => requestFileList(ble, onStatus),
    downloadLog: (name, onProgress, onStatus) => downloadFile(ble, name, onProgress, onStatus),
    disconnect: () => disconnect(ble),
  };
}
