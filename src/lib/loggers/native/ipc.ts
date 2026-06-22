/**
 * Shared native (Tauri) IPC client for the logger downloaders.
 *
 * This is the ONLY module that touches `@tauri-apps/api`, and it does so via a
 * dynamic `import("@tauri-apps/api/core")` so Vite code-splits Tauri into the
 * lazy native chunks — the web build never fetches it (Golden Rule #1). Only the
 * lazy native flows may reach this module; never the eager picker.
 *
 * The commands here are **kind-agnostic** — `logger_list_files`,
 * `logger_download_file`, `logger_device_info` and `logger_disconnect` operate on
 * whichever logger the last `logger_connect` bound, so every native logger
 * (MyChron over Wi-Fi, DovesLogger over BLE) shares them. The per-logger
 * `logger_connect` / `logger_scan` wrappers live in each logger's own `ipc.ts`
 * and call `api()` from here.
 *
 * Arg keys are camelCase and every command rejects with a plain string whose
 * prefix encodes the error category (`device unreachable:`, `device hung:`,
 * `protocol error:`, `unsupported:`, `no logger connected …`). We pass those
 * strings through unwrapped so the UI can match on the prefix.
 */

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

// Memoized loader for the Tauri core API. Dynamic so the import is the
// code-split boundary that keeps `@tauri-apps/api` off the web/eager graph.
let apiPromise: Promise<typeof import("@tauri-apps/api/core")> | null = null;

/** Lazily load (and memoize) the Tauri core API. Per-logger connect/scan reuse this. */
export function api() {
  if (!apiPromise) apiPromise = import("@tauri-apps/api/core");
  return apiPromise;
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
 * to the raw device-file bytes the backend hands back (MyChron inflates its XRK
 * server-side; DovesLogger returns its `.dove`/`.dovex`/`.csv` verbatim).
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
 * Drop the connection and release any transport resources (Wi-Fi binding, BLE
 * link). Safe to call when already disconnected — errors are swallowed.
 */
export async function loggerDisconnect(): Promise<void> {
  try {
    const { invoke } = await api();
    await invoke("logger_disconnect");
  } catch {
    // Best-effort teardown — ignore (already disconnected / shutting down).
  }
}
