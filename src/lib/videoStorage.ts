/**
 * IndexedDB persistence for video sync data.
 * Stores FileSystemFileHandle, sync offset, and video filename per session.
 */

import { openDB, STORE_NAMES } from "./dbUtils";
import type { OverlaySettings, OverlayInstance, LegacyOverlaySettings, OverlayPosition } from "@/components/video-overlays/types";
import { DEFAULT_OVERLAY_SETTINGS } from "@/components/video-overlays/types";
import { generateOverlayId } from "@/components/video-overlays/registry";

// Re-export for backward compat
export type { OverlayPosition, OverlaySettings };
export { DEFAULT_OVERLAY_SETTINGS };

export interface VideoSyncRecord {
  sessionFileName: string;
  fileHandle?: FileSystemFileHandle;
  syncOffsetMs: number;
  videoFileName: string;
  isLocked?: boolean;
  overlaySettings?: OverlaySettings;
}

/** Migrate old overlay settings format to new */
function migrateOverlaySettings(raw: any): OverlaySettings {
  if (!raw) return DEFAULT_OVERLAY_SETTINGS;

  // New format already — has overlays array
  if (Array.isArray(raw.overlays)) {
    return raw as OverlaySettings;
  }

  // Old format: { showSpeed, overlaysLocked, positions }
  const legacy = raw as LegacyOverlaySettings;
  const overlays: OverlayInstance[] = [];

  if (legacy.showSpeed) {
    const pos = legacy.positions?.speed ?? { x: 3, y: 3 };
    overlays.push({
      id: generateOverlayId(),
      type: "digital",
      dataSource: "speed",
      theme: "classic",
      colorMode: "dark",
      opacity: 1,
      position: { x: pos.x, y: pos.y, scale: pos.scale ?? 1 },
      visible: true,
    });
  }

  return {
    overlaysLocked: legacy.overlaysLocked ?? true,
    overlays,
  };
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
    request.onsuccess = () => {
      const record = request.result;
      if (record && record.overlaySettings) {
        record.overlaySettings = migrateOverlaySettings(record.overlaySettings);
      }
      resolve(record);
    };
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
