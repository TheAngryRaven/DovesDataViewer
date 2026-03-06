import type { GpsSample, FieldMapping, Lap, Course } from "@/types/racing";

export type OverlayType = "digital" | "analog" | "graph" | "bar" | "bubble" | "map" | "pace" | "sector" | "laptime";
export type ThemeId = "classic" | "neon";
export type ColorMode = "light" | "dark";

export interface OverlayPosition {
  x: number; // percentage 0-100
  y: number; // percentage 0-100
  scale?: number; // multiplier, default 1
}

export interface OverlayInstance {
  id: string;
  type: OverlayType;
  dataSource: string;
  dataSourceSecondary?: string; // For bubble (Y axis)
  theme: ThemeId;
  colorMode: ColorMode;
  opacity: number; // 0-1
  position: OverlayPosition;
  visible: boolean;
  // Type-specific config
  color?: string;
  graphLength?: number; // graph: number of samples to show
  showAnimation?: boolean; // sector: sparkle toggle
  showPaceMode?: boolean; // laptime: show pace delta + best lap
  showSectors?: boolean; // map: color line by sector performance
}

export interface OverlaySettings {
  overlaysLocked: boolean;
  overlays: OverlayInstance[];
}

export const DEFAULT_OVERLAY_SETTINGS: OverlaySettings = {
  overlaysLocked: true,
  overlays: [],
};

/** Data source definition - resolves a field to a current value + range */
export interface DataSourceDef {
  id: string;
  label: string;
  unit: string;
  getValue: (sample: GpsSample) => number | null;
  getMin: (samples: GpsSample[]) => number;
  getMax: (samples: GpsSample[]) => number;
  /** For special sources that need history */
  isSpecial?: boolean;
}

/** Context passed to each overlay renderer */
export interface OverlayRenderContext {
  currentSample: GpsSample;
  currentIndex: number;
  samples: GpsSample[]; // visible range samples
  allSamples: GpsSample[];
  dataSources: DataSourceDef[];
  fieldMappings: FieldMapping[];
  laps: Lap[];
  selectedLapNumber: number | null;
  course: Course | null;
  referenceSamples: GpsSample[];
  paceData: number[];
  brakingGData: number[];
  useKph: boolean;
  containerWidth: number;
  containerHeight: number;
}

/** Theme visual properties */
export interface ThemeDef {
  id: ThemeId;
  label: string;
  bg: (colorMode: ColorMode, opacity: number) => string;
  text: (colorMode: ColorMode) => string;
  textSecondary: (colorMode: ColorMode) => string;
  accent: (colorMode: ColorMode) => string;
  border: (colorMode: ColorMode) => string;
  needleColor: (colorMode: ColorMode) => string;
  ringColor: (colorMode: ColorMode) => string;
  glowFilter?: string;
}

/** Old format for migration */
export interface LegacyOverlaySettings {
  showSpeed: boolean;
  overlaysLocked: boolean;
  positions: Record<string, OverlayPosition>;
}
