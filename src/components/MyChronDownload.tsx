import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Wifi, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorPanel, FileListPanel, ProgressPanel } from "@/components/loggers/DownloadPanels";
import { createMychronConnection } from "@/lib/loggers/mychron/mychronConnection";
import { MYCHRON_SSID_PREFIX, loggerConnect } from "@/lib/loggers/mychron/ipc";
import {
  classifyLoggerError,
  loggerErrorKey,
  recoveryActionFor,
  type ClassifiedLoggerError,
  type LoggerFlowStage,
} from "@/lib/loggers/errors";
import type { LoggerConnection, LoggerFile, LoggerDownloadProgress } from "@/lib/loggers";
import { xrkFileName } from "@/lib/loggers/fileNaming";
import { parseDatalogFile } from "@/lib/datalogParser";
import { useSettings } from "@/hooks/useSettings";
import { ParsedData } from "@/types/racing";

type DownloadState =
  | "idle"
  | "connecting"
  | "wifi-selecting"
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

interface MyChronDownloadProps {
  onDataLoaded: (data: ParsedData, fileName?: string) => void;
  autoSave?: boolean;
  autoSaveFile?: (name: string, blob: Blob) => Promise<void>;
  /** Begin connecting as soon as the flow mounts (it's mounted on demand). */
  autoStart?: boolean;
  /** Called when the flow finishes or is dismissed so the host can unmount it. */
  onClose: () => void;
}

// Android needs the system Wi-Fi picker (join + bind to the MyChron AP); desktop
// joins the AP via the OS and sockets just work, so we omit the wifi hint there.
const isAndroid = () =>
  typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

/**
 * The native MyChron download flow: connect over Wi-Fi via the Tauri shell, list
 * sessions, download + import the chosen one. Native-only and mounted on demand
 * by `LoggerDownload` once the user picks MyChron, so `@tauri-apps/api` stays off
 * the web/eager bundle. Talks to the device only through the generic
 * `LoggerConnection` surface, and owns the connection — it disconnects on every
 * exit (close/cancel/error/unmount).
 */
export function MyChronDownload({ onDataLoaded, autoSave, autoSaveFile, autoStart, onClose }: MyChronDownloadProps) {
  const { t } = useTranslation("logger");
  const { settings } = useSettings();
  const [state, setState] = useState<DownloadState>("idle");
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
    setFiles([]);
    setProgress(null);
    setCurrentFile("");
    setFailure(null);
    onClose();
  }, [onClose]);

  const handleConnect = useCallback(async () => {
    setFailure(null);
    try {
      // Connect — on Android this drives the OS Wi-Fi picker (join + bind). The
      // picker only lists networks whose SSID starts with this prefix, so it's
      // user-configurable (Settings → MyChron) with the constant as the fallback.
      const android = isAndroid();
      const ssidPrefix = settings.mychronSsidPrefix?.trim() || MYCHRON_SSID_PREFIX;
      setState(android ? "wifi-selecting" : "connecting");
      const info = await (android
        ? loggerConnect({ wifi: { ssidPrefix } })
        : loggerConnect());

      const logger = createMychronConnection(info);
      loggerRef.current = logger;

      setState("fetching-files");
      const fileList = await logger.listLogs();
      setFiles(fileList);
      setState("file-list");
    } catch (err) {
      console.error("MyChron connect/list error:", err);
      setFailure({ error: classifyLoggerError(err), stage: "connect", fileSaved: false });
      setState("error");
    }
  }, [settings.mychronSsidPrefix]);

  // Kick off the connection as soon as the flow is mounted (once).
  const startedRef = useRef(false);
  useEffect(() => {
    if (autoStart && !startedRef.current) {
      startedRef.current = true;
      void handleConnect();
    }
  }, [autoStart, handleConnect]);

  // Always release the device + Wi-Fi binding when this flow unmounts.
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

      // Bytes are already-inflated XRK — name accordingly (swapping the device's
      // `.xrz` for `.xrk`) so the importer routes them to the async wasm path.
      const fileName = xrkFileName(file.name);

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
        console.error("MyChron download/parse error:", err);
        setFailure({ error: classifyLoggerError(err), stage: "download", fileSaved: saved });
        setState("error");
      }
    },
    [autoSave, autoSaveFile, handleClose, onDataLoaded],
  );

  const handleReconnect = useCallback(() => {
    loggerRef.current?.disconnect();
    loggerRef.current = null;
    setFailure(null);
    void handleConnect();
  }, [handleConnect]);

  // Recovery: a failed download retries the same file while the link is alive;
  // everything else (a declined Wi-Fi join, a dead link) re-drives the connect,
  // which re-opens the OS Wi-Fi picker on Android.
  const action = failure ? recoveryActionFor(failure.error.category, failure.stage) : "none";
  const handleRecover = useCallback(() => {
    const lastFile = lastFileRef.current;
    if (action === "retry" && loggerRef.current && lastFile) {
      void handleFileSelect(lastFile);
    } else {
      handleReconnect();
    }
  }, [action, handleFileSelect, handleReconnect]);
  // There's no scan step over Wi-Fi — every non-retry recovery is a reconnect.
  const actionLabel = action === "retry" ? t("errors.actionRetry") : t("errors.actionReconnect");

  const isModalOpen = state !== "idle";

  return (
    <Dialog open={isModalOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md safe-area-modal">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wifi className="w-5 h-5" />
            {state === "connecting" && t("mychron.flow.connecting")}
            {state === "wifi-selecting" && t("mychron.flow.wifiSelecting")}
            {state === "fetching-files" && t("mychron.flow.fetching")}
            {state === "file-list" && t("mychron.flow.selectFile")}
            {state === "downloading" && t("mychron.flow.downloading")}
            {state === "error" && t("mychron.flow.errorTitle")}
          </DialogTitle>
        </DialogHeader>

        {state === "wifi-selecting" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="w-12 h-12 animate-spin text-primary" />
            <p className="text-sm text-center text-muted-foreground">{t("mychron.flow.wifiHint")}</p>
          </div>
        )}

        {state === "connecting" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="w-12 h-12 animate-spin text-primary" />
            <p className="text-muted-foreground">{t("mychron.flow.connecting")}</p>
          </div>
        )}

        {state === "fetching-files" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="w-12 h-12 animate-spin text-primary" />
            <p className="text-muted-foreground">{t("mychron.flow.fetching")}</p>
          </div>
        )}

        {state === "file-list" && (
          <FileListPanel
            files={files}
            onSelect={handleFileSelect}
            instructions={t("mychron.flow.instructions")}
            emptyText={t("mychron.flow.empty")}
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
            savedHint={failure.fileSaved ? t("mychron.flow.savedHint") : undefined}
            onCancel={handleClose}
            cancelLabel={t("mychron.flow.cancel")}
            onAction={action !== "none" ? handleRecover : undefined}
            actionLabel={action !== "none" ? actionLabel : undefined}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
