// "Is this device actually ready to work with no signal?"
//
// The app is offline-first, but until now nothing said so out loud: a user could
// load the site, walk out of coverage, and only discover on the next refresh
// that the service worker install never finished. This turns the two things that
// matter — is the app shell cached, and are the deferred extras in — into one
// state the UI can show before signal is gone.

export type OfflineReadiness =
  /**
   * The native (Tauri) shell: every asset ships inside the app package and no
   * service worker is registered, so it is offline by construction.
   */
  | "native"
  /** No service worker (unsupported browser, private mode). */
  | "unsupported"
  /** Nothing usable cached yet — a refresh with no signal would fail. */
  | "not-ready"
  /** The app itself will load offline; the extras are still downloading. */
  | "preparing"
  /** Everything is cached. */
  | "ready";

export interface ReadinessInput {
  /**
   * `isNativeApp()`. Checked first: Android's WebView exposes
   * `navigator.serviceWorker`, but the shell never registers one, so without
   * this it would read "not ready" forever.
   */
  nativeApp?: boolean;
  /** `"serviceWorker" in navigator` — false in private mode. */
  serviceWorkerSupported: boolean;
  /** A worker is active and controlling this page, so the shell is cached. */
  controlled: boolean;
  /** Deferred assets listed in the build manifest. */
  deferredTotal: number;
  /** Deferred assets already in the cache. */
  deferredCached: number;
}

/**
 * Note that `controlled` alone decides whether the app loads offline: the shell
 * is precached as a unit, so a controlling worker means the install completed.
 * The deferred count only separates "ready" from "preparing" — a session with
 * extras still missing still opens, it just can't show the bundled sample.
 */
export function computeReadiness(input: ReadinessInput): OfflineReadiness {
  if (input.nativeApp) return "native";
  if (!input.serviceWorkerSupported) return "unsupported";
  if (!input.controlled) return "not-ready";
  return input.deferredCached >= input.deferredTotal ? "ready" : "preparing";
}

/** Whole-number percent of the deferred warm-up, for a progress readout. */
export function readinessPercent(cached: number, total: number): number {
  if (total <= 0) return 100;
  return Math.min(100, Math.max(0, Math.round((cached / total) * 100)));
}
