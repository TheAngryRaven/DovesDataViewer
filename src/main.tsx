import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { toast } from "@/components/ui/sonner";
import { registerSW } from "virtual:pwa-register";
import { initPlugins } from "@/plugins";
import { initDebugConsole } from "@/lib/debugConsole";
import { isNativeApp } from "@/lib/platform";
import { startVersionPolling } from "@/lib/versionCheck";
// Initialize i18next before render so the chosen language is active on first
// paint (no English flash). The default export is the configured instance.
import i18n from "@/lib/i18n";

/**
 * "Never auto-dismiss" duration for sonner toasts. Sonner doesn't export a
 * persist constant, and passing `Infinity` hands the value to `setTimeout`
 * which different browsers handle differently (some clamp to ~24 days, some
 * fire immediately). A long finite value is unambiguous; 24h is more than
 * enough — the toast is dismissed by the user clicking Refresh or Later
 * long before this expires.
 */
const PERSISTENT_TOAST_DURATION_MS = 24 * 60 * 60 * 1000;

// Install the on-screen debug console capture before anything else renders, so
// early/uncaught errors are caught on devices with no dev tools (?dbg=true).
initDebugConsole();

initPlugins();

createRoot(document.getElementById("root")!).render(<App />);

const isInIframe = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();

const isPreviewHost = window.location.search.includes("nosw=1");

const cleanupPreviewServiceWorkers = async () => {
  const registrations = await navigator.serviceWorker?.getRegistrations();
  await Promise.all(
    (registrations ?? []).map((registration) => registration.unregister()),
  );

  if (typeof caches === "undefined") return;

  const cacheNames = await caches.keys();
  await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
};

type UpdateSW = (reloadPage?: boolean) => Promise<void>;

/**
 * Reboot onto the freshly-deployed build. The happy path hands off to the PWA's
 * own `updateSW(true)` (activate the waiting worker, then reload). If that does
 * nothing — e.g. the service worker itself was served stale, which is the very
 * failure this guards against — fall back after a short grace period to a hard
 * reset: unregister the worker, drop caches, reload.
 */
const rebootToLatest = (updateSW: UpdateSW) => {
  void updateSW(true);
  window.setTimeout(async () => {
    await cleanupPreviewServiceWorkers();
    window.location.reload();
  }, 2000);
};

/**
 * Persistent "Update ready" toast. A fixed id de-dupes it, so the SW's
 * `onNeedRefresh` and the version poller can both ask for it without stacking.
 */
const showUpdateToast = (updateSW: UpdateSW) => {
  toast(i18n.t("common:updateToast.title"), {
    id: "app-update",
    description: i18n.t("common:updateToast.description"),
    duration: PERSISTENT_TOAST_DURATION_MS,
    action: {
      label: i18n.t("common:updateToast.refresh"),
      onClick: () => rebootToLatest(updateSW),
    },
    cancel: {
      label: i18n.t("common:updateToast.later"),
      onClick: () => undefined,
    },
  });
};

// The native (Tauri/Android) shell is a top-level window — not an iframe — so it
// slips past the checks above. It serves its own packaged assets, so a service
// worker has nothing useful to do and would only fight the shell's caching;
// route native through the same cleanup path as preview hosts.
if (isInIframe || isPreviewHost || isNativeApp()) {
  void cleanupPreviewServiceWorkers();
} else {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      showUpdateToast(updateSW);
    },
    onRegisteredSW(_swUrl: string, registration: ServiceWorkerRegistration | undefined) {
      if (!registration) return;

      window.setInterval(() => {
        void registration.update();
      }, 60_000);

      // Independent of the service worker's own diff-detection (which can stall
      // behind HTTP/CDN caching): poll a build-emitted version.json and prompt
      // when a genuinely newer build is live. Nudge the SW first so the reboot
      // lands on the new assets.
      startVersionPolling(() => {
        void registration.update();
        showUpdateToast(updateSW);
      });
    },
  });
}
