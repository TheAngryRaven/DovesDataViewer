/**
 * IndexedDB CRUD for the "setups" object store.
 * Reuses the same "dove-file-manager" database (version 5).
 */

export interface KartSetup {
  id: string;
  kartId: string;
  name: string;
  toe: number | null;
  camber: number | null;
  castor: number | null;
  frontWidth: number | null;
  frontWidthUnit: "mm" | "in";
  rearWidth: number | null;
  rearWidthUnit: "mm" | "in";
  rearHeight: number | null;
  rearHeightUnit: "mm" | "in";
  frontSprocket: number | null;
  rearSprocket: number | null;
  steeringBrand: string;
  steeringSetting: number | null;
  spindleSetting: number | null;
  tireBrand: string;
  psiMode: "single" | "halves" | "quarters";
  psiFrontLeft: number | null;
  psiFrontRight: number | null;
  psiRearLeft: number | null;
  psiRearRight: number | null;
  tireWidthMode: "halves" | "quarters";
  tireWidthFrontLeft: number | null;
  tireWidthFrontRight: number | null;
  tireWidthRearLeft: number | null;
  tireWidthRearRight: number | null;
  tireWidthUnit: "mm" | "in";
  tireDiameterMode: "halves" | "quarters";
  tireDiameterFrontLeft: number | null;
  tireDiameterFrontRight: number | null;
  tireDiameterRearLeft: number | null;
  tireDiameterRearRight: number | null;
  tireDiameterUnit: "mm" | "in";
  createdAt: number;
  updatedAt: number;
}

const DB_NAME = "dove-file-manager";
const SETUPS_STORE = "setups";
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
      if (!db.objectStoreNames.contains("notes")) {
        const notesStore = db.createObjectStore("notes", { keyPath: "id" });
        notesStore.createIndex("fileName", "fileName", { unique: false });
      }
      if (!db.objectStoreNames.contains(SETUPS_STORE)) {
        const store = db.createObjectStore(SETUPS_STORE, { keyPath: "id" });
        store.createIndex("kartId", "kartId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function listSetups(): Promise<KartSetup[]> {
  const db = await openDB();
  const tx = db.transaction(SETUPS_STORE, "readonly");
  const request = tx.objectStore(SETUPS_STORE).getAll();
  const results = await new Promise<KartSetup[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return results.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveSetup(setup: KartSetup): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(SETUPS_STORE, "readwrite");
  tx.objectStore(SETUPS_STORE).put(setup);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function deleteSetup(id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(SETUPS_STORE, "readwrite");
  tx.objectStore(SETUPS_STORE).delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function getLatestSetupForKart(kartId: string): Promise<KartSetup | null> {
  const db = await openDB();
  const tx = db.transaction(SETUPS_STORE, "readonly");
  const index = tx.objectStore(SETUPS_STORE).index("kartId");
  const request = index.getAll(kartId);
  const results = await new Promise<KartSetup[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  if (results.length === 0) return null;
  results.sort((a, b) => b.updatedAt - a.updatedAt);
  return results[0];
}
