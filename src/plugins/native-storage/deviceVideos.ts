/**
 * Pure logic behind the "Videos on this device" card (see DeviceVideosPanel):
 * ordering, totals, labels, and applying a removal to a listing. No React, no
 * bridge — unit-tested; the panel stays a thin view.
 */

import type { NativeStoredVideoEntry } from "@/lib/nativeVideoStore";

/** Human-readable byte size. Videos are GB-scale, so GB gets two decimals. */
export function formatVideoBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/** Newest first; copies without a timestamp (an earlier shell) last, by name. */
export function sortDeviceVideos(entries: readonly NativeStoredVideoEntry[]): NativeStoredVideoEntry[] {
  return [...entries].sort(
    (a, b) => (b.storedAtMs ?? 0) - (a.storedAtMs ?? 0) || a.fileName.localeCompare(b.fileName),
  );
}

export function totalDeviceVideoBytes(entries: readonly NativeStoredVideoEntry[]): number {
  return entries.reduce((sum, e) => sum + e.size, 0);
}

/**
 * The session a copy belongs to, as shown: the session file name without its
 * extension. `null` for copies stored before the shell recorded it.
 */
export function sessionLabel(entry: NativeStoredVideoEntry): string | null {
  const name = entry.sessionFileName?.trim();
  if (!name) return null;
  return name.replace(/\.[^./\\]+$/, "");
}

/** A listing after a removal, without a round-trip: `null` keys = everything went. */
export function withoutRemoved(
  entries: readonly NativeStoredVideoEntry[],
  removedKeys: readonly string[] | null,
): NativeStoredVideoEntry[] {
  if (removedKeys === null) return [];
  const gone = new Set(removedKeys);
  return entries.filter((e) => !gone.has(e.key));
}
