import { describe, it, expect } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatNumber,
  formatList,
  formatDecimal,
  formatInteger,
  formatSignedDelta,
} from "./format";

// A fixed instant: 2026-02-12T16:15:00Z. Assertions check locale-specific
// separators/ordering rather than exact wording, which can vary by ICU version.
const INSTANT = Date.UTC(2026, 1, 12, 16, 15, 0);

describe("format: numbers", () => {
  it("uses locale-aware grouping and decimal separators", () => {
    expect(formatNumber(1234567.89, "en-US")).toBe("1,234,567.89");
    // German swaps grouping (.) and decimal (,) separators.
    expect(formatNumber(1234567.89, "de-DE")).toBe("1.234.567,89");
  });

  it("honours NumberFormat options", () => {
    expect(formatNumber(0.5, "en-US", { style: "percent" })).toBe("50%");
  });

  it("formats fixed-fraction decimals with the locale separator", () => {
    expect(formatDecimal(2, "en", 1)).toBe("2.0");
    expect(formatDecimal(2, "de", 1)).toBe("2,0");
    expect(formatDecimal(0.34, "en", 2)).toBe("0.34");
    expect(formatDecimal(0.34, "de", 2)).toBe("0,34");
  });

  it("formats grouped integers per locale", () => {
    expect(formatInteger(1200, "en")).toBe("1,200");
    expect(formatInteger(1200, "de")).toBe("1.200");
    expect(formatInteger(42, "fr")).toBe("42");
  });

  it("signs deltas: + on positive, - on negative, none on zero", () => {
    expect(formatSignedDelta(1, "en")).toBe("+1");
    expect(formatSignedDelta(-1, "en")).toBe("-1");
    expect(formatSignedDelta(0, "en")).toBe("0");
    expect(formatSignedDelta(0.25, "en")).toBe("+0.25");
    expect(formatSignedDelta(0.25, "de")).toBe("+0,25");
  });
});

describe("format: dates", () => {
  it("formats a date by locale", () => {
    const en = formatDate(INSTANT, "en-US", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" });
    expect(en).toBe("02/12/2026");
    const de = formatDate(INSTANT, "de-DE", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" });
    expect(de).toBe("12.02.2026");
  });

  it("formats date-time without throwing for each shipped locale", () => {
    for (const locale of ["en", "es", "fr", "de", "it", "pt-BR", "ja"]) {
      expect(typeof formatDateTime(INSTANT, locale, { timeZone: "UTC" })).toBe("string");
    }
  });
});

describe("format: lists", () => {
  it("joins with the locale conjunction", () => {
    expect(formatList(["a", "b", "c"], "en-US")).toBe("a, b, and c");
    // Single item is returned as-is.
    expect(formatList(["solo"], "en-US")).toBe("solo");
  });
});
