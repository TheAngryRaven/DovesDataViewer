import { describe, it, expect } from "vitest";
import { computeReadiness, readinessPercent } from "./offlineReadiness";

const base = {
  serviceWorkerSupported: true,
  controlled: true,
  deferredTotal: 5,
  deferredCached: 5,
};

describe("computeReadiness", () => {
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
