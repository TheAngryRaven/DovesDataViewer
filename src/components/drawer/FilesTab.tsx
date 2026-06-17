import { useCallback, useRef, useState, useEffect, useMemo, lazy, Suspense } from "react";
import { useTranslation, Trans } from "react-i18next";
import { toast } from "sonner";
import { Trash2, Download, Upload, FolderOpen, Loader2, Video, Cloud, CloudDownload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FileEntry, FileMetadata, getFileMetadata } from "@/lib/fileStorage";
import { Vehicle } from "@/lib/vehicleStorage";
import { parseDatalogFile } from "@/lib/datalogParser";
import { ParsedData } from "@/types/racing";
import {
  buildBrowserSessions, computeBrowserView, defaultNav,
  type BrowserSession, type NavState,
} from "@/lib/fileBrowserTree";
import { SessionBrowser } from "@/components/SessionBrowser";
import { FileTypeBadge } from "@/components/FileTypeBadge";
import { useFileSources, type FileSource, type RemoteFile } from "@/plugins/fileSources";
// Lazy — keeps the BLE module in its own chunk, loaded only on device use.
const DataloggerDownload = lazy(() =>
  import("@/components/DataloggerDownload").then((m) => ({ default: m.DataloggerDownload })),
);
import { listSessionVideos, StoredVideoMeta } from "@/lib/videoFileStorage";
import { PluginMount } from "@/plugins/PluginMount";
import { MountSlot } from "@/plugins/mounts";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatLapTime(ms: number): string {
  const totalSecs = ms / 1000;
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return mins > 0
    ? `${mins}:${secs.toFixed(3).padStart(6, "0")}`
    : secs.toFixed(3);
}

interface FilesTabProps {
  files: FileEntry[];
  fileMetadataMap: Map<string, FileMetadata>;
  vehicles: Vehicle[];
  /** Track/course of the currently-loaded session — the browser opens here. */
  currentTrackName: string | null;
  currentCourseName: string | null;
  /** Drawer open flag — re-homes the browser to the current session on each open. */
  isOpen: boolean;
  storageUsed: number;
  storageQuota: number;
  onLoadFile: (name: string) => Promise<Blob | null>;
  onDeleteFile: (name: string) => Promise<void>;
  onExportFile: (name: string) => Promise<void>;
  onSaveFile: (name: string, blob: Blob) => Promise<void>;
  onDataLoaded: (data: ParsedData, fileName?: string) => void;
  onClose: () => void;
  autoSave: boolean;
  /** When false, bundled sample logs are hidden from the browser. */
  showSampleFiles: boolean;
}

export function FilesTab({
  files,
  fileMetadataMap,
  vehicles,
  currentTrackName,
  currentCourseName,
  isOpen,
  storageUsed,
  storageQuota,
  onLoadFile,
  onDeleteFile,
  onExportFile,
  onSaveFile,
  onDataLoaded,
  onClose,
  autoSave,
  showSampleFiles,
}: FilesTabProps) {
  const { t } = useTranslation("drawer");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [confirmLoad, setConfirmLoad] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cloudBusy, setCloudBusy] = useState<string | null>(null);
  const [videoFiles, setVideoFiles] = useState<Map<string, StoredVideoMeta>>(new Map());

  // Remote (cloud) files contributed by plugins (cloud-sync). Merged into the
  // same tree as "cloud" rows; the host never imports any cloud code.
  const sources = useFileSources();
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;
  // Stable key (getContributions hands back a fresh [] each call, so we can't
  // depend on the array identity without looping the effect).
  const sourceKey = sources.map((s) => s.id).join("|");
  const [remoteFiles, setRemoteFiles] = useState<RemoteFile[]>([]);
  const [remoteMeta, setRemoteMeta] = useState<Map<string, FileMetadata>>(new Map());
  const remoteSourceByName = useRef<Map<string, FileSource>>(new Map());

  // Folder navigation. Opens at the current session's track/course, and re-homes
  // there whenever the drawer is (re)opened or a different session is loaded.
  const [nav, setNav] = useState<NavState>(() => defaultNav(currentTrackName, currentCourseName));
  useEffect(() => {
    if (isOpen) setNav(defaultNav(currentTrackName, currentCourseName));
  }, [isOpen, currentTrackName, currentCourseName]);

  // Pull the list of cloud files (+ their synced metadata) when the drawer opens
  // or the local set changes (e.g. after a download promotes a cloud file local).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const localNames = new Set(files.map((f) => f.name));
      const byName = new Map<string, FileSource>();
      const all: RemoteFile[] = [];
      for (const src of sourcesRef.current) {
        let list: RemoteFile[] = [];
        try { list = await src.listFiles(); } catch { list = []; }
        for (const rf of list) {
          if (!byName.has(rf.name)) { byName.set(rf.name, src); all.push(rf); }
        }
      }
      if (cancelled) return;
      remoteSourceByName.current = byName;
      setRemoteFiles(all);
      // Metadata for cloud-only files syncs down separately — load any the local
      // map doesn't already have so they can be grouped by track/course.
      const cloudOnly = all.filter((rf) => !localNames.has(rf.name) && !fileMetadataMap.has(rf.name));
      const entries = await Promise.all(
        cloudOnly.map(async (rf) => {
          const m = await getFileMetadata(rf.name);
          return m ? ([rf.name, m] as const) : null;
        }),
      );
      if (cancelled) return;
      const rm = new Map<string, FileMetadata>();
      for (const e of entries) if (e) rm.set(e[0], e[1]);
      setRemoteMeta(rm);
    })();
    return () => { cancelled = true; };
  }, [sourceKey, files, fileMetadataMap, isOpen]);

  const mergedMeta = useMemo(() => {
    const m = new Map(fileMetadataMap);
    for (const [k, v] of remoteMeta) if (!m.has(k)) m.set(k, v);
    return m;
  }, [fileMetadataMap, remoteMeta]);

  const sessions = useMemo(() => {
    const all = buildBrowserSessions(files, mergedMeta, vehicles, remoteFiles);
    return showSampleFiles ? all : all.filter((s) => !s.isSample);
  }, [files, mergedMeta, vehicles, remoteFiles, showSampleFiles]);
  const view = useMemo(
    () => computeBrowserView(sessions, nav, { allSessions: t("browser.allSessions"), untagged: t("browser.untagged") }),
    [sessions, nav, t],
  );
  const filesByName = useMemo(() => new Map(files.map((f) => [f.name, f])), [files]);

  // Load stored video metadata to show video icons
  useEffect(() => {
    listSessionVideos().then(videos => {
      setVideoFiles(new Map(videos.map(v => [v.sessionFileName, v])));
    }).catch(() => {});
  }, [files]);

  const handleLoadConfirm = useCallback(async () => {
    if (!confirmLoad) return;
    setLoading(true);
    try {
      const blob = await onLoadFile(confirmLoad);
      if (blob) {
        const file = new File([blob], confirmLoad);
        const data = await parseDatalogFile(file);
        onDataLoaded(data, confirmLoad);
        onClose();
      }
    } catch (e) {
      console.error("Failed to load file:", e);
    } finally {
      setLoading(false);
      setConfirmLoad(null);
    }
  }, [confirmLoad, onLoadFile, onDataLoaded, onClose]);

  // Cloud-only row tapped: pull the blob, persist it locally, then open it.
  const handleOpenCloud = useCallback(async (name: string) => {
    const src = remoteSourceByName.current.get(name);
    if (!src || cloudBusy) return;
    setCloudBusy(name);
    try {
      const blob = await src.download(name);
      if (!blob) throw new Error("Download returned no data");
      await onSaveFile(name, blob);
      const data = await parseDatalogFile(new File([blob], name));
      onDataLoaded(data, name);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("files.downloadFailed"));
    } finally {
      setCloudBusy(null);
    }
  }, [cloudBusy, onSaveFile, onDataLoaded, onClose, t]);

  // A plugin (cloud-sync) can register an extra action to run on confirm — e.g.
  // also removing the synced copy from the cloud. The host stays cloud-agnostic.
  const deleteConfirmAction = useRef<(() => Promise<void>) | null>(null);
  const registerDeleteConfirm = useCallback((fn: (() => Promise<void>) | null) => {
    deleteConfirmAction.current = fn;
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!confirmDelete) return;
    await onDeleteFile(confirmDelete);
    try {
      await deleteConfirmAction.current?.();
    } finally {
      deleteConfirmAction.current = null;
      setConfirmDelete(null);
    }
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
        onDataLoaded(data, file.name);
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
    (data: ParsedData, fileName?: string) => {
      onDataLoaded(data, fileName);
      onClose();
    },
    [onDataLoaded, onClose],
  );

  const storagePercent = storageQuota > 0 ? Math.min((storageUsed / storageQuota) * 100, 100) : 0;

  const renderRow = useCallback((s: BrowserSession) => {
    // Cloud-only row: one tap downloads + opens it.
    if (s.location === "cloud") {
      const busy = cloudBusy === s.fileName;
      // Greyed out (not on this device until downloaded).
      return (
        <div className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 transition-colors group opacity-60">
          <button
            className="flex-1 text-left min-w-0 cursor-pointer disabled:opacity-60"
            disabled={busy}
            onClick={() => handleOpenCloud(s.fileName)}
            title={t("files.cloudRowTitle", { name: s.fileName })}
          >
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium truncate text-muted-foreground">{s.displayName}</span>
              <FileTypeBadge fileName={s.fileName} />
              {busy
                ? <Loader2 className="w-3.5 h-3.5 text-primary shrink-0 animate-spin" />
                : <Cloud className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
            </div>
            <div className="text-xs text-muted-foreground">
              {s.size != null ? `${formatSize(s.size)} · ` : ""}{t("files.inCloud")}
              {s.fastestLapMs != null && (
                <span className="ml-1.5 text-primary font-medium">⚡ {formatLapTime(s.fastestLapMs)}</span>
              )}
            </div>
          </button>
          <CloudDownload className="w-4 h-4 shrink-0 text-muted-foreground" />
        </div>
      );
    }

    // Local row: tap to load; export + delete; plugin per-row control (sync toggle).
    const file = filesByName.get(s.fileName);
    if (!file) return null;
    const metadata = mergedMeta.get(s.fileName);
    return (
      <div className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 transition-colors group">
        <button
          className="flex-1 text-left min-w-0 cursor-pointer"
          onClick={() => setConfirmLoad(s.fileName)}
        >
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium truncate text-foreground" title={s.fileName}>{s.displayName}</span>
            <FileTypeBadge fileName={s.fileName} />
            {videoFiles.has(s.fileName) && (
              <span title={(() => {
                const m = videoFiles.get(s.fileName)!;
                const parts = [m.exportType === "lap" && m.lapNumber != null ? t("files.videoLap", { number: m.lapNumber }) : m.exportType === "session" ? t("files.videoSession") : t("files.videoSource")];
                if (m.hasOverlays) parts.push(t("files.videoWithOverlays"));
                parts.push(`(${formatSize(m.size)})`);
                return parts.join(" ");
              })()}>
                <Video className="w-3.5 h-3.5 text-primary shrink-0" />
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {formatSize(file.size)} · {new Date(file.savedAt).toLocaleDateString()}
            {s.fastestLapMs != null && (
              <span className="ml-1.5 text-primary font-medium">⚡ {formatLapTime(s.fastestLapMs)}</span>
            )}
          </div>
        </button>
        <PluginMount slot={MountSlot.FileRow} ctx={{ file, metadata }} />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 opacity-60 hover:opacity-100"
          onClick={() => onExportFile(s.fileName)}
          title={t("files.exportDownload")}
        >
          <Download className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 opacity-60 hover:opacity-100 hover:text-destructive"
          onClick={() => setConfirmDelete(s.fileName)}
          title={t("files.delete")}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    );
  }, [cloudBusy, handleOpenCloud, filesByName, mergedMeta, videoFiles, onExportFile, t]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Inline Confirmation Banner */}
      {(confirmLoad || confirmDelete) && (
        <div className="mx-3 mt-3 mb-1 p-3 rounded-md border border-border bg-muted/60 space-y-2 shrink-0">
          {confirmLoad && (
            <>
              <p className="text-sm text-foreground">
                <Trans ns="drawer" i18nKey="files.confirmLoad" values={{ name: confirmLoad }} components={{ name: <span className="font-mono font-medium" /> }} />
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setConfirmLoad(null)}>{t("files.cancel")}</Button>
                <Button size="sm" onClick={handleLoadConfirm} disabled={loading}>
                  {loading && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                  {t("files.load")}
                </Button>
              </div>
            </>
          )}
          {confirmDelete && (
            <>
              <p className="text-sm text-foreground">
                <Trans ns="drawer" i18nKey="files.confirmDelete" values={{ name: confirmDelete }} components={{ name: <span className="font-mono font-medium" /> }} />
              </p>
              <PluginMount
                key={confirmDelete}
                slot={MountSlot.FileDeleteConfirm}
                ctx={{ fileName: confirmDelete, registerOnConfirm: registerDeleteConfirm }}
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setConfirmDelete(null)}>{t("files.cancel")}</Button>
                <Button variant="destructive" size="sm" onClick={handleDeleteConfirm}>{t("files.delete")}</Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* File List */}
      <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-1">
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <FolderOpen className="w-12 h-12 opacity-30" />
            <p className="text-sm">{t("files.emptyTitle")}</p>
            <p className="text-xs">{t("files.emptyHint")}</p>
          </div>
        ) : (
          <SessionBrowser view={view} onNavigate={setNav} renderRow={renderRow} />
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
              {t("files.storageUsed", { used: formatSize(storageUsed), quota: formatSize(storageQuota) })}
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center">{t("files.storageUnavailable")}</p>
        )}
      </div>

      {/* Bottom Actions */}
      <div className="flex gap-2 px-4 py-3 border-t border-border shrink-0">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.nmea,.txt,.ubx,.vbo,.dove,.ld"
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
          {t("files.uploadFiles")}
        </Button>
        <Suspense fallback={null}>
          <DataloggerDownload
            onDataLoaded={handleBleDataLoaded}
            autoSave={autoSave}
            autoSaveFile={onSaveFile}
          />
        </Suspense>
      </div>
    </div>
  );
}
