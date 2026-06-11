/**
 * Unit tests for the VBO (Racelogic VBOX) parser.
 *
 * VBO files have [header] / [column names] / [data] sections. Data rows are
 * space-delimited. Velocity is km/h. Per the Racelogic spec, time is UTC
 * packed HHMMSS.SS and coordinates are total decimal minutes with longitude
 * positive west; third-party exporters (RaceBox) write signed decimal degrees
 * instead, detected per file.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isVboFormat,
  parseVboFile,
  parseVboTime,
  detectVboCoordinateMode,
  vboCoordinateToDegrees,
} from "./vboParser";

// ─── Synthetic fixtures ─────────────────────────────────────────────────────

/** Valid VBO with named columns + N space-delimited data rows.
 *  Coordinates given as decimal degrees (|val| ≤ 180 → used directly). */
function makeVbo(rows = 4): string {
  const lines = [
    "[header]",
    "satellites",
    "time",
    "latitude",
    "longitude",
    "velocity",
    "heading",
    "height",
    "",
    "[column names]",
    "sats time lat long velocity heading height",
    "",
    "[data]",
  ];
  for (let i = 0; i < rows; i++) {
    // time as seconds-since-midnight (small → *1000)
    const time = (10 + i * 0.1).toFixed(2);
    const lat = "28.401";
    const lon = (-81.401 + i * 0.00001).toFixed(6);
    const vel = (50 + i).toString(); // km/h
    lines.push(`12 ${time} ${lat} ${lon} ${vel} 90 30.5`);
  }
  return lines.join("\n");
}

// ─── isVboFormat ────────────────────────────────────────────────────────────

describe("isVboFormat", () => {
  it("accepts content with [header]", () => {
    expect(isVboFormat("[header]\nsome stuff")).toBe(true);
  });

  it("accepts content with [column names]", () => {
    expect(isVboFormat("[column names]\nsats time")).toBe(true);
  });

  it("accepts content with [data]", () => {
    expect(isVboFormat("[data]\n1 2 3")).toBe(true);
  });

  it("accepts a full synthetic VBO", () => {
    expect(isVboFormat(makeVbo())).toBe(true);
  });

  it("rejects a plain CSV with no VBO sections", () => {
    expect(isVboFormat("timestamp,lat,lng,speed_mph\n1,2,3,4")).toBe(false);
  });

  it("rejects random text", () => {
    expect(isVboFormat("nothing relevant here")).toBe(false);
  });
});

// ─── parseVboFile ───────────────────────────────────────────────────────────

describe("parseVboFile", () => {
  it("parses all valid rows into samples", () => {
    const parsed = parseVboFile(makeVbo(4));
    expect(parsed.samples).toHaveLength(4);
  });

  it("makes the first sample t=0 and scales seconds→ms", () => {
    const parsed = parseVboFile(makeVbo(4));
    expect(parsed.samples[0].t).toBe(0);
    // 0.1s later → 100 ms
    expect(parsed.samples[1].t).toBeCloseTo(100, 3);
  });

  it("derives a consistent speed triple from km/h velocity", () => {
    const parsed = parseVboFile(makeVbo(4));
    const s = parsed.samples[0];
    expect(s.speedMph).toBeCloseTo(s.speedMps * 2.23694, 4);
    expect(s.speedKph).toBeCloseTo(s.speedMps * 3.6, 4);
    expect(s.speedMps).toBeCloseTo(50 / 3.6, 5);
  });

  it("reads decimal-degree coordinates directly", () => {
    const parsed = parseVboFile(makeVbo(4));
    expect(parsed.samples[0].lat).toBeCloseTo(28.401, 5);
    expect(parsed.samples[0].lon).toBeCloseTo(-81.401, 5);
  });

  it("computes sane bounds", () => {
    const parsed = parseVboFile(makeVbo(4));
    expect(parsed.bounds.minLat).toBeCloseTo(28.401, 5);
    expect(parsed.bounds.minLon).toBeLessThan(parsed.bounds.maxLon);
  });

  it("reads heading and altitude", () => {
    const parsed = parseVboFile(makeVbo(4));
    expect(parsed.samples[0].heading).toBe(90);
    expect(parsed.samples[0].extraFields["Altitude (m)"]).toBeCloseTo(30.5, 4);
  });

  it("always adds GPS-derived Lat G / Lon G mappings", () => {
    const parsed = parseVboFile(makeVbo(4));
    const names = parsed.fieldMappings.map((m) => m.name);
    expect(names).toContain("Lat G");
    expect(names).toContain("Lon G");
    expect(names).toContain("Satellites");
  });

  it("parses VBO with no [column names] using positional defaults", () => {
    // Standard VBOX positional order: sats time lat long velocity heading height
    const vbo = [
      "[data]",
      "12 10.00 28.401 -81.401 50 90 30",
      "12 10.10 28.401 -81.4011 51 90 30",
      "12 10.20 28.401 -81.4012 52 90 30",
    ].join("\n");
    const parsed = parseVboFile(vbo);
    expect(parsed.samples.length).toBeGreaterThanOrEqual(3);
    expect(parsed.samples[0].lat).toBeCloseTo(28.401, 5);
  });

  it("throws when there is no [data] section", () => {
    expect(() => parseVboFile("[header]\nsats time\n[column names]\nsats time")).toThrow();
  });
});

// ─── parseVboTime (UTC packed HHMMSS.SS) ────────────────────────────────────

describe("parseVboTime", () => {
  it("parses packed HHMMSS.SS by decimal-point alignment", () => {
    expect(parseVboTime("123456.789")).toBe((12 * 3600 + 34 * 60 + 56.789) * 1000);
  });

  it("parses a pre-10:00-UTC time as HHMMSS, not seconds since midnight", () => {
    // 09:55:59 UTC. The old magnitude-based branch read this as 95559 s.
    expect(parseVboTime("095559.00")).toBe((9 * 3600 + 55 * 60 + 59) * 1000);
  });

  it("is continuous across a minute boundary before 10:00 UTC (regression)", () => {
    // Old bug: 095559→095600 read as plain seconds injected ~40 phantom seconds.
    expect(parseVboTime("095600.00") - parseVboTime("095559.00")).toBe(1000);
  });

  it("parses 2-decimal values at/after 100000 correctly (regression)", () => {
    // Old bug: padStart(10) assumed 3 decimals, so "100000.00" mis-aligned to
    // 01:00:00 and time ran backwards, spuriously triggering the +24h patch.
    expect(parseVboTime("100000.00")).toBe(10 * 3600 * 1000);
    expect(parseVboTime("100000.00") - parseVboTime("095959.00")).toBe(1000);
  });

  it("keeps sub-minute values identical in both interpretations", () => {
    expect(parseVboTime("10.50")).toBe(10500);
    expect(parseVboTime("0.00")).toBe(0);
  });

  it("falls back to seconds-since-midnight when digits can't be HHMMSS", () => {
    // "86399" → minutes digit pair 63 — impossible as packed HHMMSS.
    expect(parseVboTime("86399.5")).toBe(86399500);
  });

  it("returns 0 for non-numeric input", () => {
    expect(parseVboTime("garbage")).toBe(0);
  });
});

// ─── Coordinate-mode detection + conversion ─────────────────────────────────

describe("detectVboCoordinateMode", () => {
  it("detects Racelogic decimal minutes when values exceed degree range", () => {
    const mode = detectVboCoordinateMode([
      { lat: "+03119.09973", lon: "+00063.00614" },
    ]);
    expect(mode).toBe("minutes");
  });

  it("detects signed decimal degrees (RaceBox-style)", () => {
    const mode = detectVboCoordinateMode([
      { lat: "28.401", lon: "-81.401" },
      { lat: "28.402", lon: "-81.402" },
    ]);
    expect(mode).toBe("degrees");
  });

  it("detects minutes from zero-padded fixed width even near the equator/meridian", () => {
    // 81.2' = 1.35°N, 31.1' = 0.52°W — numerically within degree range, but the
    // fixed-width zero padding is Racelogic's formatting.
    const mode = detectVboCoordinateMode([
      { lat: "+00081.23456", lon: "+00031.12345" },
    ]);
    expect(mode).toBe("minutes");
  });

  it("ignores garbage rows beyond plausible minutes range", () => {
    const mode = detectVboCoordinateMode([
      { lat: "28.401", lon: "-81.401" },
      { lat: "99999.9", lon: "-81.401" }, // glitch, not minutes evidence
    ]);
    expect(mode).toBe("degrees");
  });
});

describe("vboCoordinateToDegrees", () => {
  it("converts total decimal minutes to degrees", () => {
    expect(vboCoordinateToDegrees("+03119.09973", "minutes", "lat")).toBeCloseTo(51.9849955, 6);
  });

  it("negates longitude in minutes mode (Racelogic is positive-west)", () => {
    expect(vboCoordinateToDegrees("+00063.00614", "minutes", "lon")).toBeCloseTo(-1.05010233, 6);
    expect(vboCoordinateToDegrees("-00088.80000", "minutes", "lon")).toBeCloseTo(1.48, 6);
  });

  it("passes decimal degrees through unchanged, keeping the sign", () => {
    expect(vboCoordinateToDegrees("-81.401", "degrees", "lon")).toBeCloseTo(-81.401, 6);
    expect(vboCoordinateToDegrees("28.401", "degrees", "lat")).toBeCloseTo(28.401, 6);
  });

  it("returns NaN for unparseable values (rejected by coordinate validation)", () => {
    expect(Number.isNaN(vboCoordinateToDegrees("abc", "minutes", "lat"))).toBe(true);
  });
});

// ─── Real Racelogic-format fixture (regression for CR-1 / CR-2) ─────────────
//
// Standard Racelogic export: UTC HHMMSS.SS time with 2 decimals, total
// decimal-minutes coordinates, longitude positive west. The session starts
// before 10:00 UTC and crosses both a minute boundary and the 10:00:00
// boundary — exactly where the old magnitude/padStart time parsing corrupted
// lap timing — and its coordinates (51.985°N, 1.05°W) landed ~2,300 km off
// under the old DDDMM.MMMMM interpretation with no west-positive flip.

describe("Racelogic-format VBO fixture", () => {
  const content = readFileSync(resolve(__dirname, "__fixtures__/racelogic.vbo"), "utf-8");

  it("is detected as VBO format", () => {
    expect(isVboFormat(content)).toBe(true);
  });

  it("parses every data row", () => {
    expect(parseVboFile(content).samples).toHaveLength(6);
  });

  it("produces continuous, monotonic time across the 09:56 and 10:00 boundaries", () => {
    const ts = parseVboFile(content).samples.map((s) => s.t);
    // 09:55:58, :59, 09:56:00, 09:59:59, 10:00:00, 10:00:01 UTC
    expect(ts).toEqual([0, 1000, 2000, 241000, 242000, 243000]);
  });

  it("never triggers the midnight +24h patch (duration stays sane)", () => {
    expect(parseVboFile(content).duration).toBe(243000);
  });

  it("decodes decimal-minutes coordinates with west-positive longitude", () => {
    const s = parseVboFile(content).samples[0];
    expect(s.lat).toBeCloseTo(51.9849955, 5); // +03119.09973' N
    expect(s.lon).toBeCloseTo(-1.05010233, 5); // +00063.00614' → 1.05°W
  });

  it("reads velocity (km/h), heading, and height", () => {
    const s = parseVboFile(content).samples[0];
    expect(s.speedKph).toBeCloseTo(60.123, 3);
    expect(s.heading).toBeCloseTo(91.97, 2);
    expect(s.extraFields["Altitude (m)"]).toBeCloseTo(149.81, 2);
  });
});
