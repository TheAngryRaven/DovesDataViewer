/**
 * Screen Wake Lock controller — keeps the device's screen awake while enabled.
 *
 * The browser's Wake Lock is fragile: the OS silently releases it whenever the
 * page is hidden/backgrounded (tab switch, screen-off), so a long-running view
 * like the Lap Timer has to re-acquire it on every return to visibility. This
 * controller owns that "held vs. should-be-held" state. It's pure of React and
 * DOM globals — the wake-lock requester is injected — so it's unit-testable;
 * `useWakeLock` is the thin browser adapter that wires it to the real
 * `navigator.wakeLock` + `visibilitychange`.
 */

/** The subset of `WakeLockSentinel` we depend on. */
export interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
}

/** A function shaped like `navigator.wakeLock.request`. */
export type WakeLockRequester = (type: "screen") => Promise<WakeLockSentinelLike>;

export class WakeLockController {
  private sentinel: WakeLockSentinelLike | null = null;
  private enabled = false;

  /** `request` is `null` where the Wake Lock API is unavailable — a no-op then. */
  constructor(private readonly request: WakeLockRequester | null) {}

  get isHeld(): boolean {
    return this.sentinel != null;
  }

  /** Mark the lock as wanted and acquire it now. */
  async enable(): Promise<void> {
    this.enabled = true;
    await this.acquire();
  }

  /** Mark the lock as no longer wanted and release any held sentinel. */
  async disable(): Promise<void> {
    this.enabled = false;
    await this.releaseHeld();
  }

  /**
   * Call when the page becomes visible again. The OS drops the lock while hidden,
   * so re-acquire it if we still want it but no longer hold it.
   */
  async onVisible(): Promise<void> {
    if (this.enabled && !this.sentinel) await this.acquire();
  }

  private async acquire(): Promise<void> {
    if (!this.request || this.sentinel) return;
    try {
      const sentinel = await this.request("screen");
      // Guard against a disable() that landed while the request was in flight.
      if (!this.enabled) {
        await sentinel.release().catch(() => {});
        return;
      }
      this.sentinel = sentinel;
      // The OS can release it out from under us (hide/low-battery); track that.
      sentinel.addEventListener("release", () => {
        this.sentinel = null;
      });
    } catch {
      // Request can reject (unsupported, not visible, battery saver) — non-fatal.
    }
  }

  private async releaseHeld(): Promise<void> {
    const held = this.sentinel;
    this.sentinel = null;
    if (held) await held.release().catch(() => {});
  }
}
