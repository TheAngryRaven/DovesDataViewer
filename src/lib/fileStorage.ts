/**
 * IndexedDB wrapper for storing/retrieving/deleting file blobs and file metadata.
 */

import { openDB, STORE_NAMES } from './dbUtils';
import { deleteCachedWeather } from './weatherCacheStorage';

export interface FileEntry {
  name: string;
  size: number;
  savedAt: number;
}

export interface FileMetadata {
  fileName: string;
  trackName: string;
  courseName: string;
  // Cached weather station lookup
  weatherStationId?: string;
  weatherStationName?: string;
  weatherStationDistanceKm?: number;
  /** "asos" (NWS/IEM) or "open-meteo" (global reanalysis); absent = "asos". */
  weatherStationSource?: "asos" | "open-meteo";
  // Session kart/setup link
  sessionKartId?: string;
  sessionSetupId?: string;
  // Immutable revision (content hash) of the setup as it was when assigned, so
  // this session keeps the exact setup it ran even if the live one is edited.
  sessionSetupRev?: string;
  // Engine string snapshot (resolved from the kart at assign time), so the file
  // browser can group by engine even if the vehicle is later edited or deleted.
  sessionEngine?: string;
  // Epoch ms of the first valid GPS sample (the session's true start), used for
  // the browser's date/time display name — independent of when it was uploaded.
  sessionStartTime?: number;
  // Fastest lap cache
  fastestLapMs?: number;
  fastestLapNumber?: number;
  // Browser display-name override. When set, the file browser shows this instead
  // of the date/time derived name (used by the bundled sample log).
  displayName?: string;
  // Marks the bundled sample log so the browser can hide it behind the
  // "show sample files" setting. Sample files are otherwise ordinary logs.
  isSample?: boolean;
}

interface StoredFile {
  name: string;
  data: Blob;
  size: number;
  savedAt: number;
}

const FILES_STORE = STORE_NAMES.FILES;
const META_STORE = STORE_NAMES.METADATA;

export async function saveFile(name: string, data: Blob): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(FILES_STORE, "readwrite");
    const store = tx.objectStore(FILES_STORE);
    const record: StoredFile = { name, data, size: data.size, savedAt: Date.now() };
    store.put(record);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn("Failed to save file to IndexedDB:", e);
    throw e;
  }
}

export async function listFiles(): Promise<FileEntry[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(FILES_STORE, "readonly");
    const store = tx.objectStore(FILES_STORE);
    const request = store.getAll();
    const results = await new Promise<StoredFile[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return results
      .map(({ name, size, savedAt }) => ({ name, size, savedAt }))
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch (e) {
    console.warn("Failed to list files from IndexedDB:", e);
    return [];
  }
}

export async function getFile(name: string): Promise<Blob | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(FILES_STORE, "readonly");
    const store = tx.objectStore(FILES_STORE);
    const request = store.get(name);
    const result = await new Promise<StoredFile | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return result?.data ?? null;
  } catch (e) {
    console.warn("Failed to get file from IndexedDB:", e);
    return null;
  }
}

export async function deleteFile(name: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(FILES_STORE, "readwrite");
    const store = tx.objectStore(FILES_STORE);
    store.delete(name);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    // Drop the session's locally-cached weather so a future file reusing this
    // name doesn't inherit stale conditions (best-effort).
    await deleteCachedWeather(name);
  } catch (e) {
    console.warn("Failed to delete file from IndexedDB:", e);
    throw e;
  }
}

export async function saveFileMetadata(meta: FileMetadata): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(META_STORE, "readwrite");
    tx.objectStore(META_STORE).put(meta);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn("Failed to save file metadata:", e);
  }
}

/**
 * Read-merge-write one file's metadata: applies `patch` over the existing record
 * (or a fresh one), preserving every untouched field. Use this for all partial
 * updates so a write that only cares about, say, the fastest lap can't clobber
 * the track/course/kart/setup tags. Returns the merged record.
 */
export async function updateFileMetadata(
  fileName: string,
  patch: Partial<Omit<FileMetadata, "fileName">>,
): Promise<FileMetadata> {
  const existing = await getFileMetadata(fileName);
  const merged: FileMetadata = {
    ...(existing ?? {}),
    ...patch,
    fileName,
    trackName: patch.trackName ?? existing?.trackName ?? "",
    courseName: patch.courseName ?? existing?.courseName ?? "",
  };
  await saveFileMetadata(merged);
  return merged;
}

export async function getFileMetadata(fileName: string): Promise<FileMetadata | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(META_STORE, "readonly");
    const request = tx.objectStore(META_STORE).get(fileName);
    const result = await new Promise<FileMetadata | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return result ?? null;
  } catch (e) {
    console.warn("Failed to get file metadata:", e);
    return null;
  }
}

/** Every saved session's metadata — used to find which setup revisions are in use. */
export async function listAllMetadata(): Promise<FileMetadata[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(META_STORE, "readonly");
    const request = tx.objectStore(META_STORE).getAll();
    const results = await new Promise<FileMetadata[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return results;
  } catch (e) {
    console.warn("Failed to list file metadata:", e);
    return [];
  }
}

export async function getStorageEstimate(): Promise<{ used: number; quota: number } | null> {
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      return { used: est.usage ?? 0, quota: est.quota ?? 0 };
    }
  } catch (e) {
    console.warn("Storage estimate unavailable:", e);
  }
  return null;
}
