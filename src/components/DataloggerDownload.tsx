import { useState, useCallback, useEffect, useRef } from "react";
import { Bluetooth, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createFledglingConnection, type LoggerConnection, type LoggerFile, type LoggerDownloadProgress } from "@/lib/loggers";
import { FileListPanel, ProgressPanel } from "@/components/loggers/DownloadPanels";
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
  const device = useDeviceContext();
  const connection = device.connection;
  const [state, setState] = useState<DownloadState>("idle");
  const [files, setFiles] = useState<LoggerFile[]>([]);
  const [progress, setProgress] = useState<LoggerDownloadProgress | null>(null);
  const [currentFile, setCurrentFile] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const loggerRef = useRef<LoggerConnection | null>(null);

  const handleClose = useCallback(() => {
    // Do NOT disconnect — connection lifecycle is owned by DeviceContext.
    // Only the explicit Disconnect button in the drawer header tears down GATT.
    setState("idle");
    setFiles([]);
    setProgress(null);
    setCurrentFile("");
    setError("");
    setStatusMessage("");
    loggerRef.current = null;
    onClose();
  }, [onClose]);

  const handleConnect = useCallback(async () => {
    setState("connecting");
    setError("");
    setStatusMessage("Scanning for DovesLapTimer...");

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
      setStatusMessage("Fetching file list...");

      const fileList = await logger.listLogs(setStatusMessage);
      setFiles(fileList);
      setState("file-list");
      setStatusMessage(`Found ${fileList.length} files`);
    } catch (err) {
      console.error("Connection/file list error:", err);
      setError(err instanceof Error ? err.message : "Failed to connect");
      setState("error");
    }
  }, [device, handleClose]);

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
        setError("Device disconnected. Please reconnect.");
        setState("error");
        return;
      }

      setState("downloading");
      setCurrentFile(file.name);
      setProgress({
        received: 0,
        total: file.size,
        percent: 0,
        speed: "0 B/s",
        eta: "--",
      });
      setError("");

      try {
        const fileData = await logger.downloadLog(file.name, setProgress, setStatusMessage);

        // Always save the raw file first so it's never lost
        if (autoSave && autoSaveFile) {
          try {
            await autoSaveFile(file.name, new Blob([fileData.buffer as ArrayBuffer]));
          } catch (e) {
            console.warn("Auto-save failed:", e);
          }
        }

        // Parse the downloaded file
        setStatusMessage("Parsing file...");

        // Convert Uint8Array to string for text-based formats
        const decoder = new TextDecoder();
        const content = decoder.decode(fileData);

        const parsedData = parseDatalogContent(content);

        // Close modal and load data
        handleClose();
        onDataLoaded(parsedData, file.name);
      } catch (err) {
        console.error("Download/parse error:", err);
        const msg = err instanceof Error ? err.message : "Download failed";
        setError(`${msg} — file was saved and can be found in Browse Files.`);
        setState("error");
      }
    },
    [connection, onDataLoaded, autoSave, autoSaveFile, handleClose]
  );

  // React to unexpected disconnects from the context while a transfer is in flight.
  useEffect(() => {
    if (!connection && (state === "downloading" || state === "fetching-files" || state === "file-list")) {
      setError("Device disconnected unexpectedly.");
      setState("error");
    }
  }, [connection, state]);

  const handleRetry = useCallback(() => {
    setError("");
    void handleConnect();
  }, [handleConnect]);

  const isModalOpen = state !== "idle";

  return (
    <Dialog open={isModalOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bluetooth className="w-5 h-5" />
            {state === "connecting" && "Connecting..."}
            {state === "fetching-files" && "Fetching Files..."}
            {state === "file-list" && "Select File to Download"}
            {state === "downloading" && "Downloading..."}
            {state === "error" && "Connection Error"}
          </DialogTitle>
        </DialogHeader>

        {/* Connecting State */}
        {state === "connecting" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="w-12 h-12 animate-spin text-primary" />
            <p className="text-muted-foreground">{statusMessage}</p>
            <p className="text-sm text-muted-foreground">
              If prompted, select "DovesLapTimer" from the list
            </p>
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
          <FileListPanel files={files} onSelect={handleFileSelect} />
        )}

        {/* Downloading State */}
        {state === "downloading" && progress && (
          <ProgressPanel currentFile={currentFile} progress={progress} />
        )}

        {/* Error State */}
        {state === "error" && (
          <div className="flex flex-col items-center gap-4 py-4">
            <p className="text-destructive text-center">{error}</p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleRetry}>Try Again</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
