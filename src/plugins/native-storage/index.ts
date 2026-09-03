import { lazy } from "react";
import { Film } from "lucide-react";
import type { DataViewerPlugin } from "@/plugins/types";
import { PANELS_POINT, PanelSlot, type PluginPanel } from "@/plugins/panels";
import { isNativeApp } from "@/lib/platform";

// Lazy: the panel (and the native bridge it pulls in) loads only when the
// Profile tab opens.
const DeviceVideosPanel = lazy(() => import("./DeviceVideosPanel"));

/**
 * Native shell only: the Profile tab's "Videos on this device" card — the
 * LapWing store of remembered session videos (plan 0024), listed with sizes
 * and deletable one at a time or all at once. It is the one thing in the app
 * that grows by gigabytes, and nothing else prunes it.
 *
 * Contributing the panel is also what makes the Profile tab exist in a native
 * build without the cloud plugin.
 */
const plugin: DataViewerPlugin = {
  id: "native-storage",
  name: "Device storage",
  setup(ctx) {
    if (!isNativeApp()) return;
    ctx.registry.contribute(PANELS_POINT, {
      id: "native-storage-videos",
      title: "panels.deviceVideos",
      slot: PanelSlot.Profile,
      // Between the account/storage meters (0) and lap snapshots (5).
      order: 3,
      icon: Film,
      component: DeviceVideosPanel,
    } satisfies PluginPanel);
  },
};

export default plugin;
