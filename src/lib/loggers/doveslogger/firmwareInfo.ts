/**
 * Derive the connected DovesLogger's firmware identity from the native
 * backend's `LoggerDeviceInfo` — the native counterpart of the web path's DIS
 * read (`readDeviceFirmwareInfo`), feeding the same `evaluateFirmwareUpdate` /
 * `pickBuildForVariant` manifest logic.
 *
 * The backend flattens the device's reported fields into `fields`; the exact
 * key names are still being aligned with the LapWing side (see plan 0008), so
 * this probes the plausible spellings and degrades to `null`s — the update UI
 * then falls back to an explicit variant confirmation. Pure; imports only the
 * pure `parseVariantFromModel` (no Web Bluetooth, no Tauri).
 */

import { parseVariantFromModel } from "@/lib/ble/dfu/version";
import type { DeviceFirmwareInfo } from "@/lib/ble/dfu";
import type { LoggerDeviceInfo } from "../native/ipc";

const VERSION_KEYS = ["hw.fw", "hw.firmware", "hw.version", "firmware", "version"];
const MODEL_KEYS = ["hw.model", "model"];

/**
 * Optional backend capability flag: when the connect handshake reports
 * `fields["cap.fw_update"]`, it authoritatively says whether the shell can
 * flash firmware. Returns `null` when the field is absent (older backends) —
 * then availability is discovered by attempting the command.
 */
export function firmwareUpdateCapability(info: LoggerDeviceInfo): boolean | null {
  const cap = info.fields["cap.fw_update"];
  if (cap === undefined) return null;
  return cap === "1" || cap.toLowerCase() === "true";
}

function probe(fields: Record<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    const value = fields[key]?.trim();
    if (value) return value;
  }
  return null;
}

/** Extract version/model/variant from a native connect's device info. Pure. */
export function firmwareInfoFromDeviceInfo(info: LoggerDeviceInfo): DeviceFirmwareInfo {
  const version = probe(info.fields, VERSION_KEYS);
  const model = probe(info.fields, MODEL_KEYS) ?? info.model?.trim() ?? null;
  return {
    version,
    model,
    variant: parseVariantFromModel(model),
    manufacturer: info.fields["hw.manufacturer"]?.trim() ?? null,
  };
}
