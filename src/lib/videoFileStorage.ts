/**
 * IndexedDB storage for video file blobs attached to telemetry sessions.
 * One video per session file. Stored in the "session-videos" object store.
 */

import { openDB, STORE_NAMES } from "./dbUtils";

export interface StoredVideo {
  sessionFileName: string;
  videoBlob: Blob;
  videoFileName: string;
  savedAt: number;
  size: number;
}

export interface StoredVideoMeta {
  sessionFileName: string;
  videoFileName: string;
  savedAt: number;
  size: number;
}

export async function saveSessionVideo(
  sessionFileName: string,
  blob: Blob,
  videoFileName: string,
): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.SESSION_VIDEOS, "readwrite");
  tx.objectStore(STORE_NAMES.SESSION_VIDEOS).put({
    sessionFileName,
    videoBlob: blob,
    videoFileName,
    savedAt: Date.now(),
    size: blob.size,
  });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadSessionVideo(
  sessionFileName: string,
): Promise<{ blob: Blob; videoFileName: string } | null> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.SESSION_VIDEOS, "readonly");
  const request = tx.objectStore(STORE_NAMES.SESSION_VIDEOS).get(sessionFileName);
  const result = await new Promise<StoredVideo | undefined>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  if (!result) return null;
  return { blob: result.videoBlob, videoFileName: result.videoFileName };
}

export async function deleteSessionVideo(sessionFileName: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.SESSION_VIDEOS, "readwrite");
  tx.objectStore(STORE_NAMES.SESSION_VIDEOS).delete(sessionFileName);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function hasSessionVideo(sessionFileName: string): Promise<boolean> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.SESSION_VIDEOS, "readonly");
  const request = tx.objectStore(STORE_NAMES.SESSION_VIDEOS).count(
    IDBKeyRange.only(sessionFileName),
  );
  const count = await new Promise<number>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return count > 0;
}

/** List all stored videos (metadata only, no blobs) */
export async function listSessionVideos(): Promise<StoredVideoMeta[]> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.SESSION_VIDEOS, "readonly");
  const request = tx.objectStore(STORE_NAMES.SESSION_VIDEOS).getAll();
  const results = await new Promise<StoredVideo[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  // Return metadata only — omit the blob to save memory
  return results.map(({ sessionFileName, videoFileName, savedAt, size }) => ({
    sessionFileName,
    videoFileName,
    savedAt,
    size,
  }));
}
