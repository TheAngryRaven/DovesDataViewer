import { useState, useCallback } from "react";
import {
  FileEntry,
  saveFile as dbSave,
  listFiles,
  getFile,
  deleteFile as dbDelete,
  getStorageEstimate,
} from "@/lib/fileStorage";

export function useFileManager() {
  const [isOpen, setIsOpen] = useState(false);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [storageUsed, setStorageUsed] = useState(0);
  const [storageQuota, setStorageQuota] = useState(0);

  const refresh = useCallback(async () => {
    const [fileList, estimate] = await Promise.all([listFiles(), getStorageEstimate()]);
    setFiles(fileList);
    if (estimate) {
      setStorageUsed(estimate.used);
      setStorageQuota(estimate.quota);
    }
  }, []);

  const open = useCallback(() => {
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
    storageUsed,
    storageQuota,
    open,
    close,
    refresh,
    saveFile,
    removeFile,
    exportFile,
    loadFile,
  };
}
