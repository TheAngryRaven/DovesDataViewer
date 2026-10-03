import { describe, it, expect } from "vitest";
import { computeReadiness, countCachedAssets, readinessPercent } from "./offlineReadiness";

const base = {
  serviceWorkerSupported: true,
  controlled: true,
  deferredTotal: 5,
  deferredCached: 5,
};

describe("computeReadiness", () => {
  it("is native in the app shell, even though its WebView exposes serviceWorker", () => {
    // Regression: the Android WebView has navigator.serviceWorker but the shell
    // never registers a worker, so this used to read "not-ready" forever.
    expect(computeReadiness({ ...base, nativeApp: true, controlled: false, deferredCached: 0 })).toBe(
      "native",
    );
  });

  it("is unsupported without a service worker", () => {
    expect(computeReadiness({ ...base, serviceWorkerSupported: false })).toBe(
      "unsupported",
    );
  });

  it("is not-ready until a worker controls the page", () => {
    expect(computeReadiness({ ...base, controlled: false })).toBe("not-ready");
  });

  it("is preparing while the deferred extras are still missing", () => {
    expect(computeReadiness({ ...base, deferredCached: 2 })).toBe("preparing");
  });

  it("is ready once everything is cached", () => {
    expect(computeReadiness(base)).toBe("ready");
  });

  it("is ready when there is nothing deferred to warm", () => {
    expect(
      computeReadiness({ ...base, deferredTotal: 0, deferredCached: 0 }),
    ).toBe("ready");
  });

  it("treats an over-count as complete rather than stalling at 'preparing'", () => {
    expect(
      computeReadiness({ ...base, deferredTotal: 3, deferredCached: 4 }),
    ).toBe("ready");
  });
});

describe("readinessPercent", () => {
  it("reports whole-number progress", () => {
    expect(readinessPercent(1, 4)).toBe(25);
    expect(readinessPercent(2, 3)).toBe(67);
  });

  it("is complete when there is nothing to do", () => {
    expect(readinessPercent(0, 0)).toBe(100);
  });

  it("clamps to 0–100", () => {
    expect(readinessPercent(9, 4)).toBe(100);
    expect(readinessPercent(-1, 4)).toBe(0);
  });
});

describe("countCachedAssets", () => {
  const check = (cached: string[], throwing: string[] = []) => async (url: string) => {
    if (throwing.includes(url)) throw new Error("storage evicted");
    return cached.includes(url);
  };

  it("counts the assets the predicate reports as cached", async () => {
    expect(await countCachedAssets(["/a", "/b", "/c"], check(["/a", "/c"]))).toBe(2);
  });

  it("treats a lookup that throws as a miss instead of failing the readout", async () => {
    expect(await countCachedAssets(["/a", "/b"], check(["/a", "/b"], ["/b"]))).toBe(1);
  });

  it("is zero with nothing to check", async () => {
    expect(await countCachedAssets([], check(["/a"]))).toBe(0);
  });
});
