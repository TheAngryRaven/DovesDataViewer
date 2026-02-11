/**
 * IndexedDB wrapper for storing/retrieving/deleting file blobs and file metadata.
 */

import { openDB, STORE_NAMES } from './dbUtils';

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
  // Session kart/setup link
  sessionKartId?: string;
  sessionSetupId?: string;
}

interface StoredFile {
  name: string;
  data: Blob;
  size: number;
  savedAt: number;
}

const FILES_STORE = STORE_NAMES.FILES;
const META_STORE = STORE_NAMES.METADATA;

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
