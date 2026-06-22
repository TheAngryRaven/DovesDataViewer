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

import { api, type LoggerDeviceInfo } from "../native/ipc";

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
