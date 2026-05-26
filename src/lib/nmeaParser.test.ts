/**
 * Unit tests for the NMEA 0183 parser (`parseDatalog`).
 *
 * The NMEA parser is the fallback format and exports only `parseDatalog` (no
 * `isXxxFormat` — `datalogParser` routes to it when no other format matches).
 * Fields are TAB-separated (NMEA sentences use commas internally), so each
 * line is typically a single sentence in `fields[0]`. We test:
 *   - $GPRMC parsing → lat/lon/speed (knots)/heading/date
 *   - $GPGGA enrichment → Satellites / HDOP / Altitude
 *   - t=0 first sample, consistent speed triple, sane bounds
 *   - rejection of invalid-fix (status != 'A') and zero-coord sentences
 * It also exercises the real bundled sample for an end-to-end smoke test.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseDatalog } from "./nmeaParser";
import { KNOTS_TO_MPS, MPS_TO_MPH, MPS_TO_KPH } from "./parserUtils";

const SAMPLES_DIR = resolve(__dirname, "../../public/samples");

/**
 * Build a $GPRMC sentence. Position is near Orlando Kart Center.
 *   $GPRMC,hhmmss.ss,A,llll.ll,N,yyyyy.yy,W,knots,cog,ddmmyy,...,A
 */
function rmc(opts: {
  time?: string;
  lat?: string;
  latDir?: string;
  lon?: string;
  lonDir?: string;
  knots?: string;
  cog?: string;
  date?: string;
  status?: string;
}): string {
  return [
    "$GPRMC",
    opts.time ?? "170130.00",
    opts.status ?? "A",
    opts.lat ?? "2824.64918",
    opts.latDir ?? "N",
    opts.lon ?? "08122.75706",
    opts.lonDir ?? "W",
    opts.knots ?? "10.0",
    opts.cog ?? "90.0",
    opts.date ?? "231125",
    "",
    "",
    "A*65",
  ].join(",");
}

/** Build a $GPGGA sentence: time, lat, dir, lon, dir, fixQ, nsat, hdop, alt, M, ... */
function gga(opts: { time?: string; fixQ?: string; nsat?: string; hdop?: string; alt?: string }): string {
  return [
    "$GPGGA",
    opts.time ?? "170130.00",
    "2824.64924",
    "N",
    "08122.75702",
    "W",
    opts.fixQ ?? "1",
    opts.nsat ?? "8",
    opts.hdop ?? "1.2",
    opts.alt ?? "47.8",
    "M",
    "-29.2",
    "M",
    ",*5A",
  ].join(",");
}

// Expected decimal degrees for the default RMC position.
// 28 + 24.64918/60 ≈ 28.41082 ; -(81 + 22.75706/60) ≈ -81.37928
const EXPECTED_LAT = 28 + 24.64918 / 60;
const EXPECTED_LON = -(81 + 22.75706 / 60);

// ─── parseDatalog: synthetic RMC ──────────────────────────────────────────────

describe("parseDatalog (NMEA RMC)", () => {
  it("parses RMC sentences into samples with decimal-degree coords", () => {
    const content = [
      rmc({ time: "170130.00", lat: "2824.64918", lon: "08122.75706" }),
      rmc({ time: "170130.10", lat: "2824.64920", lon: "08122.75708" }),
      rmc({ time: "170130.20", lat: "2824.64922", lon: "08122.75710" }),
    ].join("\n");
    const parsed = parseDatalog(content);
    expect(parsed.samples).toHaveLength(3);
    expect(parsed.samples[0].lat).toBeCloseTo(EXPECTED_LAT, 4);
    expect(parsed.samples[0].lon).toBeCloseTo(EXPECTED_LON, 4);
  });

  it("makes the first sample t=0", () => {
    const content = [
      rmc({ time: "170130.00" }),
      rmc({ time: "170130.50", lat: "2824.64920" }),
    ].join("\n");
    const parsed = parseDatalog(content);
    expect(parsed.samples[0].t).toBe(0);
    // 0.5s later → 500 ms
    expect(parsed.samples[1].t).toBeCloseTo(500, 0);
  });

  it("converts knots to a consistent speed triple", () => {
    const content = [
      rmc({ time: "170130.00", knots: "20.0" }),
      rmc({ time: "170130.10", lat: "2824.64920", knots: "20.0" }),
    ].join("\n");
    const parsed = parseDatalog(content);
    const s = parsed.samples[0];
    expect(s.speedMps).toBeCloseTo(20 * KNOTS_TO_MPS, 5);
    expect(s.speedMph).toBeCloseTo(s.speedMps * MPS_TO_MPH, 5);
    expect(s.speedKph).toBeCloseTo(s.speedMps * MPS_TO_KPH, 5);
  });

  it("reads course-over-ground as heading (normalized to [0,360))", () => {
    const content = [
      rmc({ time: "170130.00", cog: "123.4" }),
      rmc({ time: "170130.10", lat: "2824.64920", cog: "124.0" }),
    ].join("\n");
    const parsed = parseDatalog(content);
    expect(parsed.samples[0].heading).toBeCloseTo(123.4, 4);
  });

  it("computes sane bounds", () => {
    const content = [
      rmc({ time: "170130.00", lat: "2824.64918", lon: "08122.75706" }),
      rmc({ time: "170130.10", lat: "2824.65000", lon: "08122.75800" }),
      rmc({ time: "170130.20", lat: "2824.64800", lon: "08122.75600" }),
    ].join("\n");
    const parsed = parseDatalog(content);
    expect(parsed.bounds.minLat).toBeGreaterThan(28);
    expect(parsed.bounds.maxLat).toBeLessThan(29);
    expect(parsed.bounds.minLon).toBeGreaterThan(-82);
    expect(parsed.bounds.maxLon).toBeLessThan(-81);
    expect(parsed.bounds.minLat).toBeLessThan(parsed.bounds.maxLat);
  });

  it("parses the NMEA date into startDate (2025-11-23)", () => {
    const content = [
      rmc({ time: "170130.00", date: "231125" }),
      rmc({ time: "170130.10", lat: "2824.64920", date: "231125" }),
    ].join("\n");
    const parsed = parseDatalog(content);
    expect(parsed.startDate).toBeInstanceOf(Date);
    expect(parsed.startDate!.getUTCFullYear()).toBe(2025);
    expect(parsed.startDate!.getUTCMonth() + 1).toBe(11);
    expect(parsed.startDate!.getUTCDate()).toBe(23);
  });

  it("preserves the raw NMEA sentence on each sample", () => {
    const content = [
      rmc({ time: "170130.00" }),
      rmc({ time: "170130.10", lat: "2824.64920" }),
    ].join("\n");
    const parsed = parseDatalog(content);
    expect(parsed.samples[0].rawNmea).toContain("$GPRMC");
  });

  it("adds GPS-derived Lat G / Lon G field mappings", () => {
    const content = [
      rmc({ time: "170130.00" }),
      rmc({ time: "170130.10", lat: "2824.64920" }),
    ].join("\n");
    const parsed = parseDatalog(content);
    const names = parsed.fieldMappings.map((m) => m.name);
    expect(names).toContain("Lat G");
    expect(names).toContain("Lon G");
  });

  it("enriches samples with GGA Satellites/HDOP/Altitude at matching times", () => {
    const content = [
      gga({ time: "170130.00", nsat: "9", hdop: "1.1", alt: "50.0" }),
      rmc({ time: "170130.00" }),
      rmc({ time: "170130.10", lat: "2824.64920" }),
    ].join("\n");
    const parsed = parseDatalog(content);
    const ex = parsed.samples[0].extraFields;
    expect(ex["Satellites"]).toBe(9);
    expect(ex["HDOP"]).toBeCloseTo(1.1, 4);
    expect(ex["Altitude (m)"]).toBeCloseTo(50.0, 4);
    const names = parsed.fieldMappings.map((m) => m.name);
    expect(names).toContain("Satellites");
  });

  it("skips RMC sentences with a non-valid fix status (not 'A')", () => {
    const content = [
      rmc({ time: "170130.00" }),
      rmc({ time: "170130.10", lat: "2824.64920", status: "V" }), // void fix → skipped
      rmc({ time: "170130.20", lat: "2824.64922" }),
    ].join("\n");
    const parsed = parseDatalog(content);
    expect(parsed.samples).toHaveLength(2);
  });

  it("skips RMC sentences with zero coordinates", () => {
    const content = [
      rmc({ time: "170130.00" }),
      rmc({ time: "170130.10", lat: "0000.00000", lon: "00000.00000" }), // lat parses to 0 → skipped
      rmc({ time: "170130.20", lat: "2824.64922" }),
    ].join("\n");
    const parsed = parseDatalog(content);
    expect(parsed.samples).toHaveLength(2);
  });

  it("throws on empty content", () => {
    expect(() => parseDatalog("")).toThrow();
  });

  it("throws when no valid GPS data is present", () => {
    // All void-fix sentences → no accepted samples
    const content = [
      rmc({ time: "170130.00", status: "V" }),
      rmc({ time: "170130.10", status: "V" }),
    ].join("\n");
    expect(() => parseDatalog(content)).toThrow(/No valid GPS data/);
  });
});

// ─── parseDatalog: real bundled sample smoke test ─────────────────────────────

describe("parseDatalog (real okc-tillotson-plain.nmea sample)", () => {
  it("parses the bundled NMEA file into a plausible session", () => {
    const content = readFileSync(resolve(SAMPLES_DIR, "okc-tillotson-plain.nmea"), "utf-8");
    const parsed = parseDatalog(content);
    expect(parsed.samples.length).toBeGreaterThan(1000);
    expect(parsed.samples[0].t).toBe(0);
    expect(parsed.bounds.minLat).toBeGreaterThan(28);
    expect(parsed.bounds.maxLat).toBeLessThan(29);
    expect(parsed.samples[0].rawNmea).toContain("$GPRMC");
    // time-ordered
    for (let i = 1; i < parsed.samples.length; i += 250) {
      expect(parsed.samples[i].t).toBeGreaterThanOrEqual(parsed.samples[i - 1].t);
    }
  });
});
