// Platform detection + the native-shell bridge.
//
// One frontend bundle serves both the web app and the Tauri/Android shell. A
// handful of behaviours must branch on which one is running:
//   - the service worker must NOT register inside the native WebView (the shell
//     serves packaged assets; a stray SW would fight it — see main.tsx),
//   - in-app purchases are disabled on native — paid plans are bought and
//     managed on the web, to stay within Google Play's billing policy, and
//   - external links open in the system browser, not the app WebView.
// `isNativeApp()` is the single predicate the rest of the app gates on.
//
// Detection OR's two signals: a deterministic build flag (VITE_IS_NATIVE, set by
// the Tauri build) and a runtime check for Tauri's injected globals. The flag is
// primary because some decisions run at import time (the SW gate in main.tsx),
// before the Tauri runtime injects its globals.

/** The contract the native shell (the Tauri repo) wires onto `window`. */
export interface NativeBridge {
  /** Open a URL in the device's default browser, outside the app WebView. */
  openExternal(url: string): void | Promise<void>;
}

declare global {
  interface Window {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
    __HTT_NATIVE__?: NativeBridge;
  }
}

const currentWindow = (): Window | undefined => (typeof window !== "undefined" ? window : undefined);

/**
 * True when running inside a Tauri WebView. Tauri v2 injects
 * `__TAURI_INTERNALS__`; v1 used `__TAURI__` — we accept either.
 */
export function isTauri(w: Window | undefined = currentWindow()): boolean {
  return !!w && ("__TAURI_INTERNALS__" in w || "__TAURI__" in w);
}

/** True for a bundle built for the native shell (VITE_IS_NATIVE === "true"). */
export function isNativeBuild(env: { VITE_IS_NATIVE?: string } = import.meta.env): boolean {
  return env.VITE_IS_NATIVE === "true";
}

/**
 * The single gate for native-only behaviour: a native build OR a live Tauri
 * runtime. Everything that must differ between web and the Android app branches
 * on this.
 */
export function isNativeApp(
  env: { VITE_IS_NATIVE?: string } = import.meta.env,
  w: Window | undefined = currentWindow(),
): boolean {
  return isNativeBuild(env) || isTauri(w);
}

/**
 * Open a URL outside the app shell. On native, hand it to the shell's bridge so
 * it lands in the system browser (a WebView would otherwise navigate the app
 * away); on web, open a new tab. Falls back to a new tab if the native bridge
 * isn't wired up.
 */
export function openExternal(url: string, w: Window | undefined = currentWindow()): void {
  if (!w) return;
  const bridge = w.__HTT_NATIVE__;
  if (bridge && isNativeApp(import.meta.env, w)) {
    void bridge.openExternal(url);
    return;
  }
  w.open(url, "_blank", "noopener,noreferrer");
}

/**
 * onClick handler for an external `<a target="_blank">`: on native, cancel the
 * in-WebView navigation and route the URL to the system browser instead. On web
 * it's a no-op — the anchor's default opens a new tab. Framework-agnostic (takes
 * only the part of the event it needs) so this module stays React-free.
 */
export function interceptExternal(
  e: { preventDefault(): void },
  url: string,
  w: Window | undefined = currentWindow(),
): void {
  if (!isNativeApp(import.meta.env, w)) return;
  e.preventDefault();
  openExternal(url, w);
}
