import { describe, it, expect, vi } from "vitest";
import { WakeLockController, type WakeLockSentinelLike } from "./wakeLock";

/** A controllable fake of the Wake Lock sentinel + requester. */
function makeApi() {
  const sentinels: FakeSentinel[] = [];
  const request = vi.fn(async (_type: "screen") => {
    const s = new FakeSentinel();
    sentinels.push(s);
    return s as unknown as WakeLockSentinelLike;
  });
  return { request, sentinels };
}

class FakeSentinel {
  released = false;
  private releaseListeners: Array<() => void> = [];
  release = vi.fn(async () => {
    this.released = true;
    for (const l of this.releaseListeners) l();
  });
  addEventListener(_type: "release", listener: () => void): void {
    this.releaseListeners.push(listener);
  }
  /** Simulate the OS dropping the lock (page hidden / battery saver). */
  osRelease(): void {
    this.released = true;
    for (const l of this.releaseListeners) l();
  }
}

describe("WakeLockController", () => {
  it("acquires a sentinel on enable and reports held", async () => {
    const { request } = makeApi();
    const c = new WakeLockController(request);
    await c.enable();
    expect(request).toHaveBeenCalledWith("screen");
    expect(c.isHeld).toBe(true);
  });

  it("releases the held sentinel on disable", async () => {
    const { request, sentinels } = makeApi();
    const c = new WakeLockController(request);
    await c.enable();
    await c.disable();
    expect(sentinels[0].release).toHaveBeenCalledTimes(1);
    expect(c.isHeld).toBe(false);
  });

  it("re-acquires on visibility after the OS releases the lock", async () => {
    const { request, sentinels } = makeApi();
    const c = new WakeLockController(request);
    await c.enable();
    sentinels[0].osRelease(); // OS drops it while hidden
    expect(c.isHeld).toBe(false);
    await c.onVisible();
    expect(request).toHaveBeenCalledTimes(2);
    expect(c.isHeld).toBe(true);
  });

  it("does not re-acquire on visibility while still holding the lock", async () => {
    const { request } = makeApi();
    const c = new WakeLockController(request);
    await c.enable();
    await c.onVisible();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not re-acquire on visibility when disabled", async () => {
    const { request } = makeApi();
    const c = new WakeLockController(request);
    await c.onVisible();
    expect(request).not.toHaveBeenCalled();
  });

  it("is a safe no-op when the Wake Lock API is unavailable", async () => {
    const c = new WakeLockController(null);
    await c.enable();
    expect(c.isHeld).toBe(false);
    await c.disable();
    await c.onVisible();
    expect(c.isHeld).toBe(false);
  });

  it("releases immediately if disabled while the request is in flight", async () => {
    let resolveRequest!: (s: WakeLockSentinelLike) => void;
    const sentinel = new FakeSentinel();
    const request = vi.fn(
      () => new Promise<WakeLockSentinelLike>((res) => { resolveRequest = res; }),
    );
    const c = new WakeLockController(request);
    const enabling = c.enable();
    await c.disable(); // lands before the request resolves
    resolveRequest(sentinel as unknown as WakeLockSentinelLike);
    await enabling;
    expect(sentinel.release).toHaveBeenCalledTimes(1);
    expect(c.isHeld).toBe(false);
  });

  it("swallows a rejected request without throwing", async () => {
    const request = vi.fn(async () => { throw new Error("not allowed"); });
    const c = new WakeLockController(request);
    await expect(c.enable()).resolves.toBeUndefined();
    expect(c.isHeld).toBe(false);
  });
});
