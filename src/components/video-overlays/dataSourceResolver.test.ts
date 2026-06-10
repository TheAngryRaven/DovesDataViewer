import { describe, it, expect } from "vitest";
import {
  buildDataSources,
  resolveValue,
  resolveRange,
  resolveUnit,
  resolveLabel,
} from "./dataSourceResolver";
import type { GpsSample, FieldMapping } from "@/types/racing";
import type { DataSourceDef } from "./types";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeSample(overrides: Partial<GpsSample> = {}): GpsSample {
  return {
    t: 0,
    lat: 0,
    lon: 0,
    speedMps: 10,
    speedMph: 22.3694,
    speedKph: 36,
    extraFields: {},
    ...overrides,
  };
}

const RPM_FIELD: FieldMapping = { index: 0, name: "rpm", label: "RPM", unit: "rpm", enabled: true };
const LATG_FIELD: FieldMapping = { index: 1, name: "lat_g", label: "Lat G", unit: "G", enabled: true };

// ─── buildDataSources ─────────────────────────────────────────────────────────

describe("buildDataSources", () => {
  it("always includes speed and brake % sources", () => {
    const sources = buildDataSources([], false, false);
    const ids = sources.map((s) => s.id);
    expect(ids).toContain("speed");
    expect(ids).toContain("__braking_g__");
  });

  it("labels speed by the active unit (MPH vs KPH)", () => {
    expect(buildDataSources([], false, false)[0].label).toBe("Speed (MPH)");
    expect(buildDataSources([], true, false)[0].unit).toBe("KPH");
  });

  it("omits the pace source when there is no reference lap", () => {
    const ids = buildDataSources([], false, false).map((s) => s.id);
    expect(ids).not.toContain("__pace__");
  });

  it("includes the pace source only when a reference exists", () => {
    const ids = buildDataSources([], false, true).map((s) => s.id);
    expect(ids).toContain("__pace__");
  });

  it("creates one source per field mapping with a composed label", () => {
    const sources = buildDataSources([RPM_FIELD], false, false);
    const rpm = sources.find((s) => s.id === "rpm")!;
    expect(rpm).toBeDefined();
    expect(rpm.label).toBe("RPM (rpm)");
    expect(rpm.unit).toBe("rpm");
  });

  it("speed source reads the right unit field from a sample", () => {
    const mph = buildDataSources([], false, false)[0];
    const kph = buildDataSources([], true, false)[0];
    const sample = makeSample({ speedMph: 50, speedKph: 80 });
    expect(mph.getValue(sample)).toBe(50);
    expect(kph.getValue(sample)).toBe(80);
  });

  it("speed getMin/getMax fall back to 0/100 on an empty sample set", () => {
    const speed = buildDataSources([], false, false)[0];
    expect(speed.getMin([])).toBe(0);
    expect(speed.getMax([])).toBe(100);
  });

  it("field source getValue returns null when the extraField is missing", () => {
    const rpm = buildDataSources([RPM_FIELD], false, false).find((s) => s.id === "rpm")!;
    expect(rpm.getValue(makeSample())).toBeNull();
    expect(rpm.getValue(makeSample({ extraFields: { rpm: 8000 } }))).toBe(8000);
  });

  it("field source getMin/getMax compute over present values, falling back to 0/100", () => {
    const rpm = buildDataSources([RPM_FIELD], false, false).find((s) => s.id === "rpm")!;
    const samples = [
      makeSample({ extraFields: { rpm: 5000 } }),
      makeSample({ extraFields: {} }), // skipped
      makeSample({ extraFields: { rpm: 9000 } }),
    ];
    expect(rpm.getMin(samples)).toBe(5000);
    expect(rpm.getMax(samples)).toBe(9000);
    expect(rpm.getMin([])).toBe(0);
    expect(rpm.getMax([])).toBe(100);
  });

  it("distance-family channels follow the distance unit toggle", () => {
    const DIST_FIELD: FieldMapping = { index: 2, name: "distance", label: "Distance", unit: "m", enabled: true };
    const sample = makeSample({ extraFields: { distance: 1000 } });

    // Imperial (default): meters → feet, unit + label switch to ft.
    const imperial = buildDataSources([DIST_FIELD], false, false, false).find((s) => s.id === "distance")!;
    expect(imperial.unit).toBe("ft");
    expect(imperial.label).toBe("Distance (ft)");
    expect(imperial.getValue(sample)).toBeCloseTo(3280.84, 1);
    expect(imperial.getMax([sample])).toBeCloseTo(3280.84, 1);

    // Metric: stays in meters.
    const metric = buildDataSources([DIST_FIELD], false, false, true).find((s) => s.id === "distance")!;
    expect(metric.unit).toBe("m");
    expect(metric.label).toBe("Distance (m)");
    expect(metric.getValue(sample)).toBe(1000);
  });
});

// ─── resolveValue ──────────────────────────────────────────────────────────────

describe("resolveValue", () => {
  const sources = buildDataSources([RPM_FIELD], false, true);

  it("resolves pace from paceData by index", () => {
    expect(resolveValue("__pace__", makeSample(), 1, sources, [0.1, -0.5, 0.3])).toBe(-0.5);
  });

  it("returns null for pace when the index has no value", () => {
    expect(resolveValue("__pace__", makeSample(), 5, sources, [0.1])).toBeNull();
  });

  it("resolves braking from brakingGData by index", () => {
    expect(resolveValue("__braking_g__", makeSample(), 2, sources, [], [0, 0, 75])).toBe(75);
  });

  it("returns null for braking when brakingGData is absent", () => {
    expect(resolveValue("__braking_g__", makeSample(), 0, sources, [])).toBeNull();
  });

  it("resolves a normal source via its getValue", () => {
    const sample = makeSample({ extraFields: { rpm: 7200 } });
    expect(resolveValue("rpm", sample, 0, sources, [])).toBe(7200);
  });

  it("returns null for an unknown source id", () => {
    expect(resolveValue("does_not_exist", makeSample(), 0, sources, [])).toBeNull();
  });

  it("falls back to the canonical key for a legacy display-name source id", () => {
    // "Lat G" is a legacy stored id; the source lives under canonical "lat_g".
    const s = buildDataSources([LATG_FIELD], false, false);
    const sample = makeSample({ extraFields: { lat_g: 0.8 } });
    expect(resolveValue("Lat G", sample, 0, s, [])).toBe(0.8);
  });
});

// ─── resolveRange ──────────────────────────────────────────────────────────────

describe("resolveRange", () => {
  const sources = buildDataSources([RPM_FIELD], false, true);

  it("returns a fixed 0-100 range for braking", () => {
    expect(resolveRange("__braking_g__", [], sources, [])).toEqual({ min: 0, max: 100 });
  });

  it("returns a symmetric range around zero for pace (min 0.5 magnitude)", () => {
    // All small values → clamped to ±0.5 minimum.
    expect(resolveRange("__pace__", [], sources, [0.1, -0.2])).toEqual({ min: -0.5, max: 0.5 });
    // Larger spread expands symmetrically to the max magnitude.
    expect(resolveRange("__pace__", [], sources, [0.3, -1.4])).toEqual({ min: -1.4, max: 1.4 });
  });

  it("ignores nulls in the pace data", () => {
    expect(resolveRange("__pace__", [], sources, [null, 0.9, null])).toEqual({ min: -0.9, max: 0.9 });
  });

  it("delegates to a source's getMin/getMax for normal sources", () => {
    const samples = [
      makeSample({ extraFields: { rpm: 4000 } }),
      makeSample({ extraFields: { rpm: 10000 } }),
    ];
    expect(resolveRange("rpm", samples, sources, [])).toEqual({ min: 4000, max: 10000 });
  });

  it("returns a default 0-100 range for an unknown source", () => {
    expect(resolveRange("nope", [], sources, [])).toEqual({ min: 0, max: 100 });
  });
});

// ─── resolveUnit & resolveLabel ──────────────────────────────────────────────

describe("resolveUnit", () => {
  const sources = buildDataSources([RPM_FIELD], false, false);

  it("returns the unit for a known source", () => {
    expect(resolveUnit("rpm", sources)).toBe("rpm");
    expect(resolveUnit("speed", sources)).toBe("MPH");
  });

  it("returns an empty string for an unknown source", () => {
    expect(resolveUnit("ghost", sources)).toBe("");
  });
});

describe("resolveLabel", () => {
  const sources = buildDataSources([RPM_FIELD], false, false);

  it("returns the composed label for a known source", () => {
    expect(resolveLabel("rpm", sources)).toBe("RPM (rpm)");
  });

  it("falls back to the source id itself when unknown", () => {
    expect(resolveLabel("unknownId", sources)).toBe("unknownId");
  });
});
