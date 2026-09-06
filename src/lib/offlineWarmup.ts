// Fetch the heavy assets that were deliberately left out of the precache.
//
// Workbox's precache install is all-or-nothing — one failed request and the
// service worker is discarded with nothing cached. `vite.config.ts` therefore
// holds the big public directories (the bundled sample datalogs, the logger
// photos) out of the install and runtime-caches them instead; this module pulls
// them in afterwards, so they are still available offline.
//
// Everything here is deliberately failure-tolerant. A warm-up that only gets
// halfway leaves the app fully usable — the shell is already precached — and the
// next online visit picks up whatever is still missing. That is the whole point
// of the split: partial progress is now progress, not a total loss.

/** Build-emitted list of the deferred assets (see `deferredAssetManifest`). */
export const DEFERRED_MANIFEST_URL = "/offline-assets.json";

/** Cache the service worker's runtime route stores the deferred assets in. */
export const DEFERRED_CACHE_NAME = "app-deferred-assets";

export interface WarmupResult {
  /** Assets in the manifest. */
  total: number;
  /** Assets present in the cache when the run finished (including pre-existing). */
  cached: number;
  /** Assets that could not be fetched this run — retried on the next visit. */
  failed: number;
}

export interface WarmupOptions {
  /** Only used to read the manifest. */
  fetchImpl?: typeof fetch;
  /** Resolves true when the asset is already cached, so we don't refetch it. */
  isCached?: (url: string) => Promise<boolean>;
  /** Fetches the asset and stores it; rejects if it can't. */
  addToCache?: (url: string) => Promise<void>;
  onProgress?: (cached: number, total: number) => void;
  /** Kept low: this runs behind the user's real traffic, not in front of it. */
  concurrency?: number;
}

/**
 * Read the build-emitted manifest. Returns an empty list rather than throwing
 * when it's missing or malformed — an older cached build, or a deploy that
 * predates the manifest, should degrade to "nothing to warm", not an error.
 */
export async function readDeferredAssets(
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  try {
    const res = await fetchImpl(DEFERRED_MANIFEST_URL, { cache: "no-cache" });
    if (!res.ok) return [];
    const body: unknown = await res.json();
    const assets = (body as { assets?: unknown })?.assets;
    if (!Array.isArray(assets)) return [];
    return assets.filter((a): a is string => typeof a === "string");
  } catch {
    return [];
  }
}

/** Default cache probe — asks the Cache Storage API whether the URL is stored. */
const defaultIsCached = async (url: string): Promise<boolean> => {
  if (typeof caches === "undefined") return false;
  try {
    return (await caches.match(url)) !== undefined;
  } catch {
    return false;
  }
};

/**
 * Write straight into the cache the service worker's CacheFirst route reads
 * from, rather than plain `fetch`ing and hoping the worker intercepts it.
 *
 * That distinction matters: on a first visit the worker is registered but not
 * yet *controlling* the page, so page-initiated requests bypass it completely
 * and would be cached nowhere. `cache.add` is also per-URL, which keeps the
 * partial-progress property that motivated this whole split — unlike `addAll`,
 * which is all-or-nothing exactly like the precache install we moved away from.
 */
const defaultAddToCache = async (url: string): Promise<void> => {
  if (typeof caches === "undefined")
    throw new Error("Cache Storage unavailable");
  const cache = await caches.open(DEFERRED_CACHE_NAME);
  await cache.add(url);
};

/**
 * Store every not-yet-cached asset. Requests run a few at a time so the warm-up
 * stays behind whatever the user is actually doing.
 */
export async function warmOfflineAssets(
  urls: string[],
  options: WarmupOptions = {},
): Promise<WarmupResult> {
  const {
    isCached = defaultIsCached,
    addToCache = defaultAddToCache,
    onProgress,
    concurrency = 3,
  } = options;

  const total = urls.length;
  let cached = 0;
  let failed = 0;
  const queue = [...urls];

  const worker = async () => {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      try {
        if (await isCached(url)) {
          cached++;
        } else {
          await addToCache(url);
          cached++;
        }
      } catch {
        failed++;
      }
      onProgress?.(cached, total);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, total) }, worker),
  );
  return { total, cached, failed };
}

/**
 * Read the manifest and warm anything missing. The single call site is the
 * service worker registration in `main.tsx`; it is fire-and-forget.
 */
export async function warmOfflineCache(
  options: WarmupOptions = {},
): Promise<WarmupResult> {
  const urls = await readDeferredAssets(options.fetchImpl ?? fetch);
  return warmOfflineAssets(urls, options);
}
