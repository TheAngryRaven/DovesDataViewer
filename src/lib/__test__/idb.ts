import { IDBFactory, IDBKeyRange } from "fake-indexeddb";

/**
 * Install a fresh, empty in-memory IndexedDB as the global `indexedDB`.
 * Call in `beforeEach` so every test starts from a clean schema with no
 * cross-test state. The storage modules read the global lazily, so swapping the
 * factory is enough to reset them. We also expose `IDBKeyRange` globally, since
 * some modules use it directly (e.g. videoFileStorage's existence check).
 */
export function freshIndexedDB(): void {
  globalThis.indexedDB = new IDBFactory();
  globalThis.IDBKeyRange = IDBKeyRange;
}
