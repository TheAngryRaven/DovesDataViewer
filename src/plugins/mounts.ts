// Inline UI mount points.
//
// Where `panels.ts` lets a plugin contribute a standalone titled card to a slot
// (the Labs tab), a *mount* lets a plugin inject a raw component into a fixed
// spot in core UI — e.g. a control on every file row, or a section under the
// file list. Each mount targets a named slot and receives a typed context.
//
// All mounts share one registry point (`MOUNTS_POINT`), discriminated by `slot`,
// so adding a new mount location is just a new string — no registry change.

import { useSyncExternalStore, type ComponentType } from "react";
import type { FileEntry, FileMetadata } from "@/lib/fileStorage";
import { getContributionsVersion, pluginRegistry, subscribeContributions } from "./registry";

export const MOUNTS_POINT = "ui:mounts";

/** Known inline mount locations in core UI. */
export const MountSlot = {
  /** Rendered once per file row in the file manager. Context: that file. */
  FileRow: "file-row",
  /** Rendered inside the file delete-confirm banner. Context: the target file +
   *  a hook to run an extra action when the user confirms the delete. */
  FileDeleteConfirm: "file-delete-confirm",
} as const;
export type MountSlot = (typeof MountSlot)[keyof typeof MountSlot];

/** Context handed to a `MountSlot.FileRow` component. */
export interface FileRowContext {
  file: FileEntry;
  metadata?: FileMetadata;
}

/** Context handed to a `MountSlot.FileDeleteConfirm` component. */
export interface FileDeleteConfirmContext {
  /** The file about to be deleted locally. */
  fileName: string;
  /**
   * Register an extra action the host runs (after the local delete) when the
   * user confirms — or `null` to clear it. Lets a plugin (e.g. cloud-sync)
   * offer "also delete from the cloud" without the host knowing about cloud.
   */
  registerOnConfirm: (fn: (() => Promise<void>) | null) => void;
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

/**
 * React hook form of `getMounts` that re-reads when plugins contribute (async
 * plugin `setup` can register mounts after the first render — see
 * `usePanelsForSlot`).
 */
export function useMounts<C = unknown>(slot: string): PluginMountDef<C>[] {
  useSyncExternalStore(subscribeContributions, getContributionsVersion, getContributionsVersion);
  return getMounts<C>(slot);
}
