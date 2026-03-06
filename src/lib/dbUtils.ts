/**
 * Shared IndexedDB utilities.
 * All storage modules share the same database ("dove-file-manager") and version.
 * The schema is defined here once to avoid duplication across storage files.
 */

export const DB_NAME = "dove-file-manager";
export const DB_VERSION = 9;

export const STORE_NAMES = {
  FILES: "files",
  METADATA: "metadata",
  KARTS: "karts",           // still "karts" for IDB compat, holds Vehicle objects
  NOTES: "notes",
  SETUPS: "setups",
  VIDEO_SYNC: "video-sync",
  GRAPH_PREFS: "graph-prefs",
  VEHICLE_TYPES: "vehicle-types",
  SETUP_TEMPLATES: "setup-templates",
  SESSION_VIDEOS: "session-videos",
} as const;

/**
 * Open the shared IndexedDB database, creating/upgrading all object stores as needed.
 */
export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = event.oldVersion;

      // Original stores (v1-v7)
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
      if (!db.objectStoreNames.contains(STORE_NAMES.GRAPH_PREFS)) {
        db.createObjectStore(STORE_NAMES.GRAPH_PREFS, { keyPath: "sessionFileName" });
      }

      // v8: New stores for vehicle types and setup templates
      if (!db.objectStoreNames.contains(STORE_NAMES.VEHICLE_TYPES)) {
        db.createObjectStore(STORE_NAMES.VEHICLE_TYPES, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_NAMES.SETUP_TEMPLATES)) {
        db.createObjectStore(STORE_NAMES.SETUP_TEMPLATES, { keyPath: "id" });
      }

      // v9: Session videos store
      if (!db.objectStoreNames.contains(STORE_NAMES.SESSION_VIDEOS)) {
        db.createObjectStore(STORE_NAMES.SESSION_VIDEOS, { keyPath: "sessionFileName" });
      }

      // v8 migration: add vehicleId index to setups if upgrading from v7
      if (oldVersion < 8) {
        try {
          const setupsStore = request.transaction!.objectStore(STORE_NAMES.SETUPS);
          if (!setupsStore.indexNames.contains("vehicleId")) {
            setupsStore.createIndex("vehicleId", "vehicleId", { unique: false });
          }
        } catch {
          // Store may not exist yet in fresh installs, handled above
        }

        // Migrate existing karts: add vehicleTypeId if missing
        try {
          const kartsStore = request.transaction!.objectStore(STORE_NAMES.KARTS);
          const getAllReq = kartsStore.getAll();
          getAllReq.onsuccess = () => {
            const karts = getAllReq.result;
            for (const kart of karts) {
              if (!kart.vehicleTypeId) {
                kart.vehicleTypeId = "default-kart-type";
                kartsStore.put(kart);
              }
            }
          };
        } catch {
          // Ignore if store doesn't exist yet
        }

        // Migrate existing setups: move hardcoded fields to customFields
        try {
          const setupsStore = request.transaction!.objectStore(STORE_NAMES.SETUPS);
          const getAllReq = setupsStore.getAll();
          getAllReq.onsuccess = () => {
            const setups = getAllReq.result;
            for (const setup of setups) {
              if (setup.customFields) continue; // already migrated

              // Build customFields from old hardcoded fields
              const customFields: Record<string, string | number | null> = {};
              if (setup.toe !== undefined) customFields["f-toe"] = setup.toe ?? null;
              if (setup.camber !== undefined) customFields["f-camber"] = setup.camber ?? null;
              if (setup.castor !== undefined) customFields["f-castor"] = setup.castor ?? null;
              if (setup.frontWidth !== undefined) customFields["f-front-width"] = setup.frontWidth ?? null;
              if (setup.rearWidth !== undefined) customFields["f-rear-width"] = setup.rearWidth ?? null;
              if (setup.rearHeight !== undefined) customFields["f-rear-height"] = setup.rearHeight ?? null;
              if (setup.frontSprocket !== undefined) customFields["f-front-sprocket"] = setup.frontSprocket ?? null;
              if (setup.rearSprocket !== undefined) customFields["f-rear-sprocket"] = setup.rearSprocket ?? null;
              if (setup.steeringBrand !== undefined) customFields["f-steering-brand"] = setup.steeringBrand || null;
              if (setup.steeringSetting !== undefined) customFields["f-steering-setting"] = setup.steeringSetting ?? null;
              if (setup.spindleSetting !== undefined) customFields["f-spindle-setting"] = setup.spindleSetting ?? null;

              // Determine unitSystem from old per-field units
              const unitSystem = setup.frontWidthUnit || setup.rearWidthUnit || setup.tireWidthUnit || "mm";

              // Map kartId → vehicleId
              setup.vehicleId = setup.kartId || setup.vehicleId || "";
              setup.templateId = setup.templateId || "default-kart-template";
              setup.unitSystem = unitSystem;
              setup.customFields = customFields;

              // Keep tire fields as-is (they're first-class)
              setup.tireBrand = setup.tireBrand || "";
              setup.tireDiameterMode = setup.tireDiameterMode || "halves";

              setupsStore.put(setup);
            }
          };
        } catch {
          // Ignore
        }
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
