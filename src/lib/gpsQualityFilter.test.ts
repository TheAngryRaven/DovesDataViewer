import { describe, it, expect, afterEach, vi } from "vitest";
import { filterGpsQuality, readHardcoreGpsFilteringSetting } from "./gpsQualityFilter";
import { speedTriple } from "./parserUtils";
import type { GpsSample, ParsedData, FieldMapping } from "@/types/racing";

// ~1 m of latitude in degrees
const M = 1 / 111195;

function makeSample(
  t: number,
  lat: number,
  lon: number,
  speedMps = 20,
  extraFields: Record<string, number> = {},
): GpsSample {
  return { t, lat, lon, ...speedTriple(speedMps), extraFields };
}

/** A straight 25Hz run of `n` samples moving ~1m per tick. */
function makeRun(n: number, extraForIndex?: (i: number) => Record<string, number>): GpsSample[] {
  return Array.from({ length: n }, (_, i) =>
    makeSample(i * 40, 40 + i * M, -74, 25, extraForIndex?.(i) ?? {}),
  );
}

function makeData(samples: GpsSample[], fieldMappings: FieldMapping[] = []): ParsedData {
  return {
    samples,
    fieldMappings,
    bounds: { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 },
    duration: samples.length > 0 ? samples[samples.length - 1].t : 0,
  };
}

const satMapping: FieldMapping = { index: 0, name: "satellites", enabled: true };

describe("filterGpsQuality — always-on quality gate", () => {
  it("returns the data unchanged when there are no quality channels and hardcore is off", () => {
    const data = makeData(makeRun(10));
    expect(filterGpsQuality(data)).toBe(data);
  });

  it("returns empty data unchanged", () => {
    const data = makeData([]);
    expect(filterGpsQuality(data)).toBe(data);
  });

  it("drops samples with impossible satellite counts (the Solo2 report values)", () => {
    const samples = makeRun(10, (i) => ({ satellites: i === 4 ? -1597.4 : 13 }));
    const out = filterGpsQuality(makeData(samples, [satMapping]));
    expect(out.samples).toHaveLength(9);
    expect(out.samples.every((s) => s.extraFields.satellites === 13)).toBe(true);
    expect(out.parserStats?.rejected.lowQuality).toBe(1);
  });

  it("drops weak fixes below the satellite threshold", () => {
    const samples = makeRun(10, (i) => ({ satellites: i < 3 ? 2 : 12 }));
    const out = filterGpsQuality(makeData(samples, [satMapping]));
    expect(out.samples).toHaveLength(7);
    expect(out.parserStats?.rejected.lowQuality).toBe(3);
  });

  it("converts position-accuracy units from the field mapping (AiM ships mm)", () => {
    const accMapping: FieldMapping = { index: 0, name: "h_acc", unit: "mm", enabled: true };
    // 1630mm = 1.63m (healthy), 50000mm = 50m (weak), -612100 (impossible)
    const accs = [1630, 1630, 50000, 1630, -612100, 1630];
    const samples = makeRun(6, (i) => ({ h_acc: accs[i] }));
    const out = filterGpsQuality(makeData(samples, [accMapping]));
    expect(out.samples).toHaveLength(4);
    expect(out.parserStats?.rejected.lowQuality).toBe(2);
  });

  it("reads pDOP through its custom channel key", () => {
    const dopMapping: FieldMapping = { index: 0, name: "custom:gps_pdop", enabled: true };
    const samples = makeRun(5, (i) => ({ "custom:gps_pdop": i === 2 ? 275.3 : 1.4 }));
    const out = filterGpsQuality(makeData(samples, [dopMapping]));
    expect(out.samples).toHaveLength(4);
    expect(out.parserStats?.rejected.lowQuality).toBe(1);
  });

  it("skips samples that lack the quality value instead of rejecting them", () => {
    const samples = makeRun(5, (i): Record<string, number> => (i === 2 ? { satellites: -5 } : {}));
    const out = filterGpsQuality(makeData(samples, [satMapping]));
    expect(out.samples).toHaveLength(4);
  });

  it("falls back to impossible-only rejection when the weak-fix thresholds would drop the whole session", () => {
    // A marginal logger: every fix is 25m accuracy (weak), one is provably garbage.
    const accMapping: FieldMapping = { index: 0, name: "h_acc", unit: "m", enabled: true };
    const samples = makeRun(10, (i) => ({ h_acc: i === 5 ? -3 : 25 }));
    const out = filterGpsQuality(makeData(samples, [accMapping]));
    expect(out.samples).toHaveLength(9); // weak fixes survive, garbage doesn't
    expect(out.parserStats?.rejected.lowQuality).toBe(1);
  });

  it("throws when every sample is provably invalid", () => {
    const samples = makeRun(5, () => ({ satellites: -1 }));
    expect(() => filterGpsQuality(makeData(samples, [satMapping]))).toThrow(/no usable fixes/i);
  });

  it("recomputes bounds and duration after dropping trailing samples", () => {
    const samples = makeRun(10, (i) => ({ satellites: i >= 8 ? -1 : 13 }));
    const out = filterGpsQuality(makeData(samples, [satMapping]));
    expect(out.samples).toHaveLength(8);
    expect(out.duration).toBe(7 * 40);
    expect(out.bounds.maxLat).toBeCloseTo(40 + 7 * M, 10);
  });

  it("merges into parser-emitted stats without losing the parser's counts", () => {
    const samples = makeRun(6, (i) => ({ satellites: i === 0 ? 1 : 13 }));
    const data = makeData(samples, [satMapping]);
    data.parserStats = {
      totalRows: 8, // parser saw 8 rows, already rejected 2 itself
      acceptedRows: 6,
      rejected: {
        nanFields: 2, zeroCoords: 0, outOfRange: 0,
        speedCap: 0, teleportation: 0, incompleteRow: 0, lowQuality: 0,
      },
    };
    const out = filterGpsQuality(data);
    expect(out.parserStats).toMatchObject({
      totalRows: 8,
      acceptedRows: 5,
      rejected: { nanFields: 2, lowQuality: 1 },
    });
  });
});

describe("filterGpsQuality — hardcore pass", () => {
  it("does not reject teleport spikes when hardcore is off", () => {
    const samples = makeRun(10);
    samples[5] = makeSample(5 * 40, 41, -74, 25); // ~111km spike
    const out = filterGpsQuality(makeData(samples));
    expect(out).toEqual(makeData(samples)); // untouched — no quality channels, no hardcore
  });

  it("rejects teleport spikes when hardcore is on", () => {
    const samples = makeRun(10);
    samples[5] = makeSample(5 * 40, 41, -74, 25);
    const out = filterGpsQuality(makeData(samples), { hardcore: true });
    expect(out.samples).toHaveLength(9);
    expect(out.parserStats?.rejected.teleportation).toBe(1);
    expect(out.samples.some((s) => s.lat > 40.5)).toBe(false);
  });

  it("repairs an errant reported speed from neighboring positions instead of dropping the packet", () => {
    const samples = makeRun(10);
    // 735 mph ≈ 328 m/s reported on a sample whose position is fine.
    samples[5] = makeSample(5 * 40, 40 + 5 * M, -74, 328);
    const out = filterGpsQuality(makeData(samples), { hardcore: true });
    expect(out.samples).toHaveLength(10); // packet retained
    const repaired = out.samples[5];
    // Neighbors are 2m apart over 80ms → 25 m/s
    expect(repaired.speedMps).toBeCloseTo(25, 0);
    expect(repaired.speedMph).toBeCloseTo(repaired.speedMps * 2.23694, 3);
    expect(out.parserStats?.repairedSpeeds).toBe(1);
  });

  it("repairs non-finite and negative speeds too", () => {
    const samples = makeRun(6);
    samples[2] = makeSample(2 * 40, 40 + 2 * M, -74, NaN);
    samples[3] = makeSample(3 * 40, 40 + 3 * M, -74, -12);
    const out = filterGpsQuality(makeData(samples), { hardcore: true });
    expect(out.samples).toHaveLength(6);
    expect(out.samples[2].speedMps).toBeGreaterThan(0);
    expect(out.samples[3].speedMps).toBeGreaterThan(0);
    expect(out.parserStats?.repairedSpeeds).toBe(2);
  });

  it("quality gate runs before the teleport gate so garbage never becomes the anchor", () => {
    // First sample is garbage-flagged; without ordering, it would anchor the
    // gate 11km from the real track and poison the run.
    const samples = [makeSample(0, 40.1, -74, 25, { satellites: -1 }), ...makeRun(9, () => ({ satellites: 13 }))];
    const out = filterGpsQuality(makeData(samples, [satMapping]), { hardcore: true });
    expect(out.samples).toHaveLength(9);
    expect(out.parserStats?.rejected.lowQuality).toBe(1);
    expect(out.parserStats?.rejected.teleportation).toBe(0);
  });
});

describe("readHardcoreGpsFilteringSetting", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns false when localStorage is unavailable (node/tests)", () => {
    expect(readHardcoreGpsFilteringSetting()).toBe(false);
  });

  it("reads the persisted setting", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    });
    expect(readHardcoreGpsFilteringSetting()).toBe(false);
    store.set("dove-dataviewer-settings", JSON.stringify({ hardcoreGpsFiltering: true }));
    expect(readHardcoreGpsFilteringSetting()).toBe(true);
    store.set("dove-dataviewer-settings", "not json");
    expect(readHardcoreGpsFilteringSetting()).toBe(false);
  });
});
