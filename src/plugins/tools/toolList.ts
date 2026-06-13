// The catalog of tools the Tools tab offers. Each tool is a self-contained,
// lazy-loaded component; adding a tool is adding an entry here. Tools receive
// the standard `PluginPanelProps` session snapshot so a future tool can read
// the loaded session, but most are standalone calculators that ignore it.

import { lazy, type ComponentType } from "react";
import { Armchair } from "lucide-react";
import type { PluginPanelProps } from "@/plugins/panels";

export interface ToolDef {
  /** Stable id — also the persistence key prefix in the plugin store. */
  id: string;
  name: string;
  /** One-liner shown on the picker card. */
  description: string;
  /** Optional bubble tag on the picker card (e.g. maturity warning). */
  badge?: string;
  icon: ComponentType<{ className?: string }>;
  component: ComponentType<PluginPanelProps>;
}

export const TOOLS: ToolDef[] = [
  {
    id: "seat-position",
    name: "Seat Position Visualizer",
    description:
      "See how sliding or tilting your kart seat shifts front/rear weight and CoG height — with a calibration mode for corner scales.",
    badge: "Super experimental",
    icon: Armchair,
    component: lazy(() => import("./seat-position/SeatPositionTool")),
  },
];
