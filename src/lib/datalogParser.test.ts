/**
 * Regression tests against bundled sample data files.
 *
 * These don't assert exact byte-for-byte parser output (too brittle); instead
 * they pin down structural invariants — sample counts, bounds, field mappings,
 * metadata — so that a future refactor of any parser or shared helper can't
 * silently drop samples, mis-detect format, or break field naming.
 *
 * When updating these tests after intentional behavior changes: re-run the
 * file locally, log the new actual values, then update the expected ranges.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseDatalogContent } from "./datalogParser";
import { isDovexFormat, parseDovexFile } from "./dovexParser";
import { isDoveFormat } from "./doveParser";
import type { ParsedData } from "@/types/racing";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SAMPLES_DIR = resolve(__dirname, "../../public/samples");

function loadSample(filename: string): string {
  return readFileSync(resolve(SAMPLES_DIR, filename), "utf-8");
}

// ─── Dovex sample (OKC, CrimsonDoveKarting, 2026-04-04) ───────────────────────

describe("regression: okc-tillotson-data.dovex", () => {
  let content: string;
  let parsed: ParsedData;

  beforeAll(() => {
    content = loadSample("okc-tillotson-data.dovex");
    parsed = parseDatalogContent(content);
  });

  it("is detected as dovex format (not bare dove)", () => {
    expect(isDovexFormat(content)).toBe(true);
  });

  it("the embedded payload is also recognized as dove format", () => {
    // The dovex parser will strip the header and pass the rest to doveParser
    // — verify the embedded payload is a valid Dove CSV.
    const headerEnd = content.indexOf("timestamp");
    expect(headerEnd).toBeGreaterThan(0);
    expect(isDoveFormat(content.substring(headerEnd))).toBe(true);
  });

  it("produces a non-trivial number of samples", () => {
    // 13 laps * ~56s/lap * ~10Hz ≈ 7000 samples minimum expected
    expect(parsed.samples.length).toBeGreaterThan(5000);
    expect(parsed.samples.length).toBeLessThan(30000); // sanity ceiling
  });

  it("bounds are within Orlando Kart Center (OKC) region (≈28.4°N, -81.4°W)", () => {
    // OKC in this dataset = Orlando Kart Center, FL (not Oklahoma City)
    expect(parsed.bounds.minLat).toBeGreaterThan(28);
    expect(parsed.bounds.maxLat).toBeLessThan(29);
    expect(parsed.bounds.minLon).toBeGreaterThan(-82);
    expect(parsed.bounds.maxLon).toBeLessThan(-81);
  });

  it("first sample has t=0 (timestamps are relative to file start)", () => {
    expect(parsed.samples[0].t).toBe(0);
  });

  it("samples are strictly time-ordered", () => {
    for (let i = 1; i < parsed.samples.length; i++) {
      expect(parsed.samples[i].t).toBeGreaterThanOrEqual(parsed.samples[i - 1].t);
    }
  });

  it("speed triple is consistent (mph/kph derived from mps)", () => {
    const s = parsed.samples[parsed.samples.length / 2 | 0];
    expect(s.speedMph).toBeCloseTo(s.speedMps * 2.23694, 2);
    expect(s.speedKph).toBeCloseTo(s.speedMps * 3.6, 2);
  });

  it("speed values are within reasonable range (kart, < ~120 mph)", () => {
    const maxMph = Math.max(...parsed.samples.map((s) => s.speedMph));
    expect(maxMph).toBeGreaterThan(10); // moving
    expect(maxMph).toBeLessThan(120); // not impossible
  });

  it("startDate is set from the first timestamp", () => {
    expect(parsed.startDate).toBeInstanceOf(Date);
    expect(parsed.startDate!.getFullYear()).toBe(2026);
  });

  it("dovexMetadata is populated with header fields", () => {
    const meta = parsed.dovexMetadata!;
    expect(meta).toBeDefined();
    expect(meta.driver).toBe("CrimsonDoveKarting");
    expect(meta.course).toBe("Normal");
    expect(meta.shortName).toBe("OKC");
    expect(meta.datetime).toBe("2026-04-04 16:29:30");
  });

  it("dovexMetadata lap times have the expected 13 entries", () => {
    expect(parsed.dovexMetadata!.lapTimesMs).toHaveLength(13);
    // First lap from header: 58648 ms
    expect(parsed.dovexMetadata!.lapTimesMs![0]).toBe(58648);
    // Best lap declared in header should match min of lap times array
    const minLap = Math.min(...parsed.dovexMetadata!.lapTimesMs!);
    expect(parsed.dovexMetadata!.bestLapMs).toBe(minLap);
  });

  it("fieldMappings includes the GPS-derived G-forces", () => {
    const names = parsed.fieldMappings.map((m) => m.name);
    expect(names).toContain("Lat G");
    expect(names).toContain("Lon G");
  });

  it("parserStats reports the row breakdown", () => {
    expect(parsed.parserStats).toBeDefined();
    const stats = parsed.parserStats!;
    expect(stats.totalRows).toBeGreaterThan(0);
    expect(stats.acceptedRows).toBe(parsed.samples.length);
    // Sum of all rejections + accepted should equal total
    const sumRejected = Object.values(stats.rejected).reduce((a, b) => a + b, 0);
    expect(stats.acceptedRows + sumRejected).toBe(stats.totalRows);
  });

  it("parses to the same result via parseDovexFile directly", () => {
    const direct = parseDovexFile(content);
    expect(direct.samples.length).toBe(parsed.samples.length);
    expect(direct.bounds).toEqual(parsed.bounds);
    expect(direct.duration).toBe(parsed.duration);
  });
});

// ─── NMEA sample (Orlando area, 2025-11-23) ───────────────────────────────────

describe("regression: okc-tillotson-plain.nmea", () => {
  let content: string;
  let parsed: ParsedData;

  beforeAll(() => {
    content = loadSample("okc-tillotson-plain.nmea");
    parsed = parseDatalogContent(content);
  });

  it("falls through to NMEA parser (not detected as any binary/CSV format)", () => {
    // Other formats reject this file → parseDatalogContent falls back to parseDatalog
    expect(isDovexFormat(content)).toBe(false);
    expect(isDoveFormat(content)).toBe(false);
  });

  it("produces a non-trivial number of samples", () => {
    expect(parsed.samples.length).toBeGreaterThan(1000);
    expect(parsed.samples.length).toBeLessThan(30000);
  });

  it("bounds are within Orlando region (≈28.4°N, -81.4°W)", () => {
    expect(parsed.bounds.minLat).toBeGreaterThan(28);
    expect(parsed.bounds.maxLat).toBeLessThan(29);
    expect(parsed.bounds.minLon).toBeGreaterThan(-82);
    expect(parsed.bounds.maxLon).toBeLessThan(-81);
  });

  it("first sample has t=0", () => {
    expect(parsed.samples[0].t).toBe(0);
  });

  it("samples are time-ordered (monotonically non-decreasing)", () => {
    for (let i = 1; i < parsed.samples.length; i++) {
      expect(parsed.samples[i].t).toBeGreaterThanOrEqual(parsed.samples[i - 1].t);
    }
  });

  it("speed triple is consistent across samples", () => {
    for (let i = 0; i < parsed.samples.length; i += 500) {
      const s = parsed.samples[i];
      expect(s.speedMph).toBeCloseTo(s.speedMps * 2.23694, 2);
      expect(s.speedKph).toBeCloseTo(s.speedMps * 3.6, 2);
    }
  });

  it("speed range is plausible for kart data", () => {
    const speeds = parsed.samples.map((s) => s.speedMph);
    const maxMph = Math.max(...speeds);
    expect(maxMph).toBeGreaterThan(5);
    expect(maxMph).toBeLessThan(120);
  });

  it("startDate is parsed from the NMEA date field (2025-11-23)", () => {
    expect(parsed.startDate).toBeInstanceOf(Date);
    expect(parsed.startDate!.getUTCFullYear()).toBe(2025);
    expect(parsed.startDate!.getUTCMonth() + 1).toBe(11); // November
    expect(parsed.startDate!.getUTCDate()).toBe(23);
  });

  it("fieldMappings includes GPS-derived G-forces (added by parser)", () => {
    const names = parsed.fieldMappings.map((m) => m.name);
    expect(names).toContain("Lat G");
    expect(names).toContain("Lon G");
  });

  it("populates Satellites/HDOP/Altitude from GGA sentences in extraFields", () => {
    // The NMEA fixture has interleaved $GPGGA sentences which provide these
    const anyWithSats = parsed.samples.find((s) => s.extraFields["Satellites"] !== undefined);
    expect(anyWithSats).toBeDefined();
    expect(anyWithSats!.extraFields["Satellites"]).toBeGreaterThan(0);
    expect(anyWithSats!.extraFields["Satellites"]).toBeLessThan(50);

    const anyWithAlt = parsed.samples.find((s) => s.extraFields["Altitude (m)"] !== undefined);
    expect(anyWithAlt).toBeDefined();
  });

  it("each sample has a heading in [0, 360) when present", () => {
    for (const s of parsed.samples) {
      if (s.heading !== undefined) {
        expect(s.heading).toBeGreaterThanOrEqual(0);
        expect(s.heading).toBeLessThan(360);
      }
    }
  });

  it("rawNmea field is preserved on each sample (NMEA-specific)", () => {
    expect(parsed.samples[0].rawNmea).toBeTruthy();
    expect(parsed.samples[0].rawNmea).toContain("$GPRMC");
  });
});
