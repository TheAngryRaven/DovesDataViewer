import { useState, useCallback } from "react";
import {
  FileEntry,
  FileMetadata,
  saveFile as dbSave,
  listFiles,
  getFile,
  deleteFile as dbDelete,
  getStorageEstimate,
  getFileMetadata,
  listAllMetadata,
} from "@/lib/fileStorage";
import { isSampleFileName } from "@/lib/sampleData";

/** Garage sub-tabs the drawer can be opened directly to. */
export type GarageTabKey = "files" | "vehicles" | "setups" | "notes";

export function useFileManager() {
  const [isOpen, setIsOpen] = useState(false);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [fileMetadataMap, setFileMetadataMap] = useState<Map<string, FileMetadata>>(new Map());
  const [storageUsed, setStorageUsed] = useState(0);
  const [storageQuota, setStorageQuota] = useState(0);
  const [initialGarageTab, setInitialGarageTab] = useState<GarageTabKey>("files");
  // Whether any non-sample file exists — locally or as cloud-synced metadata.
  // Used to lock the "show sample files" setting on when the sample is the user's
  // only file, so they can never hide their only way back into the app.
  const [hasOtherFiles, setHasOtherFiles] = useState(false);

  const refresh = useCallback(async () => {
    const [fileList, estimate, allMeta] = await Promise.all([
      listFiles(),
      getStorageEstimate(),
      listAllMetadata(),
    ]);
    setFiles(fileList);
    if (estimate) {
      setStorageUsed(estimate.used);
      setStorageQuota(estimate.quota);
    }
    // Non-sample files = local blobs ∪ all known metadata (the latter includes
    // cloud-only files synced down by the cloud-sync plugin), minus samples.
    const names = new Set<string>();
    for (const f of fileList) names.add(f.name);
    for (const m of allMeta) names.add(m.fileName);
    let other = false;
    for (const n of names) {
      if (!isSampleFileName(n)) { other = true; break; }
    }
    setHasOtherFiles(other);
    // Load metadata for all files
    const metaEntries = await Promise.all(
      fileList.map(async (f) => {
        const meta = await getFileMetadata(f.name);
        return [f.name, meta] as const;
      })
    );
    const map = new Map<string, FileMetadata>();
    for (const [name, meta] of metaEntries) {
      if (meta) map.set(name, meta);
    }
    setFileMetadataMap(map);
  }, []);

  // Accepts an optional garage sub-tab to open straight to. Guarded against
  // being wired directly as an event handler (e.g. onClick), where the first
  // argument would be a MouseEvent rather than a tab key.
  const open = useCallback((garageTab?: GarageTabKey) => {
    setInitialGarageTab(typeof garageTab === "string" ? garageTab : "files");
    setIsOpen(true);
    refresh();
  }, [refresh]);

  const close = useCallback(() => setIsOpen(false), []);

  const saveFile = useCallback(
    async (name: string, blob: Blob) => {
      await dbSave(name, blob);
      await refresh();
    },
    [refresh],
  );

  const removeFile = useCallback(
    async (name: string) => {
      await dbDelete(name);
      await refresh();
    },
    [refresh],
  );

  const exportFile = useCallback(async (name: string) => {
    const blob = await getFile(name);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const loadFile = useCallback(async (name: string): Promise<Blob | null> => {
    return getFile(name);
  }, []);

  return {
    isOpen,
    files,
    fileMetadataMap,
    hasOtherFiles,
    storageUsed,
    storageQuota,
    initialGarageTab,
    open,
    close,
    refresh,
    saveFile,
    removeFile,
    exportFile,
    loadFile,
  };
}
