/**
 * Vitest global setup — runs before any test imports.
 *
 * Polyfills browser globals that protocol code touches but Node doesn't ship:
 *   - requestAnimationFrame / cancelAnimationFrame (used by BLE downloadFile
 *     and downloadTrackFile to throttle progress callbacks)
 *
 * These are minimal shims — they just schedule via setTimeout(0). Tests that
 * care about timing should use vi.useFakeTimers() and drive the clock
 * explicitly; tests that don't care don't need to.
 */

if (typeof globalThis.requestAnimationFrame === "undefined") {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number =>
    setTimeout(() => cb(performance.now()), 0) as unknown as number;
  globalThis.cancelAnimationFrame = (handle: number): void => {
    clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
  };
}
