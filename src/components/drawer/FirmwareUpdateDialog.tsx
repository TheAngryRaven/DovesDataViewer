import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Clock, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { FirmwareFlashPhase, useFirmwareUpdate } from "@/hooks/useFirmwareUpdate";

export type FirmwareUpdateApi = ReturnType<typeof useFirmwareUpdate>;

/**
 * The firmware confirm / progress / complete / error dialog.
 *
 * Split out of `FirmwareUpdateSection` so it can be rendered once, high in the
 * tree, by whoever owns the single `useFirmwareUpdate` instance. It used to be
 * inline in the drawer's settings sub-tab, which meant an automatic check on
 * connect had nowhere to show itself: the dialog only existed while the drawer
 * was open, on the Device tab, on the settings sub-tab.
 */
export function FirmwareUpdateDialog({ fw }: { fw: FirmwareUpdateApi }) {
  const { t } = useTranslation("drawer");

  const phaseLabel: Record<FirmwareFlashPhase, string> = {
    downloading: t("firmware.phaseDownloading"),
    uploading: t("firmware.phaseUploading"),
    verifying: t("firmware.phaseVerifying"),
    installing: t("firmware.phaseInstalling"),
    done: t("firmware.phaseDone"),
    error: t("firmware.phaseError"),
  };

  // Confirm-step blurb: pick a key by which version bits are known (kept out of
  // JSX so translators get whole sentences, not concatenated fragments).
  const ver = fw.latestVersion;
  const cur = fw.info?.version;
  const confirmBlurb = fw.forced
    ? ver
      ? cur ? t("firmware.flashingForced", { version: ver, current: cur }) : t("firmware.flashingForcedNoCurrent", { version: ver })
      : t("firmware.flashingForcedNoVersion")
    : ver
      ? cur ? t("firmware.available", { version: ver, current: cur }) : t("firmware.availableNoCurrent", { version: ver })
      : t("firmware.availableNoVersion");

  const isError = fw.phase === "error";
  const isDone = fw.phase === "done";
  const dialogOpen = fw.confirmOpen || fw.flashing || isError || isDone;
  const showProgress = fw.flashing && !isDone;
  // Uploading + installing report real percentages; the rest are indeterminate.
  const hasPercent = fw.phase === "uploading" || fw.phase === "installing";

  const handleOpenChange = (open: boolean) => {
    if (open) return;
    if (fw.flashing) return; // can't dismiss mid-flash
    if (isDone) fw.finish();
    else if (isError) fw.dismiss();
    else fw.cancel();
  };

  return (
    <Dialog open={dialogOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onInteractOutside={(e) => fw.flashing && e.preventDefault()}
        onEscapeKeyDown={(e) => fw.flashing && e.preventDefault()}
      >
        {/* ---- Confirm step ---- */}
        {fw.confirmOpen && !fw.flashing && fw.phase === null && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-warning" />
                {t("firmware.updateTitle")}
              </DialogTitle>
              <DialogDescription asChild>
                <div className="space-y-2 pt-1 text-left">
                  <p>{confirmBlurb}</p>
                  {fw.forced && (
                    <p className="rounded-md bg-warning/10 px-2 py-1 text-xs text-warning">
                      {t("firmware.betaNote")}
                    </p>
                  )}
                  <p className="font-medium text-foreground">{t("firmware.beforeStart")}</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>{t("firmware.li1")}</li>
                    <li>{t("firmware.li2")}</li>
                    <li>{t("firmware.li3")}</li>
                  </ul>
                  <p className="text-xs">{t("firmware.interrupting")}</p>
                </div>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="ghost" onClick={fw.snooze}>
                <Clock className="w-4 h-4 mr-1" /> {t("firmware.remindTomorrow")}
              </Button>
              <Button variant="outline" onClick={fw.cancel}>
                {t("firmware.cancel")}
              </Button>
              <Button className="gap-2" onClick={fw.startUpdate}>
                <Download className="w-4 h-4" /> {t("firmware.upload")}
              </Button>
            </DialogFooter>
          </>
        )}

        {/* ---- Progress step ---- */}
        {showProgress && fw.phase && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                {phaseLabel[fw.phase]}
              </DialogTitle>
              <DialogDescription>
                {hasPercent
                  ? t("firmware.progressPercent", { percent: fw.percent })
                  : t("firmware.progressIndeterminate")}
              </DialogDescription>
            </DialogHeader>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full bg-primary transition-all ${hasPercent ? "" : "animate-pulse"}`}
                style={{ width: hasPercent ? `${fw.percent}%` : "100%" }}
              />
            </div>
          </>
        )}

        {/* ---- Complete step ---- */}
        {isDone && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-primary" />
                {t("firmware.complete")}
              </DialogTitle>
              <DialogDescription className="text-left">
                {t("firmware.completeDesc")}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={fw.finish}>{t("firmware.done")}</Button>
            </DialogFooter>
          </>
        )}

        {/* ---- Error step ---- */}
        {isError && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-destructive" />
                {phaseLabel.error}
              </DialogTitle>
              <DialogDescription className="text-left whitespace-pre-wrap break-words max-h-60 overflow-y-auto">
                {fw.flashError ?? t("firmware.genericError")}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={fw.dismiss}>
                {t("firmware.close")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
