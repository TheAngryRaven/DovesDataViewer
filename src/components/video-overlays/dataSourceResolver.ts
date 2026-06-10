import type { GpsSample, FieldMapping } from "@/types/racing";
import { toChannelKey } from "@/lib/channels";
import { isDistanceUnitChannel, distanceChannelValue, distanceChannelUnit } from "@/lib/units";

/**
 * Find a data source by id, falling back to the canonical key for legacy
 * sourceIds saved before channel normalization (e.g. a stored "Lat G" now lives
 * under "lat_g"). Special ids ("speed", "__pace__"…) match exactly on the first
 * lookup.
 */
function findSource(dataSources: DataSourceDef[], sourceId: string): DataSourceDef | undefined {
  return (
    dataSources.find((d) => d.id === sourceId) ??
    dataSources.find((d) => d.id === toChannelKey(sourceId))
  );
}
import type { DataSourceDef } from "./types";

/**
 * Build the list of available data sources from samples + fieldMappings.
 * Mirrors the logic in GraphPanel's availableSources but returns DataSourceDef objects.
 */
export function buildDataSources(
  fieldMappings: FieldMapping[],
  useKph: boolean,
  hasReference: boolean,
  useMetricDistance: boolean = false,
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

  // Brake % (computed from GPS speed deceleration)
  sources.push({
    id: "__braking_g__",
    label: "Brake %",
    unit: "Brake %",
    isSpecial: true,
    getValue: () => null, // resolved via brakingGData
    getMin: () => 0,
    getMax: () => 100,
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
    // Distance-family channels (distance, altitude) are stored in meters but
    // follow the distance unit toggle (m ⇄ ft).
    const isDist = isDistanceUnitChannel(f.name);
    const conv = (v: number) => (isDist ? distanceChannelValue(v, useMetricDistance) : v);
    const unit = isDist ? distanceChannelUnit(useMetricDistance) : (f.unit ?? "");
    sources.push({
      id: f.name,
      label: (f.label ?? f.name) + (unit ? ` (${unit})` : ""),
      unit,
      getValue: (s) => {
        const v = s.extraFields[f.name];
        return v === undefined ? null : conv(v);
      },
      getMin: (samples) => {
        let min = Infinity;
        for (const s of samples) {
          const v = s.extraFields[f.name];
          if (v !== undefined && conv(v) < min) min = conv(v);
        }
        return min === Infinity ? 0 : min;
      },
      getMax: (samples) => {
        let max = -Infinity;
        for (const s of samples) {
          const v = s.extraFields[f.name];
          if (v !== undefined && conv(v) > max) max = conv(v);
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
  paceData: (number | null)[],
  brakingGData?: number[],
): number | null {
  if (sourceId === "__pace__") {
    return paceData[currentIndex] ?? null;
  }
  if (sourceId === "__braking_g__") {
    return brakingGData?.[currentIndex] ?? null;
  }
  const src = findSource(dataSources, sourceId);
  if (!src) return null;
  return src.getValue(sample);
}

/** Get min/max for a data source from the visible samples */
export function resolveRange(
  sourceId: string,
  samples: GpsSample[],
  dataSources: DataSourceDef[],
  paceData: (number | null)[],
  brakingGData?: number[],
): { min: number; max: number } {
  if (sourceId === "__braking_g__") {
    return { min: 0, max: 100 };
  }
  if (sourceId === "__pace__") {
    let min = Infinity, max = -Infinity;
    for (const v of paceData) {
      if (v === null) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    // Symmetric around zero
    const absMax = Math.max(Math.abs(min), Math.abs(max), 0.5);
    return { min: -absMax, max: absMax };
  }
  const src = findSource(dataSources, sourceId);
  if (!src) return { min: 0, max: 100 };
  return { min: src.getMin(samples), max: src.getMax(samples) };
}

/** Get the unit string for a source */
export function resolveUnit(sourceId: string, dataSources: DataSourceDef[]): string {
  const src = findSource(dataSources, sourceId);
  return src?.unit ?? "";
}

/** Get the label for a source */
export function resolveLabel(sourceId: string, dataSources: DataSourceDef[]): string {
  const src = findSource(dataSources, sourceId);
  return src?.label ?? sourceId;
}
