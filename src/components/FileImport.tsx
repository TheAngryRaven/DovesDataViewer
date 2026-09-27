import { lazy, Suspense, useCallback, useRef, useState } from "react";
import { useTranslation, Trans } from "react-i18next";
import { Upload, Loader2, LifeBuoy } from "lucide-react";
import { parseDatalogContent, parseDatalogFile } from "@/lib/datalogParser";
import { importGoProVideo, isGoProVideoFile } from "@/lib/gopro/goproImport";
import { stageGoProVideo, type StagedVideoFile } from "@/lib/gopro/videoHandoff";
import { groupVideoRecordings } from "@/lib/videoPlaylist";
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

/** Datalog extensions the picker offers; GoPro video containers ride along (plan 0029). */
const ACCEPT = ".csv,.nmea,.txt,.ubx,.vbo,.dove,.dovex,.dovep,.ld,.xrk,.xrz,.ibt,.mp4,.mov,.360";

/** A picked file plus the File System Access handle when the browser gave one. */
interface PickedFile {
  file: File;
  handle?: FileSystemFileHandle;
}

/**
 * The drag-and-drop / click-to-browse half of the landing page's primary
 * action. The whole card is the upload target; LandingPage pairs it 50/50 with
 * a "Download from logger" panel (`h-full` so the two halves match height).
 * Other entry points (browse saved files, sample data, track manager) live as
 * their own tiles below.
 *
 * A GoPro video (or several chapters of one recording) takes a different path
 * from a datalog: the embedded GPS track is extracted to a small `.dove`
 * session that is saved instead of the multi-GB video, and the video itself is
 * handed to the player pre-synced (plan 0029).
 */
export function FileImport({ onDataLoaded, autoSave, autoSaveFile }: FileImportProps) {
  const { t } = useTranslation("landing");
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // The file + raw parser error behind the "send to support" offer (plan 0013)
  const [failedFile, setFailedFile] = useState<File | null>(null);
  const [failedError, setFailedError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  const beginLoad = useCallback((label: string) => {
    setIsLoading(true);
    setError(null);
    setProgress(null);
    setFileName(label);
    setFailedFile(null);
    setFailedError(null);
  }, []);

  const processFile = useCallback(
    async (file: File) => {
      beginLoad(file.name);
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
    [onDataLoaded, autoSave, autoSaveFile, t, beginLoad],
  );

  const processGoProVideo = useCallback(
    async (picked: PickedFile[]) => {
      const groups = groupVideoRecordings(picked.map((p) => ({ name: p.file.name, ...p })));
      const recording = groups[0];
      beginLoad(recording?.label ?? picked[0].file.name);
      try {
        // One session per recording: a mixed selection is ambiguous, so say so
        // rather than silently picking one.
        if (!recording || groups.length > 1) throw new Error(t("fileImport.goproOneRecording"));
        const result = await importGoProVideo(
          recording.files.map((f) => f.file),
          (p) => setProgress(t("fileImport.goproProgress", { ...p })),
        );
        // The extracted telemetry is the session file — never the video.
        if (autoSave && autoSaveFile) {
          try { await autoSaveFile(result.fileName, result.blob); } catch (e) { console.warn("Auto-save failed:", e); }
        }
        const files: StagedVideoFile[] = result.chapters.map((file) => ({
          name: file.name,
          file,
          handle: recording.files.find((f) => f.file === file)?.handle,
        }));
        stageGoProVideo({ sessionFileName: result.fileName, files, syncOffsetMs: result.syncOffsetMs });
        onDataLoaded(parseDatalogContent(result.csv), result.fileName);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("fileImport.parseFailed"));
      } finally {
        setIsLoading(false);
        setProgress(null);
      }
    },
    [onDataLoaded, autoSave, autoSaveFile, t, beginLoad],
  );

  // Route a selection: any video means a GoPro import; otherwise the first
  // file is a datalog as before.
  const processSelection = useCallback(
    async (picked: PickedFile[]) => {
      if (picked.length === 0) return;
      const videos = picked.filter((p) => isGoProVideoFile(p.file.name));
      if (videos.length > 0) await processGoProVideo(videos);
      else await processFile(picked[0].file);
    },
    [processGoProVideo, processFile],
  );

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files ? Array.from(event.target.files) : [];
      event.target.value = "";
      await processSelection(files.map((file) => ({ file })));
    },
    [processSelection],
  );

  // Prefer the File System Access picker when the browser has it: the handles
  // it returns let a GoPro import's video reopen with the session later.
  // Anything but a user cancel falls back to the plain input.
  const handleLabelClick = useCallback(
    async (event: React.MouseEvent<HTMLLabelElement>) => {
      // A click bubbling up from the input itself (the fallback below, or a
      // keyboard activation) must keep its default, or the picker never opens.
      if (isLoading || event.target === inputRef.current || !("showOpenFilePicker" in window)) return;
      event.preventDefault();
      try {
        const handles = await window.showOpenFilePicker({ multiple: true });
        const picked = await Promise.all(handles.map(async (handle) => ({ file: await handle.getFile(), handle })));
        await processSelection(picked);
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
        inputRef.current?.click();
      }
    },
    [isLoading, processSelection],
  );

  const handleDrop = useCallback(
    async (event: React.DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      setIsDragging(false);
      const items = Array.from(event.dataTransfer.items ?? []);
      const files = Array.from(event.dataTransfer.files ?? []);
      // Chromium hands out handles for dropped files; keep them for the same
      // reopen-later reason as the picker.
      const handles = await Promise.all(items.map(async (item) => {
        try {
          const handle = await item.getAsFileSystemHandle?.();
          return handle?.kind === "file" ? (handle as FileSystemFileHandle) : undefined;
        } catch {
          return undefined;
        }
      }));
      await processSelection(files.map((file, i) => ({ file, handle: handles[i] })));
    },
    [processSelection],
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
        onClick={handleLabelClick}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={[
          "flex h-full flex-1 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition-colors",
          isDragging ? "border-primary bg-primary/10" : "border-border bg-card/50 hover:border-primary/50 hover:bg-card",
        ].join(" ")}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
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
