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
import { getFile, listFiles, saveFile } from "@/lib/fileStorage";
import { syncRecords, userFiles, type SyncRecordRow } from "./cloudClient";
import { DOC_STORES, FILE_STORE, extractKey, type SyncSummary } from "./syncStores";

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

/** Mirror all local data (structured records + file blobs) up to the cloud. */
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

  const fileRows: SyncRecordRow[] = [];
  for (const file of await listFiles()) {
    const blob = await getFile(file.name);
    if (!blob) continue;
    const { error } = await userFiles().upload(blobPath(userId, file.name), blob, {
      upsert: true,
      contentType: blob.type || "application/octet-stream",
    });
    if (error) throw new Error(`Failed to upload ${file.name}: ${error.message}`);
    fileRows.push({
      user_id: userId,
      store: FILE_STORE,
      record_key: file.name,
      data: { size: file.size, savedAt: file.savedAt },
    });
  }
  if (fileRows.length) {
    const { error } = await syncRecords().upsert(fileRows, { onConflict: "user_id,store,record_key" });
    if (error) throw new Error(`Failed to push file index: ${error.message}`);
  }

  return { records: rows.length, files: fileRows.length };
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
      files++;
    } else if ((DOC_STORES as readonly string[]).includes(row.store)) {
      await writeOne(row.store, row.data);
      records++;
    }
  }
  return { records, files };
}
