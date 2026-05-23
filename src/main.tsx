import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { toast } from "@/components/ui/sonner";
import { registerSW } from "virtual:pwa-register";
import { initPlugins } from "@/plugins";

/**
 * "Never auto-dismiss" duration for sonner toasts. Sonner doesn't export a
 * persist constant, and passing `Infinity` hands the value to `setTimeout`
 * which different browsers handle differently (some clamp to ~24 days, some
 * fire immediately). A long finite value is unambiguous; 24h is more than
 * enough — the toast is dismissed by the user clicking Refresh or Later
 * long before this expires.
 */
const PERSISTENT_TOAST_DURATION_MS = 24 * 60 * 60 * 1000;

initPlugins();

createRoot(document.getElementById("root")!).render(<App />);

const isInIframe = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();

const isPreviewHost =
  window.location.hostname.includes("id-preview--") ||
  window.location.hostname.includes("lovableproject.com") ||
  window.location.hostname.includes("lovable.app");

if (isInIframe || isPreviewHost) {
  navigator.serviceWorker?.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => {
      void registration.unregister();
    });
  });
} else {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      toast("Update ready", {
        description: "Refresh to clear stale cached files and load the latest app version.",
        duration: PERSISTENT_TOAST_DURATION_MS,
        action: {
          label: "Refresh",
          onClick: async () => {
            await updateSW(true);
          },
        },
        cancel: {
          label: "Later",
          onClick: () => undefined,
        },
      });
    },
    onRegisteredSW(_swUrl: string, registration: ServiceWorkerRegistration | undefined) {
      if (!registration) return;

      window.setInterval(() => {
        void registration.update();
      }, 60_000);
    },
  });
}
