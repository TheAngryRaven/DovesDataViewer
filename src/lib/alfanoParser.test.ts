/**
 * Unit tests for the Alfano CSV parser.
 *
 * Alfano exports have a metadata preamble (Driver:, Track:, …) then a header
 * row with recognizable columns (gps_latitude, gps_longitude, gps_speed, …),
 * then data rows. Delimiter is comma or semicolon. Speed is km/h.
 */

import { describe, it, expect } from "vitest";
import {
  isAlfanoFormat,
  parseAlfanoFile,
  detectAlfanoTimeMultiplier,
  detectAlfanoDecimalComma,
  parseAlfanoNumber,
} from "./alfanoParser";

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

/**
 * Alfano 6 ADA-app "classic Excel" export (real-world layout, user-reported):
 * header row first (no metadata preamble), `;` delimiter, locale-grouped
 * numbers (`4,120` RPM), per-lap columns only on lap-start rows, `Time`
 * resetting to 0 every lap (only `Absolute Time` is monotonic), heading as
 * `Orientation` in hundredths of a degree, and a trailing empty field per row.
 */
const ADA_HEADER =
  "Lap;Time Lap;Strip;Time Strip;Absolute Time;Time;Distance;RPM;Speed GPS;" +
  "T1;T2;Gf. X;Gf. Y;Orientation;Speed rear;Lat.;Lon.;Altitude;UTC time : 144141.00";

function makeAdaExcelCsv(): string {
  return [
    ADA_HEADER,
    "1;87.43;1;20.81;0;0;0;4,120;52.6;0;0;0.02;-0.19;17,082;0;52.3017693;-106.6489868;515;",
    ";;;;0.01;0.01;0.15;4,173;52.7;0;0;0.02;-0.18;17,090.4;0;52.3017693;-106.6489868;515;",
    ";;;;0.02;0.02;0.29;4,231;52.7;0;0;0.02;-0.18;17,098.8;0;52.3017693;-106.6489868;515;",
    // Lap 2 starts: `Time` (col 5) resets to 0 while `Absolute Time` keeps going
    "2;60.69;1;20.43;0.03;0;0;4,586;56.7;0;0;0.02;-0.2;17,069;0;52.3017693;-106.6489944;514;",
    ";;;;0.04;0.01;0.2;4,600;56.8;0;0;0.02;-0.2;17,070;0;52.3017693;-106.6489944;514;",
    ";;;;0.05;0.02;0.4;4,610;56.9;0;0;0.02;-0.2;17,071;0;52.3017655;-106.6489944;514;",
    ";;;;;;;;;;;;;;;;;;", // trailing all-empty row (real exports end with one)
  ].join("\n");
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

  it("treats a millisecond time column uniformly (regression for the per-row heuristic)", () => {
    // Time in ms at 10 Hz starting from 0: every value below the old 100000
    // cutoff used to be multiplied by 1000, then collapse at 100 s — time ran
    // backwards and the midnight patch added a fake day. The unit must be
    // decided once per file.
    const lines = [
      "Driver:,Test",
      "Time,GPS_Latitude,GPS_Longitude,GPS_Speed",
    ];
    for (let i = 0; i < 5; i++) {
      lines.push(`${i * 100},28.401,${(-81.401 + i * 0.00001).toFixed(6)},50`);
    }
    const parsed = parseAlfanoFile(lines.join("\n"));
    expect(parsed.samples.map((s) => s.t)).toEqual([0, 100, 200, 300, 400]);
    expect(parsed.duration).toBe(400); // not 400,000 — and no +24 h patch
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

// ─── ADA "classic Excel" export (Alfano 6) ──────────────────────────────────

describe("parseAlfanoFile — ADA classic Excel export", () => {
  it("is detected as Alfano format", () => {
    expect(isAlfanoFormat(makeAdaExcelCsv())).toBe(true);
  });

  it("parses all data rows (regression: header used to be unrecognized → throw)", () => {
    const parsed = parseAlfanoFile(makeAdaExcelCsv());
    expect(parsed.samples).toHaveLength(6);
  });

  it("uses monotonic Absolute Time across the per-lap Time reset (no fake +24 h)", () => {
    const parsed = parseAlfanoFile(makeAdaExcelCsv());
    // Absolute Time is seconds at 100 Hz → 10 ms steps; the lap-2 rows where
    // `Time` resets to 0 must NOT run backwards or pick up the midnight patch.
    expect(parsed.samples.map((s) => s.t)).toEqual([0, 10, 20, 30, 40, 50]);
    expect(parsed.duration).toBe(50);
  });

  it("parses locale-grouped numbers (regression: `4,120` RPM parsed as 4)", () => {
    const parsed = parseAlfanoFile(makeAdaExcelCsv());
    expect(parsed.samples[0].extraFields["RPM"]).toBe(4120);
    expect(parsed.samples[3].extraFields["RPM"]).toBe(4586);
  });

  it("reads heading from centidegree Orientation", () => {
    const parsed = parseAlfanoFile(makeAdaExcelCsv());
    expect(parsed.samples[0].heading).toBeCloseTo(170.82, 5);
    expect(parsed.samples[1].heading).toBeCloseTo(170.904, 5);
  });

  it("maps Gf. X/Gf. Y to native lateral/longitudinal G", () => {
    const parsed = parseAlfanoFile(makeAdaExcelCsv());
    const ef = parsed.samples[0].extraFields;
    expect(ef["Lat G (Native)"]).toBeCloseTo(0.02, 5);
    expect(ef["Lon G (Native)"]).toBeCloseTo(-0.19, 5);
  });

  it("reads Speed GPS as km/h and Lat./Lon. coordinates", () => {
    const parsed = parseAlfanoFile(makeAdaExcelCsv());
    const s = parsed.samples[0];
    expect(s.speedMps).toBeCloseTo(52.6 / 3.6, 5);
    expect(s.lat).toBeCloseTo(52.3017693, 7);
    expect(s.lon).toBeCloseTo(-106.6489868, 7);
    expect(s.extraFields["Altitude (m)"]).toBe(515);
  });

  it("parses a comma-decimal (European locale) variant", () => {
    const csv = [
      ADA_HEADER,
      "1;87,43;1;20,81;0;0;0;4.120;52,6;0;0;0,02;-0,19;17.082;0;52,3017693;-106,6489868;515;",
      ";;;;0,01;0,01;0,15;4.173;52,7;0;0;0,02;-0,18;17.090,4;0;52,3017693;-106,6489868;515;",
      ";;;;0,02;0,02;0,29;4.231;52,7;0;0;0,02;-0,18;17.098,8;0;52,3017655;-106,6489868;515;",
    ].join("\n");
    const parsed = parseAlfanoFile(csv);
    expect(parsed.samples).toHaveLength(3);
    expect(parsed.samples[0].lat).toBeCloseTo(52.3017693, 7);
    expect(parsed.samples[0].lon).toBeCloseTo(-106.6489868, 7);
    expect(parsed.samples[0].speedMps).toBeCloseTo(52.6 / 3.6, 5);
    expect(parsed.samples[0].extraFields["RPM"]).toBe(4120);
    expect(parsed.samples[0].heading).toBeCloseTo(170.82, 5);
    expect(parsed.samples.map((s) => s.t)).toEqual([0, 10, 20]);
  });

  it("keeps a plain-degrees Orientation column unscaled", () => {
    const lines = [
      "Time;Orientation;Lat.;Lon.;Speed GPS",
      "0;170.8;52.3017693;-106.6489868;52.6",
      "0.01;171.2;52.3017693;-106.6489868;52.7",
    ];
    const parsed = parseAlfanoFile(lines.join("\n"));
    expect(parsed.samples[0].heading).toBeCloseTo(170.8, 5);
  });
});

// ─── detectAlfanoDecimalComma ───────────────────────────────────────────────

describe("detectAlfanoDecimalComma", () => {
  it("returns false for period-decimal files with comma grouping", () => {
    const lines = ["hdr", "1;4,120;52.6;52.3017693"];
    expect(detectAlfanoDecimalComma(lines, 1, ";")).toBe(false);
  });

  it("returns true for comma-decimal files with period grouping", () => {
    const lines = ["hdr", "1;4.120;52,6;52,3017693"];
    expect(detectAlfanoDecimalComma(lines, 1, ";")).toBe(true);
  });

  it("treats a mixed token's last separator as decisive", () => {
    expect(detectAlfanoDecimalComma(["hdr", "17,090.4"], 1, ";")).toBe(false);
    expect(detectAlfanoDecimalComma(["hdr", "17.090,4"], 1, ";")).toBe(true);
  });

  it("always returns false for comma-delimited files", () => {
    expect(detectAlfanoDecimalComma(["hdr", "1,2,3"], 1, ",")).toBe(false);
  });
});

// ─── parseAlfanoNumber ──────────────────────────────────────────────────────

describe("parseAlfanoNumber", () => {
  it("strips comma grouping in period-decimal mode", () => {
    expect(parseAlfanoNumber("4,120", false)).toBe(4120);
    expect(parseAlfanoNumber("17,090.4", false)).toBeCloseTo(17090.4, 5);
    expect(parseAlfanoNumber("52.6", false)).toBeCloseTo(52.6, 5);
  });

  it("strips period grouping and converts the comma decimal in comma-decimal mode", () => {
    expect(parseAlfanoNumber("4.120", true)).toBe(4120);
    expect(parseAlfanoNumber("17.090,4", true)).toBeCloseTo(17090.4, 5);
    expect(parseAlfanoNumber("52,6", true)).toBeCloseTo(52.6, 5);
  });

  it("returns NaN for empty or missing values", () => {
    expect(parseAlfanoNumber("", false)).toBeNaN();
    expect(parseAlfanoNumber(undefined, false)).toBeNaN();
  });
});

// ─── detectAlfanoTimeMultiplier ──────────────────────────────────────────────

describe("detectAlfanoTimeMultiplier", () => {
  it("detects seconds from sub-second row steps", () => {
    const values = Array.from({ length: 50 }, (_, i) => i * 0.1); // 10 Hz, seconds
    expect(detectAlfanoTimeMultiplier(values)).toBe(1000);
  });

  it("detects milliseconds from large values", () => {
    const values = Array.from({ length: 50 }, (_, i) => 3_600_000 + i * 100);
    expect(detectAlfanoTimeMultiplier(values)).toBe(1);
  });

  it("detects milliseconds from row steps even when all values are small", () => {
    // A short ms-based session (< 100 s): every value is below the old 100000
    // cutoff, but 100-unit steps at any sane log rate can only be ms.
    const values = Array.from({ length: 50 }, (_, i) => i * 100);
    expect(detectAlfanoTimeMultiplier(values)).toBe(1);
  });

  it("falls back to seconds for empty or constant columns", () => {
    expect(detectAlfanoTimeMultiplier([])).toBe(1000);
    expect(detectAlfanoTimeMultiplier([5, 5, 5])).toBe(1000);
  });
});
