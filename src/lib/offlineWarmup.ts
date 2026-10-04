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
//
// Entries are REVISIONED. The precache gets per-file revisions from Workbox for
// free; this runtime cache does not, and its route is CacheFirst — so without a
// revision an updated sample log or logger photo would never reach a device
// that had already cached the old one. The build manifest carries a content
// hash per file, every stored response is stamped with it, and a stamp that
// doesn't match the current manifest counts as missing.

/** Build-emitted list of the deferred assets (see `deferredAssetManifest`). */
export const DEFERRED_MANIFEST_URL = "/offline-assets.json";

/** Cache the service worker's runtime route stores the deferred assets in. */
export const DEFERRED_CACHE_NAME = "app-deferred-assets";

/** Response header the warm-up stamps each stored asset's revision into. */
export const ASSET_REVISION_HEADER = "X-Asset-Revision";

/** One deferred asset: its root-relative URL and the build's content hash. */
export interface DeferredAsset {
  url: string;
  revision: string;
}

export interface WarmupResult {
  /** Assets in the manifest. */
  total: number;
  /** Assets present (at the current revision) when the run finished. */
  cached: number;
  /** Assets that could not be fetched this run — retried on the next visit. */
  failed: number;
}

export interface WarmupOptions {
  /** Only used to read the manifest. */
  fetchImpl?: typeof fetch;
  /** Resolves true when the asset is cached at its current revision. */
  isCached?: (asset: DeferredAsset) => Promise<boolean>;
  /** Fetches the asset and stores it (stamped); rejects if it can't. */
  addToCache?: (asset: DeferredAsset) => Promise<void>;
  /** Drops cached entries no longer in the manifest. Failures are ignored. */
  prune?: (keepUrls: string[]) => Promise<void>;
  onProgress?: (cached: number, total: number) => void;
  /** Kept low: this runs behind the user's real traffic, not in front of it. */
  concurrency?: number;
}

const isDeferredAsset = (a: unknown): a is DeferredAsset =>
  typeof a === "object" &&
  a !== null &&
  typeof (a as DeferredAsset).url === "string" &&
  typeof (a as DeferredAsset).revision === "string" &&
  (a as DeferredAsset).revision.length > 0;

/**
 * Read the build-emitted manifest. Returns an empty list rather than throwing
 * when it's missing or malformed — an older cached build, or a deploy that
 * predates the manifest, should degrade to "nothing to warm", not an error.
 */
export async function readDeferredAssets(
  fetchImpl: typeof fetch = fetch,
): Promise<DeferredAsset[]> {
  try {
    const res = await fetchImpl(DEFERRED_MANIFEST_URL, { cache: "no-cache" });
    if (!res.ok) return [];
    const body: unknown = await res.json();
    const assets = (body as { assets?: unknown })?.assets;
    if (!Array.isArray(assets)) return [];
    return assets.filter(isDeferredAsset);
  } catch {
    return [];
  }
}

/**
 * True when the deferred cache holds this asset at the manifest's revision.
 * An unstamped entry (stored by the service worker's own CacheFirst route on
 * a cache miss) or one from an older build reads as missing, so the next
 * warm-up replaces it.
 */
export const isDeferredAssetCached = async (asset: DeferredAsset): Promise<boolean> => {
  if (typeof caches === "undefined") return false;
  try {
    const cache = await caches.open(DEFERRED_CACHE_NAME);
    const res = await cache.match(asset.url);
    return res?.headers.get(ASSET_REVISION_HEADER) === asset.revision;
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
 * and would be cached nowhere. One `put` per URL also keeps the
 * partial-progress property that motivated this whole split — unlike `addAll`,
 * which is all-or-nothing exactly like the precache install we moved away from.
 *
 * `cache: "reload"` skips the HTTP cache: a refresh triggered by a new revision
 * must not be answered with the old bytes the browser already holds.
 */
const defaultAddToCache = async (asset: DeferredAsset): Promise<void> => {
  if (typeof caches === "undefined")
    throw new Error("Cache Storage unavailable");
  const res = await fetch(asset.url, { cache: "reload" });
  if (!res.ok) throw new Error(`${asset.url}: HTTP ${res.status}`);
  const headers = new Headers(res.headers);
  headers.set(ASSET_REVISION_HEADER, asset.revision);
  const stamped = new Response(await res.blob(), {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
  const cache = await caches.open(DEFERRED_CACHE_NAME);
  await cache.put(asset.url, stamped);
};

/** Delete deferred-cache entries whose path is no longer in the manifest. */
const defaultPrune = async (keepUrls: string[]): Promise<void> => {
  if (typeof caches === "undefined") return;
  const keep = new Set(keepUrls);
  const cache = await caches.open(DEFERRED_CACHE_NAME);
  for (const req of await cache.keys()) {
    if (!keep.has(new URL(req.url).pathname)) await cache.delete(req);
  }
};

/**
 * Store every asset that isn't cached at its current revision, then drop
 * entries the build no longer ships. Requests run a few at a time so the
 * warm-up stays behind whatever the user is actually doing.
 */
export async function warmOfflineAssets(
  assets: DeferredAsset[],
  options: WarmupOptions = {},
): Promise<WarmupResult> {
  const {
    isCached = isDeferredAssetCached,
    addToCache = defaultAddToCache,
    prune = defaultPrune,
    onProgress,
    concurrency = 3,
  } = options;

  const total = assets.length;
  let cached = 0;
  let failed = 0;
  const queue = [...assets];

  const worker = async () => {
    for (let asset = queue.shift(); asset !== undefined; asset = queue.shift()) {
      try {
        if (!(await isCached(asset))) await addToCache(asset);
        cached++;
      } catch {
        failed++;
      }
      onProgress?.(cached, total);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, total) }, worker),
  );
  // Only prune against a real manifest: an empty list is what a missing or
  // unreadable manifest degrades to, and must not wipe a good cache.
  if (total > 0) {
    try {
      await prune(assets.map((a) => a.url));
    } catch {
      // Best effort — stale extras cost space, not correctness.
    }
  }
  return { total, cached, failed };
}

/**
 * Read the manifest and warm anything missing. The single call site is the
 * service worker registration in `main.tsx`; it is fire-and-forget.
 */
export async function warmOfflineCache(
  options: WarmupOptions = {},
): Promise<WarmupResult> {
  const assets = await readDeferredAssets(options.fetchImpl ?? fetch);
  return warmOfflineAssets(assets, options);
}
