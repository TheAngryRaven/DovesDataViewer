// IndexedDB CRUD for the immutable "setup-revisions" store.
//
// Revisions are content-addressed (id = SHA-256 of the setup content), so they
// are write-once and dedup naturally: freezing an unchanged setup re-derives the
// same id and is a no-op. The pure freeze/hash logic lives in `setupRevision.ts`.

import { openDB, STORE_NAMES } from './dbUtils';
import { emitGarageChange } from './garageEvents';
import { getSetup, listSetups } from './setupStorage';
import { getTemplate } from './templateStorage';
import { listAllMetadata } from './fileStorage';
import { buildSetupRevision, findPrunableRevisionIds, type SetupRevision } from './setupRevision';

const STORE = STORE_NAMES.SETUP_REVISIONS;

export async function getSetupRevision(id: string): Promise<SetupRevision | null> {
  const db = await openDB();
  const tx = db.transaction(STORE, "readonly");
  const request = tx.objectStore(STORE).get(id);
  const result = await new Promise<SetupRevision | undefined>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result ?? null;
}

export async function listSetupRevisions(): Promise<SetupRevision[]> {
  const db = await openDB();
  const tx = db.transaction(STORE, "readonly");
  const request = tx.objectStore(STORE).getAll();
  const results = await new Promise<SetupRevision[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return results.sort((a, b) => b.createdAt - a.createdAt);
}

async function putRevision(rev: SetupRevision): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(rev);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/**
 * Freeze the current state of a live setup into an immutable, content-addressed
 * revision and return its id (hash). Idempotent: if a revision with the same
 * content already exists it is kept (original createdAt preserved, no garage
 * event) and only its `updatedAt` is bumped to `now`, so the retention sweep
 * treats "saved again today" as fresh. Returns null if the setup no longer exists.
 *
 * The garage event a new revision emits is a *candidate* push: the cloud-sync
 * plugin only uploads revisions a session references (plan 0028), so an edit
 * that was never run stays on this device.
 */
export async function freezeSetupRevision(
  setupId: string,
  now: number = Date.now(),
): Promise<string | null> {
  const setup = await getSetup(setupId);
  if (!setup) return null;
  const template = setup.templateId ? await getTemplate(setup.templateId) : null;
  const rev = await buildSetupRevision({ setup, template });

  const existing = await getSetupRevision(rev.id);
  if (existing) {
    if (existing.updatedAt < now) await putRevision({ ...existing, updatedAt: now });
    return existing.id;
  }

  await putRevision({ ...rev, createdAt: now, updatedAt: now });
  emitGarageChange({ store: STORE, key: rev.id, type: "put" });
  return rev.id;
}

/** Every revision id some session's `FileMetadata.sessionSetupRev` points at. */
export async function referencedSetupRevisionIds(): Promise<Set<string>> {
  const metas = await listAllMetadata();
  return new Set(metas.map((m) => m.sessionSetupRev).filter((r): r is string => !!r));
}

/**
 * Delete one revision locally and emit a garage event. The cloud-sync plugin
 * treats a revision delete specially — it tombstones the id (so reconcile won't
 * re-pull it) rather than removing the cloud copy another device may still need.
 */
export async function deleteSetupRevision(id: string): Promise<void> {
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

/**
 * Retention sweep (plan 0028): delete revisions `findPrunableRevisionIds` names —
 * unreferenced by any session, older than `REVISION_RETENTION_MS`, and not the
 * newest unreferenced revision of a live setup. Returns the ids removed. Cheap
 * (three reads), always safe offline; the cloud copy is never touched (only
 * tombstoned, by the sync plugin reacting to the delete events).
 */
export async function pruneSetupRevisions(now: number = Date.now()): Promise<string[]> {
  const [revisions, referenced, setups] = await Promise.all([
    listSetupRevisions(), referencedSetupRevisionIds(), listSetups(),
  ]);
  const prunable = findPrunableRevisionIds(revisions, referenced, setups.map((s) => s.id), now);
  for (const id of prunable) await deleteSetupRevision(id);
  return prunable;
}

/**
 * Best-effort `pruneSetupRevisions` for UI call sites (garage mount, history
 * panel open): never throws, returns null when the sweep failed.
 */
export async function pruneSetupRevisionsSafely(): Promise<string[] | null> {
  try {
    return await pruneSetupRevisions();
  } catch (e) {
    console.warn("Setup-revision sweep skipped:", e);
    return null;
  }
}
