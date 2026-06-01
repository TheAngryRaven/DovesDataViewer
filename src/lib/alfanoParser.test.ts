/**
 * Unit tests for the Alfano CSV parser.
 *
 * Alfano exports have a metadata preamble (Driver:, Track:, …) then a header
 * row with recognizable columns (gps_latitude, gps_longitude, gps_speed, …),
 * then data rows. Delimiter is comma or semicolon. Speed is km/h.
 */

import { describe, it, expect } from "vitest";
import { isAlfanoFormat, parseAlfanoFile } from "./alfanoParser";

// ─── Synthetic fixtures ─────────────────────────────────────────────────────

/** Valid Alfano CSV: metadata preamble + header + N rows, comma-delimited. */
function makeAlfanoCsv(rows = 4, delimiter = ","): string {
  const d = delimiter;
  const lines = [
    `Driver:${d}Test Driver`,
    `Track:${d}Orlando`,
    ["Time", "GPS_Latitude", "GPS_Longitude", "GPS_Speed", "GPS_Heading", "RPM", "LatAcc"].join(d),
  ];
  for (let i = 0; i < rows; i++) {
    const time = (i * 0.1).toFixed(1); // seconds
    const lat = "28.401";
    const lon = (-81.401 + i * 0.00001).toFixed(6);
    const speed = (50 + i).toString(); // km/h
    lines.push([time, lat, lon, speed, "90", "5000", "1.2"].join(d));
  }
  return lines.join("\n");
}

// ─── isAlfanoFormat ─────────────────────────────────────────────────────────

describe("isAlfanoFormat", () => {
  it("accepts a CSV with Alfano headers", () => {
    expect(isAlfanoFormat(makeAlfanoCsv())).toBe(true);
  });

  it("accepts a CSV detected purely by metadata preamble", () => {
    const csv = "Driver: Mike\nTrack: OKC\nsomecol,othercol\n1,2";
    expect(isAlfanoFormat(csv)).toBe(true);
  });

  it("rejects VBO format markers", () => {
    const csv = "[header]\ngps_speed gps_latitude\n[data]\n1 2";
    expect(isAlfanoFormat(csv)).toBe(false);
  });

  it("rejects random text without headers or metadata", () => {
    expect(isAlfanoFormat("hello world\nnothing to see")).toBe(false);
  });
});

// ─── parseAlfanoFile ────────────────────────────────────────────────────────

describe("parseAlfanoFile", () => {
  it("parses all valid rows into samples", () => {
    const parsed = parseAlfanoFile(makeAlfanoCsv(4));
    expect(parsed.samples).toHaveLength(4);
  });

  it("makes the first sample t=0 and converts seconds→ms", () => {
    const parsed = parseAlfanoFile(makeAlfanoCsv(4));
    expect(parsed.samples[0].t).toBe(0);
    // second row: 0.1s relative → 100 ms
    expect(parsed.samples[1].t).toBeCloseTo(100, 5);
  });

  it("derives a consistent speed triple from km/h", () => {
    const parsed = parseAlfanoFile(makeAlfanoCsv(4));
    const s = parsed.samples[0];
    expect(s.speedMph).toBeCloseTo(s.speedMps * 2.23694, 4);
    expect(s.speedKph).toBeCloseTo(s.speedMps * 3.6, 4);
    // 50 km/h → m/s
    expect(s.speedMps).toBeCloseTo(50 / 3.6, 5);
  });

  it("computes sane bounds", () => {
    const parsed = parseAlfanoFile(makeAlfanoCsv(4));
    expect(parsed.bounds.minLat).toBeCloseTo(28.401, 5);
    expect(parsed.bounds.minLon).toBeLessThan(parsed.bounds.maxLon);
  });

  it("reads heading from the GPS_Heading column", () => {
    const parsed = parseAlfanoFile(makeAlfanoCsv(4));
    expect(parsed.samples[0].heading).toBe(90);
  });

  it("populates native G + RPM extra fields and exposes mappings", () => {
    const parsed = parseAlfanoFile(makeAlfanoCsv(4));
    const ef = parsed.samples[0].extraFields;
    expect(ef["RPM"]).toBe(5000);
    expect(ef["Lat G (Native)"]).toBeDefined();
    const names = parsed.fieldMappings.map((m) => m.name);
    expect(names).toContain("Lat G");
    expect(names).toContain("Lon G");
    expect(names).toContain("RPM");
    expect(names).toContain("Lat G (Native)");
  });

  it("handles a semicolon-delimited export", () => {
    const parsed = parseAlfanoFile(makeAlfanoCsv(4, ";"));
    expect(parsed.samples).toHaveLength(4);
    expect(parsed.samples[0].speedMps).toBeCloseTo(50 / 3.6, 5);
  });

  it("skips rows with invalid coordinates", () => {
    const lines = [
      "Driver:,Test",
      "Time,GPS_Latitude,GPS_Longitude,GPS_Speed",
      "0.0,28.401,-81.401,50",
      "0.1,0,0,51", // (0,0) → skipped
      "0.2,28.402,-81.402,52",
    ];
    const parsed = parseAlfanoFile(lines.join("\n"));
    expect(parsed.samples).toHaveLength(2);
  });

  it("throws when no valid header row is found", () => {
    expect(() => parseAlfanoFile("just\nrandom\ntext")).toThrow();
  });
});
