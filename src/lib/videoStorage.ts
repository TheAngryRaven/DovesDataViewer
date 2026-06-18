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

/**
 * One chunk of a multi-file recording (e.g. a GoPro chapter). The file handle
 * lets the playlist be restored after reload; durationSec is cached so the
 * virtual timeline rebuilds without re-reading each file's metadata.
 */
export interface VideoSyncChunk {
  fileName: string;
  fileHandle?: FileSystemFileHandle;
  durationSec: number;
}

export interface VideoSyncRecord {
  sessionFileName: string;
  /** First chunk's handle — kept for single-file back-compat. */
  fileHandle?: FileSystemFileHandle;
  syncOffsetMs: number;
  videoFileName: string;
  isLocked?: boolean;
  overlaySettings?: OverlaySettings;
  /** Ordered chunks of a chunked recording. Absent for legacy single-file records. */
  chunks?: VideoSyncChunk[];
}

/** Migrate old overlay settings format to new */
function migrateOverlaySettings(raw: unknown): OverlaySettings {
  if (!raw || typeof raw !== "object") return DEFAULT_OVERLAY_SETTINGS;

  // New format already — has overlays array
  if (Array.isArray((raw as { overlays?: unknown }).overlays)) {
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
