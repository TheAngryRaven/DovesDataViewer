import { lazy, Suspense, useCallback, useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { Upload, Loader2, LifeBuoy } from "lucide-react";
import { parseDatalogFile } from "@/lib/datalogParser";
import { ParsedData } from "@/types/racing";

// Loaded only after a parse actually fails (plan 0013).
const ParseErrorReportDialog = lazy(() =>
  import("@/components/ParseErrorReportDialog").then((m) => ({ default: m.ParseErrorReportDialog })),
);

interface FileImportProps {
  onDataLoaded: (data: ParsedData, fileName?: string) => void;
  autoSave?: boolean;
  autoSaveFile?: (name: string, blob: Blob) => Promise<void>;
}

/**
 * The drag-and-drop / click-to-browse half of the landing page's primary
 * action. The whole card is the upload target; LandingPage pairs it 50/50 with
 * a "Download from logger" panel (`h-full` so the two halves match height).
 * Other entry points (browse saved files, sample data, track manager) live as
 * their own tiles below.
 */
export function FileImport({ onDataLoaded, autoSave, autoSaveFile }: FileImportProps) {
  const { t } = useTranslation("landing");
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  // The file + raw parser error behind the "send to support" offer (plan 0013)
  const [failedFile, setFailedFile] = useState<File | null>(null);
  const [failedError, setFailedError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  const processFile = useCallback(
    async (file: File) => {
      setIsLoading(true);
      setError(null);
      setProgress(null);
      setFileName(file.name);
      setFailedFile(null);
      setFailedError(null);

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
        const msg = e instanceof Error ? e.message : t("fileImport.parseFailed");
        setError(autoSave ? t("fileImport.parseErrorSaved", { message: msg }) : msg);
        setFailedFile(file);
        setFailedError(e instanceof Error ? e.message : null);
      } finally {
        setIsLoading(false);
        setProgress(null);
      }
    },
    [onDataLoaded, autoSave, autoSaveFile, t],
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
    (event: React.DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      setIsDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file) {
        processFile(file);
      }
    },
    [processFile],
  );

  const handleDragOver = useCallback((event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);
  }, []);

  return (
    <div className="flex h-full flex-col gap-3">
      <label
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={[
          "flex h-full flex-1 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition-colors",
          isDragging ? "border-primary bg-primary/10" : "border-border bg-card/50 hover:border-primary/50 hover:bg-card",
        ].join(" ")}
      >
        <input
          type="file"
          accept=".csv,.nmea,.txt,.ubx,.vbo,.dove,.dovex,.ld,.xrk,.xrz,.ibt"
          onChange={handleFileChange}
          className="hidden"
          disabled={isLoading}
        />
        {isLoading ? (
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
        ) : (
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Upload className="h-7 w-7" />
          </span>
        )}
        <span className="text-xl font-semibold text-foreground">
          {isLoading ? (progress ?? t("fileImport.processing")) : t("fileImport.title")}
        </span>
        <span className="text-sm text-muted-foreground">
          {t("fileImport.dragDrop")}
        </span>
        <span className="max-w-md text-xs text-muted-foreground">
          <Trans t={t} i18nKey="fileImport.formats" components={{ i: <i /> }} />
        </span>
      </label>

      {fileName && !error && (
        <p className="text-center text-sm font-mono text-muted-foreground">{t("fileImport.loaded", { name: fileName })}</p>
      )}
      {error && <p className="text-center text-sm font-medium text-destructive">{t("fileImport.errorLine", { error })}</p>}
      {failedFile && (
        <button
          onClick={() => setReportOpen(true)}
          className="mx-auto inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
        >
          <LifeBuoy className="h-4 w-4" />
          {t("parseReport.sendButton")}
        </button>
      )}
      {failedFile && reportOpen && (
        <Suspense fallback={null}>
          <ParseErrorReportDialog
            file={failedFile}
            errorText={failedError}
            open={reportOpen}
            onOpenChange={setReportOpen}
          />
        </Suspense>
      )}
    </div>
  );
}
