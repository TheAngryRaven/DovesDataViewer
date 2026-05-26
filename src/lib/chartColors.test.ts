import { describe, it, expect } from "vitest";
import { getChartColors, type ChartColorPalette } from "./chartColors";

// Pure theme-palette selector: getChartColors(isDark) returns a frozen-ish
// constant object — dark vs light. No DOM involved.

const KEYS: (keyof ChartColorPalette)[] = [
  "background",
  "grid",
  "axisText",
  "tooltipBg",
  "tooltipBorder",
  "scrubCursor",
  "zeroLine",
  "refLine",
  "deltaText",
];

describe("getChartColors", () => {
  it("returns a palette with every documented key for dark", () => {
    const p = getChartColors(true);
    for (const k of KEYS) {
      expect(typeof p[k]).toBe("string");
      expect(p[k].length).toBeGreaterThan(0);
    }
  });

  it("returns a palette with every documented key for light", () => {
    const p = getChartColors(false);
    for (const k of KEYS) {
      expect(typeof p[k]).toBe("string");
      expect(p[k].length).toBeGreaterThan(0);
    }
  });

  it("dark and light differ on every key (distinct themes)", () => {
    const dark = getChartColors(true);
    const light = getChartColors(false);
    for (const k of KEYS) {
      expect(dark[k]).not.toBe(light[k]);
    }
  });

  it("dark background is near-black, light background is white", () => {
    expect(getChartColors(true).background).toBe("hsl(220, 18%, 10%)");
    expect(getChartColors(false).background).toBe("hsl(0, 0%, 100%)");
  });

  it("returns the same constant reference across calls (no per-call alloc)", () => {
    expect(getChartColors(true)).toBe(getChartColors(true));
    expect(getChartColors(false)).toBe(getChartColors(false));
  });

  it("all color values are valid hsl/hsla strings", () => {
    for (const isDark of [true, false]) {
      const p = getChartColors(isDark);
      for (const k of KEYS) {
        expect(p[k]).toMatch(/^hsla?\(/);
      }
    }
  });
});
