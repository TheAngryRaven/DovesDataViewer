/**
 * Holds a screen wake lock (keeps the phone awake) while `active` is true,
 * re-acquiring it after the OS releases it on tab-hide. A no-op where the Wake
 * Lock API is unavailable (older browsers / non-secure contexts). The lifecycle
 * logic lives in the unit-tested `WakeLockController`; this is the browser glue.
 */
import { useEffect } from "react";
import { WakeLockController, type WakeLockRequester } from "@/lib/wakeLock";

export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    const wakeLock = (navigator as Navigator & { wakeLock?: { request: WakeLockRequester } }).wakeLock;
    const request: WakeLockRequester | null = wakeLock
      ? (type) => wakeLock.request(type)
      : null;

    const controller = new WakeLockController(request);
    void controller.enable();

    const onVisibility = () => {
      if (document.visibilityState === "visible") void controller.onVisible();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      void controller.disable();
    };
  }, [active]);
}
