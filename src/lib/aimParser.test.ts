/**
 * Unit tests for the AiM MyChron CSV parser.
 *
 * AiM exports use channel names like GPS_Speed / GPS_Lat / GPS_Long / Acc_Lat.
 * Detection needs 2+ AiM-specific channel names in the first lines. Time is
 * seconds (auto-scaled to ms); speed >50 in the first row is treated as km/h.
 */

import { describe, it, expect } from "vitest";
import { isAimFormat, parseAimFile } from "./aimParser";

// ─── Synthetic fixtures ─────────────────────────────────────────────────────

/** Valid AiM CSV: header with AiM channels + N data rows. */
function makeAimCsv(rows = 4): string {
  const header = "Time,GPS_Speed,GPS_Lat,GPS_Long,GPS_Heading,Acc_Lat,Acc_Long,RPM";
  const lines = [header];
  for (let i = 0; i < rows; i++) {
    const time = (i * 0.1).toFixed(1); // seconds
    const speed = (60 + i).toString(); // km/h (>50 → detected as km/h)
    const lat = "28.401";
    const lon = (-81.401 + i * 0.00001).toFixed(6);
    lines.push([time, speed, lat, lon, "90", "0.5", "0.3", "5000"].join(","));
  }
  return lines.join("\n");
}

// ─── isAimFormat ────────────────────────────────────────────────────────────

describe("isAimFormat", () => {
  it("accepts a CSV with 2+ AiM channel headers", () => {
    expect(isAimFormat(makeAimCsv())).toBe(true);
  });

  it("rejects content with fewer than 2 lines", () => {
    expect(isAimFormat("GPS_Speed,GPS_Lat")).toBe(false);
  });

  it("rejects a single AiM channel (needs 2+ indicators)", () => {
    expect(isAimFormat("time,gps_speed,foo\n0,60,1")).toBe(false);
  });

  it("rejects random text", () => {
    expect(isAimFormat("nothing\nrelevant here")).toBe(false);
  });
});

// ─── parseAimFile ───────────────────────────────────────────────────────────

describe("parseAimFile", () => {
  it("parses all valid rows into samples", () => {
    const parsed = parseAimFile(makeAimCsv(4));
    expect(parsed.samples).toHaveLength(4);
  });

  it("makes the first sample t=0 and scales seconds→ms", () => {
    const parsed = parseAimFile(makeAimCsv(4));
    expect(parsed.samples[0].t).toBe(0);
    expect(parsed.samples[1].t).toBeCloseTo(100, 5);
  });

  it("derives a consistent speed triple and treats >50 as km/h", () => {
    const parsed = parseAimFile(makeAimCsv(4));
    const s = parsed.samples[0];
    expect(s.speedMph).toBeCloseTo(s.speedMps * 2.23694, 4);
    expect(s.speedKph).toBeCloseTo(s.speedMps * 3.6, 4);
    // 60 km/h → m/s
    expect(s.speedMps).toBeCloseTo(60 / 3.6, 5);
  });

  it("computes sane bounds", () => {
    const parsed = parseAimFile(makeAimCsv(4));
    expect(parsed.bounds.minLat).toBeCloseTo(28.401, 5);
    expect(parsed.bounds.minLon).toBeLessThan(parsed.bounds.maxLon);
  });

  it("reads heading from GPS_Heading", () => {
    const parsed = parseAimFile(makeAimCsv(4));
    expect(parsed.samples[0].heading).toBe(90);
  });

  it("populates native G + RPM extra fields and builds mappings", () => {
    const parsed = parseAimFile(makeAimCsv(4));
    const ef = parsed.samples[0].extraFields;
    expect(ef["RPM"]).toBe(5000);
    expect(ef["Lat G"]).toBeDefined();
    expect(ef["Lon G"]).toBeDefined();
    const names = parsed.fieldMappings.map((m) => m.name);
    expect(names).toContain("Lat G");
    expect(names).toContain("RPM");
  });

  it("skips rows with invalid coordinates", () => {
    const lines = [
      "Time,GPS_Speed,GPS_Lat,GPS_Long",
      "0.0,60,28.401,-81.401",
      "0.1,61,0,0", // (0,0) → skipped
      "0.2,62,28.40101,-81.40101", // close enough to pass teleportation filter
    ];
    const parsed = parseAimFile(lines.join("\n"));
    expect(parsed.samples).toHaveLength(2);
  });

  it("throws when no AiM header row can be found", () => {
    expect(() => parseAimFile("just\nrandom\ntext lines")).toThrow();
  });
});
