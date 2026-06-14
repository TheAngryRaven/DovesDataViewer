// Orchestrates the "Download my data" export: pulls the server-side account
// document (when signed in), gathers all local browser data, downloads the
// cloud + local file blobs, and zips the lot for the user. The pure manifest
// assembly lives in exportManifest.ts; this layer does the I/O.

import JSZip from "jszip";
import i18n from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { getFile, listFiles } from "@/lib/fileStorage";
import { getAccessor } from "./storeAccessors";
import { downloadCloudFile } from "./syncEngine";
import { DOC_STORES } from "./syncStores";
import { buildExportTextFiles, type CloudExport, type LocalExport } from "./exportManifest";

const SETTINGS_KEY = "dove-dataviewer-settings";

/** Fetch the server-side account export. Returns null when signed out. */
async function fetchCloudExport(): Promise<CloudExport | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data, error } = await supabase.functions.invoke("export-account-data");
  if (error) throw new Error(error.message);
  return data as CloudExport;
}

/** Read all local browser data the export should include. */
async function gatherLocal(): Promise<LocalExport> {
  let settings: unknown = null;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    settings = raw ? JSON.parse(raw) : null;
  } catch {
    settings = null;
  }

  const stores: Record<string, unknown[]> = {};
  for (const store of DOC_STORES) {
    try {
      stores[store] = await getAccessor(store).readAll();
    } catch {
      stores[store] = [];
    }
  }

  const fileNames = (await listFiles()).map((f) => f.name);
  return { settings, stores, fileNames };
}

export interface ExportProgress {
  /** Human-readable phase, surfaced in the UI. */
  phase: string;
}

/**
 * Build the export ZIP and trigger a browser download. `onProgress` is optional
 * and reports coarse phases ("Gathering…", "Downloading files…", "Zipping…").
 */
export async function downloadAccountExport(onProgress?: (p: ExportProgress) => void): Promise<void> {
  onProgress?.({ phase: i18n.t("plugins:export.gathering") });
  const [cloud, local] = await Promise.all([fetchCloudExport(), gatherLocal()]);

  const zip = new JSZip();
  for (const [path, content] of Object.entries(buildExportTextFiles(cloud, local))) {
    zip.file(path, content);
  }

  // Local session-file blobs.
  onProgress?.({ phase: i18n.t("plugins:export.addingLocal") });
  for (const name of local.fileNames) {
    const blob = await getFile(name);
    if (blob) zip.file(`local/files/${name}`, blob);
  }

  // Cloud session-file blobs (downloaded with the user's own session).
  const cloudFiles = cloud?.cloud_files ?? [];
  if (cloudFiles.length) {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      onProgress?.({ phase: i18n.t("plugins:export.downloadingFiles", { count: cloudFiles.length }) });
      for (const f of cloudFiles) {
        const blob = await downloadCloudFile(user.id, f.name);
        if (blob) zip.file(`cloud/files/${f.name}`, blob);
      }
    }
  }

  onProgress?.({ phase: i18n.t("plugins:export.zipping") });
  const out = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(out);
  const a = document.createElement("a");
  a.href = url;
  const date = new Date().toISOString().slice(0, 10);
  a.download = `hackthetrack-data-export-${date}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}
