import { lazy } from "react";
import { Cloud } from "lucide-react";
import type { DataViewerPlugin } from "@/plugins/types";
import { PANELS_POINT, PanelSlot, type PluginPanel } from "@/plugins/panels";
import {
  MOUNTS_POINT, MountSlot,
  type PluginMountDef, type FileRowContext, type FileManagerSectionContext,
} from "@/plugins/mounts";

// The panel pulls in the Supabase sync engine + storage modules, so it's lazy:
// the chunk loads only when the Labs tab is opened, keeping the initial bundle
// lean (see Bundle Splitting in CLAUDE.md).
const CloudSyncPanel = lazy(() => import("./CloudSyncPanel"));
// Likewise the per-file toggle + cloud-only list: lazy so the file-manager
// drawer doesn't pull the sync engine onto its chunk until they render.
const FileSyncToggle = lazy(() => import("./FileSyncToggle"));
const CloudFilesSection = lazy(() => import("./CloudFilesSection"));

const enableCloud = import.meta.env.VITE_ENABLE_CLOUD === 'true';

const plugin: DataViewerPlugin = {
  id: "cloud-sync",
  name: "Cloud Sync",
  version: "0.1.0",
  setup(ctx) {
    // Offline-first guard: when the cloud flag is off, contribute nothing.
    // The Labs panel never registers, the panel chunk never loads, and the
    // Labs tab stays hidden unless another plugin contributes there.
    if (!enableCloud) return;
    const panel: PluginPanel = {
      id: "cloud-sync",
      title: "Cloud Sync",
      slot: PanelSlot.Labs,
      order: 10,
      icon: Cloud,
      component: CloudSyncPanel,
    };
    ctx.registry.contribute(PANELS_POINT, panel);

    // Per-file sync toggle injected into each file-manager row.
    ctx.registry.contribute(MOUNTS_POINT, {
      id: "cloud-sync-file-toggle",
      slot: MountSlot.FileRow,
      order: 0,
      component: FileSyncToggle,
    } satisfies PluginMountDef<FileRowContext>);

    // Cloud-only files (in the cloud, not on this device) listed under the file
    // list, each with a per-file pull.
    ctx.registry.contribute(MOUNTS_POINT, {
      id: "cloud-sync-cloud-files",
      slot: MountSlot.FileManagerSection,
      order: 0,
      component: CloudFilesSection,
    } satisfies PluginMountDef<FileManagerSectionContext>);
  },
};

export default plugin;
