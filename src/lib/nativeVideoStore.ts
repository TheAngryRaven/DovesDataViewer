/**
 * Native video store bridge (plan 0024 follow-up).
 *
 * On the web, a session remembers its video through a `FileSystemFileHandle`
 * in the sync record — Chrome desktop only. The Android WebView has no such
 * thing, so the LapWing shell keeps a copy of the video in app data instead
 * (`video_store_*` IPC; contract in LapWing `docs/video-pipeline.md`):
 *
 *   - `storeNativeVideo` copies the picked File across once (8 MB raw-body
 *     chunks) and seals it under the session's store key;
 *   - `getNativeStoredVideo` finds it again on the next open and returns a
 *     playable URL over the asset protocol — the <video> streams from disk;
 *   - the export bridge names the stored copy as its source (`sourceKey`) and
 *     skips the source copy entirely.
 *
 * Every function is a no-op (`null`) off the native shell or on a shell that
 * predates the store, so callers can call them unconditionally.
 */

import { api } from "@/lib/loggers/native/ipc";
import { isNativeApp } from "@/lib/platform";

const CHUNK_BYTES = 8 * 1024 * 1024;

export interface NativeStoredVideo {
  key: string;
  fileName: string;
  size: number;
  /** Absolute path on the device (the export bridge passes the key, not this). */
  path: string;
  /** Playable URL over the asset protocol. */
  url: string;
}

interface StoredVideoInfo {
  key: string;
  fileName: string;
  size: number;
  path: string;
}

/** The desktop stub's sentinel, or a shell predating the store commands. */
function isUnavailable(err: unknown): boolean {
  const msg = String(err);
  return msg.startsWith("unsupported:") || /unknown|not found|not allowed/i.test(msg);
}

/** The session's remembered video, if the shell has one. */
export async function getNativeStoredVideo(sessionFileName: string): Promise<NativeStoredVideo | null> {
  if (!isNativeApp()) return null;
  try {
    const { invoke, convertFileSrc } = await api();
    const info = await invoke<StoredVideoInfo | null>("video_store_get", { sessionFileName });
    if (!info) return null;
    return { ...info, url: convertFileSrc(info.path) };
  } catch (err) {
    if (!isUnavailable(err)) console.warn("Native video store lookup failed:", err);
    return null;
  }
}

/**
 * Copy `file` into the shell's store for `sessionFileName`, replacing any
 * previous video for that session. Resolves `null` when the shell can't
 * store (web, desktop stub, old shell) — the caller just keeps its blob URL.
 */
export async function storeNativeVideo(
  sessionFileName: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<NativeStoredVideo | null> {
  if (!isNativeApp() || file.size === 0) return null;
  const { invoke, convertFileSrc } = await api();
  let key: string;
  try {
    key = await invoke<string>("video_store_begin", { sessionFileName, fileName: file.name });
  } catch (err) {
    if (isUnavailable(err)) return null;
    throw err;
  }
  for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
    const end = Math.min(offset + CHUNK_BYTES, file.size);
    const bytes = new Uint8Array(await file.slice(offset, end).arrayBuffer());
    await invoke("video_store_push", bytes, {
      headers: { "store-key": key, offset: String(offset) },
    });
    onProgress?.(end / file.size);
  }
  const info = await invoke<StoredVideoInfo>("video_store_finish", { key });
  return { ...info, url: convertFileSrc(info.path) };
}

/** Forget the session's stored video (best effort). */
export async function deleteNativeStoredVideo(sessionFileName: string): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { invoke } = await api();
    await invoke("video_store_delete", { sessionFileName });
  } catch {
    // Best effort — an old shell or the desktop stub simply has nothing to delete.
  }
}
