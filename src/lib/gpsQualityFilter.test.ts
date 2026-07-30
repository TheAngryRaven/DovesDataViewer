import { describe, it, expect } from "vitest";
import { filterGpsQuality } from "./gpsQualityFilter";
import { speedTriple } from "./parserUtils";
import type { GpsSample, ParsedData, FieldMapping } from "@/types/racing";

// ~1 m of latitude in degrees
const M = 1 / 111195;

function makeSample(
  t: number,
  lat: number,
  lon: number,
  extraFields: Record<string, number> = {},
): GpsSample {
  return { t, lat, lon, ...speedTriple(25), extraFields };
}

/** A straight 25Hz run of `n` samples moving ~1m per tick. */
function makeRun(n: number, extraForIndex?: (i: number) => Record<string, number>): GpsSample[] {
  return Array.from({ length: n }, (_, i) =>
    makeSample(i * 40, 40 + i * M, -74, extraForIndex?.(i) ?? {}),
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

describe("filterGpsQuality", () => {
  it("returns the data unchanged when there are no quality channels", () => {
    const data = makeData(makeRun(10));
    expect(filterGpsQuality(data)).toBe(data);
  });

  it("returns empty data unchanged", () => {
    const data = makeData([]);
    expect(filterGpsQuality(data)).toBe(data);
  });

  it("returns the data unchanged when every row is clean", () => {
    const data = makeData(makeRun(10, () => ({ satellites: 13 })), [satMapping]);
    expect(filterGpsQuality(data)).toBe(data);
  });

  it("drops rows with negative satellite counts (the Solo2 report values)", () => {
    const samples = makeRun(10, (i) => ({ satellites: i === 4 ? -1597.4 : 13 }));
    const out = filterGpsQuality(makeData(samples, [satMapping]));
    expect(out.samples).toHaveLength(9);
    expect(out.samples.every((s) => s.extraFields.satellites === 13)).toBe(true);
    expect(out.parserStats?.rejected.lowQuality).toBe(1);
  });

  it("keeps low-but-possible satellite counts (only negative is provably invalid)", () => {
    const samples = makeRun(6, (i) => ({ satellites: i < 3 ? 2 : 12 }));
    const out = filterGpsQuality(makeData(samples, [satMapping]));
    expect(out.samples).toHaveLength(6);
  });

  it("drops rows with negative position accuracy through the canonical h_acc key", () => {
    const accMapping: FieldMapping = { index: 0, name: "h_acc", enabled: true };
    const samples = makeRun(6, (i) => ({ h_acc: i === 4 ? -612.1 : 1.63 }));
    const out = filterGpsQuality(makeData(samples, [accMapping]));
    expect(out.samples).toHaveLength(5);
    expect(out.parserStats?.rejected.lowQuality).toBe(1);
  });

  it("drops rows with DOP above 10 or negative, through the custom pDOP key", () => {
    const dopMapping: FieldMapping = { index: 0, name: "custom:gps_pdop", enabled: true };
    const dops = [1.4, 275.3, 1.4, -2, 1.4]; // the report's 275.3 + a negative artifact
    const samples = makeRun(5, (i) => ({ "custom:gps_pdop": dops[i] }));
    const out = filterGpsQuality(makeData(samples, [dopMapping]));
    expect(out.samples).toHaveLength(3);
    expect(out.parserStats?.rejected.lowQuality).toBe(2);
  });

  it("keeps rows that simply lack the quality value", () => {
    const samples = makeRun(5, (i): Record<string, number> => (i === 2 ? { satellites: -5 } : {}));
    const out = filterGpsQuality(makeData(samples, [satMapping]));
    expect(out.samples).toHaveLength(4);
  });

  it("keeps the raw data when every single row would be condemned (better shown than refused)", () => {
    const data = makeData(makeRun(5, () => ({ satellites: -1 })), [satMapping]);
    expect(filterGpsQuality(data)).toBe(data);
  });

  it("recomputes bounds and duration after dropping trailing rows", () => {
    const samples = makeRun(10, (i) => ({ satellites: i >= 8 ? -1 : 13 }));
    const out = filterGpsQuality(makeData(samples, [satMapping]));
    expect(out.samples).toHaveLength(8);
    expect(out.duration).toBe(7 * 40);
    expect(out.bounds.maxLat).toBeCloseTo(40 + 7 * M, 10);
  });

  it("merges into parser-emitted stats without losing the parser's counts", () => {
    const samples = makeRun(6, (i) => ({ satellites: i === 0 ? -1 : 13 }));
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
