// Lightweight host pub/sub for garage mutations (vehicles, setups, templates,
// vehicle types, notes). Storage modules emit a change after each write/delete;
// the cloud-sync plugin subscribes to drive incremental auto-sync (upsert on
// put, delete on delete). Host-owned and generic — no plugin or network deps —
// so the core works the same whether or not a sync plugin is listening.

export type GarageChangeType = "put" | "delete";

export interface GarageChange {
  /** IndexedDB store name (matches STORE_NAMES + the cloud record `store`). */
  store: string;
  /** Record key (the store's key path value). */
  key: string;
  type: GarageChangeType;
}

type Listener = (change: GarageChange) => void;

const listeners = new Set<Listener>();

/** Subscribe to garage changes. Returns an unsubscribe function. */
export function onGarageChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Notify subscribers of a garage mutation. Listener errors are isolated. */
export function emitGarageChange(change: GarageChange): void {
  for (const listener of listeners) {
    try {
      listener(change);
    } catch (err) {
      console.error("garage change listener failed", err);
    }
  }
}
