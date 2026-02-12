/**
 * Shared IndexedDB utilities.
 * All storage modules share the same database ("dove-file-manager") and version.
 * The schema is defined here once to avoid duplication across storage files.
 */

export const DB_NAME = "dove-file-manager";
export const DB_VERSION = 6;

export const STORE_NAMES = {
  FILES: "files",
  METADATA: "metadata",
  KARTS: "karts",
  NOTES: "notes",
  SETUPS: "setups",
  VIDEO_SYNC: "video-sync",
} as const;

/**
 * Open the shared IndexedDB database, creating/upgrading all object stores as needed.
 */
export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAMES.FILES)) {
        db.createObjectStore(STORE_NAMES.FILES, { keyPath: "name" });
      }
      if (!db.objectStoreNames.contains(STORE_NAMES.METADATA)) {
        db.createObjectStore(STORE_NAMES.METADATA, { keyPath: "fileName" });
      }
      if (!db.objectStoreNames.contains(STORE_NAMES.KARTS)) {
        db.createObjectStore(STORE_NAMES.KARTS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_NAMES.NOTES)) {
        const notesStore = db.createObjectStore(STORE_NAMES.NOTES, { keyPath: "id" });
        notesStore.createIndex("fileName", "fileName", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_NAMES.SETUPS)) {
        const setupsStore = db.createObjectStore(STORE_NAMES.SETUPS, { keyPath: "id" });
        setupsStore.createIndex("kartId", "kartId", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_NAMES.VIDEO_SYNC)) {
        db.createObjectStore(STORE_NAMES.VIDEO_SYNC, { keyPath: "sessionFileName" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Run a readwrite transaction on a store and wait for it to complete.
 */
export async function withWriteTransaction<T>(
  storeName: string,
  operation: (store: IDBObjectStore) => IDBRequest | void
): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(storeName, "readwrite");
  const store = tx.objectStore(storeName);
  operation(store);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/**
 * Run a readonly transaction and return the result.
 */
export async function withReadTransaction<T>(
  storeName: string,
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDB();
  const tx = db.transaction(storeName, "readonly");
  const store = tx.objectStore(storeName);
  const request = operation(store);
  const result = await new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}
