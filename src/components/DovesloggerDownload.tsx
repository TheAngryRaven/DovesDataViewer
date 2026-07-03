import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Bluetooth, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DeviceListPanel, ErrorPanel, FileListPanel, ProgressPanel } from "@/components/loggers/DownloadPanels";
import { createDovesloggerConnection } from "@/lib/loggers/doveslogger/dovesloggerConnection";
import { loggerScan, loggerConnect, type ScannedDevice } from "@/lib/loggers/doveslogger/ipc";
import {
  classifyLoggerError,
  loggerErrorKey,
  recoveryActionFor,
  type ClassifiedLoggerError,
  type LoggerFlowStage,
} from "@/lib/loggers/errors";
import type { LoggerConnection, LoggerFile, LoggerDownloadProgress } from "@/lib/loggers";
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

interface DovesloggerDownloadProps {
  onDataLoaded: (data: ParsedData, fileName?: string) => void;
  autoSave?: boolean;
  autoSaveFile?: (name: string, blob: Blob) => Promise<void>;
  /** Begin scanning as soon as the flow mounts (it's mounted on demand). */
  autoStart?: boolean;
  /** Called when the flow finishes or is dismissed so the host can unmount it. */
  onClose: () => void;
}

/**
 * The native (Tauri) PerchWerks Fledgling / DovesLogger download flow: scan over
 * BLE via the native shell, let the user pick a device (BLE has no OS picker),
 * connect, list sessions, download + import the chosen one. Native-only and
 * mounted on demand by `LoggerDownload` once the user picks the Fledgling on the
 * native app, so `@tauri-apps/api` stays off the web/eager bundle. Talks to the
 * device only through the generic `LoggerConnection` surface, and owns the
 * connection — it disconnects on every exit (close/cancel/error/unmount).
 */
export function DovesloggerDownload({ onDataLoaded, autoSave, autoSaveFile, autoStart, onClose }: DovesloggerDownloadProps) {
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
      console.error("DovesLogger scan error:", err);
      setFailure({ error: classifyLoggerError(err), stage: "scan", fileSaved: false });
      setState("error");
    }
  }, []);

  const handleDeviceSelect = useCallback(async (device: ScannedDevice) => {
    setFailure(null);
    setState("connecting");
    try {
      const info = await loggerConnect({ host: device.id });
      const logger = createDovesloggerConnection(info);
      loggerRef.current = logger;

      setState("fetching-files");
      const fileList = await logger.listLogs();
      setFiles(fileList);
      setState("file-list");
    } catch (err) {
      console.error("DovesLogger connect/list error:", err);
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

      let saved = false;
      try {
        const bytes = await logger.downloadLog(file.name, setProgress);
        const blob = new Blob([bytes.buffer as ArrayBuffer]);

        // Save the raw file first so it's never lost.
        if (autoSave && autoSaveFile) {
          try {
            await autoSaveFile(file.name, blob);
            saved = true;
          } catch (e) {
            console.warn("Auto-save failed:", e);
          }
        }

        // Raw device bytes (.dove/.dovex/.csv) — route by extension so the binary
        // .dovex header survives (parseDatalogFile auto-detects; no text decode).
        const data = await parseDatalogFile(new File([blob], file.name));
        handleClose();
        onDataLoaded(data, file.name);
      } catch (err) {
        console.error("DovesLogger download/parse error:", err);
        setFailure({ error: classifyLoggerError(err), stage: "download", fileSaved: saved });
        setState("error");
      }
    },
    [autoSave, autoSaveFile, handleClose, onDataLoaded],
  );

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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bluetooth className="w-5 h-5" />
            {state === "scanning" && t("doveslogger.flow.scanning")}
            {state === "device-list" && t("doveslogger.flow.selectDevice")}
            {state === "connecting" && t("doveslogger.flow.connecting")}
            {state === "fetching-files" && t("doveslogger.flow.fetching")}
            {state === "file-list" && t("doveslogger.flow.selectFile")}
            {state === "downloading" && t("doveslogger.flow.downloading")}
            {state === "error" && t("doveslogger.flow.errorTitle")}
          </DialogTitle>
        </DialogHeader>

        {state === "scanning" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="w-12 h-12 animate-spin text-primary" />
            <p className="text-muted-foreground">{t("doveslogger.flow.scanning")}</p>
          </div>
        )}

        {state === "device-list" && (
          <DeviceListPanel
            devices={devices}
            onSelect={handleDeviceSelect}
            onRescan={handleScan}
            instructions={t("doveslogger.flow.deviceInstructions")}
            emptyText={t("doveslogger.flow.noDevices")}
            rescanLabel={t("doveslogger.flow.rescan")}
          />
        )}

        {state === "connecting" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="w-12 h-12 animate-spin text-primary" />
            <p className="text-muted-foreground">{t("doveslogger.flow.connecting")}</p>
          </div>
        )}

        {state === "fetching-files" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="w-12 h-12 animate-spin text-primary" />
            <p className="text-muted-foreground">{t("doveslogger.flow.fetching")}</p>
          </div>
        )}

        {state === "file-list" && (
          <FileListPanel
            files={files}
            onSelect={handleFileSelect}
            instructions={t("doveslogger.flow.instructions")}
            emptyText={t("doveslogger.flow.empty")}
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

        {state === "error" && failure && (
          <ErrorPanel
            message={t(loggerErrorKey(failure.error.category))}
            detail={failure.error.detail || undefined}
            detailLabel={t("errors.detailLabel")}
            savedHint={failure.fileSaved ? t("doveslogger.flow.savedHint") : undefined}
            onCancel={handleClose}
            cancelLabel={t("doveslogger.flow.cancel")}
            onAction={action !== "none" ? handleRecover : undefined}
            actionLabel={action !== "none" ? actionLabel : undefined}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
