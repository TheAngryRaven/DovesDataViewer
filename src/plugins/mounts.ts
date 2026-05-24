// Inline UI mount points.
//
// Where `panels.ts` lets a plugin contribute a standalone titled card to a slot
// (the Labs tab), a *mount* lets a plugin inject a raw component into a fixed
// spot in core UI — e.g. a control on every file row, or a section under the
// file list. Each mount targets a named slot and receives a typed context.
//
// All mounts share one registry point (`MOUNTS_POINT`), discriminated by `slot`,
// so adding a new mount location is just a new string — no registry change.

import type { ComponentType } from "react";
import type { FileEntry, FileMetadata } from "@/lib/fileStorage";
import { pluginRegistry } from "./registry";

export const MOUNTS_POINT = "ui:mounts";

/** Known inline mount locations in core UI. */
export const MountSlot = {
  /** Rendered once per file row in the file manager. Context: that file. */
  FileRow: "file-row",
  /** Rendered once below the file list. Context: the whole list. */
  FileManagerSection: "file-manager-section",
} as const;
export type MountSlot = (typeof MountSlot)[keyof typeof MountSlot];

/** Context handed to a `MountSlot.FileRow` component. */
export interface FileRowContext {
  file: FileEntry;
  metadata?: FileMetadata;
}

/** Context handed to a `MountSlot.FileManagerSection` component. */
export interface FileManagerSectionContext {
  files: FileEntry[];
  /** Persist a (e.g. cloud-pulled) blob into local storage. */
  onSaveFile: (name: string, blob: Blob) => Promise<void>;
}

/**
 * A mount descriptor. The component receives its slot's context as a single
 * `ctx` prop (avoids generic prop-spreading; keeps the contract explicit).
 */
export interface PluginMountDef<C = unknown> {
  id: string;
  slot: string;
  order?: number;
  component: ComponentType<{ ctx: C }>;
}

/** All mounts contributed to `slot`, sorted by `order` then registration. */
export function getMounts<C = unknown>(slot: string): PluginMountDef<C>[] {
  return pluginRegistry
    .getContributions<PluginMountDef<C>>(MOUNTS_POINT)
    .filter((m) => m.slot === slot)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
