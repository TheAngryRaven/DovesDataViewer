// File-source extension point for the file browser.
//
// The host file browser (FilesTab) is cloud-agnostic — it only knows local
// files. A plugin (cloud-sync) can contribute a *file source* that lists
// *remote* session files (e.g. logs in the cloud not yet on this device) and
// fetches one on demand. The host merges these into the same Track→Course tree
// as "cloud" rows; tapping one pulls its blob via `download`, saves it locally,
// then opens it — so the host never imports any cloud code.
//
// Sources are looked up by name only here; their schemas stay in the plugin.

import { useSyncExternalStore } from "react";
import { getContributionsVersion, pluginRegistry, subscribeContributions } from "./registry";

export const FILE_SOURCES_POINT = "file-sources";

/** A remote file a source can list (and later download by name). */
export interface RemoteFile {
  name: string;
  size?: number;
  /** ISO upload time, if known (used for sort/display). */
  uploadedAt?: string;
}

/** A provider of remote (not-on-this-device) session files for the browser. */
export interface FileSource {
  id: string;
  /** List remote files; resolve to `[]` when unavailable (signed out / offline). */
  listFiles(): Promise<RemoteFile[]>;
  /** Fetch one remote file's blob (null when unavailable). */
  download(name: string): Promise<Blob | null>;
}

export function getFileSources(): FileSource[] {
  return pluginRegistry.getContributions<FileSource>(FILE_SOURCES_POINT);
}

/** Hook form — re-reads when a plugin contributes a source after first render. */
export function useFileSources(): FileSource[] {
  useSyncExternalStore(subscribeContributions, getContributionsVersion, getContributionsVersion);
  return getFileSources();
}
