/**
 * Web Bluetooth implementation of the transport-neutral `DeviceDetails`
 * surface — wraps the existing `@/lib/ble` settings/tracks/battery functions
 * around a live `BleConnection`. The native (Tauri) sibling is
 * `doveslogger/dovesloggerConnection.ts` → `createNativeDeviceDetails()`.
 *
 * Importing this module pulls the BLE protocol in, so only surfaces that
 * already hold a `BleConnection` should reference it — never the eager picker.
 */

import {
  type BleConnection,
  requestBatteryLevel,
  requestSettingsList,
  setDeviceSetting,
  resetDeviceSettings,
  requestTrackFileList,
  downloadTrackFile,
  uploadTrackFile,
  deleteTrackFile,
} from "@/lib/bleDatalogger";
import type { DeviceDetails } from "./types";

/** The Device-tab surface over a live Web Bluetooth connection. */
export function createBleDeviceDetails(connection: BleConnection): DeviceDetails {
  return {
    battery: () => requestBatteryLevel(connection),
    listSettings: () => requestSettingsList(connection),
    setSetting: (key, value) => setDeviceSetting(connection, key, value),
    resetSettings: () => resetDeviceSettings(connection),
    listTracks: (kind) => requestTrackFileList(connection, kind),
    getTrack: (name, kind) => downloadTrackFile(connection, name, undefined, kind),
    putTrack: (name, data, kind) => uploadTrackFile(connection, name, data, kind),
    deleteTrack: (name, kind) => deleteTrackFile(connection, name, kind),
    // Web Bluetooth speaks the TS* verbs directly.
    supportsSprintTracks: true,
  };
}
