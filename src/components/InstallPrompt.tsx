import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Download, Share, SquarePlus, X } from "lucide-react";
import {
  detectInstallState,
  isSnoozed,
  readInstallEnvironment,
  INSTALL_HINT_SNOOZE_KEY,
  type InstallState,
} from "@/lib/pwaInstall";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Read the dismissal stamp; treat a locked-down storage as "never dismissed". */
const readSnooze = (): string | null => {
  try {
    return localStorage.getItem(INSTALL_HINT_SNOOZE_KEY);
  } catch {
    return null;
  }
};

const writeSnooze = (now: number) => {
  try {
    localStorage.setItem(INSTALL_HINT_SNOOZE_KEY, String(now));
  } catch {
    /* private mode / lockdown — the hint simply returns next visit */
  }
};

/**
 * Offers an installed copy of the app, which on iOS is the difference between
 * having telemetry at the track and staring at an error page: Safari wipes a
 * plain tab's service worker and IndexedDB after about a week of not visiting,
 * while a Home Screen app keeps them. iOS never fires `beforeinstallprompt`, so
 * there it renders the share-sheet steps instead of a button — see
 * lib/pwaInstall for the why.
 */
export function InstallPrompt() {
  const { t } = useTranslation("common");
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installState, setInstallState] = useState<InstallState>("installed");
  const [isDismissed, setIsDismissed] = useState(true);

  useEffect(() => {
    const state = detectInstallState(readInstallEnvironment());
    setInstallState(state);
    setIsDismissed(isSnoozed(readSnooze(), Date.now()));

    if (state === "installed") return;

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setInstallState("installed");
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") setInstallState("installed");
    setDeferredPrompt(null);
  }, [deferredPrompt]);

  const handleDismiss = useCallback(() => {
    setIsDismissed(true);
    writeSnooze(Date.now());
  }, []);

  const showIosHint = installState === "ios-manual";
  const showInstallButton = installState === "prompt-capable" && deferredPrompt !== null;

  if (isDismissed || (!showIosHint && !showInstallButton)) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-auto md:max-w-sm z-[9999] animate-in slide-in-from-bottom-4 duration-300">
      <div className="bg-card border border-border rounded-lg shadow-lg p-4 flex items-start gap-3">
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-sm font-medium text-foreground">{t("install.title")}</p>
          <p className="text-xs text-muted-foreground">{t("install.body")}</p>
          {showIosHint && (
            <>
              <p className="text-xs text-muted-foreground">{t("install.iosWhy")}</p>
              <ol className="text-xs text-muted-foreground space-y-1 pt-1">
                <li className="flex items-center gap-1.5">
                  <Share className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>{t("install.iosStepShare")}</span>
                </li>
                <li className="flex items-center gap-1.5">
                  <SquarePlus className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>{t("install.iosStepAdd")}</span>
                </li>
              </ol>
              <p className="text-xs text-muted-foreground pt-1">{t("install.iosStepOpen")}</p>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {showInstallButton && (
            <Button size="sm" variant="default" onClick={handleInstall} className="gap-1.5">
              <Download className="w-3.5 h-3.5" />
              {t("install.action")}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={handleDismiss}
            className="p-2"
            aria-label={t("install.dismiss")}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
