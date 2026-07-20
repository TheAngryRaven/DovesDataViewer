/**
 * Unit tests for the simulator's lenient session loader.
 *
 * The sim file picker must accept any dove-family log — full metadata
 * preamble, blank-padded headerless, corrupted preamble, or a bare Dove CSV —
 * and hand back channel-normalized ParsedData (the sim playback layer reads
 * canonical channel ids like `rpm`/`satellites` from extraFields).
 */

import { describe, it, expect } from "vitest";
import { parseSimSession, SIM_SESSION_ACCEPT } from "./simSession";

// A Unix ms timestamp inside the Dove parser's accepted window (≈2021-03).
const T0 = 1_614_700_000_000;

/** Build a valid Dove CSV with N rows. */
function makeDoveCsv(rows = 4): string {
  const header = "timestamp,sats,hdop,lat,lng,speed_mph,heading_deg,rpm";
  const lines = [header];
  for (let i = 0; i < rows; i++) {
    const t = T0 + i * 100;
    lines.push(`${t},12,0.9,28.401,${-81.401 + i * 0.00001},${30 + i},90,5000`);
  }
  return lines.join("\n");
}

const FULL_PREAMBLE =
  "datetime,driver,course,short_name,best_lap_ms,optimal_ms\n" +
  "2024-03-15 14:30:00,Mike,Full CW,OKC,62345,61200\n" +
  "lap_times_ms\n65432,64321,62345\n";

describe("parseSimSession", () => {
  it("parses a full .dovex (metadata preamble + CSV)", () => {
    const parsed = parseSimSession(FULL_PREAMBLE + makeDoveCsv(5));
    expect(parsed.samples).toHaveLength(5);
    expect(parsed.dovexMetadata?.driver).toBe("Mike");
    expect(parsed.startDate?.getTime()).toBe(T0);
  });

  it("parses a headerless .dovex (blank-padded preamble, session never ended)", () => {
    const parsed = parseSimSession("\n".repeat(1024) + makeDoveCsv(4));
    expect(parsed.samples).toHaveLength(4);
    expect(parsed.dovexMetadata).toBeUndefined();
    expect(parsed.startDate?.getTime()).toBe(T0);
  });

  it("parses through a corrupted preamble glued to the CSV header row", () => {
    const parsed = parseSimSession("ÿþgarbage" + makeDoveCsv(4));
    expect(parsed.samples).toHaveLength(4);
    expect(parsed.dovexMetadata).toBeUndefined();
  });

  it("parses a bare Dove CSV (column headers only, no preamble)", () => {
    const parsed = parseSimSession(makeDoveCsv(3));
    expect(parsed.samples).toHaveLength(3);
    expect(parsed.dovexMetadata).toBeUndefined();
  });

  it("normalizes channels to canonical ids the sim playback reads", () => {
    const parsed = parseSimSession(makeDoveCsv(3));
    const f = parsed.samples[0].extraFields;
    expect(f["rpm"]).toBe(5000);
    expect(f["satellites"]).toBe(12);
    expect(f["hdop"]).toBeCloseTo(0.9);
  });

  it("throws when no embedded Dove CSV can be found", () => {
    expect(() => parseSimSession("not,a,dove\nfile,at,all\n".repeat(20)))
      .toThrow(/embedded Dove CSV/i);
  });
});

describe("SIM_SESSION_ACCEPT", () => {
  it("covers every dove-family extension", () => {
    expect(SIM_SESSION_ACCEPT.split(",")).toEqual([".dovex", ".dovep", ".dove"]);
  });
});
