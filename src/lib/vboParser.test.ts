/**
 * Unit tests for the VBO (Racelogic VBOX) parser.
 *
 * VBO files have [header] / [column names] / [data] sections. Data rows are
 * space-delimited. Velocity is km/h; time is hhmmss.sss or seconds-since-midnight.
 */

import { describe, it, expect } from "vitest";
import { isVboFormat, parseVboFile } from "./vboParser";

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
