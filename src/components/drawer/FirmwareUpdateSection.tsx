import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Cpu, Download, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type BleConnection } from "@/lib/bleDatalogger";
import { useFirmwareUpdate, type FirmwareFlashPhase } from "@/hooks/useFirmwareUpdate";

/** Firmware version display + "Check for updates" + the update confirm/progress dialog. */
export function FirmwareUpdateSection({ connection }: { connection: BleConnection }) {
  const { t } = useTranslation("drawer");
  const fw = useFirmwareUpdate(connection);

  const phaseLabel: Record<FirmwareFlashPhase, string> = {
    downloading: t("firmware.phaseDownloading"),
    uploading: t("firmware.phaseUploading"),
    verifying: t("firmware.phaseVerifying"),
    installing: t("firmware.phaseInstalling"),
    done: t("firmware.phaseDone"),
    error: t("firmware.phaseError"),
  };

  const versionLabel = fw.loadingVersion
    ? t("firmware.readingVersion")
    : fw.versionError
      ? t("firmware.versionUnavailable")
      : fw.info?.version
        ? `${t("firmware.version", { version: fw.info.version })}${fw.info.variant ? ` · ${fw.info.variant}` : ""}`
        : t("firmware.versionUnknown");

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

  // The dialog covers the confirm step, the in-progress flash, completion, and errors.
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
    <div className="space-y-2 pb-3 border-b border-border">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Cpu className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{t("firmware.firmware")}</p>
            <p className="text-xs text-muted-foreground truncate">{versionLabel}</p>
          </div>
        </div>
      </div>

      <Button
        variant="outline"
        size="sm"
        className="w-full gap-2"
        disabled={fw.checking || fw.flashing}
        onClick={fw.checkForUpdates}
      >
        {fw.checking ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <RefreshCw className="w-4 h-4" />
        )}
        {t("firmware.checkForUpdates")}
      </Button>

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
                    <p className="text-xs">
                      {t("firmware.interrupting")}
                    </p>
                  </div>
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2 sm:gap-0">
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
    </div>
  );
}
