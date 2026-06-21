/**
 * Native (Tauri) IPC client for the AiM MyChron Wi-Fi downloader.
 *
 * This is the ONLY module that touches `@tauri-apps/api`, and it does so via a
 * dynamic `import("@tauri-apps/api/core")` so Vite code-splits Tauri into the
 * lazy MyChron chunk — the web build never fetches it (Golden Rule #1). Only the
 * lazy native flow may reach this module; never the eager picker.
 *
 * Commands are app-defined on the native side; arg keys are camelCase and every
 * command rejects with a plain string whose prefix encodes the error category
 * (`device unreachable:`, `device hung:`, `protocol error:`, `unsupported:`,
 * `Wi-Fi join was declined…`, `no logger connected …`). We pass those strings
 * through unwrapped so the UI can match on the prefix.
 */

/**
 * SSID prefix for the MyChron's Wi-Fi AP, used on Android to drive the system
 * Wi-Fi picker. OPEN HARDWARE ITEM: confirm the real prefix from a device and
 * whether the AP is open or WPA2 (+ passphrase). Single source of truth.
 */
export const MYCHRON_SSID_PREFIX = "MYCHRON5";

/** Default MyChron gateway host — omit to let the backend use it. */
const DEFAULT_HOST = "10.0.0.1";

/** Device fields the backend reports after a connect (flattened hw.* / path.* / usr.*). */
export interface LoggerDeviceInfo {
  kind: string;
  name?: string;
  model?: string;
  fields: Record<string, string>;
}

/** A downloadable session on the device. */
export interface FileEntry {
  name: string;
  size: number;
  date?: string;
  meta: Record<string, string>;
}

/** Raw progress payload from the native download channel. */
export interface DownloadProgress {
  received: number;
  total: number;
}

/** Wi-Fi join hint (Android) — exact SSID or a prefix the OS picker matches. */
export interface WifiHint {
  ssid?: string;
  ssidPrefix?: string;
  passphrase?: string;
}

// Memoized loader for the Tauri core API. Dynamic so the import is the
// code-split boundary that keeps `@tauri-apps/api` off the web/eager graph.
let apiPromise: Promise<typeof import("@tauri-apps/api/core")> | null = null;
function api() {
  if (!apiPromise) apiPromise = import("@tauri-apps/api/core");
  return apiPromise;
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

/** Re-read device info from an already-connected logger. */
export async function loggerDeviceInfo(): Promise<LoggerDeviceInfo> {
  const { invoke } = await api();
  return invoke<LoggerDeviceInfo>("logger_device_info");
}

/** List the downloadable sessions on the connected device. */
export async function loggerListFiles(): Promise<FileEntry[]> {
  const { invoke } = await api();
  return invoke<FileEntry[]>("logger_list_files");
}

/**
 * Download one session by name, streaming progress through a `Channel`. Resolves
 * to the already-inflated XRK bytes (the backend downloads the `.xrz` and unzips
 * it for us).
 */
export async function loggerDownloadFile(
  name: string,
  onProgress: (p: DownloadProgress) => void,
): Promise<Uint8Array> {
  const { invoke, Channel } = await api();
  const channel = new Channel<DownloadProgress>();
  channel.onmessage = onProgress;
  const buf = await invoke<ArrayBuffer>("logger_download_file", { name, onProgress: channel });
  return new Uint8Array(buf);
}

/**
 * Drop the connection, stop the keepalive and unbind the Wi-Fi. Safe to call
 * when already disconnected — errors are swallowed.
 */
export async function loggerDisconnect(): Promise<void> {
  try {
    const { invoke } = await api();
    await invoke("logger_disconnect");
  } catch {
    // Best-effort teardown — ignore (already disconnected / shutting down).
  }
}
