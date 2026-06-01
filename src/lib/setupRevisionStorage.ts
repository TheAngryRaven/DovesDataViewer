// IndexedDB CRUD for the immutable "setup-revisions" store.
//
// Revisions are content-addressed (id = SHA-256 of the setup content), so they
// are write-once and dedup naturally: freezing an unchanged setup re-derives the
// same id and is a no-op. The pure freeze/hash logic lives in `setupRevision.ts`.

import { openDB, STORE_NAMES } from './dbUtils';
import { emitGarageChange } from './garageEvents';
import { getSetup } from './setupStorage';
import { getTemplate } from './templateStorage';
import { listAllMetadata } from './fileStorage';
import {
  buildSetupRevision, findOrphanRevisionIds, shouldPrune,
  type SetupRevision,
} from './setupRevision';

const STORE = STORE_NAMES.SETUP_REVISIONS;

/** localStorage key holding the last orphan-prune time (ms). */
const PRUNE_TS_KEY = "dove:setup-revisions:lastPrune";

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
 * content already exists, the existing one is kept (original createdAt preserved,
 * no write, no sync churn). Returns null if the setup no longer exists.
 */
export async function freezeSetupRevision(setupId: string): Promise<string | null> {
  const setup = await getSetup(setupId);
  if (!setup) return null;
  const template = setup.templateId ? await getTemplate(setup.templateId) : null;
  const rev = await buildSetupRevision({ setup, template });

  const existing = await getSetupRevision(rev.id);
  if (existing) return existing.id; // dedup — same content, keep the original revision

  await putRevision(rev);
  emitGarageChange({ store: STORE, key: rev.id, type: "put" });
  return rev.id;
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
 * Sweep revisions no session references (orphans) and delete them. A revision is
 * referenced when some `FileMetadata.sessionSetupRev` equals its id. Returns the
 * ids removed. Always safe offline; the cloud copy is never touched (only
 * tombstoned, by the sync plugin reacting to the delete events).
 */
export async function pruneSetupRevisions(): Promise<string[]> {
  const [revisions, metas] = await Promise.all([listSetupRevisions(), listAllMetadata()]);
  const referenced = metas
    .map((m) => m.sessionSetupRev)
    .filter((r): r is string => !!r);
  const orphans = findOrphanRevisionIds(revisions.map((r) => r.id), referenced);
  for (const id of orphans) await deleteSetupRevision(id);
  return orphans;
}

/**
 * Run `pruneSetupRevisions` at most once per `PRUNE_INTERVAL_MS` (throttled via
 * localStorage), best-effort. Returns the pruned ids, or null when it was skipped
 * (not yet due) or failed. Call on app start.
 */
export async function maybePruneSetupRevisions(now: number = Date.now()): Promise<string[] | null> {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(PRUNE_TS_KEY) : null;
    const lastRun = raw ? Number(raw) : null;
    if (!shouldPrune(Number.isFinite(lastRun) ? lastRun : null, now)) return null;
    const pruned = await pruneSetupRevisions();
    if (typeof localStorage !== "undefined") localStorage.setItem(PRUNE_TS_KEY, String(now));
    return pruned;
  } catch (e) {
    console.warn("Setup-revision prune skipped:", e);
    return null;
  }
}
