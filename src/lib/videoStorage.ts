/**
 * IndexedDB persistence for video sync data.
 * Stores FileSystemFileHandle, sync offset, and video filename per session.
 */

import { openDB, STORE_NAMES } from "./dbUtils";

export interface OverlayPosition {
  x: number; // percentage 0-100
  y: number; // percentage 0-100
}

export interface OverlaySettings {
  showSpeed: boolean;
  overlaysLocked: boolean;
  positions: Record<string, OverlayPosition>;
}

export const DEFAULT_OVERLAY_SETTINGS: OverlaySettings = {
  showSpeed: true,
  overlaysLocked: true,
  positions: {
    speed: { x: 3, y: 3 },
  },
};

export interface VideoSyncRecord {
  sessionFileName: string;
  fileHandle?: FileSystemFileHandle;
  syncOffsetMs: number;
  videoFileName: string;
  overlaySettings?: OverlaySettings;
}

export async function saveVideoSync(record: VideoSyncRecord): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.VIDEO_SYNC, "readwrite");
  tx.objectStore(STORE_NAMES.VIDEO_SYNC).put(record);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadVideoSync(sessionFileName: string): Promise<VideoSyncRecord | undefined> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.VIDEO_SYNC, "readonly");
  const request = tx.objectStore(STORE_NAMES.VIDEO_SYNC).get(sessionFileName);
  const result = await new Promise<VideoSyncRecord | undefined>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}

export async function deleteVideoSync(sessionFileName: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.VIDEO_SYNC, "readwrite");
  tx.objectStore(STORE_NAMES.VIDEO_SYNC).delete(sessionFileName);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
