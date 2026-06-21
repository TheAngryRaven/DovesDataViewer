import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Wifi, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileListPanel, ProgressPanel } from "@/components/loggers/DownloadPanels";
import { createMychronConnection } from "@/lib/loggers/mychron/mychronConnection";
import { MYCHRON_SSID_PREFIX, loggerConnect } from "@/lib/loggers/mychron/ipc";
import type { LoggerConnection, LoggerFile, LoggerDownloadProgress } from "@/lib/loggers";
import { parseDatalogFile } from "@/lib/datalogParser";
import { ParsedData } from "@/types/racing";

type DownloadState =
  | "idle"
  | "connecting"
  | "wifi-selecting"
  | "fetching-files"
  | "file-list"
  | "downloading"
  | "error";

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
  const [state, setState] = useState<DownloadState>("idle");
  const [files, setFiles] = useState<LoggerFile[]>([]);
  const [progress, setProgress] = useState<LoggerDownloadProgress | null>(null);
  const [currentFile, setCurrentFile] = useState<string>("");
  const [error, setError] = useState<string>("");
  const loggerRef = useRef<LoggerConnection | null>(null);

  const handleClose = useCallback(() => {
    loggerRef.current?.disconnect();
    loggerRef.current = null;
    setState("idle");
    setFiles([]);
    setProgress(null);
    setCurrentFile("");
    setError("");
    onClose();
  }, [onClose]);

  const handleConnect = useCallback(async () => {
    setError("");
    try {
      // Connect — on Android this drives the OS Wi-Fi picker (join + bind).
      const android = isAndroid();
      setState(android ? "wifi-selecting" : "connecting");
      const info = await (android
        ? loggerConnect({ wifi: { ssidPrefix: MYCHRON_SSID_PREFIX } })
        : loggerConnect());

      const logger = createMychronConnection(info);
      loggerRef.current = logger;

      setState("fetching-files");
      const fileList = await logger.listLogs();
      setFiles(fileList);
      setState("file-list");
    } catch (err) {
      console.error("MyChron connect/list error:", err);
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  }, []);

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
        setError(t("mychron.flow.errorTitle"));
        setState("error");
        return;
      }

      setState("downloading");
      setCurrentFile(file.name);
      setProgress({ received: 0, total: file.size, percent: 0, speed: "0 B/s", eta: "--" });
      setError("");

      // Bytes are already-inflated XRK — name accordingly so the importer routes
      // them to the async wasm path.
      const fileName = file.name.toLowerCase().endsWith(".xrk") ? file.name : `${file.name}.xrk`;

      try {
        const bytes = await logger.downloadLog(file.name, setProgress);
        const blob = new Blob([bytes.buffer as ArrayBuffer]);

        // Save the raw file first so it's never lost.
        if (autoSave && autoSaveFile) {
          try {
            await autoSaveFile(fileName, blob);
          } catch (e) {
            console.warn("Auto-save failed:", e);
          }
        }

        const data = await parseDatalogFile(new File([blob], fileName));
        handleClose();
        onDataLoaded(data, fileName);
      } catch (err) {
        console.error("MyChron download/parse error:", err);
        const msg = err instanceof Error ? err.message : String(err);
        setError(`${msg}${t("mychron.flow.savedHint")}`);
        setState("error");
      }
    },
    [autoSave, autoSaveFile, handleClose, onDataLoaded, t],
  );

  const handleRetry = useCallback(() => {
    loggerRef.current?.disconnect();
    loggerRef.current = null;
    setError("");
    void handleConnect();
  }, [handleConnect]);

  const isModalOpen = state !== "idle";

  return (
    <Dialog open={isModalOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md">
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
          <ProgressPanel currentFile={currentFile} progress={progress} />
        )}

        {state === "error" && (
          <div className="flex flex-col items-center gap-4 py-4">
            <p className="text-destructive text-center">{error}</p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleClose}>
                {t("mychron.flow.cancel")}
              </Button>
              <Button onClick={handleRetry}>{t("mychron.flow.retry")}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
