import { describe, it, expect } from "vitest";
import type { Engine } from "./engineStorage";
import {
  normalizeEngineName,
  engineNameKey,
  findEngineByName,
  filterEngines,
  shouldOfferCreate,
  distinctEngineNames,
} from "./engineUtils";

const engine = (name: string): Engine => ({ id: name, name, createdAt: 0 });

describe("normalizeEngineName / engineNameKey", () => {
  it("trims the display name and lowercases the key", () => {
    expect(normalizeEngineName("  IAME X30  ")).toBe("IAME X30");
    expect(engineNameKey("  IAME X30  ")).toBe("iame x30");
  });
});

describe("findEngineByName", () => {
  const engines = [engine("IAME X30"), engine("Rotax Max")];

  it("matches case-insensitively and ignores surrounding whitespace", () => {
    expect(findEngineByName(engines, "  iame x30 ")?.name).toBe("IAME X30");
  });

  it("returns undefined for no match or empty query", () => {
    expect(findEngineByName(engines, "Briggs")).toBeUndefined();
    expect(findEngineByName(engines, "   ")).toBeUndefined();
  });
});

describe("filterEngines", () => {
  const engines = [engine("Rotax Max"), engine("IAME X30"), engine("IAME KA100")];

  it("returns all sorted by name when the query is empty", () => {
    expect(filterEngines(engines, "").map((e) => e.name)).toEqual([
      "IAME KA100",
      "IAME X30",
      "Rotax Max",
    ]);
  });

  it("filters by case-insensitive substring", () => {
    expect(filterEngines(engines, "iame").map((e) => e.name)).toEqual(["IAME KA100", "IAME X30"]);
  });
});

describe("shouldOfferCreate", () => {
  const engines = [engine("IAME X30")];

  it("offers create for a novel, non-empty name", () => {
    expect(shouldOfferCreate("Rotax", engines)).toBe(true);
  });

  it("does not offer create for an existing name (case-insensitive) or blank input", () => {
    expect(shouldOfferCreate(" iame x30 ", engines)).toBe(false);
    expect(shouldOfferCreate("   ", engines)).toBe(false);
  });
});

describe("distinctEngineNames", () => {
  it("dedupes case-insensitively, drops blanks, and keeps first-seen casing", () => {
    expect(distinctEngineNames(["IAME X30", "", "  iame x30 ", "Rotax", "rotax"])).toEqual([
      "IAME X30",
      "Rotax",
    ]);
  });
});
