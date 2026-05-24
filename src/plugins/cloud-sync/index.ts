import { lazy } from "react";
import { Cloud } from "lucide-react";
import type { DataViewerPlugin } from "@/plugins/types";
import { PANELS_POINT, PanelSlot, type PluginPanel } from "@/plugins/panels";

// The panel pulls in the Supabase sync engine + storage modules, so it's lazy:
// the chunk loads only when the Labs tab is opened, keeping the initial bundle
// lean (see Bundle Splitting in CLAUDE.md).
const CloudSyncPanel = lazy(() => import("./CloudSyncPanel"));

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
  },
};

export default plugin;
