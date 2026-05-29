// Cloud storage accounting for the unified, single-pool quota.
//
// There is ONE per-tier byte budget. Three kinds of data draw from it — they're
// segments of one bar, not separate quotas:
//   • documents — garage data (vehicles, setups, templates, types, notes, tracks,
//     metadata, graph prefs), stored as sync_records jsonb docs
//   • logs      — raw session file blobs (sync_records "files" index rows)
//   • snapshots — frozen course-fastest-lap captures (lap_snapshots rows)
//
// The real limit + enforcement live server-side (subscription_tiers.total_bytes +
// the pooled quota triggers); sync_storage_usage() is the authoritative readout the
// meter reads online. These client values are the offline/advisory fallback.

import { FILE_STORE } from "./syncStores";

/** A segment of the storage bar (also the document/log split for sync_records). */
export type StorageType = "documents" | "logs" | "snapshots";

/** Advisory fallback for the pooled limit (bytes) — the free tier's 50 MB budget. */
export const DEFAULT_TOTAL_LIMIT = 50 * 1024 * 1024;

/** Which sync_records segment a store belongs to (snapshots have their own table). */
export function storageTypeForStore(store: string): "documents" | "logs" {
  return store === FILE_STORE ? "logs" : "documents";
}

/** Per-segment used bytes + the single pooled limit they all share. */
export interface StorageUsage {
  documents: number;
  logs: number;
  snapshots: number;
  totalLimit: number;
}

/** Total bytes used across all three segments. */
export function totalUsed(u: Pick<StorageUsage, "documents" | "logs" | "snapshots">): number {
  return u.documents + u.logs + u.snapshots;
}

/** Fraction of the pooled limit used, clamped to [0, 1]. */
export function usageFraction(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(1, used / limit);
}

/**
 * Widths (as fractions of the bar) for the three stacked segments. Under the limit
 * the segments leave empty space; at/over the limit they're normalised to fill the
 * whole bar while keeping their relative proportions (a full bar = "you're maxed").
 */
export function segmentFractions(u: StorageUsage): Record<StorageType, number> {
  const limit = u.totalLimit > 0 ? u.totalLimit : 1;
  const raw: Record<StorageType, number> = {
    documents: Math.max(0, u.documents) / limit,
    logs: Math.max(0, u.logs) / limit,
    snapshots: Math.max(0, u.snapshots) / limit,
  };
  const sum = raw.documents + raw.logs + raw.snapshots;
  if (sum <= 1) return raw;
  return { documents: raw.documents / sum, logs: raw.logs / sum, snapshots: raw.snapshots / sum };
}

/** Human-readable byte size (B / KB / MB / GB). Rolls over at the rounded display
 *  value, so e.g. 1048575 reads "1.0 MB" rather than "1024 KB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = Math.round(bytes / 1024);
  if (kb < 1024) return `${kb} KB`;
  const mb = bytes / (1024 * 1024);
  if (Math.round(mb * 10) / 10 < 1024) return `${mb.toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
