import { describe, it, expect, vi } from "vitest";
import { OVERLAY_TYPES, getOverlayTypeDef, generateOverlayId } from "./registry";
import type { OverlayType } from "./types";

const ALL_TYPES: OverlayType[] = [
  "digital",
  "analog",
  "graph",
  "bar",
  "bubble",
  "map",
  "pace",
  "sector",
  "laptime",
];

// ─── OVERLAY_TYPES catalog ──────────────────────────────────────────────────

describe("OVERLAY_TYPES", () => {
  it("defines every OverlayType exactly once", () => {
    const types = OVERLAY_TYPES.map((t) => t.type).sort();
    expect(types).toEqual([...ALL_TYPES].sort());
    expect(new Set(types).size).toBe(types.length); // no dupes
  });

  it("every def carries label, icon, and description strings", () => {
    for (const def of OVERLAY_TYPES) {
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.icon.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
    }
  });

  it("only bubble needs a secondary source (XY plot)", () => {
    const needsSecondary = OVERLAY_TYPES.filter((t) => t.needsSecondarySource).map((t) => t.type);
    expect(needsSecondary).toEqual(["bubble"]);
  });

  it("map/pace/sector/laptime are flagged special (no generic data source)", () => {
    const special = OVERLAY_TYPES.filter((t) => t.isSpecial).map((t) => t.type).sort();
    expect(special).toEqual(["laptime", "map", "pace", "sector"]);
  });

  it("digital/analog/bar are NOT special and need no secondary source", () => {
    for (const type of ["digital", "analog", "bar"] as const) {
      const def = getOverlayTypeDef(type)!;
      expect(def.isSpecial).toBeFalsy();
      expect(def.needsSecondarySource).toBeFalsy();
    }
  });

  it("graph defaults seed graphLength + color", () => {
    const graph = getOverlayTypeDef("graph")!;
    expect(graph.defaultConfig).toEqual({ graphLength: 100, color: "#00ccaa" });
  });

  it("sector defaults enable animation; laptime defaults disable pace mode", () => {
    expect(getOverlayTypeDef("sector")!.defaultConfig).toEqual({ showAnimation: true });
    expect(getOverlayTypeDef("laptime")!.defaultConfig).toEqual({ showPaceMode: false });
  });
});

// ─── getOverlayTypeDef ────────────────────────────────────────────────────────

describe("getOverlayTypeDef", () => {
  it("returns the matching def for every known type", () => {
    for (const type of ALL_TYPES) {
      expect(getOverlayTypeDef(type)?.type).toBe(type);
    }
  });

  it("returns undefined for an unknown type", () => {
    // Cast through unknown — exercising the runtime fallthrough, not the type system.
    expect(getOverlayTypeDef("nope" as unknown as OverlayType)).toBeUndefined();
  });
});

// ─── generateOverlayId ────────────────────────────────────────────────────────

describe("generateOverlayId", () => {
  it("is prefixed with 'ov-'", () => {
    expect(generateOverlayId()).toMatch(/^ov-/);
  });

  it("matches the ov-<base36time>-<4char> shape", () => {
    expect(generateOverlayId()).toMatch(/^ov-[0-9a-z]+-[0-9a-z]{1,4}$/);
  });

  it("varies the suffix with Math.random (deterministic, no birthday-paradox flake)", () => {
    // The id is `ov-<Date.now base36>-<4 base36 chars of Math.random>`. Pin both
    // sources so the test is deterministic: same timestamp, distinct random draws
    // → distinct suffixes → distinct ids. (A real 1000-call loop is flaky because
    // ~1.68M 4-char suffixes collide ~25% of the time within a single ms.)
    vi.spyOn(Date, "now").mockReturnValue(0);
    const rnd = vi.spyOn(Math, "random");
    rnd.mockReturnValueOnce(0.111111).mockReturnValueOnce(0.222222);
    const a = generateOverlayId();
    const b = generateOverlayId();
    vi.restoreAllMocks();
    expect(a).not.toBe(b);
    expect(a.startsWith("ov-0-")).toBe(true);
    expect(b.startsWith("ov-0-")).toBe(true);
  });

  it("changes the time segment as the clock advances", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    vi.spyOn(Math, "random").mockReturnValue(0.5); // hold suffix constant
    const first = generateOverlayId();
    now.mockReturnValue(2000);
    const second = generateOverlayId();
    vi.restoreAllMocks();
    expect(first).not.toBe(second);
  });
});
