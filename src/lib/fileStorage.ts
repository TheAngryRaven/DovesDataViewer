/**
 * IndexedDB wrapper for storing/retrieving/deleting file blobs and file metadata.
 * Database: "dove-file-manager"
 * Object Stores: "files" (blobs), "metadata" (track/course per file)
 */

export interface FileEntry {
  name: string;
  size: number;
  savedAt: number;
}

export interface FileMetadata {
  fileName: string;
  trackName: string;
  courseName: string;
  // Cached weather station lookup
  weatherStationId?: string;
  weatherStationName?: string;
  weatherStationDistanceKm?: number;
}

interface StoredFile {
  name: string;
  data: Blob;
  size: number;
  savedAt: number;
}

const DB_NAME = "dove-file-manager";
const FILES_STORE = "files";
const META_STORE = "metadata";
const DB_VERSION = 4;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FILES_STORE)) {
        db.createObjectStore(FILES_STORE, { keyPath: "name" });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "fileName" });
      }
      if (!db.objectStoreNames.contains("karts")) {
        db.createObjectStore("karts", { keyPath: "id" });
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

export async function saveFile(name: string, data: Blob): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(FILES_STORE, "readwrite");
    const store = tx.objectStore(FILES_STORE);
    const record: StoredFile = { name, data, size: data.size, savedAt: Date.now() };
    store.put(record);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn("Failed to save file to IndexedDB:", e);
    throw e;
  }
}

export async function listFiles(): Promise<FileEntry[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(FILES_STORE, "readonly");
    const store = tx.objectStore(FILES_STORE);
    const request = store.getAll();
    const results = await new Promise<StoredFile[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return results
      .map(({ name, size, savedAt }) => ({ name, size, savedAt }))
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch (e) {
    console.warn("Failed to list files from IndexedDB:", e);
    return [];
  }
}

export async function getFile(name: string): Promise<Blob | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(FILES_STORE, "readonly");
    const store = tx.objectStore(FILES_STORE);
    const request = store.get(name);
    const result = await new Promise<StoredFile | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return result?.data ?? null;
  } catch (e) {
    console.warn("Failed to get file from IndexedDB:", e);
    return null;
  }
}

export async function deleteFile(name: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(FILES_STORE, "readwrite");
    const store = tx.objectStore(FILES_STORE);
    store.delete(name);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn("Failed to delete file from IndexedDB:", e);
    throw e;
  }
}

export async function saveFileMetadata(meta: FileMetadata): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(META_STORE, "readwrite");
    tx.objectStore(META_STORE).put(meta);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn("Failed to save file metadata:", e);
  }
}

export async function getFileMetadata(fileName: string): Promise<FileMetadata | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(META_STORE, "readonly");
    const request = tx.objectStore(META_STORE).get(fileName);
    const result = await new Promise<FileMetadata | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return result ?? null;
  } catch (e) {
    console.warn("Failed to get file metadata:", e);
    return null;
  }
}

export async function getStorageEstimate(): Promise<{ used: number; quota: number } | null> {
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      return { used: est.usage ?? 0, quota: est.quota ?? 0 };
    }
  } catch (e) {
    console.warn("Storage estimate unavailable:", e);
  }
  return null;
}
