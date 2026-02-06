/**
 * IndexedDB CRUD for the "notes" object store.
 * Reuses the same "dove-file-manager" database (version 4).
 */

export interface Note {
  id: string;
  fileName: string;
  text: string;
  createdAt: number;
  updatedAt: number;
}

const DB_NAME = "dove-file-manager";
const NOTES_STORE = "notes";
const DB_VERSION = 5;

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
      if (!db.objectStoreNames.contains("karts")) {
        db.createObjectStore("karts", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(NOTES_STORE)) {
        const store = db.createObjectStore(NOTES_STORE, { keyPath: "id" });
        store.createIndex("fileName", "fileName", { unique: false });
      }
      if (!db.objectStoreNames.contains("setups")) {
        const setupsStore = db.createObjectStore("setups", { keyPath: "id" });
        setupsStore.createIndex("kartId", "kartId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function listNotes(fileName: string): Promise<Note[]> {
  const db = await openDB();
  const tx = db.transaction(NOTES_STORE, "readonly");
  const index = tx.objectStore(NOTES_STORE).index("fileName");
  const request = index.getAll(fileName);
  const results = await new Promise<Note[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return results.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveNote(note: Note): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(NOTES_STORE, "readwrite");
  tx.objectStore(NOTES_STORE).put(note);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function deleteNote(id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(NOTES_STORE, "readwrite");
  tx.objectStore(NOTES_STORE).delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
