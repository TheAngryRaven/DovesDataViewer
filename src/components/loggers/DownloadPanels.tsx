/**
 * Shared presentational panels for the logger download flows. The file-list and
 * progress UI is identical across transports (BLE Fledgling, native MyChron), so
 * it lives here and both flows compose it. Transport-specific states (connecting,
 * Wi-Fi selecting, errors) stay in each flow's component.
 */

import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/loggers/progress";
import type { LoggerFile, LoggerDownloadProgress } from "@/lib/loggers";
import type { ScannedDevice } from "@/lib/loggers/doveslogger/ipc";

interface FileListPanelProps {
  files: LoggerFile[];
  onSelect: (file: LoggerFile) => void;
  /** Instruction line above the list. */
  instructions?: string;
  /** Shown when the device reports no files. */
  emptyText?: string;
}

/** Tappable list of downloadable logs on the device. */
export function FileListPanel({
  files,
  onSelect,
  instructions = "Click a file to download and load it:",
  emptyText = "No files found on device",
}: FileListPanelProps) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground mb-2">{instructions}</p>
      <div className="max-h-80 overflow-y-auto space-y-1">
        {files.length === 0 ? (
          <p className="text-center text-muted-foreground py-4">{emptyText}</p>
        ) : (
          files.map((file) => (
            <button
              key={file.name}
              onClick={() => onSelect(file)}
              className="w-full text-left px-3 py-2 rounded-md bg-muted/50 hover:bg-muted transition-colors flex justify-between items-center"
            >
              <span className="font-mono text-sm">{file.name}</span>
              <span className="text-xs text-muted-foreground">{formatBytes(file.size)}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

interface DeviceListPanelProps {
  devices: ScannedDevice[];
  onSelect: (device: ScannedDevice) => void;
  onRescan: () => void;
  /** Instruction line above the list. */
  instructions: string;
  /** Shown when the scan turns up no devices. */
  emptyText: string;
  /** Label for the rescan button (both states). */
  rescanLabel: string;
}

/**
 * Tappable list of nearby loggers found by a BLE scan. BLE has no OS picker, so
 * the native DovesLogger flow renders this; selection is by `id` (the `name`/
 * `rssi` are display-only). An empty scan still shows the Rescan affordance.
 */
export function DeviceListPanel({
  devices,
  onSelect,
  onRescan,
  instructions,
  emptyText,
  rescanLabel,
}: DeviceListPanelProps) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground mb-2">{instructions}</p>
      <div className="max-h-80 overflow-y-auto space-y-1">
        {devices.length === 0 ? (
          <p className="text-center text-muted-foreground py-4">{emptyText}</p>
        ) : (
          devices.map((device) => (
            <button
              key={device.id}
              onClick={() => onSelect(device)}
              className="w-full text-left px-3 py-2 rounded-md bg-muted/50 hover:bg-muted transition-colors flex justify-between items-center"
            >
              <span className="font-medium text-sm">{device.name ?? device.id}</span>
              {typeof device.rssi === "number" && (
                <span className="text-xs text-muted-foreground">{device.rssi} dBm</span>
              )}
            </button>
          ))
        )}
      </div>
      <Button variant="outline" className="w-full mt-1" onClick={onRescan}>
        {rescanLabel}
      </Button>
    </div>
  );
}

interface ProgressPanelProps {
  currentFile: string;
  progress: LoggerDownloadProgress;
}

/** Progress bar + received/speed/eta stats for an in-flight download. */
export function ProgressPanel({ currentFile, progress }: ProgressPanelProps) {
  return (
    <div className="flex flex-col gap-4 py-4">
      <p className="font-mono text-sm text-center">{currentFile}</p>

      <div className="w-full bg-muted rounded-full h-3 overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-150"
          style={{ width: `${progress.percent}%` }}
        />
      </div>

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
  );
}
