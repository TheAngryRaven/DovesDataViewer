// Pure view-model for the setup-revision history panel.
//
// A live `VehicleSetup` accumulates immutable, content-addressed `SetupRevision`s
// over time (see setupRevision.ts). This module turns that flat list — plus the
// session metadata that references each revision — into a chronological history
// the UI can render: the original revision in full, every later revision as a
// diff against the one before it, the sessions (karts/courses) each was run on,
// and the fastest lap achieved on each.
//
// Kept pure (no IndexedDB / React) so the aggregation + diff logic is unit-tested.

import type { SetupRevision, FrozenTemplate } from "./setupRevision";
import type { FileMetadata } from "./fileStorage";
import type { Vehicle } from "./vehicleStorage";

/** Separator for the composite course key (never appears in track/course names). */
export const COURSE_KEY_SEP = "\x1f";

/** A single flattened setup value, ready to render or diff. */
export interface SetupField {
  /** Stable identity used to line fields up across revisions. */
  key: string;
  /** Raw label for data-driven (template) fields — already human text, not i18n. */
  label?: string;
  /** i18n key (drawer namespace) for built-in tire/PSI/ratio fields. */
  labelKey?: string;
  /** Display unit (mm/in resolved to the setup's unit system). */
  unit?: string;
  /** Canonical value — number for numeric fields, string otherwise, null when unset. */
  value: number | string | null;
  /** Pre-formatted display string (without unit). */
  display: string;
  isNumeric: boolean;
}

/** One changed field between two revisions. */
export interface SetupFieldDiff {
  key: string;
  label?: string;
  labelKey?: string;
  unit?: string;
  /** Previous display value; null when the field was added in this revision. */
  prevDisplay: string | null;
  /** New display value; null when the field was removed in this revision. */
  nextDisplay: string | null;
  /** Numeric direction vs the previous revision: up = increased, down = decreased. */
  direction: "up" | "down" | "neutral";
  isNumeric: boolean;
}

/** One session this revision was run on. */
export interface SetupUsage {
  fileName: string;
  kartId?: string;
  kartName?: string;
  engine?: string;
  trackName?: string;
  courseName?: string;
  /** Composite track+course key, present only when a course is tagged. */
  courseKey?: string;
  /** Human course label ("Track — Course" or the course name). */
  courseLabel?: string;
  fastestLapMs?: number;
  sessionStartTime?: number;
}

export interface SetupHistoryEntry {
  revision: SetupRevision;
  /** Fully flattened fields, in template order then tires. */
  fields: SetupField[];
  /** Diff vs the previous displayed entry; null for the first (show full). */
  diff: SetupFieldDiff[] | null;
  /** Filtered sessions, fastest lap first. */
  usages: SetupUsage[];
  fastestLapMs: number | null;
  fastestUsage: SetupUsage | null;
  /** Distinct kart names across the (filtered) usages. */
  karts: string[];
  /** Distinct course labels across the (filtered) usages. */
  courses: string[];
  /** True when this revision holds the fastest lap in the current view. */
  isFastestOverall: boolean;
}

export interface SetupHistory {
  setupId: string;
  setupName: string;
  /** Chronological, oldest first. Filtered-out (no matching usage) entries removed. */
  entries: SetupHistoryEntry[];
  /** Every kart this setup has been run on (for the filter). */
  kartOptions: { id: string; name: string }[];
  /** Every course this setup has been run on (for the filter). */
  courseOptions: { key: string; label: string }[];
  overallFastestLapMs: number | null;
}

export interface SetupHistoryFilter {
  kartId?: string | null;
  courseKey?: string | null;
}

export interface BuildSetupHistoryInput {
  setupId: string;
  setupName: string;
  /** All revisions in the store; filtered to this setup internally. */
  revisions: SetupRevision[];
  /** All session metadata; only those referencing a revision are used. */
  metas: FileMetadata[];
  vehicles: Vehicle[];
  filter?: SetupHistoryFilter;
}

/** Format a numeric setup value to a stable display string. */
function formatNumber(value: number, decimals: number): string {
  return value.toFixed(decimals);
}

/** Collapse a four-corner tire group (FL/FR/RL/RR) the way the InfoBox does. */
function cornerFields(
  fl: number | null,
  fr: number | null,
  rl: number | null,
  rr: number | null,
  keys: { all: string; front: string; rear: string; fl: string; fr: string; rl: string; rr: string },
  labelKeys: { all: string; front: string; rear: string; fl: string; fr: string; rl: string; rr: string },
  unit: string | undefined,
  decimals: number,
): SetupField[] {
  if (fl === null) return [];
  const field = (key: string, labelKey: string, v: number): SetupField => ({
    key,
    labelKey,
    unit,
    value: v,
    display: formatNumber(v, decimals),
    isNumeric: true,
  });
  if (fl === fr && rl === rr && fl === rl) {
    return [field(keys.all, labelKeys.all, fl)];
  }
  if (fl === fr && rl === rr) {
    return [field(keys.front, labelKeys.front, fl), field(keys.rear, labelKeys.rear, rl ?? fl)];
  }
  const out: SetupField[] = [field(keys.fl, labelKeys.fl, fl)];
  if (fr !== null) out.push(field(keys.fr, labelKeys.fr, fr));
  if (rl !== null) out.push(field(keys.rl, labelKeys.rl, rl));
  if (rr !== null) out.push(field(keys.rr, labelKeys.rr, rr));
  return out;
}

/**
 * Flatten one revision's frozen setup + template into an ordered field list.
 * Uses the revision's own frozen template so old history renders with the labels
 * it had the day it ran.
 */
export function flattenRevisionFields(revision: SetupRevision): SetupField[] {
  const setup = revision.setup;
  const template: FrozenTemplate | null = revision.template;
  const fields: SetupField[] = [];

  if (template) {
    for (const section of template.sections) {
      for (const field of section.fields) {
        const raw = setup.customFields[field.id];
        if (raw === null || raw === undefined || raw === "") continue;
        const displayUnit =
          field.unit === "mm" || field.unit === "in" ? setup.unitSystem || "mm" : field.unit;
        const isNumeric = field.type === "number";
        fields.push({
          key: `tpl:${field.id}`,
          label: field.name,
          unit: displayUnit,
          value: isNumeric ? Number(raw) : String(raw),
          display: String(raw),
          isNumeric,
        });
      }
    }
    const front = setup.customFields["f-front-sprocket"];
    const rear = setup.customFields["f-rear-sprocket"];
    if (typeof front === "number" && typeof rear === "number" && front > 0) {
      const ratio = rear / front;
      fields.push({
        key: "ratio",
        labelKey: "setupDetails.ratio",
        value: Number(ratio.toFixed(3)),
        display: ratio.toFixed(3),
        isNumeric: true,
      });
    }
  }

  if (setup.tireBrand) {
    fields.push({
      key: "tireBrand",
      labelKey: "setupDetails.tireBrand",
      value: setup.tireBrand,
      display: setup.tireBrand,
      isNumeric: false,
    });
  }

  const unit = setup.unitSystem || "mm";
  fields.push(
    ...cornerFields(
      setup.psiFrontLeft,
      setup.psiFrontRight,
      setup.psiRearLeft,
      setup.psiRearRight,
      { all: "psiAll", front: "psiFront", rear: "psiRear", fl: "psiFL", fr: "psiFR", rl: "psiRL", rr: "psiRR" },
      {
        all: "setupDetails.psiAll", front: "setupDetails.psiFront", rear: "setupDetails.psiRear",
        fl: "setupDetails.psiFL", fr: "setupDetails.psiFR", rl: "setupDetails.psiRL", rr: "setupDetails.psiRR",
      },
      undefined,
      2,
    ),
  );
  fields.push(
    ...cornerFields(
      setup.tireWidthFrontLeft,
      setup.tireWidthFrontRight,
      setup.tireWidthRearLeft,
      setup.tireWidthRearRight,
      { all: "widthAll", front: "widthFront", rear: "widthRear", fl: "widthFL", fr: "widthFR", rl: "widthRL", rr: "widthRR" },
      {
        all: "setupDetails.tireWidthFront", front: "setupDetails.tireWidthFront", rear: "setupDetails.tireWidthRear",
        fl: "setupDetails.tireWidthFL", fr: "setupDetails.tireWidthFR", rl: "setupDetails.tireWidthRL", rr: "setupDetails.tireWidthRR",
      },
      unit,
      2,
    ),
  );
  fields.push(
    ...cornerFields(
      setup.tireDiameterFrontLeft,
      setup.tireDiameterFrontRight,
      setup.tireDiameterRearLeft,
      setup.tireDiameterRearRight,
      { all: "diamAll", front: "diamFront", rear: "diamRear", fl: "diamFL", fr: "diamFR", rl: "diamRL", rr: "diamRR" },
      {
        all: "setupDetails.tireDiameterFront", front: "setupDetails.tireDiameterFront", rear: "setupDetails.tireDiameterRear",
        fl: "setupDetails.tireDiameterFL", fr: "setupDetails.tireDiameterFR", rl: "setupDetails.tireDiameterRL", rr: "setupDetails.tireDiameterRR",
      },
      unit,
      2,
    ),
  );

  return fields;
}

/** Diff `next` against `prev` — only changed/added/removed fields, in `next` order. */
export function diffRevisionFields(prev: SetupField[], next: SetupField[]): SetupFieldDiff[] {
  const prevMap = new Map(prev.map((f) => [f.key, f]));
  const nextMap = new Map(next.map((f) => [f.key, f]));
  const diffs: SetupFieldDiff[] = [];

  for (const n of next) {
    const p = prevMap.get(n.key);
    if (p && p.display === n.display) continue;
    let direction: SetupFieldDiff["direction"] = "neutral";
    if (p && p.isNumeric && n.isNumeric && typeof p.value === "number" && typeof n.value === "number") {
      direction = n.value > p.value ? "up" : n.value < p.value ? "down" : "neutral";
    }
    diffs.push({
      key: n.key,
      label: n.label,
      labelKey: n.labelKey,
      unit: n.unit,
      prevDisplay: p ? p.display : null,
      nextDisplay: n.display,
      direction,
      isNumeric: n.isNumeric,
    });
  }
  // Fields present before but gone now (removed).
  for (const p of prev) {
    if (nextMap.has(p.key)) continue;
    diffs.push({
      key: p.key,
      label: p.label,
      labelKey: p.labelKey,
      unit: p.unit,
      prevDisplay: p.display,
      nextDisplay: null,
      direction: "neutral",
      isNumeric: p.isNumeric,
    });
  }
  return diffs;
}

/** Convert one session's metadata into a `SetupUsage` (kart/course resolved). */
export function buildUsage(meta: FileMetadata, vehicles: Vehicle[]): SetupUsage {
  const vehicle = meta.sessionKartId ? vehicles.find((v) => v.id === meta.sessionKartId) : undefined;
  const trackName = meta.trackName || undefined;
  const courseName = meta.courseName || undefined;
  const courseKey = courseName ? `${trackName ?? ""}${COURSE_KEY_SEP}${courseName}` : undefined;
  const courseLabel = courseName
    ? trackName
      ? `${trackName} — ${courseName}`
      : courseName
    : undefined;
  return {
    fileName: meta.fileName,
    kartId: meta.sessionKartId,
    kartName: vehicle?.name,
    engine: meta.sessionEngine || vehicle?.engine || undefined,
    trackName,
    courseName,
    courseKey,
    courseLabel,
    fastestLapMs: meta.fastestLapMs,
    sessionStartTime: meta.sessionStartTime,
  };
}

/** Sort usages fastest lap first; sessions without a lap time sink to the bottom. */
export function byFastestLap(a: SetupUsage, b: SetupUsage): number {
  const av = a.fastestLapMs ?? Infinity;
  const bv = b.fastestLapMs ?? Infinity;
  if (av !== bv) return av - bv;
  return (a.sessionStartTime ?? 0) - (b.sessionStartTime ?? 0);
}

export function distinct<T>(values: (T | undefined)[]): T[] {
  return Array.from(new Set(values.filter((v): v is T => v !== undefined && v !== "")));
}

/** Build the full chronological history view-model for one setup. */
export function buildSetupHistory(input: BuildSetupHistoryInput): SetupHistory {
  const { setupId, setupName, revisions, metas, vehicles, filter } = input;

  const revs = revisions
    .filter((r) => r.setupId === setupId)
    .sort((a, b) => a.createdAt - b.createdAt);

  // Group every session by the revision it referenced.
  const usagesByRev = new Map<string, SetupUsage[]>();
  for (const meta of metas) {
    const revId = meta.sessionSetupRev;
    if (!revId) continue;
    if (!revs.some((r) => r.id === revId)) continue;
    const list = usagesByRev.get(revId) ?? [];
    list.push(buildUsage(meta, vehicles));
    usagesByRev.set(revId, list);
  }

  // Filter options span every (unfiltered) usage of this setup.
  const allUsages = Array.from(usagesByRev.values()).flat();
  const kartMap = new Map<string, string>();
  for (const u of allUsages) {
    if (u.kartId) kartMap.set(u.kartId, u.kartName ?? u.kartId);
  }
  const kartOptions = Array.from(kartMap, ([id, name]) => ({ id, name })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const courseMap = new Map<string, string>();
  for (const u of allUsages) {
    if (u.courseKey) courseMap.set(u.courseKey, u.courseLabel ?? u.courseKey);
  }
  const courseOptions = Array.from(courseMap, ([key, label]) => ({ key, label })).sort((a, b) =>
    a.label.localeCompare(b.label),
  );

  const matchesFilter = (u: SetupUsage): boolean => {
    if (filter?.kartId && u.kartId !== filter.kartId) return false;
    if (filter?.courseKey && u.courseKey !== filter.courseKey) return false;
    return true;
  };
  const filtering = !!(filter?.kartId || filter?.courseKey);

  // First pass: per-revision aggregation (still in chronological order).
  const built = revs
    .map((revision) => {
      const usages = (usagesByRev.get(revision.id) ?? [])
        .filter(matchesFilter)
        .sort(byFastestLap);
      const laps = usages.map((u) => u.fastestLapMs).filter((v): v is number => v !== undefined);
      const fastestLapMs = laps.length ? Math.min(...laps) : null;
      const fastestUsage = usages.find((u) => u.fastestLapMs !== undefined) ?? null;
      return {
        revision,
        fields: flattenRevisionFields(revision),
        usages,
        fastestLapMs,
        fastestUsage,
        karts: distinct(usages.map((u) => u.kartName)),
        courses: distinct(usages.map((u) => u.courseLabel)),
      };
    })
    // When filtering, only show revisions actually run under that filter.
    .filter((e) => !filtering || e.usages.length > 0);

  const overallFastestLapMs = built.reduce<number | null>((min, e) => {
    if (e.fastestLapMs === null) return min;
    return min === null ? e.fastestLapMs : Math.min(min, e.fastestLapMs);
  }, null);

  // Second pass: diff each displayed entry against the previous displayed one.
  const entries: SetupHistoryEntry[] = built.map((e, i) => ({
    ...e,
    diff: i === 0 ? null : diffRevisionFields(built[i - 1].fields, e.fields),
    isFastestOverall: overallFastestLapMs !== null && e.fastestLapMs === overallFastestLapMs,
  }));

  return { setupId, setupName, entries, kartOptions, courseOptions, overallFastestLapMs };
}
