import { useCallback, useRef, useState } from "react";
import { X, Trash2, Download, Upload, FolderOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FileEntry } from "@/lib/fileStorage";
import { parseDatalogFile } from "@/lib/datalogParser";
import { ParsedData } from "@/types/racing";
import { DataloggerDownload } from "./DataloggerDownload";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

interface FileManagerDrawerProps {
  isOpen: boolean;
  files: FileEntry[];
  storageUsed: number;
  storageQuota: number;
  onClose: () => void;
  onLoadFile: (name: string) => Promise<Blob | null>;
  onDeleteFile: (name: string) => Promise<void>;
  onExportFile: (name: string) => Promise<void>;
  onSaveFile: (name: string, blob: Blob) => Promise<void>;
  onDataLoaded: (data: ParsedData) => void;
  autoSave: boolean;
}

export function FileManagerDrawer({
  isOpen,
  files,
  storageUsed,
  storageQuota,
  onClose,
  onLoadFile,
  onDeleteFile,
  onExportFile,
  onSaveFile,
  onDataLoaded,
  autoSave,
}: FileManagerDrawerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [confirmLoad, setConfirmLoad] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLoadConfirm = useCallback(async () => {
    if (!confirmLoad) return;
    setLoading(true);
    try {
      const blob = await onLoadFile(confirmLoad);
      if (blob) {
        const file = new File([blob], confirmLoad);
        const data = await parseDatalogFile(file);
        onDataLoaded(data);
        onClose();
      }
    } catch (e) {
      console.error("Failed to load file:", e);
    } finally {
      setLoading(false);
      setConfirmLoad(null);
    }
  }, [confirmLoad, onLoadFile, onDataLoaded, onClose]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!confirmDelete) return;
    await onDeleteFile(confirmDelete);
    setConfirmDelete(null);
  }, [confirmDelete, onDeleteFile]);

  const handleUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      setLoading(true);
      try {
        const data = await parseDatalogFile(file);
        if (autoSave) {
          await onSaveFile(file.name, file);
        }
        onDataLoaded(data);
        onClose();
      } catch (e) {
        console.error("Failed to process uploaded file:", e);
      } finally {
        setLoading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [autoSave, onSaveFile, onDataLoaded, onClose],
  );

  const handleBleDataLoaded = useCallback(
    (data: ParsedData) => {
      onDataLoaded(data);
      onClose();
    },
    [onDataLoaded, onClose],
  );

  const storagePercent = storageQuota > 0 ? Math.min((storageUsed / storageQuota) * 100, 100) : 0;

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[10000] bg-black/40" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 z-[10001] w-full sm:w-[28vw] sm:min-w-[320px] bg-background border-l border-border flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-5 h-5 text-primary" />
            <h2 className="font-semibold text-foreground">File Manager</h2>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Inline Confirmation Banner */}
        {(confirmLoad || confirmDelete) && (
          <div className="mx-3 mt-3 mb-1 p-3 rounded-md border border-border bg-muted/60 space-y-2 shrink-0">
            {confirmLoad && (
              <>
                <p className="text-sm text-foreground">
                  Load <span className="font-mono font-medium">{confirmLoad}</span>?
                </p>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setConfirmLoad(null)}>Cancel</Button>
                  <Button size="sm" onClick={handleLoadConfirm} disabled={loading}>
                    {loading && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                    Load
                  </Button>
                </div>
              </>
            )}
            {confirmDelete && (
              <>
                <p className="text-sm text-foreground">
                  Delete <span className="font-mono font-medium">{confirmDelete}</span>? This cannot be undone.
                </p>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setConfirmDelete(null)}>Cancel</Button>
                  <Button variant="destructive" size="sm" onClick={handleDeleteConfirm}>Delete</Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* File List */}
        <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-1">
          {files.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
              <FolderOpen className="w-12 h-12 opacity-30" />
              <p className="text-sm">No stored files</p>
              <p className="text-xs">Upload or import files to get started</p>
            </div>
          ) : (
            files.map((file) => (
              <div
                key={file.name}
                className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 transition-colors group"
              >
                <button
                  className="flex-1 text-left min-w-0 cursor-pointer"
                  onClick={() => setConfirmLoad(file.name)}
                >
                  <div className="text-sm font-mono truncate text-foreground">{file.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatSize(file.size)} · {new Date(file.savedAt).toLocaleDateString()}
                  </div>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 opacity-60 hover:opacity-100"
                  onClick={() => onExportFile(file.name)}
                  title="Export / Download"
                >
                  <Download className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 opacity-60 hover:opacity-100 hover:text-destructive"
                  onClick={() => setConfirmDelete(file.name)}
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))
          )}
        </div>

        {/* Storage Usage */}
        <div className="px-4 py-2 border-t border-border shrink-0">
          {storageQuota > 0 ? (
            <div className="space-y-1">
              <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${storagePercent}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground text-center">
                {formatSize(storageUsed)} used of {formatSize(storageQuota)}
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center">Storage usage unavailable</p>
          )}
        </div>

        {/* Bottom Actions */}
        <div className="flex gap-2 px-4 py-3 border-t border-border shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.nmea,.txt,.ubx,.vbo,.dove"
            onChange={handleUpload}
            className="hidden"
          />
          <Button
            variant="outline"
            className="flex-1"
            disabled={loading}
            onClick={() => fileInputRef.current?.click()}
          >
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
            Upload Files
          </Button>
          <DataloggerDownload
            onDataLoaded={handleBleDataLoaded}
            autoSave={autoSave}
            autoSaveFile={onSaveFile}
          />
        </div>
      </div>
    </>
  );
}
