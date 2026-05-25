// Push/pull sync engine.
//
// Manual, directional sync (no background daemon): "push" mirrors local data up
// to the cloud, "pull" brings the cloud copy down. On a key collision the active
// direction wins (push → cloud takes local; pull → local takes cloud). Neither
// direction deletes the other side's extra records, so sync is additive — a
// missing record is never inferred as a deletion. (Deletion propagation and
// timestamp-based merge are deliberate follow-ups.)
//
// All structured stores are handled generically through IndexedDB + jsonb, so
// adding a new syncable store is a single entry in syncStores.ts. File blobs
// can't live in jsonb, so they round-trip through the Storage bucket instead.

import { getFile, saveFile } from "@/lib/fileStorage";
import { getAccessor } from "./storeAccessors";
import { fetchStorageUsage, isQuotaError, syncRecords, userFiles, type SyncRecordRow } from "./cloudClient";
import { DOC_STORES, FILE_STORE, extractKey, type SyncSummary } from "./syncStores";
import { listSelectedFiles, markPushed, orphanedObjectNames } from "./fileSync";
import { DEFAULT_LIMITS, type StorageType, type StorageTypeUsage } from "./storageTypes";
import { decideSync, pendingId, recordUpdatedAt } from "./merge";

export type { SyncSummary };

/** Storage object path for a file blob, scoped to the user's folder. */
function blobPath(userId: string, name: string): string {
  return `${userId}/${encodeURIComponent(name)}`;
}

// Route through the per-store accessor (IndexedDB for most stores, localStorage
// for tracks) instead of assuming IndexedDB.
async function readAll(store: string): Promise<Record<string, unknown>[]> {
  return getAccessor(store).readAll();
}

async function writeOne(store: string, record: unknown): Promise<void> {
  await getAccessor(store).putOne(record as Record<string, unknown>);
}

/** Upload one local file blob + its index row. Returns false if not stored locally. */
async function uploadBlob(userId: string, name: string): Promise<boolean> {
  const blob = await getFile(name);
  if (!blob) return false;
  const path = blobPath(userId, name);
  const { error: upErr } = await userFiles().upload(path, blob, {
    upsert: true,
    contentType: blob.type || "application/octet-stream",
  });
  if (upErr) throw new Error(`Failed to upload ${name}: ${upErr.message}`);
  const { error } = await syncRecords().upsert(
    [{ user_id: userId, store: FILE_STORE, record_key: name, data: { size: blob.size } }],
    { onConflict: "user_id,store,record_key" },
  );
  if (error) {
    // The blob is uploaded but its index row was rejected (e.g. the server
    // quota trigger). Roll the blob back so it can't orphan in the bucket.
    await userFiles().remove([path]).catch(() => {});
    throw new Error(`Failed to index ${name}: ${error.message}`);
  }
  return true;
}

/** Push a single selected file and mark it synced. Throws if not stored locally. */
export async function pushFile(userId: string, name: string): Promise<void> {
  if (!(await uploadBlob(userId, name))) throw new Error(`File not found locally: ${name}`);
  await markPushed(name);
}

export interface CloudFile {
  name: string;
  size?: number;
  /** When the file was last uploaded (ISO string from the index row). */
  uploadedAt?: string;
}

/** List the files this user has in the cloud (the file index rows). */
export async function listCloudFiles(userId: string): Promise<CloudFile[]> {
  const { data, error } = await syncRecords()
    .select("record_key,data,updated_at")
    .eq("user_id", userId)
    .eq("store", FILE_STORE);
  if (error) throw new Error(`Failed to list cloud files: ${error.message}`);
  return (
    (data ?? []) as { record_key: string; data: { size?: number } | null; updated_at?: string }[]
  ).map((r) => ({
    name: r.record_key,
    size: r.data?.size,
    uploadedAt: r.updated_at,
  }));
}

/**
 * Delete one log file from the cloud: the blob in the bucket + its index row.
 * Does NOT touch any device's local copy — callers handle local deletion
 * separately (and only for the current device).
 */
export async function deleteCloudFile(userId: string, name: string): Promise<void> {
  const { error: rmErr } = await userFiles().remove([blobPath(userId, name)]);
  if (rmErr) throw new Error(`Failed to delete cloud file: ${rmErr.message}`);
  const { error } = await syncRecords()
    .delete()
    .eq("user_id", userId)
    .eq("store", FILE_STORE)
    .eq("record_key", name);
  if (error) throw new Error(`Failed to remove cloud file index: ${error.message}`);
}

/**
 * Remove bucket blobs that have no `sync_records` index row (orphans — e.g. left
 * by an interrupted upload before the rollback fix). Returns the count removed.
 */
export async function cleanupOrphanBlobs(userId: string): Promise<number> {
  const { data: objects, error: listErr } = await userFiles().list(userId, { limit: 1000 });
  if (listErr || !objects) return 0;
  const { data: rows } = await syncRecords()
    .select("record_key")
    .eq("user_id", userId)
    .eq("store", FILE_STORE);
  const indexed = (rows ?? []).map((r) => (r as { record_key: string }).record_key);
  const orphans = orphanedObjectNames(objects.map((o) => o.name), indexed);
  if (!orphans.length) return 0;
  const { error: rmErr } = await userFiles().remove(orphans.map((n) => `${userId}/${n}`));
  if (rmErr) return 0;
  return orphans.length;
}

/** Download a single file blob from the cloud (does not persist it locally). */
export async function downloadCloudFile(userId: string, name: string): Promise<Blob | null> {
  const { data, error } = await userFiles().download(blobPath(userId, name));
  if (error || !data) return null;
  return data;
}

/**
 * Push document rows in one batch (the common, under-limit case). If the server
 * quota trigger rejects the batch, the whole statement rolls back — so fall back
 * to per-record upserts, saving everything that still fits and reporting the rest
 * as `skipped`, instead of failing the entire sync. Non-quota errors still throw.
 */
async function pushDocRows(rows: SyncRecordRow[]): Promise<{ pushed: number; skipped: number }> {
  if (!rows.length) return { pushed: 0, skipped: 0 };
  const { error } = await syncRecords().upsert(rows, { onConflict: "user_id,store,record_key" });
  if (!error) return { pushed: rows.length, skipped: 0 };
  if (!isQuotaError(new Error(error.message))) {
    throw new Error(`Failed to push documents: ${error.message}`);
  }
  let pushed = 0;
  let skipped = 0;
  for (const row of rows) {
    const { error: rowErr } = await syncRecords().upsert([row], {
      onConflict: "user_id,store,record_key",
    });
    if (!rowErr) pushed++;
    else if (isQuotaError(new Error(rowErr.message))) skipped++;
    else throw new Error(`Failed to push documents: ${rowErr.message}`);
  }
  return { pushed, skipped };
}

/**
 * Mirror local data up to the cloud: all structured (garage) records, plus only
 * the files the user has selected for sync.
 */
export async function pushAll(userId: string): Promise<SyncSummary> {
  const rows: SyncRecordRow[] = [];
  for (const store of DOC_STORES) {
    for (const record of await readAll(store)) {
      rows.push({ user_id: userId, store, record_key: extractKey(store, record), data: record });
    }
  }
  const { pushed, skipped } = await pushDocRows(rows);

  let files = 0;
  for (const name of await listSelectedFiles()) {
    if (await uploadBlob(userId, name)) {
      await markPushed(name);
      files++;
    }
  }

  return { records: pushed, files, skipped };
}

/** Bring the cloud copy down into local IndexedDB. */
export async function pullAll(userId: string): Promise<SyncSummary> {
  const { data, error } = await syncRecords()
    .select("store,record_key,data")
    .eq("user_id", userId);
  if (error) throw new Error(`Failed to read cloud records: ${error.message}`);

  const rows = (data ?? []) as Pick<SyncRecordRow, "store" | "record_key" | "data">[];
  let records = 0;
  let files = 0;
  for (const row of rows) {
    if (row.store === FILE_STORE) {
      const { data: blob, error: dlError } = await userFiles().download(blobPath(userId, row.record_key));
      if (dlError || !blob) continue;
      await saveFile(row.record_key, blob);
      await markPushed(row.record_key); // pulled files are now synced locally
      files++;
    } else if ((DOC_STORES as readonly string[]).includes(row.store)) {
      await writeOne(row.store, row.data);
      records++;
    }
  }
  return { records, files, skipped: 0 };
}

// ── Incremental (auto) sync ──────────────────────────────────────────────────

/**
 * Upsert one document record to the cloud by reading it from its local store.
 * No-op if the record is already gone locally. Throws on a backend error
 * (including the server quota rejection — see `isQuotaError`).
 */
export async function pushRecord(userId: string, store: string, key: string): Promise<void> {
  const record = await getAccessor(store).getOne(key);
  if (record == null) return;
  const { error } = await syncRecords().upsert(
    [{ user_id: userId, store, record_key: key, data: record }],
    { onConflict: "user_id,store,record_key" },
  );
  if (error) throw new Error(error.message);
}

/** Delete one document record from the cloud (deletion propagation). */
export async function deleteRecord(userId: string, store: string, key: string): Promise<void> {
  const { error } = await syncRecords()
    .delete()
    .eq("user_id", userId)
    .eq("store", store)
    .eq("record_key", key);
  if (error) throw new Error(error.message);
}

export interface DocReconcileResult {
  pulled: number;
  pushed: number;
  /** Records that didn't fit under the documents quota (partial push). */
  skipped: number;
}

/**
 * Timestamp-aware two-way merge of the document stores (no file blobs):
 *  - newer side wins by the record's own `updatedAt` (last-write-wins);
 *  - local-only records push up (anon→account migration);
 *  - cloud-only records pull down;
 *  - anything in `pendingKeys` is treated as priority-1 local and pushed,
 *    overriding the timestamp comparison.
 * Local writes go through `writeOne` (no garage event), so a pull doesn't echo
 * back as a change. Run this AFTER flushing pending deletes.
 */
export async function reconcileDocs(
  userId: string,
  pendingKeys: Set<string>,
): Promise<DocReconcileResult> {
  const { data, error } = await syncRecords()
    .select("store,record_key,data")
    .eq("user_id", userId);
  if (error) throw new Error(`Failed to read cloud documents: ${error.message}`);

  const cloud = new Map<string, { store: string; key: string; data: unknown; t: number }>();
  for (const row of (data ?? []) as Pick<SyncRecordRow, "store" | "record_key" | "data">[]) {
    if ((DOC_STORES as readonly string[]).includes(row.store)) {
      cloud.set(pendingId(row.store, row.record_key), {
        store: row.store,
        key: row.record_key,
        data: row.data,
        t: recordUpdatedAt(row.data),
      });
    }
  }

  let pulled = 0;
  const toPush: SyncRecordRow[] = [];
  const seen = new Set<string>();

  for (const store of DOC_STORES) {
    for (const record of await readAll(store)) {
      const key = extractKey(store, record);
      const id = pendingId(store, key);
      seen.add(id);
      const c = cloud.get(id);
      const action = decideSync({
        hasLocal: true,
        hasCloud: !!c,
        localT: recordUpdatedAt(record),
        cloudT: c?.t ?? 0,
        pending: pendingKeys.has(id),
      });
      if (action === "push") {
        toPush.push({ user_id: userId, store, record_key: key, data: record });
      } else if (action === "pull" && c) {
        await writeOne(store, c.data);
        pulled++;
      }
    }
  }

  // Cloud-only records (not present locally) → pull down.
  for (const [id, c] of cloud) {
    if (seen.has(id)) continue;
    const action = decideSync({
      hasLocal: false,
      hasCloud: true,
      localT: 0,
      cloudT: c.t,
      pending: pendingKeys.has(id),
    });
    if (action === "pull") {
      await writeOne(c.store, c.data);
      pulled++;
    }
  }

  const { pushed, skipped } = await pushDocRows(toPush);
  return { pulled, pushed, skipped };
}

/** Per-type storage usage from the server, with the advisory limits as fallback. */
export async function getStorageUsage(): Promise<StorageTypeUsage[]> {
  const rows = await fetchStorageUsage();
  const byType = new Map(rows.map((r) => [r.storage_type, r]));
  const types: StorageType[] = ["documents", "logs"];
  return types.map((storageType) => {
    const row = byType.get(storageType);
    return {
      storageType,
      usedBytes: row?.used_bytes ?? 0,
      limitBytes: row?.limit_bytes ?? DEFAULT_LIMITS[storageType],
    };
  });
}
