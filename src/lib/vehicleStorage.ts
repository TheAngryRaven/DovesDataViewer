/**
 * IndexedDB CRUD for the "karts" object store (vehicles).
 * Renamed from kartStorage.ts — the IDB store name stays "karts" for backward compat.
 */

import { openDB, STORE_NAMES } from './dbUtils';
import { emitGarageChange } from './garageEvents';

export interface Vehicle {
  id: string;
  name: string;
  vehicleTypeId: string;
  engine: string;
  number: number;
  weight: number;
  weightUnit: "lb" | "kg";
  /** Last local edit time (ms) — set by saveVehicle; used for sync merge. */
  updatedAt?: number;
}

const VEHICLES_STORE = STORE_NAMES.KARTS; // store name unchanged in IDB

export async function saveVehicle(vehicle: Vehicle): Promise<void> {
  const stamped: Vehicle = { ...vehicle, updatedAt: Date.now() };
  const db = await openDB();
  const tx = db.transaction(VEHICLES_STORE, "readwrite");
  tx.objectStore(VEHICLES_STORE).put(stamped);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  emitGarageChange({ store: VEHICLES_STORE, key: vehicle.id, type: "put" });
}

export async function listVehicles(): Promise<Vehicle[]> {
  const db = await openDB();
  const tx = db.transaction(VEHICLES_STORE, "readonly");
  const request = tx.objectStore(VEHICLES_STORE).getAll();
  const results = await new Promise<Vehicle[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return results;
}

export async function getVehicle(id: string): Promise<Vehicle | null> {
  const db = await openDB();
  const tx = db.transaction(VEHICLES_STORE, "readonly");
  const request = tx.objectStore(VEHICLES_STORE).get(id);
  const result = await new Promise<Vehicle | undefined>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result ?? null;
}

export async function deleteVehicle(id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(VEHICLES_STORE, "readwrite");
  tx.objectStore(VEHICLES_STORE).delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  emitGarageChange({ store: VEHICLES_STORE, key: id, type: "delete" });
}
