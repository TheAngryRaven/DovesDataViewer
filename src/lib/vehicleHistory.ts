// Pure view-model for the vehicle-history panel.
//
// Where setup history fixes one setup and walks its revisions over time (see
// setupHistory.ts), vehicle history fixes one *vehicle* and gathers every frozen
// setup revision that has been run on it — one card per revision, ordered fastest
// lap first — so the question it answers is "which setup was quickest on this
// kart?". It reuses setupHistory's flatten/usage/sort primitives so the two
// histories stay byte-identical where they overlap.
//
// Kept pure (no IndexedDB / React) so the aggregation is unit-tested.

import type { SetupRevision } from "./setupRevision";
import type { FileMetadata } from "./fileStorage";
import type { Vehicle } from "./vehicleStorage";
import {
  buildUsage,
  byFastestLap,
  distinct,
  flattenRevisionFields,
  type SetupField,
  type SetupUsage,
} from "./setupHistory";

export interface VehicleHistoryEntry {
  revision: SetupRevision;
  /** Setup name at capture time. */
  setupName: string;
  /** Fully flattened fields, in template order then tires (for the collapsed body). */
  fields: SetupField[];
  /** Filtered sessions this revision was run on, fastest lap first. */
  usages: SetupUsage[];
  fastestLapMs: number | null;
  fastestUsage: SetupUsage | null;
  /** Distinct course labels across the (filtered) usages. */
  courses: string[];
  /** True when this revision holds the fastest lap in the current view. */
  isFastestOverall: boolean;
}

export interface VehicleHistory {
  vehicleId: string;
  vehicleName: string;
  /** Cards ordered fastest lap first; revisions with no lap sink to the bottom. */
  entries: VehicleHistoryEntry[];
  /** Every course this vehicle has been run on (for the filter). */
  courseOptions: { key: string; label: string }[];
  overallFastestLapMs: number | null;
}

export interface VehicleHistoryFilter {
  courseKey?: string | null;
}

export interface BuildVehicleHistoryInput {
  vehicleId: string;
  vehicleName: string;
  /** All revisions in the store; matched by id to the sessions' frozen setup. */
  revisions: SetupRevision[];
  /** All session metadata; only those run on this vehicle with a setup are used. */
  metas: FileMetadata[];
  vehicles: Vehicle[];
  filter?: VehicleHistoryFilter;
}

/** Build the fastest-first history view-model for one vehicle. */
export function buildVehicleHistory(input: BuildVehicleHistoryInput): VehicleHistory {
  const { vehicleId, vehicleName, revisions, metas, vehicles, filter } = input;

  const revById = new Map(revisions.map((r) => [r.id, r]));

  // Every session run on this vehicle that froze a (still-present) setup revision,
  // grouped by that revision.
  const usagesByRev = new Map<string, SetupUsage[]>();
  for (const meta of metas) {
    if (meta.sessionKartId !== vehicleId) continue;
    const revId = meta.sessionSetupRev;
    if (!revId || !revById.has(revId)) continue;
    const list = usagesByRev.get(revId) ?? [];
    list.push(buildUsage(meta, vehicles));
    usagesByRev.set(revId, list);
  }

  // Course filter spans every (unfiltered) usage on this vehicle.
  const allUsages = Array.from(usagesByRev.values()).flat();
  const courseMap = new Map<string, string>();
  for (const u of allUsages) {
    if (u.courseKey) courseMap.set(u.courseKey, u.courseLabel ?? u.courseKey);
  }
  const courseOptions = Array.from(courseMap, ([key, label]) => ({ key, label })).sort((a, b) =>
    a.label.localeCompare(b.label),
  );

  const matchesFilter = (u: SetupUsage): boolean =>
    !filter?.courseKey || u.courseKey === filter.courseKey;

  const built = Array.from(usagesByRev.entries())
    .map(([revId, rawUsages]) => {
      const revision = revById.get(revId)!;
      const usages = rawUsages.filter(matchesFilter).sort(byFastestLap);
      const laps = usages.map((u) => u.fastestLapMs).filter((v): v is number => v !== undefined);
      const fastestLapMs = laps.length ? Math.min(...laps) : null;
      const fastestUsage = usages.find((u) => u.fastestLapMs !== undefined) ?? null;
      return {
        revision,
        setupName: revision.name,
        fields: flattenRevisionFields(revision),
        usages,
        fastestLapMs,
        fastestUsage,
        courses: distinct(usages.map((u) => u.courseLabel)),
      };
    })
    // When a course filter is active, only keep revisions actually run there.
    .filter((e) => e.usages.length > 0);

  const overallFastestLapMs = built.reduce<number | null>((min, e) => {
    if (e.fastestLapMs === null) return min;
    return min === null ? e.fastestLapMs : Math.min(min, e.fastestLapMs);
  }, null);

  // Fastest lap first; revisions without a lap sink to the bottom, then by name.
  const entries: VehicleHistoryEntry[] = built
    .map((e) => ({
      ...e,
      isFastestOverall: overallFastestLapMs !== null && e.fastestLapMs === overallFastestLapMs,
    }))
    .sort((a, b) => {
      const av = a.fastestLapMs ?? Infinity;
      const bv = b.fastestLapMs ?? Infinity;
      if (av !== bv) return av - bv;
      return a.setupName.localeCompare(b.setupName);
    });

  return { vehicleId, vehicleName, entries, courseOptions, overallFastestLapMs };
}
