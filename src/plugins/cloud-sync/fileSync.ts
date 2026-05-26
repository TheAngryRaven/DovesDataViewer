// Per-file sync selection state (opt-in, default off).
//
// Which files the user has chosen to sync lives in this plugin's own KV store
// (getPluginStore), keyed `file:<name>`. A record's presence means "selected";
// `pushedAt` means it has been uploaded at least once. Absence means "not
// synced". File blobs are immutable (same name = same bytes), so once pushed a
// file stays synced — no "modified" state needed for the blob itself.

import { getPluginStore } from "@/plugins/storage";

export type FileSyncState = "off" | "pending" | "synced";

export interface FileSyncRecord {
  pushedAt?: number;
}

const store = getPluginStore("cloud-sync");
const PREFIX = "file:";
const recordKey = (name: string) => `${PREFIX}${name}`;

/** Derive the UI state from a stored record. Pure — unit-tested. */
export function fileSyncStatus(rec: FileSyncRecord | undefined): FileSyncState {
  if (!rec) return "off";
  return rec.pushedAt ? "synced" : "pending";
}

export function getFileRecord(name: string): Promise<FileSyncRecord | undefined> {
  return store.get<FileSyncRecord>(recordKey(name));
}

/** Mark a file as selected for sync (not yet uploaded). */
export function selectFile(name: string): Promise<void> {
  return store.set<FileSyncRecord>(recordKey(name), {});
}

/** Record that a file has been uploaded to the cloud. */
export function markPushed(name: string): Promise<void> {
  return store.set<FileSyncRecord>(recordKey(name), { pushedAt: Date.now() });
}

/** Stop syncing a file. Additive: the cloud copy is left in place. */
export function unselectFile(name: string): Promise<void> {
  return store.delete(recordKey(name));
}

/** File names currently selected for sync. */
export async function listSelectedFiles(): Promise<string[]> {
  const keys = await store.keys();
  return keys.filter((k) => k.startsWith(PREFIX)).map((k) => k.slice(PREFIX.length));
}

/** Cloud file names that aren't present locally (i.e. pullable). Pure. */
export function cloudOnlyNames(cloudNames: string[], localNames: Iterable<string>): string[] {
  const local = new Set(localNames);
  return cloudNames.filter((n) => !local.has(n));
}

/**
 * Bucket object names with no matching index row — orphans to clean up. Pure.
 * Object names are URL-encoded file names (the bucket path segment), while index
 * keys are the raw file names, so each object name is decoded before comparing.
 */
export function orphanedObjectNames(
  objectNames: string[],
  indexedKeys: Iterable<string>,
): string[] {
  const indexed = new Set(indexedKeys);
  return objectNames.filter((n) => {
    let decoded = n;
    try {
      decoded = decodeURIComponent(n);
    } catch {
      // Malformed encoding — compare raw.
    }
    return !indexed.has(decoded);
  });
}
