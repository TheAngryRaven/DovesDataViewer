import { describe, it, expect, vi, afterEach } from "vitest";
import {
  readDeferredAssets,
  warmOfflineAssets,
  isDeferredAssetCached,
  ASSET_REVISION_HEADER,
  DEFERRED_CACHE_NAME,
  DEFERRED_MANIFEST_URL,
  type DeferredAsset,
} from "./offlineWarmup";

const jsonResponse = (body: unknown, ok = true) =>
  ({ ok, json: () => Promise.resolve(body) }) as unknown as Response;

const asset = (url: string, revision = "r1"): DeferredAsset => ({ url, revision });
const assets = (...urls: string[]) => urls.map((u) => asset(u));
const noPrune = () => Promise.resolve();

describe("readDeferredAssets", () => {
  it("reads the build-emitted manifest", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        jsonResponse({ assets: [asset("/samples/a", "abc"), asset("/b", "def")] }),
      ),
    );
    await expect(
      readDeferredAssets(fetchImpl as unknown as typeof fetch),
    ).resolves.toEqual([asset("/samples/a", "abc"), asset("/b", "def")]);
    expect(fetchImpl).toHaveBeenCalledWith(DEFERRED_MANIFEST_URL, {
      cache: "no-cache",
    });
  });

  it("degrades to 'nothing to warm' rather than throwing", async () => {
    const cases: Array<() => Promise<Response>> = [
      () => Promise.resolve(jsonResponse({}, false)),
      () => Promise.resolve(jsonResponse({ assets: "nope" })),
      () => Promise.reject(new Error("offline")),
    ];
    for (const impl of cases) {
      await expect(
        readDeferredAssets(impl as unknown as typeof fetch),
      ).resolves.toEqual([]);
    }
  });

  it("drops malformed and unrevisioned entries", async () => {
    const fetchImpl = () =>
      Promise.resolve(
        jsonResponse({
          assets: [asset("/a"), "/plain-string", 42, null, { url: "/no-rev" }, { url: "/x", revision: "" }, asset("/b")],
        }),
      );
    await expect(
      readDeferredAssets(fetchImpl as unknown as typeof fetch),
    ).resolves.toEqual([asset("/a"), asset("/b")]);
  });
});

describe("isDeferredAssetCached (revision check)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubCache(entries: Record<string, string | null>) {
    const open = vi.fn(async (name: string) => {
      expect(name).toBe(DEFERRED_CACHE_NAME);
      return {
        match: async (url: string) => {
          if (!(url in entries)) return undefined;
          const rev = entries[url];
          return new Response("x", { headers: rev ? { [ASSET_REVISION_HEADER]: rev } : {} });
        },
      };
    });
    vi.stubGlobal("caches", { open });
  }

  it("is cached only at the manifest's current revision", async () => {
    stubCache({ "/samples/a.dove": "new", "/loggers/old.jpg": "old", "/loggers/sw.jpg": null });
    expect(await isDeferredAssetCached(asset("/samples/a.dove", "new"))).toBe(true);
    // An updated asset (new revision in the manifest) must read as missing so
    // the warm-up replaces it — the CacheFirst route alone never would.
    expect(await isDeferredAssetCached(asset("/loggers/old.jpg", "new"))).toBe(false);
    // Stored unstamped by the service worker's own route: refresh once.
    expect(await isDeferredAssetCached(asset("/loggers/sw.jpg", "new"))).toBe(false);
    expect(await isDeferredAssetCached(asset("/missing", "new"))).toBe(false);
  });

  it("is false without Cache Storage", async () => {
    vi.stubGlobal("caches", undefined);
    expect(await isDeferredAssetCached(asset("/a"))).toBe(false);
  });
});

describe("warmOfflineAssets", () => {
  const alwaysMissing = () => Promise.resolve(false);

  it("stores every asset that isn't cached yet", async () => {
    const addToCache = vi.fn(() => Promise.resolve());
    const result = await warmOfflineAssets(assets("/a", "/b", "/c"), {
      addToCache,
      isCached: alwaysMissing,
      prune: noPrune,
    });
    expect(result).toEqual({ total: 3, cached: 3, failed: 0 });
    expect(addToCache).toHaveBeenCalledTimes(3);
  });

  it("skips assets already cached at their revision", async () => {
    const addToCache = vi.fn(() => Promise.resolve());
    const result = await warmOfflineAssets(assets("/a", "/b"), {
      addToCache,
      isCached: (a) => Promise.resolve(a.url === "/a"),
      prune: noPrune,
    });
    expect(result).toEqual({ total: 2, cached: 2, failed: 0 });
    expect(addToCache).toHaveBeenCalledTimes(1);
    expect(addToCache).toHaveBeenCalledWith(asset("/b"));
  });

  // The whole point of moving these out of the precache: losing the network
  // partway through must leave the successes in place, not discard everything.
  // This is the regression test for the reported bug.
  it("keeps partial progress when the connection drops mid-run", async () => {
    let served = 0;
    const addToCache = vi.fn(() => {
      served++;
      return served <= 2
        ? Promise.resolve()
        : Promise.reject(new Error("offline"));
    });
    const result = await warmOfflineAssets(assets("/a", "/b", "/c", "/d"), {
      addToCache,
      isCached: alwaysMissing,
      prune: noPrune,
      concurrency: 1,
    });
    expect(result).toEqual({ total: 4, cached: 2, failed: 2 });
  });

  it("counts a rejected store as failed, not cached", async () => {
    await expect(
      warmOfflineAssets(assets("/a"), {
        addToCache: () => Promise.reject(new Error("404")),
        isCached: alwaysMissing,
        prune: noPrune,
      }),
    ).resolves.toEqual({ total: 1, cached: 0, failed: 1 });
  });

  it("survives a cache probe that throws", async () => {
    await expect(
      warmOfflineAssets(assets("/a"), {
        isCached: () => Promise.reject(new Error("storage disabled")),
        addToCache: () => Promise.resolve(),
        prune: noPrune,
      }),
    ).resolves.toEqual({ total: 1, cached: 0, failed: 1 });
  });

  it("prunes entries the build no longer ships, but never on an empty manifest", async () => {
    const prune = vi.fn(() => Promise.resolve());
    await warmOfflineAssets(assets("/a", "/b"), {
      addToCache: () => Promise.resolve(),
      isCached: alwaysMissing,
      prune,
    });
    expect(prune).toHaveBeenCalledWith(["/a", "/b"]);

    // A missing/unreadable manifest degrades to [] — that must not wipe the cache.
    prune.mockClear();
    await warmOfflineAssets([], { prune });
    expect(prune).not.toHaveBeenCalled();
  });

  it("tolerates a prune that fails", async () => {
    await expect(
      warmOfflineAssets(assets("/a"), {
        addToCache: () => Promise.resolve(),
        isCached: alwaysMissing,
        prune: () => Promise.reject(new Error("quota")),
      }),
    ).resolves.toEqual({ total: 1, cached: 1, failed: 0 });
  });

  it("reports progress and handles an empty manifest", async () => {
    const seen: Array<[number, number]> = [];
    await warmOfflineAssets(assets("/a", "/b"), {
      addToCache: () => Promise.resolve(),
      isCached: alwaysMissing,
      prune: noPrune,
      concurrency: 1,
      onProgress: (c, t) => seen.push([c, t]),
    });
    expect(seen).toEqual([
      [1, 2],
      [2, 2],
    ]);
    await expect(warmOfflineAssets([], {})).resolves.toEqual({
      total: 0,
      cached: 0,
      failed: 0,
    });
  });
});
