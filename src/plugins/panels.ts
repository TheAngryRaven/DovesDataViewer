// UI panel framework for plugins.
//
// A plugin contributes self-contained React panels to a named *slot* (a host
// surface, e.g. the Labs tab). The host mounts every panel registered for a
// slot and hands each one a curated, stable `PluginPanelProps` snapshot of the
// active session — plugins never see the host's internal session context, so
// the contract here is the entire surface a plugin can rely on.
//
// New slots need no changes here: a host surface picks a slot string, plugins
// target it, and `getPanelsForSlot` wires them together.

import type { ComponentType } from "react";
import type { ParsedData, Lap, Course } from "@/types/racing";
import { pluginRegistry } from "./registry";

/** Registry extension point that all UI panels are contributed to. */
export const PANELS_POINT = "ui:panels";

/** Known host surfaces a panel can mount into. */
export const PanelSlot = {
  /** The Labs tab in the main view. */
  Labs: "labs",
} as const;
export type PanelSlot = (typeof PanelSlot)[keyof typeof PanelSlot];

/** Live, read-only session snapshot handed to every panel on each render. */
export interface PluginPanelProps {
  /** Parsed telemetry for the active session, or null when none is loaded. */
  data: ParsedData | null;
  /** Detected laps for the active session. */
  laps: Lap[];
  /** Currently selected lap number, or null for "all laps". */
  selectedLapNumber: number | null;
  /** Selected course (start/finish + sectors), or null when undetected. */
  course: Course | null;
  /** Unit preference: true = km/h, false = mph. */
  useKph: boolean;
}

/** Descriptor a plugin contributes to `PANELS_POINT` to render a panel. */
export interface PluginPanel {
  /** Unique id (within its slot). */
  id: string;
  /** Title shown in the panel header. */
  title: string;
  /** Host surface to mount into — a `PanelSlot` value. */
  slot: string;
  /** Sort order within the slot; lower renders first. Defaults to 0. */
  order?: number;
  /** Optional lucide-style icon for the panel header. */
  icon?: ComponentType<{ className?: string }>;
  /** The panel body. Re-renders with a fresh `PluginPanelProps` snapshot. */
  component: ComponentType<PluginPanelProps>;
}

/** All panels contributed to `slot`, sorted by `order` then registration. */
export function getPanelsForSlot(slot: string): PluginPanel[] {
  return pluginRegistry
    .getContributions<PluginPanel>(PANELS_POINT)
    .filter((panel) => panel.slot === slot)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
