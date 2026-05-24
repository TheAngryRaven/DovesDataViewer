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

import { withReadTransaction, withWriteTransaction } from "@/lib/dbUtils";
import { getFile, saveFile } from "@/lib/fileStorage";
import { syncRecords, userFiles, type SyncRecordRow } from "./cloudClient";
import { DOC_STORES, FILE_STORE, extractKey, type SyncSummary } from "./syncStores";
import { listSelectedFiles, markPushed } from "./fileSync";

export type { SyncSummary };

/** Storage object path for a file blob, scoped to the user's folder. */
function blobPath(userId: string, name: string): string {
  return `${userId}/${encodeURIComponent(name)}`;
}

async function readAll(store: string): Promise<Record<string, unknown>[]> {
  return withReadTransaction<Record<string, unknown>[]>(store, (s) => s.getAll());
}

async function writeOne(store: string, record: unknown): Promise<void> {
  await withWriteTransaction(store, (s) => s.put(record as Record<string, unknown>));
}

/** Upload one local file blob + its index row. Returns false if not stored locally. */
async function uploadBlob(userId: string, name: string): Promise<boolean> {
  const blob = await getFile(name);
  if (!blob) return false;
  const { error: upErr } = await userFiles().upload(blobPath(userId, name), blob, {
    upsert: true,
    contentType: blob.type || "application/octet-stream",
  });
  if (upErr) throw new Error(`Failed to upload ${name}: ${upErr.message}`);
  const { error } = await syncRecords().upsert(
    [{ user_id: userId, store: FILE_STORE, record_key: name, data: { size: blob.size } }],
    { onConflict: "user_id,store,record_key" },
  );
  if (error) throw new Error(`Failed to index ${name}: ${error.message}`);
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
}

/** List the files this user has in the cloud (the file index rows). */
export async function listCloudFiles(userId: string): Promise<CloudFile[]> {
  const { data, error } = await syncRecords()
    .select("record_key,data")
    .eq("user_id", userId)
    .eq("store", FILE_STORE);
  if (error) throw new Error(`Failed to list cloud files: ${error.message}`);
  return ((data ?? []) as { record_key: string; data: { size?: number } | null }[]).map((r) => ({
    name: r.record_key,
    size: r.data?.size,
  }));
}

/** Download a single file blob from the cloud (does not persist it locally). */
export async function downloadCloudFile(userId: string, name: string): Promise<Blob | null> {
  const { data, error } = await userFiles().download(blobPath(userId, name));
  if (error || !data) return null;
  return data;
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
  if (rows.length) {
    const { error } = await syncRecords().upsert(rows, { onConflict: "user_id,store,record_key" });
    if (error) throw new Error(`Failed to push records: ${error.message}`);
  }

  let files = 0;
  for (const name of await listSelectedFiles()) {
    if (await uploadBlob(userId, name)) {
      await markPushed(name);
      files++;
    }
  }

  return { records: rows.length, files };
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
  return { records, files };
}
