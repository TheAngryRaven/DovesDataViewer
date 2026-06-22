/**
 * Native (Tauri) IPC client for the AiM MyChron Wi-Fi downloader.
 *
 * The kind-agnostic commands (list / download / device info / disconnect) and the
 * memoized `@tauri-apps/api` loader live in `../native/ipc` and are shared with the
 * other native loggers; this module adds only the MyChron-specific `logger_connect`
 * (Wi-Fi join hint) and re-exports the shared surface so existing callers
 * (`mychronConnection.ts`) keep importing everything from here.
 *
 * Arg keys are camelCase and every command rejects with a plain string whose
 * prefix encodes the error category (`device unreachable:`, `device hung:`,
 * `protocol error:`, `unsupported:`, `Wi-Fi join was declined…`, `no logger
 * connected …`). We pass those strings through unwrapped so the UI can match on
 * the prefix.
 */

import { api, type LoggerDeviceInfo } from "../native/ipc";

// Re-export the shared native surface so MyChron callers import it all from here.
export {
  loggerDeviceInfo,
  loggerListFiles,
  loggerDownloadFile,
  loggerDisconnect,
} from "../native/ipc";
export type { LoggerDeviceInfo, FileEntry, DownloadProgress } from "../native/ipc";

/**
 * SSID prefix for the MyChron's Wi-Fi AP, used on Android to drive the system
 * Wi-Fi picker. OPEN HARDWARE ITEM: confirm the real prefix from a device and
 * whether the AP is open or WPA2 (+ passphrase). Single source of truth.
 */
export const MYCHRON_SSID_PREFIX = "MYCHRON5";

/** Default MyChron gateway host — omit to let the backend use it. */
const DEFAULT_HOST = "10.0.0.1";

/** Wi-Fi join hint (Android) — exact SSID or a prefix the OS picker matches. */
export interface WifiHint {
  ssid?: string;
  ssidPrefix?: string;
  passphrase?: string;
}

/** Connect to the MyChron — joins + binds Wi-Fi on Android when `wifi` is set. */
export async function loggerConnect(opts: { host?: string; wifi?: WifiHint } = {}): Promise<LoggerDeviceInfo> {
  const { invoke } = await api();
  return invoke<LoggerDeviceInfo>("logger_connect", {
    kind: "mychron",
    host: opts.host ?? DEFAULT_HOST,
    wifi: opts.wifi,
  });
}
