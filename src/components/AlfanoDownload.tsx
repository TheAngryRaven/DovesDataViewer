import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Bluetooth, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DeviceListPanel, ErrorPanel, FileListPanel, ProgressPanel } from "@/components/loggers/DownloadPanels";
import { createAlfanoConnection } from "@/lib/loggers/alfano/alfanoConnection";
import { loggerScan, loggerConnect, type ScannedDevice } from "@/lib/loggers/alfano/ipc";
import {
  classifyLoggerError,
  loggerErrorKey,
  recoveryActionFor,
  type ClassifiedLoggerError,
  type LoggerFlowStage,
} from "@/lib/loggers/errors";
import type { LoggerConnection, LoggerFile, LoggerDownloadProgress } from "@/lib/loggers";
import { csvFileName } from "@/lib/loggers/fileNaming";
import { parseDatalogFile } from "@/lib/datalogParser";
import { ParsedData } from "@/types/racing";

type DownloadState =
  | "idle"
  | "scanning"
  | "device-list"
  | "connecting"
  | "fetching-files"
  | "file-list"
  | "downloading"
  | "error";

interface Failure {
  error: ClassifiedLoggerError;
  stage: LoggerFlowStage;
  /** Only download-stage failures leave a saved raw file behind. */
  fileSaved: boolean;
}

interface AlfanoDownloadProps {
  onDataLoaded: (data: ParsedData, fileName?: string) => void;
  autoSave?: boolean;
  autoSaveFile?: (name: string, blob: Blob) => Promise<void>;
  /** Begin scanning as soon as the flow mounts (it's mounted on demand). */
  autoStart?: boolean;
  /** Called when the flow finishes or is dismissed so the host can unmount it. */
  onClose: () => void;
}

/**
 * The native (Tauri) Alfano download flow — SKELETON. Alfano talks over Bluetooth
 * serial (Classic Bluetooth SPP), which the web can't reach, so this flow is
 * native-only and is mounted on demand by `LoggerDownload` once the user picks
 * Alfano on the native app, keeping `@tauri-apps/api` off the web/eager bundle.
 * Mirrors `DovesloggerDownload`: scan → pick device → connect → list → download +
 * import. Talks to the device only through the generic `LoggerConnection`
 * surface, and owns the connection — it disconnects on every exit
 * (close/cancel/error/unmount). The Rust backend it drives is still TBD, and it's
 * Android-only — desktop shells reject with `unsupported:`, which renders as an
 * informational "not available" panel, not an error.
 */
export function AlfanoDownload({ onDataLoaded, autoSave, autoSaveFile, autoStart, onClose }: AlfanoDownloadProps) {
  const { t } = useTranslation("logger");
  const [state, setState] = useState<DownloadState>("idle");
  const [devices, setDevices] = useState<ScannedDevice[]>([]);
  const [files, setFiles] = useState<LoggerFile[]>([]);
  const [progress, setProgress] = useState<LoggerDownloadProgress | null>(null);
  const [currentFile, setCurrentFile] = useState<string>("");
  const [failure, setFailure] = useState<Failure | null>(null);
  const loggerRef = useRef<LoggerConnection | null>(null);
  const lastFileRef = useRef<LoggerFile | null>(null);

  const handleClose = useCallback(() => {
    loggerRef.current?.disconnect();
    loggerRef.current = null;
    setState("idle");
    setDevices([]);
    setFiles([]);
    setProgress(null);
    setCurrentFile("");
    setFailure(null);
    onClose();
  }, [onClose]);

  const handleScan = useCallback(async () => {
    setFailure(null);
    // A fresh scan implies any prior connection is stale — drop it.
    loggerRef.current?.disconnect();
    loggerRef.current = null;
    setState("scanning");
    try {
      const found = await loggerScan();
      setDevices(found);
      setState("device-list");
    } catch (err) {
      console.error("Alfano scan error:", err);
      setFailure({ error: classifyLoggerError(err), stage: "scan", fileSaved: false });
      setState("error");
    }
  }, []);

  const handleDeviceSelect = useCallback(async (device: ScannedDevice) => {
    setFailure(null);
    setState("connecting");
    try {
      const info = await loggerConnect({ host: device.id });
      const logger = createAlfanoConnection(info);
      loggerRef.current = logger;

      setState("fetching-files");
      const fileList = await logger.listLogs();
      setFiles(fileList);
      setState("file-list");
    } catch (err) {
      console.error("Alfano connect/list error:", err);
      setFailure({ error: classifyLoggerError(err), stage: "connect", fileSaved: false });
      setState("error");
    }
  }, []);

  // Kick off the scan as soon as the flow is mounted (once).
  const startedRef = useRef(false);
  useEffect(() => {
    if (autoStart && !startedRef.current) {
      startedRef.current = true;
      void handleScan();
    }
  }, [autoStart, handleScan]);

  // Always release the device when this flow unmounts.
  useEffect(() => () => void loggerRef.current?.disconnect(), []);

  const handleFileSelect = useCallback(
    async (file: LoggerFile) => {
      const logger = loggerRef.current;
      if (!logger) {
        setFailure({
          error: { category: "not-connected", detail: "" },
          stage: "download",
          fileSaved: false,
        });
        setState("error");
        return;
      }

      setState("downloading");
      setCurrentFile(file.name);
      lastFileRef.current = file;
      setProgress({ received: 0, total: file.size, percent: 0, speed: "0 B/s", eta: "--" });
      setFailure(null);

      // The device reports bare session ids; the payload is CSV — save/import
      // under a `.csv` name so the importer routes it correctly.
      const fileName = csvFileName(file.name);

      let saved = false;
      try {
        const bytes = await logger.downloadLog(file.name, setProgress);
        const blob = new Blob([bytes.buffer as ArrayBuffer]);

        // Save the raw file first so it's never lost.
        if (autoSave && autoSaveFile) {
          try {
            await autoSaveFile(fileName, blob);
            saved = true;
          } catch (e) {
            console.warn("Auto-save failed:", e);
          }
        }

        const data = await parseDatalogFile(new File([blob], fileName));
        handleClose();
        onDataLoaded(data, fileName);
      } catch (err) {
        console.error("Alfano download/parse error:", err);
        setFailure({ error: classifyLoggerError(err), stage: "download", fileSaved: saved });
        setState("error");
      }
    },
    [autoSave, autoSaveFile, handleClose, onDataLoaded],
  );

  // Alfano on desktop rejects with `unsupported:` (Android-only backend) — that's
  // a platform limitation, not a failure, so it gets an informational panel.
  const unavailable = failure?.error.category === "unsupported";

  // Recovery: a failed download retries the same file while the link is alive;
  // everything else (and a dead link) goes back through a fresh scan.
  const action = failure ? recoveryActionFor(failure.error.category, failure.stage) : "none";
  const handleRecover = useCallback(() => {
    const lastFile = lastFileRef.current;
    if (action === "retry" && loggerRef.current && lastFile) {
      void handleFileSelect(lastFile);
    } else {
      void handleScan();
    }
  }, [action, handleFileSelect, handleScan]);
  const actionLabel =
    action === "retry"
      ? t("errors.actionRetry")
      : action === "reconnect"
        ? t("errors.actionReconnect")
        : t("errors.actionRescan");

  const isModalOpen = state !== "idle";

  return (
    <Dialog open={isModalOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md safe-area-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bluetooth className="w-5 h-5" />
            {state === "scanning" && t("alfano.flow.scanning")}
            {state === "device-list" && t("alfano.flow.selectDevice")}
            {state === "connecting" && t("alfano.flow.connecting")}
            {state === "fetching-files" && t("alfano.flow.fetching")}
            {state === "file-list" && t("alfano.flow.selectFile")}
            {state === "downloading" && t("alfano.flow.downloading")}
            {state === "error" && (unavailable ? t("alfano.flow.unavailableTitle") : t("alfano.flow.errorTitle"))}
          </DialogTitle>
        </DialogHeader>

        {state === "scanning" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="w-12 h-12 animate-spin text-primary" />
            <p className="text-muted-foreground">{t("alfano.flow.scanning")}</p>
          </div>
        )}

        {state === "device-list" && (
          <DeviceListPanel
            devices={devices}
            onSelect={handleDeviceSelect}
            onRescan={handleScan}
            instructions={t("alfano.flow.deviceInstructions")}
            emptyText={t("alfano.flow.noDevices")}
            rescanLabel={t("alfano.flow.rescan")}
          />
        )}

        {state === "connecting" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="w-12 h-12 animate-spin text-primary" />
            <p className="text-muted-foreground">{t("alfano.flow.connecting")}</p>
          </div>
        )}

        {state === "fetching-files" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="w-12 h-12 animate-spin text-primary" />
            <p className="text-muted-foreground">{t("alfano.flow.fetching")}</p>
          </div>
        )}

        {state === "file-list" && (
          <FileListPanel
            files={files}
            onSelect={handleFileSelect}
            instructions={t("alfano.flow.instructions")}
            emptyText={t("alfano.flow.empty")}
          />
        )}

        {state === "downloading" && progress && (
          <ProgressPanel
            currentFile={currentFile}
            progress={progress}
            labels={{
              received: t("progress.received"),
              speed: t("progress.speed"),
              eta: t("progress.eta"),
            }}
            completeText={t("progress.complete", { percent: progress.percent.toFixed(1) })}
          />
        )}

        {state === "error" && failure && unavailable && (
          <div className="flex flex-col items-center gap-4 py-4">
            <p className="text-sm text-center text-muted-foreground">{t("errors.unsupportedAlfano")}</p>
            <Button variant="outline" onClick={handleClose}>
              {t("close")}
            </Button>
          </div>
        )}

        {state === "error" && failure && !unavailable && (
          <ErrorPanel
            message={t(loggerErrorKey(failure.error.category))}
            detail={failure.error.detail || undefined}
            detailLabel={t("errors.detailLabel")}
            savedHint={failure.fileSaved ? t("alfano.flow.savedHint") : undefined}
            onCancel={handleClose}
            cancelLabel={t("alfano.flow.cancel")}
            onAction={action !== "none" ? handleRecover : undefined}
            actionLabel={action !== "none" ? actionLabel : undefined}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
