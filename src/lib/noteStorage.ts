/**
 * IndexedDB CRUD for the "notes" object store.
 */

import { openDB, STORE_NAMES } from './dbUtils';

export interface Note {
  id: string;
  fileName: string;
  text: string;
  createdAt: number;
  updatedAt: number;
}

const NOTES_STORE = STORE_NAMES.NOTES;

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
