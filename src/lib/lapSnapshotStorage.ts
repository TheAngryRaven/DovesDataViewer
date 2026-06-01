// IndexedDB CRUD for the "lap-snapshots" object store.
//
// Local-first and unlimited on-device (the cloud count quota is enforced
// server-side by the sync plugin). Saving emits a garage change so the cloud-sync
// plugin can push it; unlike garage docs, a local DELETE never propagates to the
// cloud (the sync plugin ignores snapshot deletes) — the cloud copy is removed
// only explicitly from the profile page, just like the log menu.

import { openDB, STORE_NAMES } from "./dbUtils";
import { emitGarageChange } from "./garageEvents";
import type { LapSnapshot } from "./lapSnapshot";

const STORE = STORE_NAMES.LAP_SNAPSHOTS;

function reqPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** All snapshots, newest first. */
export async function listSnapshots(): Promise<LapSnapshot[]> {
  const db = await openDB();
  const tx = db.transaction(STORE, "readonly");
  const all = await reqPromise<LapSnapshot[]>(tx.objectStore(STORE).getAll());
  db.close();
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Snapshots for one course (any engine), sorted fastest-first. */
export async function listSnapshotsForCourse(courseKey: string): Promise<LapSnapshot[]> {
  const db = await openDB();
  const tx = db.transaction(STORE, "readonly");
  const all = await reqPromise<LapSnapshot[]>(tx.objectStore(STORE).index("courseKey").getAll(courseKey));
  db.close();
  return all.sort((a, b) => a.lapTimeMs - b.lapTimeMs);
}

export async function getSnapshot(id: string): Promise<LapSnapshot | null> {
  const db = await openDB();
  const tx = db.transaction(STORE, "readonly");
  const result = await reqPromise<LapSnapshot | undefined>(tx.objectStore(STORE).get(id));
  db.close();
  return result ?? null;
}

/** Save (or replace) a snapshot and notify the sync plugin to push it. */
export async function saveSnapshot(snap: LapSnapshot): Promise<void> {
  await putSnapshotRaw({ ...snap, updatedAt: Date.now() });
  emitGarageChange({ store: STORE, key: snap.id, type: "put" });
}

/**
 * Write without emitting a garage event or re-stamping — the cloud pull path
 * (mirrors the sync engine's `putOne`), so a pulled snapshot doesn't echo back.
 */
export async function putSnapshotRaw(snap: LapSnapshot): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(snap);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/** Delete locally. The cloud copy is untouched (deletes don't propagate). */
export async function deleteSnapshot(id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  emitGarageChange({ store: STORE, key: id, type: "delete" });
}
