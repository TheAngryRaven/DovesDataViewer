import { useState, useCallback } from "react";
import { Bluetooth, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  BleConnection,
  FileInfo,
  DownloadProgress,
  isBleSupported,
  connectToDevice,
  requestFileList,
  downloadFile,
  disconnect,
  formatBytes,
} from "@/lib/bleDatalogger";
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
}

export function DataloggerDownload({ onDataLoaded, autoSave, autoSaveFile }: DataloggerDownloadProps) {
  const [state, setState] = useState<DownloadState>("idle");
  const [connection, setConnection] = useState<BleConnection | null>(null);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [currentFile, setCurrentFile] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<string>("");

  const bleSupported = isBleSupported();

  const handleConnect = useCallback(async () => {
    setState("connecting");
    setError("");
    setStatusMessage("Scanning for DovesLapTimer...");

    try {
      const conn = await connectToDevice(setStatusMessage);
      setConnection(conn);

      setState("fetching-files");
      setStatusMessage("Fetching file list...");

      const fileList = await requestFileList(conn, setStatusMessage);
      setFiles(fileList);
      setState("file-list");
      setStatusMessage(`Found ${fileList.length} files`);
    } catch (err) {
      console.error("Connection/file list error:", err);
      setError(err instanceof Error ? err.message : "Failed to connect");
      setState("error");
    }
  }, []);

  const handleFileSelect = useCallback(
    async (file: FileInfo) => {
      if (!connection) return;

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
        const fileData = await downloadFile(
          connection,
          file.name,
          setProgress,
          setStatusMessage
        );

        // Parse the downloaded file
        setStatusMessage("Parsing file...");
        
        // Convert Uint8Array to string for text-based formats
        const decoder = new TextDecoder();
        const content = decoder.decode(fileData);
        
        const parsedData = parseDatalogContent(content);
        
        // Auto-save to IndexedDB if enabled
        if (autoSave && autoSaveFile) {
          try {
            await autoSaveFile(file.name, new Blob([fileData.buffer as ArrayBuffer]));
          } catch (e) {
            console.warn("Auto-save failed:", e);
          }
        }
        
        // Close modal and load data
        handleClose();
        onDataLoaded(parsedData, file.name);
      } catch (err) {
        console.error("Download error:", err);
        setError(err instanceof Error ? err.message : "Download failed");
        setState("error");
      }
    },
    [connection, onDataLoaded]
  );

  const handleClose = useCallback(() => {
    if (connection) {
      disconnect(connection);
    }
    setState("idle");
    setConnection(null);
    setFiles([]);
    setProgress(null);
    setCurrentFile("");
    setError("");
    setStatusMessage("");
  }, [connection]);

  const handleRetry = useCallback(() => {
    setError("");
    setState("idle");
  }, []);

  const isModalOpen = state !== "idle";

  // Button disabled if BLE not supported
  if (!bleSupported) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button variant="outline" disabled className="opacity-50">
                <Bluetooth className="w-4 h-4 mr-2" />
                Download from DovesDataLogger
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>Web Bluetooth not supported in this browser</p>
            <p className="text-xs text-muted-foreground">
              Use Chrome, Edge, or Opera on desktop
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <>
      <Button variant="outline" onClick={handleConnect}>
        <Bluetooth className="w-4 h-4 mr-2" />
        Download from DovesDataLogger
      </Button>

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
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground mb-2">
                Click a file to download and load it:
              </p>
              <div className="max-h-80 overflow-y-auto space-y-1">
                {files.length === 0 ? (
                  <p className="text-center text-muted-foreground py-4">
                    No files found on device
                  </p>
                ) : (
                  files.map((file) => (
                    <button
                      key={file.name}
                      onClick={() => handleFileSelect(file)}
                      className="w-full text-left px-3 py-2 rounded-md bg-muted/50 hover:bg-muted transition-colors flex justify-between items-center"
                    >
                      <span className="font-mono text-sm">{file.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatBytes(file.size)}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Downloading State */}
          {state === "downloading" && progress && (
            <div className="flex flex-col gap-4 py-4">
              <p className="font-mono text-sm text-center">{currentFile}</p>
              
              {/* Progress Bar */}
              <div className="w-full bg-muted rounded-full h-3 overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-150"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="text-muted-foreground">Received:</div>
                <div className="text-right font-mono">
                  {formatBytes(progress.received)} / {formatBytes(progress.total)}
                </div>
                
                <div className="text-muted-foreground">Speed:</div>
                <div className="text-right font-mono">{progress.speed}</div>
                
                <div className="text-muted-foreground">ETA:</div>
                <div className="text-right font-mono">{progress.eta}</div>
              </div>

              <p className="text-xs text-center text-muted-foreground">
                {progress.percent.toFixed(1)}% complete
              </p>
            </div>
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
    </>
  );
}
