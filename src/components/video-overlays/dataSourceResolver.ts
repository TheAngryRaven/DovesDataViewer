import type { GpsSample, FieldMapping } from "@/types/racing";
import type { DataSourceDef } from "./types";

/**
 * Build the list of available data sources from samples + fieldMappings.
 * Mirrors the logic in GraphPanel's availableSources but returns DataSourceDef objects.
 */
export function buildDataSources(
  fieldMappings: FieldMapping[],
  useKph: boolean,
  hasReference: boolean,
): DataSourceDef[] {
  const sources: DataSourceDef[] = [];

  // Speed
  sources.push({
    id: "speed",
    label: `Speed (${useKph ? "KPH" : "MPH"})`,
    unit: useKph ? "KPH" : "MPH",
    getValue: (s) => (useKph ? s.speedKph : s.speedMph),
    getMin: (samples) => {
      let min = Infinity;
      for (const s of samples) {
        const v = useKph ? s.speedKph : s.speedMph;
        if (v < min) min = v;
      }
      return min === Infinity ? 0 : min;
    },
    getMax: (samples) => {
      let max = -Infinity;
      for (const s of samples) {
        const v = useKph ? s.speedKph : s.speedMph;
        if (v > max) max = v;
      }
      return max === -Infinity ? 100 : max;
    },
  });

  // Braking G (computed from GPS speed via Savitzky-Golay filter)
  sources.push({
    id: "__braking_g__",
    label: "Braking G (computed)",
    unit: "G",
    isSpecial: true,
    getValue: () => null, // resolved via brakingGData
    getMin: () => -3,
    getMax: () => 3,
  });


  // Pace (special)
  if (hasReference) {
    sources.push({
      id: "__pace__",
      label: "Pace (Δs)",
      unit: "s",
      isSpecial: true,
      getValue: () => null, // resolved externally via paceData
      getMin: () => -2,
      getMax: () => 2,
    });
  }

  // Extra fields from parser
  for (const f of fieldMappings) {
    sources.push({
      id: f.name,
      label: f.name + (f.unit ? ` (${f.unit})` : ""),
      unit: f.unit ?? "",
      getValue: (s) => s.extraFields[f.name] ?? null,
      getMin: (samples) => {
        let min = Infinity;
        for (const s of samples) {
          const v = s.extraFields[f.name];
          if (v !== undefined && v < min) min = v;
        }
        return min === Infinity ? 0 : min;
      },
      getMax: (samples) => {
        let max = -Infinity;
        for (const s of samples) {
          const v = s.extraFields[f.name];
          if (v !== undefined && v > max) max = v;
        }
        return max === -Infinity ? 100 : max;
      },
    });
  }

  return sources;
}

/**
 * Resolve a data source value for the current sample.
 * Handles special sources like pace.
 */
export function resolveValue(
  sourceId: string,
  sample: GpsSample,
  currentIndex: number,
  dataSources: DataSourceDef[],
  paceData: number[],
): number | null {
  if (sourceId === "__pace__") {
    return paceData[currentIndex] ?? null;
  }
  const src = dataSources.find((d) => d.id === sourceId);
  if (!src) return null;
  return src.getValue(sample);
}

/** Get min/max for a data source from the visible samples */
export function resolveRange(
  sourceId: string,
  samples: GpsSample[],
  dataSources: DataSourceDef[],
  paceData: number[],
): { min: number; max: number } {
  if (sourceId === "__pace__") {
    let min = Infinity, max = -Infinity;
    for (const v of paceData) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    // Symmetric around zero
    const absMax = Math.max(Math.abs(min), Math.abs(max), 0.5);
    return { min: -absMax, max: absMax };
  }
  const src = dataSources.find((d) => d.id === sourceId);
  if (!src) return { min: 0, max: 100 };
  return { min: src.getMin(samples), max: src.getMax(samples) };
}

/** Get the unit string for a source */
export function resolveUnit(sourceId: string, dataSources: DataSourceDef[]): string {
  const src = dataSources.find((d) => d.id === sourceId);
  return src?.unit ?? "";
}

/** Get the label for a source */
export function resolveLabel(sourceId: string, dataSources: DataSourceDef[]): string {
  const src = dataSources.find((d) => d.id === sourceId);
  return src?.label ?? sourceId;
}
