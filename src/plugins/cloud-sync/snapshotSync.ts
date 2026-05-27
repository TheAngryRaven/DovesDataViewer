// Cloud sync for lap snapshots — a dedicated data type (NOT byte document
// storage), enforced by a per-tier COUNT quota server-side.
//
// Sync model (deliberately a hybrid of garage docs and log files):
//   • Always push on local save (like garage docs) — snapshots are valuable.
//   • A local delete NEVER deletes the cloud copy (like the log menu); the cloud
//     row is removed only explicitly here (deleteCloudSnapshot), which tombstones
//     the id so reconcile won't resurrect it.
//   • One cloud row per (user, course, engine): a faster lap upserts in place and
//     never increases the count.

import type { LapSnapshot } from "@/lib/lapSnapshot";
import { getSnapshot, listSnapshots, putSnapshotRaw } from "@/lib/lapSnapshotStorage";
import { isSnapshotQuotaError, lapSnapshotsTable } from "./cloudClient";
import {
  addSnapshotTombstone, clearSnapshotTombstone, snapshotTombstoneSet,
} from "./snapshotTombstones";

export interface CloudSnapshot {
  data: LapSnapshot;
  updatedAt?: string;
}

interface RawRow {
  course_key: string;
  engine_key: string;
  data: LapSnapshot;
  updated_at?: string;
}

/** Upsert one local snapshot to the cloud (no-op if gone locally or tombstoned). */
export async function pushSnapshot(userId: string, id: string): Promise<void> {
  if ((await snapshotTombstoneSet()).has(id)) return;
  const snap = await getSnapshot(id);
  if (!snap) return;
  const { error } = await lapSnapshotsTable().upsert(
    [{ user_id: userId, course_key: snap.courseKey, engine_key: snap.engineKey, data: snap }],
    { onConflict: "user_id,course_key,engine_key" },
  );
  if (error) throw new Error(error.message);
}

/** List the snapshots this user has in the cloud. */
export async function listCloudSnapshots(userId: string): Promise<CloudSnapshot[]> {
  const { data, error } = await lapSnapshotsTable()
    .select("course_key,engine_key,data,updated_at")
    .eq("user_id", userId);
  if (error) throw new Error(`Failed to list cloud snapshots: ${error.message}`);
  return ((data ?? []) as RawRow[])
    .map((r) => ({ data: r.data, updatedAt: r.updated_at }))
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

/**
 * Delete a snapshot from the cloud only (the local copy, if any, is kept). The id
 * is tombstoned so the next reconcile doesn't re-push the surviving local copy.
 */
export async function deleteCloudSnapshot(userId: string, snap: LapSnapshot): Promise<void> {
  const { error } = await lapSnapshotsTable()
    .delete()
    .eq("user_id", userId)
    .eq("course_key", snap.courseKey)
    .eq("engine_key", snap.engineKey);
  if (error) throw new Error(`Failed to delete cloud snapshot: ${error.message}`);
  await addSnapshotTombstone(snap.id);
}

export interface SnapshotReconcileResult {
  pulled: number;
  pushed: number;
  /** Local snapshots that didn't fit under the tier's count limit. */
  skipped: number;
}

/**
 * Two-way snapshot sync. Pull cloud copies down (additive — never deletes local),
 * then push local-only snapshots up, skipping tombstoned ids and counting any the
 * server rejects for the count quota. Last-write-wins by `updatedAt` on overlap.
 */
export async function reconcileSnapshots(userId: string): Promise<SnapshotReconcileResult> {
  const tombstones = await snapshotTombstoneSet();
  const cloud = await listCloudSnapshots(userId);
  const cloudById = new Map(cloud.map((c) => [c.data.id, c.data]));

  const local = await listSnapshots();
  const localById = new Map(local.map((s) => [s.id, s]));

  // Pull: cloud copy wins when it's newer or absent locally.
  let pulled = 0;
  for (const c of cloud) {
    const localCopy = localById.get(c.data.id);
    if (!localCopy || c.data.updatedAt > localCopy.updatedAt) {
      await putSnapshotRaw(c.data);
      pulled++;
    }
  }

  // Push: local snapshots the cloud lacks (or has an older copy of), unless the
  // user has explicitly removed them from the cloud (tombstoned).
  let pushed = 0;
  let skipped = 0;
  for (const s of local) {
    if (tombstones.has(s.id)) continue;
    const cloudCopy = cloudById.get(s.id);
    if (cloudCopy && cloudCopy.updatedAt >= s.updatedAt) continue;
    try {
      await pushSnapshot(userId, s.id);
      pushed++;
    } catch (err) {
      if (isSnapshotQuotaError(err)) skipped++;
      else throw err;
    }
  }

  return { pulled, pushed, skipped };
}

export { clearSnapshotTombstone };
