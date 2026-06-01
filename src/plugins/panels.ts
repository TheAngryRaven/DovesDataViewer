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

import { useSyncExternalStore, type ComponentType } from "react";
import type { ParsedData, Lap, Course, GpsSample } from "@/types/racing";
import type { VehicleSetup } from "@/lib/setupStorage";
import { getContributionsVersion, pluginRegistry, subscribeContributions } from "./registry";

/** Registry extension point that all UI panels are contributed to. */
export const PANELS_POINT = "ui:panels";

/** Known host surfaces a panel can mount into. */
export const PanelSlot = {
  /** The Labs tab in the main view. */
  Labs: "labs",
  /** The dedicated AI Coach tab in the main view. */
  Coach: "coach",
  /** The user profile tab (storage usage, account) in the file-manager drawer. */
  Profile: "profile",
} as const;
export type PanelSlot = (typeof PanelSlot)[keyof typeof PanelSlot];

/**
 * A lap snapshot as handed to plugin panels — a curated, serializable view of a
 * frozen "course fastest lap" with its samples **already trimmed to the clean
 * lap** (no ±5s capture buffer), so a panel can render/compare it directly.
 */
export interface PluginSnapshot {
  id: string;
  /** Free-text engine the snapshot was captured under (the comparison key). */
  engine: string;
  trackName: string;
  courseName: string;
  lapTimeMs: number;
  sourceFileName: string;
  sourceLapNumber: number;
  /** Session start (epoch ms) when known. */
  recordedAt?: number;
  /** Clean lap GPS samples, capture buffer already trimmed. */
  samples: GpsSample[];
  /** Course geometry frozen at capture time. */
  course: Course;
  /** Frozen vehicle context (chassis); engine is the match key. */
  vehicle?: { id?: string; name?: string; number?: number };
  /** Frozen setup sheet at capture time. */
  setup?: VehicleSetup;
}

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
  /**
   * The setup sheet assigned to the active session log (via the file manager),
   * or null when none is assigned. Lets a panel reason about the chassis the
   * driver is currently running — pair with `activeSnapshot.setup` (the *frozen*
   * setup from the reference lap) to compare against a baseline.
   */
  sessionSetup: VehicleSetup | null;
  /**
   * The lap snapshot the user has loaded as the reference lap, or null. Samples
   * are the clean lap (capture buffer trimmed). Lets a panel (e.g. the coach)
   * compare the active session against a frozen course-fastest-lap baseline.
   */
  activeSnapshot: PluginSnapshot | null;
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
  /**
   * Render the body without the host's card chrome (no bordered section,
   * header, or padding) — for panels that own their full layout, e.g. a
   * full-bleed dashboard. The error boundary and Suspense still apply. When a
   * slot's panels are all chromeless, the host also drops its outer padding so
   * the panel can fill the tab.
   */
  chromeless?: boolean;
}

/** All panels contributed to `slot`, sorted by `order` then registration. */
export function getPanelsForSlot(slot: string): PluginPanel[] {
  return pluginRegistry
    .getContributions<PluginPanel>(PANELS_POINT)
    .filter((panel) => panel.slot === slot)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * React hook form of `getPanelsForSlot` that re-reads when plugins contribute.
 * A plugin's `setup` may be async (e.g. the external coach awaits before
 * registering its panels), so panels can appear AFTER the first render — this
 * subscribes to the registry so the host re-renders and the tab shows up. The
 * snapshot is the contribution version (stable across renders), so the result
 * only recomputes when `slot` changes or something is actually contributed.
 */
export function usePanelsForSlot(slot: string): PluginPanel[] {
  useSyncExternalStore(subscribeContributions, getContributionsVersion, getContributionsVersion);
  return getPanelsForSlot(slot);
}

/**
 * A slot is "bare" when it has panels and every one is chromeless — the host
 * then renders without its outer padding/spacing so a single dashboard panel
 * can fill the tab. A mixed slot keeps the padded, stacked layout.
 */
export function isBareSlot(panels: PluginPanel[]): boolean {
  return panels.length > 0 && panels.every((p) => p.chromeless);
}
