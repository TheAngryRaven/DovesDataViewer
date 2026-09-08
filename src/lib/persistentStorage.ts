// Ask the browser to stop treating our offline data as disposable.
//
// Every browser evicts "script-writable storage" (Cache API, IndexedDB) under
// pressure or after a stretch of not visiting the site — WebKit is the harshest,
// clearing everything after roughly a week of browser use without a visit. The
// Storage API's persistent mode is the standard opt-out, and it covers exactly
// what the offline app depends on: the service worker's precache and the
// sessions in IndexedDB.
//
// Grants are automatic and browser-specific: Chromium weighs engagement and
// installation, WebKit grants "based on heuristics like whether the website is
// opened as a Home Screen Web App" — which is the other half of why the iOS
// install hint (lib/pwaInstall) matters. Nothing here can fail loudly; a denial
// just means we keep the default, evictable storage.

export type PersistenceResult =
  /** Already in persistent mode from an earlier visit. */
  | "already-persisted"
  /** The browser granted persistence on this request. */
  | "granted"
  /** The browser declined — storage stays evictable. */
  | "denied"
  /** No Storage API (older WebKit, some in-app browsers). */
  | "unsupported";

type StorageManagerLike = Pick<StorageManager, "persist" | "persisted">;

/**
 * Request persistent storage, skipping the request when it's already granted.
 * Never throws: a browser that rejects or lacks the API reports through the
 * return value instead.
 */
export async function requestPersistentStorage(
  storage: Partial<StorageManagerLike> | undefined = typeof navigator !==
  "undefined"
    ? navigator.storage
    : undefined,
): Promise<PersistenceResult> {
  if (!storage?.persist || !storage.persisted) return "unsupported";
  try {
    if (await storage.persisted()) return "already-persisted";
    return (await storage.persist()) ? "granted" : "denied";
  } catch {
    return "unsupported";
  }
}
