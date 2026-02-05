/**
 * IndexedDB CRUD for the "karts" object store.
 * Reuses the same "dove-file-manager" database (version 3).
 */

export interface Kart {
  id: string;
  name: string;
  engine: string;
  number: number;
  weight: number;
  weightUnit: "lb" | "kg";
}

const DB_NAME = "dove-file-manager";
const KARTS_STORE = "karts";
const DB_VERSION = 4;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("files")) {
        db.createObjectStore("files", { keyPath: "name" });
      }
      if (!db.objectStoreNames.contains("metadata")) {
        db.createObjectStore("metadata", { keyPath: "fileName" });
      }
      if (!db.objectStoreNames.contains(KARTS_STORE)) {
        db.createObjectStore(KARTS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("notes")) {
        const notesStore = db.createObjectStore("notes", { keyPath: "id" });
        notesStore.createIndex("fileName", "fileName", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

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
