// Restore a data-export ZIP (produced by accountExport.ts) back into local
// storage. The migration path for users moving between origins (e.g. the old
// hackthetrack.net → lapwingdata.com) where per-origin IndexedDB/localStorage
// does not carry over: export on the old site, import here.
//
// Scope is intentionally LOCAL: it writes the document stores + file blobs into
// this browser via the same accessors the sync engine uses (raw `putOne`, no
// garage event — same as the pull path). Account holders don't need this (cloud
// sync already follows them); this is the no-account fallback. The pure
// entry-classifier is split out so it can be unit-tested without a browser/zip.

import JSZip from "jszip";
import { saveFile, listFiles } from "@/lib/fileStorage";
import { getAccessor } from "./storeAccessors";
import { DOC_STORES } from "./syncStores";

export interface ImportSummary {
  /** New file blobs written (existing names are skipped, never clobbered). */
  files: number;
  /** Document rows written across all stores. */
  records: number;
  /** Distinct document stores that received at least one row. */
  stores: number;
}

export interface ImportProgress {
  phase: "stores" | "files";
}

export type EntryKind =
  | { kind: "store"; store: string }
  | { kind: "file"; name: string }
  | null;

/**
 * Classify a ZIP entry path from an export archive. Pure — no I/O — so the
 * path-mapping rules are unit-testable. Recognises the document-store JSON
 * (`local/stores/<store>.json`) and session-file blobs under either
 * `local/files/<name>` or `cloud/files/<name>`. Everything else (the cloud/*
 * account JSON, README, directories) returns null and is ignored on import.
 */
export function classifyEntry(path: string): EntryKind {
  const store = path.match(/^local\/stores\/(.+)\.json$/);
  if (store) return { kind: "store", store: store[1] };
  const file = path.match(/^(?:local|cloud)\/files\/(.+)$/);
  if (file && file[1]) return { kind: "file", name: file[1] };
  return null;
}

/**
 * Read an export ZIP and restore its local data into this browser. Existing
 * files (by name) are left untouched; document rows are upserted by key.
 */
export async function importAccountArchive(
  blob: Blob,
  onProgress?: (p: ImportProgress) => void,
): Promise<ImportSummary> {
  const zip = await JSZip.loadAsync(blob);

  // Document stores: only restore stores we actually sync, by exact filename, so
  // an unknown/malicious entry can't be written to an arbitrary store.
  onProgress?.({ phase: "stores" });
  let records = 0;
  let storesTouched = 0;
  for (const store of DOC_STORES) {
    const entry = zip.file(`local/stores/${store}.json`);
    if (!entry) continue;
    let rows: unknown;
    try {
      rows = JSON.parse(await entry.async("string"));
    } catch {
      continue;
    }
    if (!Array.isArray(rows)) continue;
    const accessor = getAccessor(store);
    let touched = false;
    for (const row of rows) {
      if (row && typeof row === "object") {
        await accessor.putOne(row as Record<string, unknown>);
        records++;
        touched = true;
      }
    }
    if (touched) storesTouched++;
  }

  // File blobs: add any that don't already exist on this device.
  onProgress?.({ phase: "files" });
  const existing = new Set((await listFiles()).map((f) => f.name));
  const fileEntries: { name: string; entry: JSZip.JSZipObject }[] = [];
  zip.forEach((path, entry) => {
    if (entry.dir) return;
    const c = classifyEntry(path);
    if (c && c.kind === "file" && !existing.has(c.name)) {
      fileEntries.push({ name: c.name, entry });
    }
  });
  let files = 0;
  for (const { name, entry } of fileEntries) {
    await saveFile(name, await entry.async("blob"));
    files++;
  }

  return { files, records, stores: storesTouched };
}
