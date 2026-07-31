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

  it("skips rows whose position implies an impossible jump — even with healthy-looking or missing quality values", () => {
    // The Solo2 failure mode: a garbage position row with NO quality data
    // recorded for it (or values inherited from a healthy packet). Position
    // is the only proof — ~11km from the previous row in 40ms.
    const samples = makeRun(10, () => ({ satellites: 13 }));
    samples[5] = makeSample(5 * 40, 40.1, -74, { satellites: 13 });
    const out = filterGpsQuality(makeData(samples, [satMapping]));
    expect(out.samples).toHaveLength(9);
    expect(out.samples.some((s) => s.lat > 40.05)).toBe(false);
    expect(out.parserStats?.rejected.teleportation).toBe(1);
    expect(out.parserStats?.rejected.lowQuality).toBe(0);
  });

  it("runs the jump check even when the file has no quality channels at all", () => {
    const samples = makeRun(10);
    samples[5] = makeSample(5 * 40, 40.1, -74);
    const out = filterGpsQuality(makeData(samples));
    expect(out.samples).toHaveLength(9);
    expect(out.parserStats?.rejected.teleportation).toBe(1);
  });

  it("does not judge the row after a skipped jump against the garbage point", () => {
    const samples = makeRun(10);
    samples[5] = makeSample(5 * 40, 40.1, -74); // spike out...
    // ...and the next row is back on track (1m from row 4's position). If the
    // spike had become the reference, this healthy row would be dropped too.
    const out = filterGpsQuality(makeData(samples));
    expect(out.samples).toHaveLength(9);
    expect(out.samples[5].lat).toBeCloseTo(40 + 6 * M, 10);
  });

  it("keeps a legitimate long move after a recording gap (trailer to the next session)", () => {
    const track1 = makeRun(5);
    // ~20km away, 10 minutes later: 33 m/s implied — real-world transport.
    const track2 = Array.from({ length: 5 }, (_, i) =>
      makeSample(600_000 + i * 40, 40.18 + i * M, -74),
    );
    const out = filterGpsQuality(makeData([...track1, ...track2]));
    expect(out.samples).toHaveLength(10);
  });

  it("re-anchors after a long rejection streak so a garbage first row can't condemn the file", () => {
    // First row is 11km from where the real session happens.
    const garbageFirst = makeSample(0, 40.1, -74);
    const real = Array.from({ length: 60 }, (_, i) =>
      makeSample((i + 1) * 40, 40 + i * M, -74),
    );
    const out = filterGpsQuality(makeData([garbageFirst, ...real]));
    // The garbage first row itself is kept (there is nothing to judge it
    // against yet), the next 50 real rows get rejected against it, then the
    // streak reset re-anchors and the rest of the session survives.
    expect(out.samples).toHaveLength(11);
    expect(out.samples.filter((s) => s.lat < 40.05)).toHaveLength(10);
    expect(out.parserStats?.rejected.teleportation).toBe(50);
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
