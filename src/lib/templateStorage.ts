/**
 * IndexedDB CRUD for "vehicle-types" and "setup-templates" object stores.
 * Also handles seeding the default Kart template on first load.
 */

import { openDB, STORE_NAMES } from './dbUtils';

// ── Types ──

export interface TemplateFieldDef {
  id: string;
  name: string;
  type: "number" | "string";
  unit?: string;        // "mm", "in", "psi", "teeth", "degrees", etc.
  min?: number;
  max?: number;
  step?: number;
}

export interface TemplateSection {
  id: string;
  name: string;
  fields: TemplateFieldDef[];
}

export interface SetupTemplate {
  id: string;
  vehicleTypeId: string;
  name: string;
  sections: TemplateSection[];
  wheelCount: 2 | 4;
  includeTires: boolean;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface VehicleType {
  id: string;
  name: string;
  templateId: string;
  wheelCount: 2 | 4;
  isDefault: boolean;
  createdAt: number;
}

// ── Default Kart Template ──

export const DEFAULT_KART_VEHICLE_TYPE_ID = "default-kart-type";
export const DEFAULT_KART_TEMPLATE_ID = "default-kart-template";

const makeId = () => crypto.randomUUID();

export const DEFAULT_KART_TEMPLATE: SetupTemplate = {
  id: DEFAULT_KART_TEMPLATE_ID,
  vehicleTypeId: DEFAULT_KART_VEHICLE_TYPE_ID,
  name: "Kart",
  sections: [
    {
      id: "sec-alignment",
      name: "Alignment",
      fields: [
        { id: "f-toe", name: "Toe", type: "number" },
        { id: "f-camber", name: "Camber", type: "number" },
        { id: "f-castor", name: "Castor", type: "number" },
      ],
    },
    {
      id: "sec-dimensions",
      name: "Dimensions",
      fields: [
        { id: "f-front-width", name: "Front Width", type: "number", unit: "mm" },
        { id: "f-rear-width", name: "Rear Width", type: "number", unit: "mm" },
        { id: "f-rear-height", name: "Rear Height", type: "number", unit: "mm" },
      ],
    },
    {
      id: "sec-sprockets",
      name: "Sprockets",
      fields: [
        { id: "f-front-sprocket", name: "Front Sprocket", type: "number" },
        { id: "f-rear-sprocket", name: "Rear Sprocket", type: "number" },
      ],
    },
    {
      id: "sec-steering",
      name: "Steering",
      fields: [
        { id: "f-steering-brand", name: "Column Brand", type: "string" },
        { id: "f-steering-setting", name: "Steering", type: "number", min: 1, max: 5 },
        { id: "f-spindle-setting", name: "Spindle", type: "number", min: 1, max: 5 },
      ],
    },
  ],
  wheelCount: 4,
  includeTires: true,
  isDefault: true,
  createdAt: 0,
  updatedAt: 0,
};

export const DEFAULT_KART_VEHICLE_TYPE: VehicleType = {
  id: DEFAULT_KART_VEHICLE_TYPE_ID,
  name: "Kart",
  templateId: DEFAULT_KART_TEMPLATE_ID,
  wheelCount: 4,
  isDefault: true,
  createdAt: 0,
};

// ── Seeding ──

export async function ensureDefaults(): Promise<void> {
  const db = await openDB();

  // Check if default vehicle type exists
  const vtTx = db.transaction(STORE_NAMES.VEHICLE_TYPES, "readonly");
  const existing = await new Promise<VehicleType | undefined>((resolve, reject) => {
    const req = vtTx.objectStore(STORE_NAMES.VEHICLE_TYPES).get(DEFAULT_KART_VEHICLE_TYPE_ID);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  if (!existing) {
    const tx = db.transaction([STORE_NAMES.VEHICLE_TYPES, STORE_NAMES.SETUP_TEMPLATES], "readwrite");
    tx.objectStore(STORE_NAMES.VEHICLE_TYPES).put(DEFAULT_KART_VEHICLE_TYPE);
    tx.objectStore(STORE_NAMES.SETUP_TEMPLATES).put(DEFAULT_KART_TEMPLATE);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  db.close();
}

// ── Vehicle Type CRUD ──

export async function listVehicleTypes(): Promise<VehicleType[]> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.VEHICLE_TYPES, "readonly");
  const req = tx.objectStore(STORE_NAMES.VEHICLE_TYPES).getAll();
  const results = await new Promise<VehicleType[]>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return results;
}

export async function getVehicleType(id: string): Promise<VehicleType | null> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.VEHICLE_TYPES, "readonly");
  const req = tx.objectStore(STORE_NAMES.VEHICLE_TYPES).get(id);
  const result = await new Promise<VehicleType | undefined>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result ?? null;
}

export async function saveVehicleType(vt: VehicleType): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.VEHICLE_TYPES, "readwrite");
  tx.objectStore(STORE_NAMES.VEHICLE_TYPES).put(vt);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function deleteVehicleType(id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.VEHICLE_TYPES, "readwrite");
  tx.objectStore(STORE_NAMES.VEHICLE_TYPES).delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

// ── Setup Template CRUD ──

export async function listTemplates(): Promise<SetupTemplate[]> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.SETUP_TEMPLATES, "readonly");
  const req = tx.objectStore(STORE_NAMES.SETUP_TEMPLATES).getAll();
  const results = await new Promise<SetupTemplate[]>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return results;
}

export async function getTemplate(id: string): Promise<SetupTemplate | null> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.SETUP_TEMPLATES, "readonly");
  const req = tx.objectStore(STORE_NAMES.SETUP_TEMPLATES).get(id);
  const result = await new Promise<SetupTemplate | undefined>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result ?? null;
}

export async function saveTemplate(template: SetupTemplate): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.SETUP_TEMPLATES, "readwrite");
  tx.objectStore(STORE_NAMES.SETUP_TEMPLATES).put(template);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function deleteTemplate(id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.SETUP_TEMPLATES, "readwrite");
  tx.objectStore(STORE_NAMES.SETUP_TEMPLATES).delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/**
 * Create a new vehicle type + template atomically.
 * Returns the created vehicle type and template.
 */
export async function createVehicleTypeWithTemplate(
  name: string,
  wheelCount: 2 | 4,
  includeTires: boolean,
  sections: TemplateSection[],
): Promise<{ vehicleType: VehicleType; template: SetupTemplate }> {
  const now = Date.now();
  const vtId = makeId();
  const tplId = makeId();

  const vehicleType: VehicleType = {
    id: vtId,
    name,
    templateId: tplId,
    wheelCount,
    isDefault: false,
    createdAt: now,
  };

  const template: SetupTemplate = {
    id: tplId,
    vehicleTypeId: vtId,
    name,
    sections,
    wheelCount,
    includeTires,
    isDefault: false,
    createdAt: now,
    updatedAt: now,
  };

  const db = await openDB();
  const tx = db.transaction([STORE_NAMES.VEHICLE_TYPES, STORE_NAMES.SETUP_TEMPLATES], "readwrite");
  tx.objectStore(STORE_NAMES.VEHICLE_TYPES).put(vehicleType);
  tx.objectStore(STORE_NAMES.SETUP_TEMPLATES).put(template);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();

  return { vehicleType, template };
}

/**
 * Delete a vehicle type and its template atomically.
 */
export async function deleteVehicleTypeWithTemplate(vehicleTypeId: string, templateId: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction([STORE_NAMES.VEHICLE_TYPES, STORE_NAMES.SETUP_TEMPLATES], "readwrite");
  tx.objectStore(STORE_NAMES.VEHICLE_TYPES).delete(vehicleTypeId);
  tx.objectStore(STORE_NAMES.SETUP_TEMPLATES).delete(templateId);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
