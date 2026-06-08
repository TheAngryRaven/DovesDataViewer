import { AlertTriangle, Cpu, Download, Loader2, RefreshCw } from "lucide-react";
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

const PHASE_LABEL: Record<FirmwareFlashPhase, string> = {
  downloading: "Downloading firmware…",
  uploading: "Uploading to device…",
  verifying: "Verifying on device…",
  installing: "Installing…",
  done: "Update complete!",
  error: "Update failed",
};

/** Firmware version display + "Check for updates" + the update confirm/progress dialog. */
export function FirmwareUpdateSection({ connection }: { connection: BleConnection }) {
  const fw = useFirmwareUpdate(connection);

  const versionLabel = fw.loadingVersion
    ? "Reading version…"
    : fw.versionError
      ? "Version unavailable"
      : fw.info?.version
        ? `Version ${fw.info.version}${fw.info.variant ? ` · ${fw.info.variant}` : ""}`
        : "Version unknown";

  // The dialog covers the confirm step, the in-progress flash, and the error state.
  const dialogOpen = fw.confirmOpen || fw.flashing || fw.phase === "error";
  const showProgress = fw.flashing || (fw.phase !== null && fw.phase !== "error");
  const isError = fw.phase === "error";
  // Uploading + installing report real percentages; the rest are indeterminate.
  const hasPercent = fw.phase === "uploading" || fw.phase === "installing";

  const handleOpenChange = (open: boolean) => {
    if (open) return;
    if (fw.flashing) return; // can't dismiss mid-flash
    if (isError) fw.dismiss();
    else fw.cancel();
  };

  return (
    <div className="space-y-2 pb-3 border-b border-border">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Cpu className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Firmware</p>
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
        Check for updates
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
                  Update firmware
                </DialogTitle>
                <DialogDescription asChild>
                  <div className="space-y-2 pt-1 text-left">
                    {fw.forced ? (
                      <p>
                        Flashing firmware
                        {fw.latestVersion ? ` v${fw.latestVersion}` : ""}
                        {fw.info?.version ? ` (current: v${fw.info.version}).` : "."}
                      </p>
                    ) : (
                      <p>
                        A new firmware version
                        {fw.latestVersion ? ` (v${fw.latestVersion})` : ""} is available
                        {fw.info?.version ? ` — you're on v${fw.info.version}.` : "."}
                      </p>
                    )}
                    {fw.forced && (
                      <p className="rounded-md bg-warning/10 px-2 py-1 text-xs text-warning">
                        On beta branches updates always push through for testing.
                      </p>
                    )}
                    <p className="font-medium text-foreground">Before you start:</p>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Make sure the logger's battery is well charged.</li>
                      <li>Keep the device close and powered on.</li>
                      <li>
                        Don't close this tab or power off the device until it finishes.
                      </li>
                    </ul>
                    <p className="text-xs">
                      Interrupting an update can require a manual recovery.
                    </p>
                  </div>
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="outline" onClick={fw.cancel}>
                  Cancel
                </Button>
                <Button className="gap-2" onClick={fw.startUpdate}>
                  <Download className="w-4 h-4" /> Upload
                </Button>
              </DialogFooter>
            </>
          )}

          {/* ---- Progress step ---- */}
          {showProgress && fw.phase && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {fw.phase !== "done" && (
                    <Loader2 className="w-5 h-5 animate-spin text-primary" />
                  )}
                  {PHASE_LABEL[fw.phase]}
                </DialogTitle>
                <DialogDescription>
                  {hasPercent
                    ? `${fw.percent}% — please keep the device powered on.`
                    : "Please keep the device powered on and nearby."}
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

          {/* ---- Error step ---- */}
          {isError && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-destructive" />
                  {PHASE_LABEL.error}
                </DialogTitle>
                <DialogDescription className="text-left whitespace-pre-wrap break-words max-h-60 overflow-y-auto">
                  {fw.flashError ?? "Something went wrong during the update."}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={fw.dismiss}>
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
