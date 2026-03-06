import type { OverlayType } from "./types";

export interface OverlayTypeDef {
  type: OverlayType;
  label: string;
  icon: string; // lucide icon name
  description: string;
  needsSecondarySource?: boolean;
  isSpecial?: boolean; // doesn't need a generic data source
  defaultConfig?: Record<string, unknown>;
}

export const OVERLAY_TYPES: OverlayTypeDef[] = [
  {
    type: "digital",
    label: "Digital",
    icon: "Hash",
    description: "Numeric value display with unit",
  },
  {
    type: "analog",
    label: "Analog Gauge",
    icon: "Gauge",
    description: "Needle gauge with ~200° arc sweep",
  },
  {
    type: "graph",
    label: "Line Graph",
    icon: "TrendingUp",
    description: "Rolling line chart of data over time",
    defaultConfig: { graphLength: 100, color: "#00ccaa" },
  },
  {
    type: "bar",
    label: "Progress Bar",
    icon: "BarChart2",
    description: "Horizontal 0-100% bar",
    defaultConfig: { color: "#00ccaa" },
  },
  {
    type: "bubble",
    label: "XY Bubble",
    icon: "Target",
    description: "Circular XY plot (e.g. G-forces)",
    needsSecondarySource: true,
  },
  {
    type: "map",
    label: "Mini Map",
    icon: "Map",
    description: "Race line with current position",
    isSpecial: true,
  },
  {
    type: "pace",
    label: "Pace Delta",
    icon: "Timer",
    description: "Real-time pace comparison indicator",
    isSpecial: true,
  },
  {
    type: "sector",
    label: "Sector Times",
    icon: "LayoutGrid",
    description: "Live sector delta with animations",
    isSpecial: true,
    defaultConfig: { showAnimation: true },
  },
  {
    type: "laptime",
    label: "Lap Time",
    icon: "Clock",
    description: "Current lap time with optional pace mode",
    isSpecial: true,
    defaultConfig: { showPaceMode: false },
  },
];

export function getOverlayTypeDef(type: OverlayType): OverlayTypeDef | undefined {
  return OVERLAY_TYPES.find((t) => t.type === type);
}

/** Generate a unique ID for a new overlay */
export function generateOverlayId(): string {
  return `ov-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
