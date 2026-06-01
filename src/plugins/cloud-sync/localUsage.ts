// On-device storage accounting — the logged-out (and offline) counterpart to the
// server's sync_storage_usage(). Sums the same three segments the cloud meter
// shows (garage documents + log blobs + lap snapshots) straight from IndexedDB /
// localStorage, so the storage bar works without an account: it just measures
// what's stored locally rather than what's synced.
//
// The pooled "limit" here is the browser's own storage quota (navigator.storage),
// not a plan cap — local storage is always free; the bar simply shows how much of
// the device budget the app is using.

import { getStorageEstimate, listFiles } from "@/lib/fileStorage";
import { listSnapshots } from "@/lib/lapSnapshotStorage";
import { DOC_STORES } from "./syncStores";
import { getAccessor } from "./storeAccessors";
import {
  DEFAULT_TOTAL_LIMIT, jsonBytes, snapshotBytes, type StorageUsage,
} from "./storageTypes";

/** Bytes used by garage documents stored on this device (all DOC_STORES). */
async function sumDocuments(): Promise<number> {
  let total = 0;
  for (const store of DOC_STORES) {
    for (const record of await getAccessor(store).readAll()) total += jsonBytes(record);
  }
  return total;
}

/** Bytes used by saved log file blobs on this device. */
async function sumLogs(): Promise<number> {
  return (await listFiles()).reduce((sum, f) => sum + (f.size ?? 0), 0);
}

/** Bytes used by lap snapshots saved on this device. */
async function sumSnapshots(): Promise<number> {
  return (await listSnapshots()).reduce((sum, s) => sum + snapshotBytes(s), 0);
}

/**
 * Local storage usage across the three segments, against the browser's storage
 * quota (falling back to the advisory free budget when the estimate is unavailable).
 */
export async function getLocalStorageUsage(): Promise<StorageUsage> {
  const [documents, logs, snapshots, estimate] = await Promise.all([
    sumDocuments(),
    sumLogs(),
    sumSnapshots(),
    getStorageEstimate(),
  ]);
  return {
    documents,
    logs,
    snapshots,
    totalLimit: estimate?.quota || DEFAULT_TOTAL_LIMIT,
  };
}
