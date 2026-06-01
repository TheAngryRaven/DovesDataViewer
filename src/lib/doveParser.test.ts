/**
 * Unit tests for the Dove CSV parser.
 *
 * Dove is a simple CSV: a header row (timestamp, lat, lng, speed_mph required)
 * followed by data rows. Timestamps are Unix ms in the 2020–2030 range.
 */

import { describe, it, expect } from "vitest";
import { isDoveFormat, parseDoveFile } from "./doveParser";

// ─── Synthetic fixtures ─────────────────────────────────────────────────────

// A Unix ms timestamp inside the accepted 1.5e12–2.0e12 window (≈2021-03).
const T0 = 1_614_700_000_000;

/** Build a valid Dove CSV with N rows around Orlando, moving slowly east. */
function makeDoveCsv(rows = 4): string {
  const header = "timestamp,sats,hdop,lat,lng,speed_mph,heading_deg,rpm";
  const lines = [header];
  for (let i = 0; i < rows; i++) {
    const t = T0 + i * 100; // 10 Hz
    const lat = 28.401;
    const lng = -81.401 + i * 0.00001;
    const speed = 30 + i;
    lines.push(`${t},12,0.9,${lat},${lng},${speed},90,5000`);
  }
  return lines.join("\n");
}

// ─── isDoveFormat ───────────────────────────────────────────────────────────

describe("isDoveFormat", () => {
  it("accepts a valid Dove CSV", () => {
    expect(isDoveFormat(makeDoveCsv())).toBe(true);
  });

  it("rejects content with fewer than 2 lines", () => {
    expect(isDoveFormat("timestamp,lat,lng,speed_mph")).toBe(false);
  });

  it("rejects when required headers are missing", () => {
    expect(isDoveFormat("foo,bar,baz\n1,2,3")).toBe(false);
  });

  it("rejects when the data row has no valid ms timestamp", () => {
    // Seconds, not ms — outside the 1.5e12–2.0e12 window
    const csv = "timestamp,lat,lng,speed_mph\n1614700000,28.4,-81.4,30";
    expect(isDoveFormat(csv)).toBe(false);
  });

  it("rejects VBO markers even with matching header words", () => {
    const csv = "[header]\ntimestamp lat lng speed_mph\n1614700000000,28.4,-81.4,30";
    expect(isDoveFormat(csv)).toBe(false);
  });

  it("rejects Alfano-style gps_latitude headers", () => {
    const csv = "gps_latitude,gps_longitude,timestamp,lat,lng,speed_mph\n1614700000000,a,b,28.4,-81.4,30";
    expect(isDoveFormat(csv)).toBe(false);
  });

  it("rejects random text", () => {
    expect(isDoveFormat("just some\nrandom text here")).toBe(false);
  });
});

// ─── parseDoveFile ──────────────────────────────────────────────────────────

describe("parseDoveFile", () => {
  it("parses all valid rows into samples", () => {
    const parsed = parseDoveFile(makeDoveCsv(4));
    expect(parsed.samples).toHaveLength(4);
  });

  it("makes the first sample t=0 (relative to file start)", () => {
    const parsed = parseDoveFile(makeDoveCsv(4));
    expect(parsed.samples[0].t).toBe(0);
    expect(parsed.samples[1].t).toBe(100);
  });

  it("derives a consistent speed triple from mph", () => {
    const parsed = parseDoveFile(makeDoveCsv(4));
    const s = parsed.samples[0];
    // 30 mph → mps; verify the three-unit relationship
    expect(s.speedMph).toBeCloseTo(s.speedMps * 2.23694, 4);
    expect(s.speedKph).toBeCloseTo(s.speedMps * 3.6, 4);
    expect(s.speedMps).toBeCloseTo(30 * 0.44704, 5);
  });

  it("computes sane bounds for the samples", () => {
    const parsed = parseDoveFile(makeDoveCsv(4));
    expect(parsed.bounds.minLat).toBeCloseTo(28.401, 5);
    expect(parsed.bounds.maxLat).toBeCloseTo(28.401, 5);
    expect(parsed.bounds.minLon).toBeLessThan(parsed.bounds.maxLon);
  });

  it("sets startDate and duration from timestamps", () => {
    const parsed = parseDoveFile(makeDoveCsv(4));
    expect(parsed.startDate).toBeInstanceOf(Date);
    expect(parsed.startDate!.getTime()).toBe(T0);
    expect(parsed.duration).toBe(300); // (4-1)*100
  });

  it("reads heading directly from the heading_deg column", () => {
    const parsed = parseDoveFile(makeDoveCsv(4));
    expect(parsed.samples[0].heading).toBe(90);
  });

  it("populates extra fields (Satellites, HDOP, RPM)", () => {
    const parsed = parseDoveFile(makeDoveCsv(4));
    const ef = parsed.samples[0].extraFields;
    expect(ef["Satellites"]).toBe(12);
    expect(ef["HDOP"]).toBeCloseTo(0.9, 5);
    expect(ef["RPM"]).toBe(5000);
  });

  it("always adds GPS-derived Lat G / Lon G field mappings", () => {
    const parsed = parseDoveFile(makeDoveCsv(4));
    const names = parsed.fieldMappings.map((m) => m.name);
    expect(names).toContain("Lat G");
    expect(names).toContain("Lon G");
  });

  it("counts a row with bad coords as a zeroCoords rejection", () => {
    const csv = [
      "timestamp,sats,hdop,lat,lng,speed_mph",
      `${T0},12,0.9,28.401,-81.401,30`,
      `${T0 + 100},12,0.9,0,0,31`, // (0,0) → zeroCoords
      `${T0 + 200},12,0.9,28.402,-81.402,32`,
    ].join("\n");
    const parsed = parseDoveFile(csv);
    expect(parsed.samples).toHaveLength(2);
    expect(parsed.parserStats!.totalRows).toBe(3);
    expect(parsed.parserStats!.acceptedRows).toBe(2);
    expect(parsed.parserStats!.rejected.zeroCoords).toBe(1);
  });

  it("counts a NaN-timestamp/speed row in the nanFields bucket", () => {
    const csv = [
      "timestamp,sats,hdop,lat,lng,speed_mph",
      `${T0},12,0.9,28.401,-81.401,30`,
      `${T0 + 100},12,0.9,28.402,-81.402,notanumber`, // NaN speed
    ].join("\n");
    const parsed = parseDoveFile(csv);
    expect(parsed.samples).toHaveLength(1);
    expect(parsed.parserStats!.rejected.nanFields).toBe(1);
  });

  it("throws when only a header is present", () => {
    expect(() => parseDoveFile("timestamp,lat,lng,speed_mph")).toThrow();
  });
});
