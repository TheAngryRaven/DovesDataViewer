/**
 * Native video store bridge (plan 0024 follow-up).
 *
 * On the web, a session remembers its video through a `FileSystemFileHandle`
 * in the sync record — Chrome desktop only. The Android WebView has no such
 * thing, so the LapWing shell keeps a copy of the video in app data instead
 * (`video_store_*` IPC; contract in LapWing `docs/video-pipeline.md`):
 *
 *   - `storeNativeVideo` copies the picked File across once (base64 chunks —
 *     `nativeBytes.ts`) and seals it under the session's store key;
 *   - `getNativeStoredVideo` finds it again on the next open and returns a
 *     playable URL over the asset protocol — the <video> streams from disk;
 *   - the export bridge names the stored copy as its source (`sourceKey`) and
 *     skips the source copy entirely;
 *   - `listNativeStoredVideos` / `removeNativeStoredVideo` /
 *     `clearNativeVideoStore` back the profile tab's "Videos on this device"
 *     card — the store is the one thing in the app that grows by gigabytes,
 *     and nothing else prunes it.
 *
 * The lookup/store/list functions are no-ops (`null`) off the native shell or
 * on a shell that predates them, so callers can call them unconditionally;
 * remove/clear throw, because the caller is a button that must report failure.
 */

import { api } from "@/lib/loggers/native/ipc";
import { blobToBase64, NATIVE_CHUNK_BYTES } from "@/lib/nativeBytes";
import { isNativeApp } from "@/lib/platform";

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

/** One entry of the shell's store, as listed. */
export interface NativeStoredVideoEntry extends StoredVideoInfo {
  /** The session the video was stored for; absent for copies made before the
   * shell recorded it (they still play and export — they just can't be named). */
  sessionFileName?: string;
  /** When the copy was sealed (Unix ms). */
  storedAtMs?: number;
}

/**
 * Fired on `window` after a stored video is removed or the store is cleared,
 * so a session that is playing (or exporting) from the deleted copy can react.
 * `removedKeys` is `null` when everything went.
 */
export const NATIVE_VIDEO_STORE_CHANGED = "native-video-store-changed";
export interface NativeVideoStoreChangedDetail {
  removedKeys: string[] | null;
}

function announceStoreChange(removedKeys: string[] | null): void {
  if (typeof window === "undefined" || typeof CustomEvent === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<NativeVideoStoreChangedDetail>(NATIVE_VIDEO_STORE_CHANGED, { detail: { removedKeys } }),
  );
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
  for (let offset = 0; offset < file.size; offset += NATIVE_CHUNK_BYTES) {
    const end = Math.min(offset + NATIVE_CHUNK_BYTES, file.size);
    const data = await blobToBase64(file.slice(offset, end));
    await invoke("video_store_push", { key, offset, data });
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

/**
 * Every video the shell holds, or `null` when it can't say — the web, the
 * desktop stub, or a shell predating the listing (the card hides itself).
 */
export async function listNativeStoredVideos(): Promise<NativeStoredVideoEntry[] | null> {
  if (!isNativeApp()) return null;
  try {
    const { invoke } = await api();
    return await invoke<NativeStoredVideoEntry[]>("video_store_list");
  } catch (err) {
    if (!isUnavailable(err)) console.warn("Native video store listing failed:", err);
    return null;
  }
}

/** Delete one stored video by its listed key. Resolves the bytes freed. */
export async function removeNativeStoredVideo(key: string): Promise<number> {
  const { invoke } = await api();
  const freed = await invoke<number>("video_store_remove", { key });
  announceStoreChange([key]);
  return freed;
}

/** Empty the store. Resolves the bytes freed. */
export async function clearNativeVideoStore(): Promise<number> {
  const { invoke } = await api();
  const freed = await invoke<number>("video_store_clear");
  announceStoreChange(null);
  return freed;
}
