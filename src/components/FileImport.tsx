import { useCallback, useState, lazy, Suspense } from "react";
import { Upload, FileText, FolderOpen, Loader2, Map } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TrackEditor } from "@/components/TrackEditor";
import { parseDatalogFile } from "@/lib/datalogParser";
import { ParsedData } from "@/types/racing";
// Lazy so the BLE module (Web Bluetooth protocol) stays out of the initial
// bundle — it only loads when the user opens the device download UI.
const DataloggerDownload = lazy(() =>
  import("./DataloggerDownload").then((m) => ({ default: m.DataloggerDownload })),
);

interface FileImportProps {
  onDataLoaded: (data: ParsedData, fileName?: string) => void;
  onOpenFileManager?: () => void;
  autoSave?: boolean;
  autoSaveFile?: (name: string, blob: Blob) => Promise<void>;
}

export function FileImport({ onDataLoaded, onOpenFileManager, autoSave, autoSaveFile }: FileImportProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const processFile = useCallback(
    async (file: File) => {
      setIsLoading(true);
      setError(null);
      setProgress(null);
      setFileName(file.name);

      try {
        // Always save the raw file first so it's never lost
        if (autoSave && autoSaveFile) {
          try { await autoSaveFile(file.name, file); } catch (e) { console.warn("Auto-save failed:", e); }
        }
        // The progress callback only fires for the AiM XRK/XRZ path (wasm parse
        // runs in a worker); other formats parse instantly.
        const data = await parseDatalogFile(file, (p) => setProgress(p.message));
        onDataLoaded(data, file.name);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to parse file";
        setError(autoSave ? `${msg} — file was saved and can be found in Browse Files.` : msg);
      } finally {
        setIsLoading(false);
        setProgress(null);
      }
    },
    [onDataLoaded, autoSave, autoSaveFile],
  );

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      await processFile(file);
    },
    [processFile],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const file = event.dataTransfer.files?.[0];
      if (file) {
        processFile(file);
      }
    },
    [processFile],
  );

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  }, []);

  return (
    <div
      className="flex flex-col items-center justify-center gap-4 p-8 border-2 border-dashed border-border rounded-lg bg-card/50 hover:border-primary/50 transition-colors cursor-pointer"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <div className="flex flex-col items-center gap-2 text-muted-foreground">
        {isLoading ? <Loader2 className="w-12 h-12 animate-spin text-primary" /> : <Upload className="w-12 h-12" />}
        <p className="text-lg font-medium">{isLoading ? (progress ?? "Processing...") : "Drop datalog file here"}</p>
        <p className="text-sm">Supports NMEA, UBX, VBO, Dove, Alfano, AiM (CSV + XRK/XRZ), MoTeC CSV/LD and more.</p>
        <p className="text-sm">
          <i>All processing done locally</i>
        </p>
      </div>

      <div className="flex flex-wrap gap-2 justify-center">
        <label>
          <input
            type="file"
            accept=".csv,.nmea,.txt,.ubx,.vbo,.dove,.dovex,.ld,.xrk,.xrz"
            onChange={handleFileChange}
            className="hidden"
            disabled={isLoading}
          />
          <Button variant="outline" disabled={isLoading} asChild>
            <span className="cursor-pointer">
              <Upload className="w-4 h-4 mr-2" />
              Upload Files
            </span>
          </Button>
        </label>

        {onOpenFileManager && (
          <Button variant="outline" onClick={onOpenFileManager}>
            <FolderOpen className="w-4 h-4 mr-2" />
            Browse Files
          </Button>
        )}

        <Suspense fallback={null}>
          <DataloggerDownload onDataLoaded={onDataLoaded} autoSave={autoSave} autoSaveFile={autoSaveFile} />
        </Suspense>
      </div>

      {/* Track manager — create/draw tracks & courses without loading a datalog.
          With no session loaded the visual editor offers location search + manual
          drawing; once a datalog is open the header editor adds "Generate from lap". */}
      <div className="flex justify-center">
        <TrackEditor
          startInManage
          triggerButton={
            <Button variant="outline">
              <Map className="w-4 h-4 mr-2" />
              Manage Tracks
            </Button>
          }
        />
      </div>

      {fileName && !error && <p className="text-sm text-muted-foreground font-mono">Loaded: {fileName}</p>}

      {error && <p className="text-sm text-destructive font-medium">Error: {error}</p>}
    </div>
  );
}
