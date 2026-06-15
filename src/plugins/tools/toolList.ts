// The catalog of tools the Tools tab offers. Each tool is a self-contained,
// lazy-loaded component; adding a tool is adding an entry here. Tools receive
// the standard `PluginPanelProps` session snapshot so a future tool can read
// the loaded session, but most are standalone calculators that ignore it.

import { lazy, type ComponentType } from "react";
import { Armchair, Satellite } from "lucide-react";
import type { PluginPanelProps } from "@/plugins/panels";

import type { ToolsKey } from "./i18n";

export interface ToolDef {
  /** Stable id — also the persistence key prefix in the plugin store. */
  id: string;
  /** i18n key (tools namespace) for the tool's display name. */
  nameKey: ToolsKey;
  /** i18n key for the one-liner shown on the picker card. */
  descriptionKey: ToolsKey;
  /** Optional i18n key for a bubble tag on the picker card (e.g. maturity warning). */
  badgeKey?: ToolsKey;
  icon: ComponentType<{ className?: string }>;
  component: ComponentType<PluginPanelProps>;
}

export const TOOLS: ToolDef[] = [
  {
    id: "seat-position",
    nameKey: "seatPosition.name",
    descriptionKey: "seatPosition.description",
    badgeKey: "seatPosition.badge",
    icon: Armchair,
    component: lazy(() => import("./seat-position/SeatPositionTool")),
  },
  {
    id: "datalogger",
    nameKey: "datalogger.name",
    descriptionKey: "datalogger.description",
    badgeKey: "datalogger.badge",
    icon: Satellite,
    component: lazy(() => import("./datalogger/DataloggerTool")),
  },
];
