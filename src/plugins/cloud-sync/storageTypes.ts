// Storage types + limits for cloud sync.
//
// Two storage *types* (not to be confused with subscription tiers, which will
// scale these limits later): "documents" (garage data — vehicles, setups,
// templates, types, notes, metadata, graph prefs) and "logs" (raw session file
// blobs). The real limits + enforcement live server-side (the quota_limits
// table + trigger in the storage-quotas migration); these client values are the
// offline/advisory fallback for the meter and the pre-push check.
// sync_storage_usage() on the server is the source of truth the UI reads online.

import { FILE_STORE } from "./syncStores";

export type StorageType = "documents" | "logs";

/** Advisory fallback limits (bytes). Mirror of the server `quota_limits` seed. */
export const DEFAULT_LIMITS: Record<StorageType, number> = {
  documents: 5 * 1024 * 1024, // 5 MB
  logs: 20 * 1024 * 1024, // 20 MB
};

/** Which storage type a sync store belongs to. */
export function storageTypeForStore(store: string): StorageType {
  return store === FILE_STORE ? "logs" : "documents";
}

/** Approximate serialized byte size of a structured (document) record. */
export function docByteSize(record: unknown): number {
  return new TextEncoder().encode(JSON.stringify(record ?? null)).length;
}

export interface StorageTypeUsage {
  storageType: StorageType;
  usedBytes: number;
  limitBytes: number;
}

/** Fraction of the limit used, clamped to [0, 1]. */
export function usageFraction(u: Pick<StorageTypeUsage, "usedBytes" | "limitBytes">): number {
  if (u.limitBytes <= 0) return 0;
  return Math.min(1, u.usedBytes / u.limitBytes);
}

export function isOverLimit(usedBytes: number, limitBytes: number): boolean {
  return usedBytes > limitBytes;
}

/** Would adding `addBytes` to the current usage exceed the limit? */
export function wouldExceed(usedBytes: number, addBytes: number, limitBytes: number): boolean {
  return usedBytes + addBytes > limitBytes;
}

/** Human-readable byte size (KB/MB), 1 decimal for MB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
