/**
 * Native (Tauri) IPC client for the PerchWerks DovesLogger / Fledgling BLE
 * downloader.
 *
 * The kind-agnostic commands (list / download / device info / disconnect) and the
 * memoized `@tauri-apps/api` loader live in `../native/ipc` and are shared with the
 * other native loggers; this module adds only the BLE-specific `logger_scan`
 * (there's no OS picker for BLE — we render the device list in-app) and
 * `logger_connect`, and re-exports the shared surface so `dovesloggerConnection.ts`
 * imports everything from here.
 *
 * Arg keys are camelCase and every command rejects with a plain string whose
 * prefix encodes the error category (`device unreachable:` — off / out of range /
 * Android BLE permission denied, `device hung:`, `protocol error:`, `no logger
 * connected …`). We pass those strings through unwrapped so the UI can match on
 * the prefix.
 */

import { api, type DownloadProgress, type LoggerDeviceInfo } from "../native/ipc";

// Re-export the shared native surface so DovesLogger callers import it all from here.
export {
  loggerDeviceInfo,
  loggerListFiles,
  loggerDownloadFile,
  loggerDisconnect,
} from "../native/ipc";
export type { LoggerDeviceInfo, FileEntry, DownloadProgress } from "../native/ipc";

/**
 * A logger found during a BLE scan. The backend matches on the advertised GATT
 * service (`0x1820`), not the name, so renamed devices still appear; `name`/`rssi`
 * are DISPLAY ONLY (so the user recognizes their device). Selection is by `id`.
 */
export interface ScannedDevice {
  /** Transport address — pass back as `host` to `loggerConnect`. */
  id: string;
  /** Advertised name — display only (user-renamable). */
  name?: string;
  /** Signal strength, for sorting / display. */
  rssi?: number;
}

/** Scan (~5 s) for nearby DovesLoggers advertising the logger service. */
export async function loggerScan(): Promise<ScannedDevice[]> {
  const { invoke } = await api();
  return invoke<ScannedDevice[]>("logger_scan", { kind: "doveslogger" });
}

/**
 * Connect to a DovesLogger over BLE. `host` is the chosen `ScannedDevice.id`;
 * omitting it connects to the first logger found (the picker is the intended UX).
 */
export async function loggerConnect(opts: { host?: string } = {}): Promise<LoggerDeviceInfo> {
  const { invoke } = await api();
  return invoke<LoggerDeviceInfo>("logger_connect", {
    kind: "doveslogger",
    host: opts.host,
  });
}

/**
 * Upload a firmware image to the connected DovesLogger, streaming upload
 * progress through a `Channel`. After the upload the device flashes and
 * reboots — the BLE link dropping at that point is SUCCESS, not an error (the
 * backend resolves before triggering the reboot). Fledgling-specific, so it
 * lives here rather than in the kind-agnostic `../native/ipc`.
 *
 * NOTE: the backend command is still landing on the LapWing side — older
 * native shells reject with an unknown-command error (`isMissingCommandError`)
 * or `unsupported:`, which the UI degrades to "not available in this version".
 */
export async function loggerUpdateFirmware(
  image: Uint8Array,
  onProgress: (p: DownloadProgress) => void,
): Promise<void> {
  const { invoke, Channel } = await api();
  const channel = new Channel<DownloadProgress>();
  channel.onmessage = onProgress;
  await invoke("logger_update_firmware", { image, onProgress: channel });
}

// --- Device tab (settings / tracks / battery) --------------------------------
//
// Fledgling-specific like the firmware command above: these back the native
// `DeviceDetails` implementation (see `dovesloggerConnection.ts`). Older native
// shells without these commands reject with an unknown-command error
// (`isMissingCommandError`) or `unsupported:` — callers degrade gracefully.

/** Battery reading reported by `logger_battery`. */
export interface NativeBattery {
  percent: number;
  voltage: number;
}

/** Read the battery state of the connected logger. */
export async function loggerBattery(): Promise<NativeBattery> {
  const { invoke } = await api();
  return invoke<NativeBattery>("logger_battery");
}

/** All device settings as key → value (both strings on the wire). */
export async function loggerListSettings(): Promise<Record<string, string>> {
  const { invoke } = await api();
  return invoke<Record<string, string>>("logger_list_settings");
}

/** Write one device setting (the backend validates known keys first). */
export async function loggerSetSetting(key: string, value: string): Promise<void> {
  const { invoke } = await api();
  await invoke("logger_set_setting", { key, value });
}

/**
 * Factory-reset the device settings. On success the device REBOOTS and the
 * backend drops its stored connection — treat the link as gone and return to
 * the scan/connect screen.
 */
export async function loggerResetSettings(): Promise<void> {
  const { invoke } = await api();
  await invoke("logger_reset_settings");
}

/** List the track files stored on the device. */
export async function loggerListTracks(): Promise<string[]> {
  const { invoke } = await api();
  return invoke<string[]>("logger_list_tracks");
}

/** Download one track file, streaming progress like `loggerDownloadFile`. */
export async function loggerDownloadTrack(
  name: string,
  onProgress?: (p: DownloadProgress) => void,
): Promise<Uint8Array> {
  const { invoke, Channel } = await api();
  const channel = new Channel<DownloadProgress>();
  channel.onmessage = onProgress ?? (() => {});
  const buf = await invoke<ArrayBuffer>("logger_download_track", { name, onProgress: channel });
  return new Uint8Array(buf);
}

/** Upload a track file (small JSON documents — plain byte array over IPC). */
export async function loggerUploadTrack(name: string, data: Uint8Array): Promise<void> {
  const { invoke } = await api();
  await invoke("logger_upload_track", { name, data });
}

/** Delete a track file by name. */
export async function loggerDeleteTrack(name: string): Promise<void> {
  const { invoke } = await api();
  await invoke("logger_delete_track", { name });
}
