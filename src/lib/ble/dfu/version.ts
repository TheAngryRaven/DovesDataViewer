/// <reference types="web-bluetooth" />

/**
 * Read the installed firmware identity from the standard Device Information
 * Service (`0x180A`). The firmware publishes it via Adafruit `BLEDis`:
 *   - Firmware Revision (0x2A26): version string, e.g. "2.1.0"
 *   - Model Number     (0x2A24): "BirdsEye-<variant>", e.g. "BirdsEye-sense"
 *   - Manufacturer     (0x2A29): "DovesDataLogger"
 *
 * No custom characteristic — the app is a pure consumer of standard BLE. The
 * model→variant mapping is pure (exported for tests); the DIS read is degrade-
 * gracefully (missing characteristics resolve to `null`).
 */

import type { DeviceFirmwareInfo } from "./dfuTypes";

/** Device Information Service. */
export const DIS_SERVICE_UUID = 0x180a;
/** Model Number String. */
export const DIS_MODEL_UUID = 0x2a24;
/** Firmware Revision String. */
export const DIS_FIRMWARE_REV_UUID = 0x2a26;
/** Manufacturer Name String. */
export const DIS_MANUFACTURER_UUID = 0x2a29;

/**
 * Derive the variant from a DIS model string. "BirdsEye-sense" → "sense".
 * Returns `null` when the model isn't in the expected `Name-variant` shape.
 * Pure.
 */
export function parseVariantFromModel(model: string | null): string | null {
  if (!model) return null;
  const idx = model.lastIndexOf("-");
  if (idx < 0 || idx === model.length - 1) return null;
  return model.slice(idx + 1).trim().toLowerCase() || null;
}

/** Read one DIS string characteristic, returning `null` if absent/unreadable. */
async function readStringChar(
  service: BluetoothRemoteGATTService,
  uuid: number,
): Promise<string | null> {
  try {
    const char = await service.getCharacteristic(uuid);
    const value = await char.readValue();
    return new TextDecoder().decode(value).replace(/\0+$/, "").trim() || null;
  } catch {
    return null;
  }
}

/**
 * Read firmware version/variant/manufacturer from the device's DIS. Requires
 * `0x180A` to be exposed (add it to the connection's `optionalServices`).
 * Throws only when the DIS itself is unavailable; individual missing fields
 * resolve to `null`.
 */
export async function readDeviceFirmwareInfo(
  server: BluetoothRemoteGATTServer,
): Promise<DeviceFirmwareInfo> {
  let service: BluetoothRemoteGATTService;
  try {
    service = await server.getPrimaryService(DIS_SERVICE_UUID);
  } catch {
    throw new Error(
      "Device Information Service not available — cannot read firmware version",
    );
  }

  const [version, model, manufacturer] = await Promise.all([
    readStringChar(service, DIS_FIRMWARE_REV_UUID),
    readStringChar(service, DIS_MODEL_UUID),
    readStringChar(service, DIS_MANUFACTURER_UUID),
  ]);

  return { version, model, variant: parseVariantFromModel(model), manufacturer };
}
