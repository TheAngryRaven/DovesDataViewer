import { describe, it, expect } from "vitest";
import { extractGpsPayload, parseGpmf, parseGpsu, readComplex, readNumbers, readString } from "./gpmf";
import { acclOnlyPayload, concat, gpmfComplex, gpmfNested, gpmfNumbers, gpmfString, gps5Payload, gps9Payload } from "./testFixtures";

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

describe("parseGpmf", () => {
  it("decodes KLV headers, 4-byte padding and nesting", () => {
    const bytes = concat([
      gpmfNumbers("GPSP", "S", [[150]]), // 2-byte payload → padded to 4
      gpmfNested("STRM", [gpmfNumbers("GPSF", "L", [[3]]), gpmfString("STNM", "GPS")]),
    ]);
    const items = parseGpmf(view(bytes));
    expect(items.map((i) => i.key)).toEqual(["GPSP", "STRM"]);
    expect(items[0]).toMatchObject({ type: "S".charCodeAt(0), structSize: 2, repeat: 1 });
    expect(items[1].type).toBe(0);
    expect(items[1].children?.map((i) => i.key)).toEqual(["GPSF", "STNM"]);
  });

  it("stops quietly at a truncated trailing item", () => {
    const bytes = concat([gpmfNumbers("GPSF", "L", [[3]]), gpmfNumbers("GPS5", "l", [[1, 2, 3, 4, 5]])]);
    const items = parseGpmf(view(bytes.slice(0, bytes.byteLength - 4)));
    expect(items.map((i) => i.key)).toEqual(["GPSF"]);
  });
});

describe("value readers", () => {
  it("reads row-major numeric records and every scalar width", () => {
    const item = parseGpmf(view(gpmfNumbers("GPS5", "l", [[1, -2, 3, 4, 5], [6, 7, 8, 9, 10]])))[0];
    expect(readNumbers(view(gpmfNumbers("GPS5", "l", [[1, -2, 3, 4, 5], [6, 7, 8, 9, 10]])), item))
      .toEqual([1, -2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const [type, value] of [["b", -5], ["B", 200], ["s", -300], ["S", 60000], ["L", 4000000000], ["f", 1.5], ["d", 2.25], ["j", -7], ["J", 7], ["q", 1.5], ["Q", -2.5]] as const) {
      const bytes = gpmfNumbers("TEST", type, [[value]]);
      expect(readNumbers(view(bytes), parseGpmf(view(bytes))[0])[0]).toBeCloseTo(value, 5);
    }
  });

  it("returns nothing for non-numeric items", () => {
    const bytes = gpmfString("STNM", "GPS");
    expect(readNumbers(view(bytes), parseGpmf(view(bytes))[0])).toEqual([]);
  });

  it("reads strings up to the first NUL", () => {
    const bytes = gpmfString("STNM", "GPS\0junk");
    expect(readString(view(bytes), parseGpmf(view(bytes))[0])).toBe("GPS");
  });

  it("decodes complex records via a TYPE string", () => {
    const bytes = gpmfComplex("GPS9", "lllllllSS", [[1, 2, 3, 4, 5, 8900, 52000123, 120, 3]]);
    expect(readComplex(view(bytes), parseGpmf(view(bytes))[0], "lllllllSS"))
      .toEqual([[1, 2, 3, 4, 5, 8900, 52000123, 120, 3]]);
  });

  it("rejects an unknown TYPE character", () => {
    const bytes = gpmfComplex("GPS9", "l", [[1]]);
    expect(() => readComplex(view(bytes), parseGpmf(view(bytes))[0], "x")).toThrow(/unsupported/);
  });

  it("rejects a TYPE wider than the record instead of reading the next one", () => {
    const bytes = gpmfComplex("GPS9", "l", [[1], [2]]);
    expect(() => readComplex(view(bytes), parseGpmf(view(bytes))[0], "ll")).toThrow(/exceeds/);
  });
});

describe("parseGpsu", () => {
  it("parses yymmddhhmmss.sss as UTC", () => {
    expect(parseGpsu("240615143025.500")).toBe(Date.UTC(2024, 5, 15, 14, 30, 25, 500));
  });
  it("tolerates a missing fraction and rejects garbage", () => {
    expect(parseGpsu("240615143025")).toBe(Date.UTC(2024, 5, 15, 14, 30, 25));
    expect(parseGpsu("241315143025.000")).toBeUndefined();
    expect(parseGpsu("")).toBeUndefined();
  });
});

describe("extractGpsPayload", () => {
  it("scales a GPS5 stream by SCAL and applies the payload-level fix/DOP/UTC", () => {
    const bytes = gps5Payload(
      [{ lat: 33.5312345, lon: -117.6987654, alt: 120.5, speed2d: 22.75 }, { lat: 33.5313, lon: -117.6988, alt: 121, speed2d: 23 }],
      { gpsu: "240615143025.500", fix: 3, dopx100: 180 },
    );
    const gps = extractGpsPayload(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(gps?.source).toBe("GPS5");
    expect(gps?.utcMs).toBe(Date.UTC(2024, 5, 15, 14, 30, 25, 500));
    expect(gps?.fixes).toHaveLength(2);
    expect(gps?.fixes[0].lat).toBeCloseTo(33.5312345, 7);
    expect(gps?.fixes[0].lon).toBeCloseTo(-117.6987654, 7);
    expect(gps?.fixes[0].altitudeM).toBeCloseTo(120.5, 3);
    expect(gps?.fixes[0].speedMps).toBeCloseTo(22.75, 3);
    expect(gps?.fixes[0]).toMatchObject({ fix: 3, dop: 1.8 });
    expect(gps?.fixes[0].utcMs).toBeUndefined();
  });

  it("treats a missing SCAL as unity", () => {
    const bytes = gps5Payload([{ lat: 1, lon: 2, alt: 3, speed2d: 4 }], { withScal: false });
    const gps = extractGpsPayload(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    // Raw int32 values (scaled up by the fixture) come back unscaled.
    expect(gps?.fixes[0].lat).toBe(10_000_000);
  });

  it("prefers GPS9 with per-sample time, DOP and fix", () => {
    const utc = Date.UTC(2024, 5, 15, 14, 30, 25, 500);
    const bytes = gps9Payload([
      { lat: 33.5, lon: -117.7, alt: 100, speed2d: 10, utcMs: utc, dop: 1.2, fix: 3 },
      { lat: 33.6, lon: -117.8, alt: 101, speed2d: 11, utcMs: utc + 100, dop: 9.9, fix: 0 },
    ]);
    const gps = extractGpsPayload(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(gps?.source).toBe("GPS9");
    expect(gps?.fixes[0]).toMatchObject({ fix: 3, utcMs: utc });
    expect(gps?.fixes[0].dop).toBeCloseTo(1.2, 5);
    expect(gps?.fixes[1]).toMatchObject({ fix: 0, utcMs: utc + 100 });
    expect(gps?.utcMs).toBe(utc);
  });

  it("returns null (skip) for a malformed GPS9 stream instead of throwing", () => {
    // Regression (A4): an unknown TYPE char used to throw out of the whole import.
    const bytes = gpmfNested("DEVC", [
      gpmfNested("STRM", [gpmfString("TYPE", "lllllllSx"), gpmfComplex("GPS9", "lllllllSS", [[1, 2, 3, 4, 5, 6, 7, 8, 3]])]),
    ]);
    expect(extractGpsPayload(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))).toBeNull();
  });

  it("falls back to GPS5 when the payload's GPS9 stream is malformed", () => {
    const gps5 = gps5Payload([{ lat: 33.5, lon: -117.7, alt: 1, speed2d: 1 }]);
    const bytes = concat([
      gpmfNested("DEVC", [
        gpmfNested("STRM", [gpmfString("TYPE", "x"), gpmfComplex("GPS9", "l", [[1]])]),
      ]),
      gps5,
    ]);
    const gps = extractGpsPayload(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(gps?.source).toBe("GPS5");
    expect(gps?.fixes[0].lat).toBeCloseTo(33.5, 6);
  });

  it("returns null for a payload without a GPS stream", () => {
    const bytes = acclOnlyPayload();
    expect(extractGpsPayload(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))).toBeNull();
    expect(extractGpsPayload(new ArrayBuffer(0))).toBeNull();
  });
});
