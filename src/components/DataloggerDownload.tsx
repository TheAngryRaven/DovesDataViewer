import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Bluetooth, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createFledglingConnection, type LoggerConnection, type LoggerFile, type LoggerDownloadProgress } from "@/lib/loggers";
import { ErrorPanel, FileListPanel, ProgressPanel } from "@/components/loggers/DownloadPanels";
import {
  classifyLoggerError,
  loggerErrorKey,
  recoveryActionFor,
  type ClassifiedLoggerError,
  type LoggerFlowStage,
} from "@/lib/loggers/errors";
import { useDeviceContext } from "@/contexts/DeviceContext";
import { parseDatalogContent } from "@/lib/datalogParser";
import { ParsedData } from "@/types/racing";

type DownloadState =
  | "idle"
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

interface DataloggerDownloadProps {
  onDataLoaded: (data: ParsedData, fileName?: string) => void;
  autoSave?: boolean;
  autoSaveFile?: (name: string, blob: Blob) => Promise<void>;
  /** Begin connecting as soon as the flow mounts (it's mounted on demand). */
  autoStart?: boolean;
  /** Called when the flow finishes or is dismissed so the host can unmount it. */
  onClose: () => void;
}

/**
 * The PerchWerks Fledgling download flow: connect over Web Bluetooth, list logs,
 * download + parse the chosen one. Mounted on demand by `LoggerDownload` once the
 * user picks the Fledgling in the logger picker, so the BLE protocol bundle
 * (`lib/ble/*`) stays off the initial/landing payload. Talks to the device only
 * through the generic `LoggerConnection` surface.
 */
export function DataloggerDownload({ onDataLoaded, autoSave, autoSaveFile, autoStart, onClose }: DataloggerDownloadProps) {
  const { t } = useTranslation("logger");
  const device = useDeviceContext();
  const connection = device.connection;
  const [state, setState] = useState<DownloadState>("idle");
  const [files, setFiles] = useState<LoggerFile[]>([]);
  const [progress, setProgress] = useState<LoggerDownloadProgress | null>(null);
  const [currentFile, setCurrentFile] = useState<string>("");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const loggerRef = useRef<LoggerConnection | null>(null);
  const lastFileRef = useRef<LoggerFile | null>(null);

  const handleClose = useCallback(() => {
    // Do NOT disconnect — connection lifecycle is owned by DeviceContext.
    // Only the explicit Disconnect button in the drawer header tears down GATT.
    setState("idle");
    setFiles([]);
    setProgress(null);
    setCurrentFile("");
    setFailure(null);
    setStatusMessage("");
    loggerRef.current = null;
    onClose();
  }, [onClose]);

  const handleConnect = useCallback(async () => {
    setState("connecting");
    setFailure(null);
    setStatusMessage(t("fledgling.flow.scanningStatus"));

    try {
      // Reuse existing context connection if available; otherwise connect via context.
      const conn = device.connection ?? (await device.connect(setStatusMessage));
      if (!conn) {
        // User cancelled the picker — close the flow.
        handleClose();
        return;
      }

      const logger = createFledglingConnection(conn);
      loggerRef.current = logger;

      setState("fetching-files");
      setStatusMessage(t("fledgling.flow.fetchingStatus"));

      const fileList = await logger.listLogs(setStatusMessage);
      setFiles(fileList);
      setState("file-list");
    } catch (err) {
      console.error("Connection/file list error:", err);
      setFailure({ error: classifyLoggerError(err), stage: "connect", fileSaved: false });
      setState("error");
    }
  }, [device, handleClose, t]);

  // Kick off the connection as soon as the flow is mounted (once).
  const startedRef = useRef(false);
  useEffect(() => {
    if (autoStart && !startedRef.current) {
      startedRef.current = true;
      void handleConnect();
    }
  }, [autoStart, handleConnect]);

  const handleFileSelect = useCallback(
    async (file: LoggerFile) => {
      const logger = loggerRef.current;
      if (!connection || !logger) {
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
      setProgress({
        received: 0,
        total: file.size,
        percent: 0,
        speed: "0 B/s",
        eta: "--",
      });
      setFailure(null);

      let saved = false;
      try {
        const fileData = await logger.downloadLog(file.name, setProgress, setStatusMessage);

        // Always save the raw file first so it's never lost
        if (autoSave && autoSaveFile) {
          try {
            await autoSaveFile(file.name, new Blob([fileData.buffer as ArrayBuffer]));
            saved = true;
          } catch (e) {
            console.warn("Auto-save failed:", e);
          }
        }

        // Convert Uint8Array to string for text-based formats
        const decoder = new TextDecoder();
        const content = decoder.decode(fileData);

        const parsedData = parseDatalogContent(content);

        // Close modal and load data
        handleClose();
        onDataLoaded(parsedData, file.name);
      } catch (err) {
        console.error("Download/parse error:", err);
        setFailure({ error: classifyLoggerError(err), stage: "download", fileSaved: saved });
        setState("error");
      }
    },
    [connection, onDataLoaded, autoSave, autoSaveFile, handleClose]
  );

  // React to unexpected disconnects from the context while a transfer is in flight.
  useEffect(() => {
    if (!connection && (state === "downloading" || state === "fetching-files" || state === "file-list")) {
      setFailure({
        error: { category: "not-connected", detail: "" },
        stage: state === "downloading" ? "download" : "connect",
        fileSaved: false,
      });
      setState("error");
    }
  }, [connection, state]);

  // Recovery: a failed download retries the same file while the link is alive;
  // everything else re-drives the Web Bluetooth connect (there's no scan step —
  // the browser chooser IS the picker, so "rescan" reads as reconnect here).
  const action = failure ? recoveryActionFor(failure.error.category, failure.stage) : "none";
  const handleRecover = useCallback(() => {
    const lastFile = lastFileRef.current;
    if (action === "retry" && connection && loggerRef.current && lastFile) {
      void handleFileSelect(lastFile);
    } else {
      void handleConnect();
    }
  }, [action, connection, handleFileSelect, handleConnect]);
  const actionLabel = action === "retry" ? t("errors.actionRetry") : t("errors.actionReconnect");

  const isModalOpen = state !== "idle";

  return (
    <Dialog open={isModalOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md safe-area-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bluetooth className="w-5 h-5" />
            {state === "connecting" && t("fledgling.flow.connecting")}
            {state === "fetching-files" && t("fledgling.flow.fetching")}
            {state === "file-list" && t("fledgling.flow.selectFile")}
            {state === "downloading" && t("fledgling.flow.downloading")}
            {state === "error" && t("fledgling.flow.errorTitle")}
          </DialogTitle>
        </DialogHeader>

        {/* Connecting State */}
        {state === "connecting" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="w-12 h-12 animate-spin text-primary" />
            <p className="text-muted-foreground">{statusMessage}</p>
            <p className="text-sm text-muted-foreground">{t("fledgling.flow.pickerHint")}</p>
          </div>
        )}

        {/* Fetching Files State */}
        {state === "fetching-files" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="w-12 h-12 animate-spin text-primary" />
            <p className="text-muted-foreground">{statusMessage}</p>
          </div>
        )}

        {/* File List State */}
        {state === "file-list" && (
          <FileListPanel
            files={files}
            onSelect={handleFileSelect}
            instructions={t("fledgling.flow.instructions")}
            emptyText={t("fledgling.flow.empty")}
          />
        )}

        {/* Downloading State */}
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

        {/* Error State */}
        {state === "error" && failure && (
          <ErrorPanel
            message={t(loggerErrorKey(failure.error.category))}
            detail={failure.error.detail || undefined}
            detailLabel={t("errors.detailLabel")}
            savedHint={failure.fileSaved ? t("fledgling.flow.savedHint") : undefined}
            onCancel={handleClose}
            cancelLabel={t("fledgling.flow.cancel")}
            onAction={action !== "none" ? handleRecover : undefined}
            actionLabel={action !== "none" ? actionLabel : undefined}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
