// Per-plugin persistent storage.
//
// Each plugin gets its own IndexedDB database (`dove-plugin-<id>`) with a single
// key-value object store. This keeps plugin data fully decoupled from the core
// schema in `dbUtils.ts` — plugins never bump the app's DB_VERSION or register
// stores there, so a new plugin's storage needs is zero core changes.

import type { PluginStore } from "./types";

const DB_PREFIX = "dove-plugin-";
const KV_STORE = "kv";

// Plugin ids become part of an IndexedDB database name; keep them tame.
function assertSafeId(pluginId: string): void {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(pluginId)) {
    throw new Error(`Invalid plugin id for storage: "${pluginId}"`);
  }
}

function openDb(pluginId: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(`${DB_PREFIX}${pluginId}`, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  pluginId: string,
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb(pluginId);
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(KV_STORE, mode);
      const req = op(tx.objectStore(KV_STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

const stores = new Map<string, PluginStore>();

/** Get the key-value store for a plugin (memoized per id). */
export function getPluginStore(pluginId: string): PluginStore {
  assertSafeId(pluginId);
  const cached = stores.get(pluginId);
  if (cached) return cached;

  const store: PluginStore = {
    get: <T>(key: string) => withStore<T>(pluginId, "readonly", (s) => s.get(key) as IDBRequest<T>),
    set: (key, value) =>
      withStore<IDBValidKey>(pluginId, "readwrite", (s) => s.put(value, key)).then(() => undefined),
    delete: (key) =>
      withStore<undefined>(pluginId, "readwrite", (s) => s.delete(key) as IDBRequest<undefined>).then(() => undefined),
    getAll: <T>() => withStore<T[]>(pluginId, "readonly", (s) => s.getAll() as IDBRequest<T[]>),
    keys: () =>
      withStore<IDBValidKey[]>(pluginId, "readonly", (s) => s.getAllKeys()).then((ks) => ks.map(String)),
  };
  stores.set(pluginId, store);
  return store;
}
