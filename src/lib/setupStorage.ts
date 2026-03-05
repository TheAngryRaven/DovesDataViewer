/**
 * IndexedDB CRUD for the "setups" object store.
 * Now uses a generic template-driven data model.
 */

import { openDB, STORE_NAMES } from './dbUtils';

export interface VehicleSetup {
  id: string;
  vehicleId: string;      // was kartId — links to Vehicle
  templateId: string;      // which template this setup uses
  name: string;
  unitSystem: "mm" | "in"; // global unit toggle for measurement fields

  // Built-in tire data (shared across all templates that include tires)
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
  tireDiameterMode: "halves" | "quarters";
  tireDiameterFrontLeft: number | null;
  tireDiameterFrontRight: number | null;
  tireDiameterRearLeft: number | null;
  tireDiameterRearRight: number | null;

  // Dynamic fields from template — keyed by TemplateFieldDef.id
  customFields: Record<string, string | number | null>;

  createdAt: number;
  updatedAt: number;
}

// Keep backward compat export name for consumers that haven't migrated yet
export type KartSetup = VehicleSetup;

const SETUPS_STORE = STORE_NAMES.SETUPS;

export async function listSetups(): Promise<VehicleSetup[]> {
  const db = await openDB();
  const tx = db.transaction(SETUPS_STORE, "readonly");
  const request = tx.objectStore(SETUPS_STORE).getAll();
  const results = await new Promise<VehicleSetup[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return results.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveSetup(setup: VehicleSetup): Promise<void> {
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

export async function getLatestSetupForVehicle(vehicleId: string): Promise<VehicleSetup | null> {
  const db = await openDB();
  const tx = db.transaction(SETUPS_STORE, "readonly");
  const store = tx.objectStore(SETUPS_STORE);
  // Try using vehicleId index first, fall back to getAll scan
  let results: VehicleSetup[];
  try {
    const index = store.index("vehicleId");
    const request = index.getAll(vehicleId);
    results = await new Promise<VehicleSetup[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch {
    // Fallback: index might still be "kartId" from old DB
    try {
      const index = store.index("kartId");
      const request = index.getAll(vehicleId);
      results = await new Promise<VehicleSetup[]>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } catch {
      // Final fallback: scan all
      const request = store.getAll();
      const all = await new Promise<VehicleSetup[]>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      results = all.filter(s => s.vehicleId === vehicleId);
    }
  }
  db.close();
  if (results.length === 0) return null;
  results.sort((a, b) => b.updatedAt - a.updatedAt);
  return results[0];
}

// Backward compat alias
export const getLatestSetupForKart = getLatestSetupForVehicle;
