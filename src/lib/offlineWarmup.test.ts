import { describe, it, expect, vi } from "vitest";
import {
  readDeferredAssets,
  warmOfflineAssets,
  DEFERRED_MANIFEST_URL,
} from "./offlineWarmup";

const jsonResponse = (body: unknown, ok = true) =>
  ({ ok, json: () => Promise.resolve(body) }) as unknown as Response;

describe("readDeferredAssets", () => {
  it("reads the build-emitted manifest", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse({ assets: ["/samples/a", "/b"] })),
    );
    await expect(
      readDeferredAssets(fetchImpl as unknown as typeof fetch),
    ).resolves.toEqual(["/samples/a", "/b"]);
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

  it("drops non-string entries", async () => {
    const fetchImpl = () =>
      Promise.resolve(jsonResponse({ assets: ["/a", 42, null, "/b"] }));
    await expect(
      readDeferredAssets(fetchImpl as unknown as typeof fetch),
    ).resolves.toEqual(["/a", "/b"]);
  });
});

describe("warmOfflineAssets", () => {
  const alwaysMissing = () => Promise.resolve(false);

  it("stores every asset that isn't cached yet", async () => {
    const addToCache = vi.fn(() => Promise.resolve());
    const result = await warmOfflineAssets(["/a", "/b", "/c"], {
      addToCache,
      isCached: alwaysMissing,
    });
    expect(result).toEqual({ total: 3, cached: 3, failed: 0 });
    expect(addToCache).toHaveBeenCalledTimes(3);
  });

  it("skips assets already in the cache", async () => {
    const addToCache = vi.fn(() => Promise.resolve());
    const result = await warmOfflineAssets(["/a", "/b"], {
      addToCache,
      isCached: (url) => Promise.resolve(url === "/a"),
    });
    expect(result).toEqual({ total: 2, cached: 2, failed: 0 });
    expect(addToCache).toHaveBeenCalledTimes(1);
    expect(addToCache).toHaveBeenCalledWith("/b");
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
    const result = await warmOfflineAssets(["/a", "/b", "/c", "/d"], {
      addToCache,
      isCached: alwaysMissing,
      concurrency: 1,
    });
    expect(result).toEqual({ total: 4, cached: 2, failed: 2 });
  });

  it("counts a rejected store as failed, not cached", async () => {
    await expect(
      warmOfflineAssets(["/a"], {
        addToCache: () => Promise.reject(new Error("404")),
        isCached: alwaysMissing,
      }),
    ).resolves.toEqual({ total: 1, cached: 0, failed: 1 });
  });

  it("survives a cache probe that throws", async () => {
    await expect(
      warmOfflineAssets(["/a"], {
        isCached: () => Promise.reject(new Error("storage disabled")),
        addToCache: () => Promise.resolve(),
      }),
    ).resolves.toEqual({ total: 1, cached: 0, failed: 1 });
  });

  it("reports progress and handles an empty manifest", async () => {
    const seen: Array<[number, number]> = [];
    await warmOfflineAssets(["/a", "/b"], {
      addToCache: () => Promise.resolve(),
      isCached: alwaysMissing,
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
