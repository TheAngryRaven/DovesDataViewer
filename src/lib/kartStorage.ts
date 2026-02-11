/**
 * IndexedDB CRUD for the "karts" object store.
 */

import { openDB, STORE_NAMES } from './dbUtils';

export interface Kart {
  id: string;
  name: string;
  engine: string;
  number: number;
  weight: number;
  weightUnit: "lb" | "kg";
}

const KARTS_STORE = STORE_NAMES.KARTS;

export async function saveKart(kart: Kart): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(KARTS_STORE, "readwrite");
  tx.objectStore(KARTS_STORE).put(kart);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function listKarts(): Promise<Kart[]> {
  const db = await openDB();
  const tx = db.transaction(KARTS_STORE, "readonly");
  const request = tx.objectStore(KARTS_STORE).getAll();
  const results = await new Promise<Kart[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return results;
}

export async function getKart(id: string): Promise<Kart | null> {
  const db = await openDB();
  const tx = db.transaction(KARTS_STORE, "readonly");
  const request = tx.objectStore(KARTS_STORE).get(id);
  const result = await new Promise<Kart | undefined>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result ?? null;
}

export async function deleteKart(id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(KARTS_STORE, "readwrite");
  tx.objectStore(KARTS_STORE).delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
