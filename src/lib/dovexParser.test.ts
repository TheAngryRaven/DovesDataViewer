/**
 * Unit tests for the .dovex parser.
 *
 * .dovex = a session-metadata preamble (datetime/driver/course/laps) followed
 * by a standard embedded .dove CSV. The GPS payload must always parse even if
 * the metadata header is missing or corrupt, and the embedded CSV start is
 * discovered robustly (variable-length preamble, null-byte padding, and the
 * legacy fixed 8192-byte header).
 */

import { describe, it, expect } from "vitest";
import {
  isDovexFormat,
  isDovexFormatBuffer,
  parseDovexFile,
  parseRaceMode,
} from "./dovexParser";

// A Unix ms timestamp inside the Dove parser's accepted window (≈2021-03).
const T0 = 1_614_700_000_000;

/** Build a valid embedded Dove CSV with N rows. */
function makeDoveCsv(rows = 4): string {
  const header = "timestamp,sats,hdop,lat,lng,speed_mph,heading_deg,rpm";
  const lines = [header];
  for (let i = 0; i < rows; i++) {
    const t = T0 + i * 100;
    const lat = 28.401;
    const lng = -81.401 + i * 0.00001;
    lines.push(`${t},12,0.9,${lat},${lng},${30 + i},90,5000`);
  }
  return lines.join("\n");
}

/** Build a full .dovex payload: metadata preamble + embedded Dove CSV. */
function makeDovex(
  opts: {
    metaHeader?: string;
    metaValues?: string;
    lapHeader?: string;
    lapValues?: string;
    rows?: number;
  } = {}
): string {
  const {
    metaHeader = "datetime,driver,course,short_name,best_lap_ms,optimal_ms",
    metaValues = "2024-03-15 14:30:00,Mike,Full CW,OKC,62345,61200",
    lapHeader = "lap_times_ms",
    lapValues = "65432,64321,62345",
    rows = 4,
  } = opts;
  const preamble = [metaHeader, metaValues, lapHeader, lapValues].join("\n");
  return preamble + "\n" + makeDoveCsv(rows);
}

/**
 * Build a payload carrying the firmware's CURRENT eight-column metadata row —
 * `device_name` and `race_mode` appended after `optimal_ms`
 * (`BirdsEye/dovex_header.cpp`). `makeDovex` above keeps the six-column shape
 * older loggers wrote, so both generations stay covered.
 */
function makeDovexV2(
  opts: { deviceName?: string; raceMode?: string; lapValues?: string } = {}
): string {
  const { deviceName = "ApexTurbo", raceMode = "", lapValues } = opts;
  return makeDovex({
    metaHeader:
      "datetime,driver,course,short_name,best_lap_ms,optimal_ms,device_name,race_mode",
    metaValues: `2024-03-15 14:30:00,Mike,Cones AM,AX1,62345,61200,${deviceName},${raceMode}`,
    lapValues,
  });
}

// ─── isDovexFormat ──────────────────────────────────────────────────────────

describe("isDovexFormat", () => {
  it("accepts a well-formed .dovex payload", () => {
    expect(isDovexFormat(makeDovex())).toBe(true);
  });

  it("rejects content shorter than the 100-char minimum", () => {
    expect(isDovexFormat("datetime,driver,course\nx")).toBe(false);
  });

  it("rejects when the first line lacks the metadata signature words", () => {
    // No datetime/driver/course on line 1 — plain Dove, not Dovex
    expect(isDovexFormat(makeDoveCsv(20))).toBe(false);
  });

  it("accepts a headerless payload (newline padding, metadata never written)", () => {
    // Session not ended on the logger → the reserved preamble is pure newline
    // padding before a valid Dove CSV. Must still be detected as dovex.
    expect(isDovexFormat("\n".repeat(1024) + makeDoveCsv(4))).toBe(true);
  });

  it("accepts a headerless payload (null-byte padding, no newlines)", () => {
    expect(isDovexFormat("\u0000".repeat(1024) + makeDoveCsv(4))).toBe(true);
  });

  it("rejects a padded preamble containing non-padding garbage", () => {
    const content = "\n\nsome,unrelated,header\n1,2,3\n" + makeDoveCsv(4);
    expect(isDovexFormat(content)).toBe(false);
  });

  it("rejects a metadata header with no embedded Dove CSV", () => {
    const noCsv =
      "datetime,driver,course,short_name\n" +
      "2024-03-15,Mike,Full CW,OKC\n" +
      "lap_times_ms\n65432,64321\n" +
      "x".repeat(200);
    expect(isDovexFormat(noCsv)).toBe(false);
  });
});

describe("isDovexFormatBuffer", () => {
  it("decodes an ArrayBuffer and detects the format", () => {
    const buf = new TextEncoder().encode(makeDovex()).buffer;
    expect(isDovexFormatBuffer(buf)).toBe(true);
  });
});

// ─── parseDovexFile: GPS payload ────────────────────────────────────────────

describe("parseDovexFile — GPS payload", () => {
  it("parses the embedded Dove CSV into samples", () => {
    const parsed = parseDovexFile(makeDovex({ rows: 5 }));
    expect(parsed.samples).toHaveLength(5);
    expect(parsed.samples[0].t).toBe(0);
  });

  it("throws when no embedded Dove CSV can be found", () => {
    const garbage =
      "datetime,driver,course\n" + "not a dove csv\n".repeat(20);
    expect(() => parseDovexFile(garbage)).toThrow(/embedded Dove CSV/i);
  });

  it("strips null-byte padding before the embedded CSV", () => {
    const preamble =
      "datetime,driver,course,short_name\n2024-03-15,Mike,Full CW,OKC\n";
    // Pad with NULs between preamble and the CSV, as real .dovex files do.
    const content = preamble + "\u0000".repeat(50) + makeDoveCsv(3);
    const parsed = parseDovexFile(content);
    expect(parsed.samples).toHaveLength(3);
  });

  it("parses GPS even when the metadata preamble is degenerate (1 line)", () => {
    // Only the signature line, then the CSV — metadata can't be read but GPS must.
    const content = "datetime,driver,course,short_name\n" + makeDoveCsv(3);
    const parsed = parseDovexFile(content);
    expect(parsed.samples).toHaveLength(3);
    expect(parsed.dovexMetadata).toBeUndefined();
  });

  it("parses GPS when the header was never written (blank-padded preamble)", () => {
    const parsed = parseDovexFile("\n".repeat(1024) + makeDoveCsv(5));
    expect(parsed.samples).toHaveLength(5);
    expect(parsed.dovexMetadata).toBeUndefined();
  });

  it("parses GPS through a corrupted preamble (garbage lines before the CSV)", () => {
    // A partially-written header leaves junk instead of the metadata rows; the
    // embedded CSV must still be discovered by its own column-header line.
    const parsed = parseDovexFile("ÿþjunk,ÿ\nÿmore junk\n" + makeDoveCsv(4));
    expect(parsed.samples).toHaveLength(4);
    expect(parsed.dovexMetadata).toBeUndefined();
  });

  it("parses GPS when garbage butts against the CSV header with no newline", () => {
    // Worst case: corruption runs straight into "timestamp,..." on the same
    // line, so the CSV start is not a line start.
    const parsed = parseDovexFile("ÿÿÿgarbage" + makeDoveCsv(4));
    expect(parsed.samples).toHaveLength(4);
    expect(parsed.dovexMetadata).toBeUndefined();
  });

  it("parses a bare Dove CSV (no preamble at all) as a zero-length header", () => {
    const parsed = parseDovexFile(makeDoveCsv(3));
    expect(parsed.samples).toHaveLength(3);
    expect(parsed.dovexMetadata).toBeUndefined();
  });
});

// ─── parseDovexFile: metadata ───────────────────────────────────────────────

describe("parseDovexFile — metadata", () => {
  it("extracts session metadata fields", () => {
    const parsed = parseDovexFile(makeDovex());
    const m = parsed.dovexMetadata!;
    expect(m.datetime).toBe("2024-03-15 14:30:00");
    expect(m.driver).toBe("Mike");
    expect(m.course).toBe("Full CW");
    expect(m.shortName).toBe("OKC");
    expect(m.bestLapMs).toBe(62345);
    expect(m.optimalMs).toBe(61200);
  });

  it("parses lap times from line 4 (header + values layout)", () => {
    const parsed = parseDovexFile(makeDovex({ lapValues: "65432,64321,62345" }));
    expect(parsed.dovexMetadata!.lapTimesMs).toEqual([65432, 64321, 62345]);
  });

  it("drops non-positive / non-numeric lap times", () => {
    const parsed = parseDovexFile(
      makeDovex({ lapValues: "65432,0,-1,notalap,62345" })
    );
    expect(parsed.dovexMetadata!.lapTimesMs).toEqual([65432, 62345]);
  });

  it("ignores out-of-range best/optimal values gracefully", () => {
    const parsed = parseDovexFile(
      makeDovex({
        metaValues: "2024-03-15 14:30:00,Mike,Full CW,OKC,notanumber,",
      })
    );
    const m = parsed.dovexMetadata!;
    expect(m.bestLapMs).toBeUndefined();
    expect(m.optimalMs).toBeUndefined();
    // Other fields still come through.
    expect(m.driver).toBe("Mike");
  });
});

// ─── parseDovexFile: device_name + race_mode (trailing columns) ─────────────

describe("parseDovexFile — device_name / race_mode", () => {
  it("reads the trailing device_name and race_mode columns", () => {
    const m = parseDovexFile(makeDovexV2({ raceMode: "SPRINT" })).dovexMetadata!;
    expect(m.deviceName).toBe("ApexTurbo");
    expect(m.raceMode).toBe("sprint");
    // The columns before them are unaffected by the two extra fields.
    expect(m.shortName).toBe("AX1");
    expect(m.optimalMs).toBe(61200);
  });

  it("compares race_mode case-insensitively", () => {
    expect(parseDovexFile(makeDovexV2({ raceMode: "sprint" })).dovexMetadata!.raceMode).toBe("sprint");
    expect(parseDovexFile(makeDovexV2({ raceMode: "Circuit" })).dovexMetadata!.raceMode).toBe("circuit");
  });

  it("leaves race_mode undefined when the column is empty (circuit session)", () => {
    const m = parseDovexFile(makeDovexV2({ raceMode: "" })).dovexMetadata!;
    expect(m.raceMode).toBeUndefined();
    expect(m.deviceName).toBe("ApexTurbo");
  });

  it("leaves race_mode undefined for an unrecognized mode", () => {
    expect(parseDovexFile(makeDovexV2({ raceMode: "RALLY" })).dovexMetadata!.raceMode).toBeUndefined();
  });

  it("still parses a six-column log that predates both columns", () => {
    const m = parseDovexFile(makeDovex()).dovexMetadata!;
    expect(m.deviceName).toBeUndefined();
    expect(m.raceMode).toBeUndefined();
    expect(m.driver).toBe("Mike");
    expect(m.lapTimesMs).toEqual([65432, 64321, 62345]);
  });

  it("keeps reading the lap-times line after the widened metadata row", () => {
    const m = parseDovexFile(
      makeDovexV2({ raceMode: "SPRINT", lapValues: "45120,44980,44980" })
    ).dovexMetadata!;
    // Identical consecutive run times are normal in sprint — they must not dedupe.
    expect(m.lapTimesMs).toEqual([45120, 44980, 44980]);
  });
});

// ─── parseRaceMode ──────────────────────────────────────────────────────────

describe("parseRaceMode", () => {
  it.each(["SPRINT", "sprint", " Sprint "])("accepts %j as sprint", (raw) => {
    expect(parseRaceMode(raw)).toBe("sprint");
  });

  it.each(["CIRCUIT", "circuit"])("accepts %j as circuit", (raw) => {
    expect(parseRaceMode(raw)).toBe("circuit");
  });

  it.each([undefined, "", "   ", "rally", "1"])(
    "returns undefined for %j rather than defaulting to circuit",
    (raw) => {
      expect(parseRaceMode(raw)).toBeUndefined();
    }
  );
});

// ─── Legacy fixed 8192-byte header ──────────────────────────────────────────

describe("parseDovexFile — legacy 8192-byte header", () => {
  it("finds the embedded CSV after a fixed-size (8 KB) padded preamble", () => {
    const csv = makeDoveCsv(4);
    // Original .dovex files padded the metadata to exactly 8192 bytes before
    // the embedded Dove CSV. Verify that fixed-size layout still parses.
    const head = "datetime,driver,course,short_name\n2024-03-15,Mike,Full CW,OKC\n";
    const padded = head + "\u0000".repeat(8192 - head.length);
    expect(padded.length).toBe(8192);
    const content = padded + csv;
    const parsed = parseDovexFile(content);
    expect(parsed.samples).toHaveLength(4);
  });
});
