/**
 * Unit tests for the AiM MyChron CSV parser.
 *
 * AiM exports use channel names like GPS_Speed / GPS_Lat / GPS_Long / Acc_Lat.
 * Detection needs 2+ AiM-specific channel names in the first lines. Time is
 * seconds (auto-scaled to ms). The speed unit is decided once per file: an
 * explicit unit label (units row / header cell) wins, otherwise it's inferred
 * from the max speed across all rows — never from a single sample.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isAimFormat,
  hasAimSignature,
  parseAimFile,
  speedMultiplierFromUnitLabel,
  inferSpeedMultiplierFromMax,
} from "./aimParser";

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

  it("derives a consistent speed triple and infers km/h from the file's max speed", () => {
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

// ─── Speed-unit detection (regression for the single-sample heuristic) ───────
//
// The old code decided the unit from the FIRST GPS-valid row: a car rolling
// out of the pits at 1–29 km/h flipped the whole file to m/s, multiplying
// every speed by 3.6 (100 km/h → 224 mph). The unit is now an explicit label
// when present, else a statistic over all rows.

describe("parseAimFile — speed unit detection", () => {
  /** Header + optional units row + rows with the given raw speeds. */
  function aimWithSpeeds(speeds: number[], unitsRow?: string): string {
    const lines = ["Time,GPS_Speed,GPS_Lat,GPS_Long"];
    if (unitsRow) lines.push(unitsRow);
    speeds.forEach((speed, i) => {
      lines.push(
        `${(i * 0.1).toFixed(1)},${speed},28.401,${(-81.401 + i * 0.00001).toFixed(6)}`,
      );
    });
    return lines.join("\n");
  }

  it("does NOT flip to m/s when the first row is slow (pit roll-out, regression)", () => {
    // First GPS row at 5 km/h, session tops out at 105 km/h → km/h.
    const parsed = parseAimFile(aimWithSpeeds([5, 15, 80, 100, 105]));
    expect(parsed.samples[0].speedKph).toBeCloseTo(5, 4);
    expect(parsed.samples[4].speedKph).toBeCloseTo(105, 4);
  });

  it("honors an explicit m/s units row even with values that look like km/h", () => {
    const parsed = parseAimFile(aimWithSpeeds([45, 50, 55], "s,m/s,deg,deg"));
    expect(parsed.samples[0].speedMps).toBeCloseTo(45, 4);
  });

  it("honors an explicit mph units row", () => {
    const parsed = parseAimFile(aimWithSpeeds([60, 65, 70], "s,mph,deg,deg"));
    expect(parsed.samples[0].speedMph).toBeCloseTo(60, 3);
  });

  it("honors an explicit km/h units row", () => {
    const parsed = parseAimFile(aimWithSpeeds([20, 25, 30], "s,km/h,deg,deg"));
    // Without the label this slow file would be inferred as m/s.
    expect(parsed.samples[0].speedKph).toBeCloseTo(20, 4);
  });

  it("reads a bracketed unit from the header cell itself", () => {
    const lines = [
      "Time,GPS_Speed [m/s],GPS_Lat,GPS_Long",
      "0.0,50,28.401,-81.401000",
      "0.1,51,28.401,-81.400990",
    ];
    const parsed = parseAimFile(lines.join("\n"));
    expect(parsed.samples[0].speedMps).toBeCloseTo(50, 4);
  });

  it("infers m/s when the whole file never exceeds plausible m/s range", () => {
    // Max 25 raw — implausible as a 25 km/h top-speed session → m/s.
    const parsed = parseAimFile(aimWithSpeeds([10, 18, 25, 22]));
    expect(parsed.samples[0].speedMps).toBeCloseTo(10, 4);
  });
});

describe("speedMultiplierFromUnitLabel", () => {
  it("recognizes km/h variants", () => {
    expect(speedMultiplierFromUnitLabel("km/h")).toBeCloseTo(1 / 3.6, 6);
    expect(speedMultiplierFromUnitLabel("KPH")).toBeCloseTo(1 / 3.6, 6);
    expect(speedMultiplierFromUnitLabel("kmh")).toBeCloseTo(1 / 3.6, 6);
  });

  it("recognizes mph and m/s", () => {
    expect(speedMultiplierFromUnitLabel("mph")).toBeCloseTo(0.44704, 6);
    expect(speedMultiplierFromUnitLabel("m/s")).toBe(1);
    expect(speedMultiplierFromUnitLabel("mps")).toBe(1);
  });

  it("returns null for unknown or empty labels and plain numbers", () => {
    expect(speedMultiplierFromUnitLabel(undefined)).toBeNull();
    expect(speedMultiplierFromUnitLabel("")).toBeNull();
    expect(speedMultiplierFromUnitLabel("deg")).toBeNull();
    expect(speedMultiplierFromUnitLabel("60")).toBeNull();
  });
});

describe("inferSpeedMultiplierFromMax", () => {
  it("treats a fast session as km/h", () => {
    expect(inferSpeedMultiplierFromMax(105)).toBeCloseTo(1 / 3.6, 6);
  });

  it("treats an implausibly slow max as m/s", () => {
    expect(inferSpeedMultiplierFromMax(25)).toBe(1);
  });

  it("defaults to km/h when there is no speed at all", () => {
    expect(inferSpeedMultiplierFromMax(0)).toBeCloseTo(1 / 3.6, 6);
  });
});

// ─── Real RaceStudio 3 export (regression for the Alfano mis-route bug) ───────
//
// RS3 CSVs differ from the synthetic underscore fixtures above in three ways
// that all broke parsing: a literal "AiM CSV File" signature, *space*-delimited
// channel names ("GPS Speed", not "GPS_Speed"), and the channel header buried
// ~15 rows deep under the metadata preamble. Before the fix this file was
// neither detected nor parsed as AiM (and got claimed by Alfano, which then
// threw). Fixture is a trimmed real export supplied by the maintainer.

describe("real RaceStudio 3 CSV (space-delimited, deep header)", () => {
  const content = readFileSync(
    resolve(__dirname, "__fixtures__/racestudio3-aim.csv"),
    "utf-8",
  );

  it("carries the AiM CSV File signature", () => {
    expect(hasAimSignature(content)).toBe(true);
  });

  it("is detected as AiM format despite space-delimited channel names", () => {
    expect(isAimFormat(content)).toBe(true);
  });

  it("parses the deep channel header (row ~15) into real samples", () => {
    const parsed = parseAimFile(content);
    expect(parsed.samples.length).toBeGreaterThan(100);
    expect(parsed.samples[0].t).toBe(0);
  });

  it("decodes GPS position + speed from the space-delimited columns", () => {
    const parsed = parseAimFile(content);
    const s = parsed.samples[0];
    // Session was logged in Italy (≈45.5°N, 10.0°E).
    expect(s.lat).toBeCloseTo(45.5167, 3);
    expect(s.lon).toBeCloseTo(10.0052, 3);
    expect(s.speedMph).toBeCloseTo(s.speedMps * 2.23694, 3);
    // Unit comes from the RS3 units row ("s,km/h,..."): 49.0581 km/h raw.
    expect(s.speedKph).toBeCloseTo(49.0581, 2);
  });

  it("maps RS3 channels (Engine RPM, Water Temp, GPS Nsat) into extra fields", () => {
    const parsed = parseAimFile(content);
    const ef = parsed.samples[0].extraFields;
    expect(ef["RPM"]).toBeGreaterThan(0);
    expect(ef["Water Temp"]).toBeTypeOf("number");
    expect(ef["Satellites"]).toBeGreaterThan(0);
  });

  it("reads the session start date from the Date/Time metadata rows", () => {
    const parsed = parseAimFile(content);
    expect(parsed.startDate).toBeInstanceOf(Date);
    // Metadata: Date "Sunday, December 15, 2024", Time "1:34 PM".
    expect(parsed.startDate!.getFullYear()).toBe(2024);
    expect(parsed.startDate!.getMonth() + 1).toBe(12);
    expect(parsed.startDate!.getDate()).toBe(15);
  });
});

// ─── Start-date metadata parsing (weather + session naming depend on it) ──────

describe("parseAimFile — start date", () => {
  function aimWithMeta(dateRow: string, timeRow?: string): string {
    const lines = ["Format,AiM CSV File", dateRow];
    if (timeRow) lines.push(timeRow);
    lines.push("Time,GPS_Speed,GPS_Lat,GPS_Long");
    for (let i = 0; i < 3; i++) {
      lines.push(`${(i * 0.1).toFixed(1)},60,28.401,${(-81.401 + i * 0.00001).toFixed(6)}`);
    }
    return lines.join("\n");
  }

  it("combines the Date and Time metadata rows", () => {
    const parsed = parseAimFile(
      aimWithMeta('Date,"Sunday, December 15, 2024"', "Time,1:34 PM"),
    );
    expect(parsed.startDate).toBeInstanceOf(Date);
    expect(parsed.startDate!.getFullYear()).toBe(2024);
  });

  it("falls back to date-only when there is no Time row", () => {
    const parsed = parseAimFile(aimWithMeta('Date,"December 15, 2024"'));
    expect(parsed.startDate).toBeInstanceOf(Date);
    expect(parsed.startDate!.getDate()).toBe(15);
  });

  it("leaves startDate undefined (without breaking parsing) on an unparseable date", () => {
    const parsed = parseAimFile(aimWithMeta("Date,not-a-real-date"));
    expect(parsed.startDate).toBeUndefined();
    expect(parsed.samples.length).toBeGreaterThan(0); // still parses fine
  });

  it("leaves startDate undefined when no Date row is present", () => {
    const noDate = [
      "Format,AiM CSV File",
      "Time,GPS_Speed,GPS_Lat,GPS_Long",
      "0.0,60,28.401,-81.401",
      "0.1,61,28.40101,-81.40101",
    ].join("\n");
    expect(parseAimFile(noDate).startDate).toBeUndefined();
  });
});
