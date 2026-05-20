import { describe, it, expect, vi, afterEach } from "vitest";
import {
  clamp,
  normalizeHeadingDelta,
  normalizeHeading,
  haversineDistance,
  calculateBearing,
  isTeleportation,
  validateGpsCoords,
  parseCsvLine,
  detectDelimiter,
  normalizeAccelToG,
  calculateBounds,
  createRejectedCounter,
  recordCoordRejection,
  speedTriple,
  MPS_TO_MPH,
  MPS_TO_KPH,
  MPH_TO_MPS,
  KPH_TO_MPS,
  KNOTS_TO_MPS,
  MAX_SPEED_MPS,
  STANDARD_GRAVITY_MPS2,
} from "./parserUtils";
import type { GpsSample } from "@/types/racing";

// ─── Constants ────────────────────────────────────────────────────────────────

describe("constants", () => {
  it("MPH_TO_MPS round-trips with MPS_TO_MPH (within fp tolerance)", () => {
    expect(MPS_TO_MPH * MPH_TO_MPS).toBeCloseTo(1, 5);
  });

  it("KPH_TO_MPS round-trips with MPS_TO_KPH", () => {
    expect(MPS_TO_KPH * KPH_TO_MPS).toBeCloseTo(1, 10);
  });

  it("KNOTS_TO_MPS matches 1 knot = 0.514444 m/s", () => {
    expect(KNOTS_TO_MPS).toBeCloseTo(0.514444, 6);
  });

  it("MAX_SPEED_MPS is 150 (~335 mph)", () => {
    expect(MAX_SPEED_MPS).toBe(150);
    expect(MAX_SPEED_MPS * MPS_TO_MPH).toBeCloseTo(335.5, 0);
  });

  it("STANDARD_GRAVITY_MPS2 is 9.80665", () => {
    expect(STANDARD_GRAVITY_MPS2).toBe(9.80665);
  });
});

// ─── speedTriple ──────────────────────────────────────────────────────────────

describe("speedTriple", () => {
  it("produces all three units from m/s", () => {
    const t = speedTriple(10);
    expect(t.speedMps).toBe(10);
    expect(t.speedMph).toBeCloseTo(22.3694, 4);
    expect(t.speedKph).toBeCloseTo(36, 4);
  });

  it("handles zero", () => {
    expect(speedTriple(0)).toEqual({ speedMps: 0, speedMph: 0, speedKph: 0 });
  });

  it("handles negative speed (parser data quirks)", () => {
    const t = speedTriple(-5);
    expect(t.speedMps).toBe(-5);
    expect(t.speedKph).toBeCloseTo(-18, 6);
  });
});

// ─── clamp ────────────────────────────────────────────────────────────────────

describe("clamp", () => {
  it("returns the value when in range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("clamps to min", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it("clamps to max", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("handles inverted range gracefully (min > max returns min)", () => {
    // Documented quirk: Math.max(min, Math.min(max, value)) — when min > max, returns min.
    expect(clamp(5, 10, 0)).toBe(10);
  });
});

// ─── normalizeHeadingDelta ────────────────────────────────────────────────────

describe("normalizeHeadingDelta", () => {
  it("returns 0 when either argument is undefined", () => {
    expect(normalizeHeadingDelta(undefined, 90)).toBe(0);
    expect(normalizeHeadingDelta(90, undefined)).toBe(0);
    expect(normalizeHeadingDelta(undefined, undefined)).toBe(0);
  });

  it("returns the delta directly when within [-180, 180]", () => {
    expect(normalizeHeadingDelta(45, 30)).toBe(15);
    expect(normalizeHeadingDelta(30, 45)).toBe(-15);
  });

  it("wraps 359 → 1 to +2 (not -358)", () => {
    expect(normalizeHeadingDelta(1, 359)).toBe(2);
  });

  it("wraps 1 → 359 to -2 (not +358)", () => {
    expect(normalizeHeadingDelta(359, 1)).toBe(-2);
  });
});

// ─── normalizeHeading ─────────────────────────────────────────────────────────

describe("normalizeHeading", () => {
  it("returns value unchanged when in [0, 360)", () => {
    expect(normalizeHeading(0)).toBe(0);
    expect(normalizeHeading(180)).toBe(180);
    expect(normalizeHeading(359)).toBe(359);
  });

  it("wraps 360 to 0", () => {
    expect(normalizeHeading(360)).toBe(0);
  });

  it("wraps negative values up", () => {
    expect(normalizeHeading(-90)).toBe(270);
    expect(normalizeHeading(-180)).toBe(180);
  });

  it("wraps large values down", () => {
    expect(normalizeHeading(720)).toBe(0);
    expect(normalizeHeading(450)).toBe(90);
  });
});

// ─── haversineDistance ────────────────────────────────────────────────────────

describe("haversineDistance", () => {
  it("returns 0 for identical points", () => {
    expect(haversineDistance(40, -74, 40, -74)).toBe(0);
  });

  it("computes ~111195m for 1° of latitude at the equator", () => {
    // 1° latitude = ~111,195 m everywhere
    expect(haversineDistance(0, 0, 1, 0)).toBeCloseTo(111195, -1);
  });

  it("computes ~111195m for 1° of longitude at the equator", () => {
    expect(haversineDistance(0, 0, 0, 1)).toBeCloseTo(111195, -1);
  });

  it("computes Berlin → Paris distance correctly (~877 km)", () => {
    // Berlin (52.5200, 13.4050) → Paris (48.8566, 2.3522)
    const km = haversineDistance(52.52, 13.405, 48.8566, 2.3522) / 1000;
    expect(km).toBeCloseTo(877, -1); // ±5 km tolerance — great-circle vs road distance
  });

  it("is symmetric", () => {
    const d1 = haversineDistance(35, -100, 40, -110);
    const d2 = haversineDistance(40, -110, 35, -100);
    expect(d1).toBeCloseTo(d2, 6);
  });
});

// ─── calculateBearing ─────────────────────────────────────────────────────────

describe("calculateBearing", () => {
  it("returns 0° (north) for due-north travel", () => {
    expect(calculateBearing(0, 0, 1, 0)).toBeCloseTo(0, 2);
  });

  it("returns ~90° (east) for due-east travel at equator", () => {
    expect(calculateBearing(0, 0, 0, 1)).toBeCloseTo(90, 2);
  });

  it("returns 180° (south) for due-south travel", () => {
    expect(calculateBearing(1, 0, 0, 0)).toBeCloseTo(180, 2);
  });

  it("returns 270° (west) for due-west travel at equator", () => {
    expect(calculateBearing(0, 1, 0, 0)).toBeCloseTo(270, 2);
  });

  it("always returns a value in [0, 360)", () => {
    for (let lat = -80; lat <= 80; lat += 20) {
      for (let lon = -170; lon <= 170; lon += 30) {
        const b = calculateBearing(0, 0, lat, lon);
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThan(360);
      }
    }
  });
});

// ─── isTeleportation ──────────────────────────────────────────────────────────

describe("isTeleportation", () => {
  // Silence the console.warn the function emits when formatName is provided
  afterEach(() => vi.restoreAllMocks());

  it("returns false when timeDiff is zero or negative", () => {
    expect(isTeleportation(0, 0, 1000, 1, 1, 1000)).toBe(false);
    expect(isTeleportation(0, 0, 1000, 1, 1, 500)).toBe(false);
  });

  it("returns false when timeDiff exceeds 10 seconds (parser pause)", () => {
    // 1° lat = 111km in 11s — would normally be teleportation, but >10s window opts out
    expect(isTeleportation(0, 0, 0, 1, 0, 11000)).toBe(false);
  });

  it("returns false for normal racing motion (40m in 40ms)", () => {
    // 40m in 40ms = 1000 m/s. Wait — limit is 50 * (timeDiff/0.04) at 40ms = 50m AND >100m.
    // 40m fails the "dist > 100m" minimum guard so it passes (not teleportation).
    expect(isTeleportation(0, 0, 0, 0, 40 / 111195, 40)).toBe(false);
  });

  it("returns true when jump is implausibly large", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // 1° lat = ~111km in 100ms — clearly teleportation
    const result = isTeleportation(0, 0, 0, 1, 0, 100);
    expect(result).toBe(true);
  });

  it("logs format name when teleportation detected", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    isTeleportation(0, 0, 0, 1, 0, 100, "TestFormat");
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("TestFormat");
  });

  it("does not log when formatName omitted", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    isTeleportation(0, 0, 0, 1, 0, 100);
    expect(warn).not.toHaveBeenCalled();
  });
});

// ─── validateGpsCoords ────────────────────────────────────────────────────────

describe("validateGpsCoords", () => {
  it("returns null for valid coordinates", () => {
    expect(validateGpsCoords(40.5, -74.5)).toBe(null);
    expect(validateGpsCoords(0, 1)).toBe(null);
    expect(validateGpsCoords(-89.9, 179.9)).toBe(null);
  });

  it("flags NaN values", () => {
    expect(validateGpsCoords(NaN, 0)).toBe("nan");
    expect(validateGpsCoords(0, NaN)).toBe("nan");
    expect(validateGpsCoords(NaN, NaN)).toBe("nan");
  });

  it("flags (0, 0) — the default GPS error value", () => {
    expect(validateGpsCoords(0, 0)).toBe("zero");
  });

  it("does NOT flag (0, 1) or (1, 0) as zero (legitimate equator points)", () => {
    expect(validateGpsCoords(0, 1)).toBe(null);
    expect(validateGpsCoords(1, 0)).toBe(null);
  });

  it("flags out-of-range latitudes", () => {
    expect(validateGpsCoords(91, 0)).toBe("outOfRange");
    expect(validateGpsCoords(-91, 0)).toBe("outOfRange");
  });

  it("flags out-of-range longitudes", () => {
    expect(validateGpsCoords(0, 181)).toBe("outOfRange");
    expect(validateGpsCoords(0, -181)).toBe("outOfRange");
  });

  it("priority: nan before zero before range", () => {
    expect(validateGpsCoords(NaN, NaN)).toBe("nan");
    // Note: 0,0 short-circuits before range check, but range short-circuits past it.
  });
});

// ─── parseCsvLine ─────────────────────────────────────────────────────────────

describe("parseCsvLine", () => {
  it("splits on commas by default", () => {
    expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("trims whitespace around fields", () => {
    expect(parseCsvLine("  a , b , c  ")).toEqual(["a", "b", "c"]);
  });

  it("respects quoted fields containing the delimiter", () => {
    expect(parseCsvLine('a,"b,c",d')).toEqual(["a", "b,c", "d"]);
  });

  it("accepts a custom delimiter", () => {
    expect(parseCsvLine("a;b;c", ";")).toEqual(["a", "b", "c"]);
  });

  it("handles tab delimiter", () => {
    expect(parseCsvLine("a\tb\tc", "\t")).toEqual(["a", "b", "c"]);
  });

  it("returns empty strings for empty fields", () => {
    expect(parseCsvLine("a,,c")).toEqual(["a", "", "c"]);
    expect(parseCsvLine(",")).toEqual(["", ""]);
  });

  it("handles a single-field line", () => {
    expect(parseCsvLine("hello")).toEqual(["hello"]);
  });

  it("removes quote characters from output", () => {
    expect(parseCsvLine('"hello"')).toEqual(["hello"]);
  });
});

// ─── detectDelimiter ──────────────────────────────────────────────────────────

describe("detectDelimiter", () => {
  it("prefers tab when it dominates", () => {
    expect(detectDelimiter("a\tb\tc\td")).toBe("\t");
  });

  it("prefers semicolon over comma when semicolons dominate", () => {
    expect(detectDelimiter("a;b;c,d")).toBe(";");
  });

  it("defaults to comma when comma dominates", () => {
    expect(detectDelimiter("a,b,c")).toBe(",");
  });

  it("returns comma when no delimiters present", () => {
    expect(detectDelimiter("abcdef")).toBe(",");
  });

  it("accepts custom candidate list", () => {
    expect(detectDelimiter("a|b|c", ["|"])).toBe("|");
  });
});

// ─── normalizeAccelToG ────────────────────────────────────────────────────────

describe("normalizeAccelToG", () => {
  it("passes through values within G range unchanged", () => {
    expect(normalizeAccelToG(1.5)).toBe(1.5);
    expect(normalizeAccelToG(-2.3)).toBe(-2.3);
    expect(normalizeAccelToG(0)).toBe(0);
  });

  it("converts m/s² to G when above the heuristic threshold (default 5)", () => {
    // 9.81 m/s² ≈ 1 G
    expect(normalizeAccelToG(9.80665)).toBeCloseTo(1, 5);
    // 19.6 m/s² ≈ 2 G
    expect(normalizeAccelToG(19.6133)).toBeCloseTo(2, 4);
  });

  it("respects a custom m/s² threshold (Alfano uses 10)", () => {
    // Value of 7: at default threshold 5 → treated as m/s² → 7/9.80665 ≈ 0.714 G.
    // At threshold 10 → treated as already-G → passes through, but clamped to 5G ceiling.
    expect(normalizeAccelToG(7)).toBeCloseTo(0.714, 2);
    expect(normalizeAccelToG(7, 10)).toBe(5); // 7G is implausible → clamped to default ±5G

    // A 3G reading is below either threshold → never converted, never clamped
    expect(normalizeAccelToG(3, 5)).toBe(3);
    expect(normalizeAccelToG(3, 10)).toBe(3);
  });

  it("clamps to ±5 G by default", () => {
    expect(normalizeAccelToG(100)).toBe(5);
    expect(normalizeAccelToG(-100)).toBe(-5);
  });

  it("accepts a custom clamp range", () => {
    expect(normalizeAccelToG(3, 5, 2)).toBe(2);
    expect(normalizeAccelToG(-3, 5, 2)).toBe(-2);
  });
});

// ─── calculateBounds ──────────────────────────────────────────────────────────

function makeSample(lat: number, lon: number): GpsSample {
  return { t: 0, lat, lon, speedMps: 0, speedMph: 0, speedKph: 0, extraFields: {} };
}

describe("calculateBounds", () => {
  it("returns zeroed bounds for empty array", () => {
    expect(calculateBounds([])).toEqual({ minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 });
  });

  it("returns identical min/max for a single sample", () => {
    expect(calculateBounds([makeSample(40, -74)])).toEqual({
      minLat: 40, maxLat: 40, minLon: -74, maxLon: -74,
    });
  });

  it("computes correct bounds across multiple samples", () => {
    const samples = [
      makeSample(40, -74),
      makeSample(35, -100),
      makeSample(45, -90),
      makeSample(38, -120),
    ];
    expect(calculateBounds(samples)).toEqual({
      minLat: 35, maxLat: 45, minLon: -120, maxLon: -74,
    });
  });

  it("does not stack-overflow on very large arrays (regression for Math.min(...lats))", () => {
    // 200k samples — Math.min(...arr) blows up around ~100-150k in V8
    const samples: GpsSample[] = [];
    for (let i = 0; i < 200_000; i++) {
      samples.push(makeSample(40 + i * 1e-6, -74 + i * 1e-6));
    }
    const b = calculateBounds(samples);
    expect(b.minLat).toBeCloseTo(40, 5);
    expect(b.maxLat).toBeCloseTo(40 + 199_999 * 1e-6, 4);
  });
});

// ─── createRejectedCounter & recordCoordRejection ─────────────────────────────

describe("createRejectedCounter", () => {
  it("initializes all counters to zero", () => {
    expect(createRejectedCounter()).toEqual({
      nanFields: 0, zeroCoords: 0, outOfRange: 0,
      speedCap: 0, teleportation: 0, incompleteRow: 0,
    });
  });

  it("returns a fresh object each call (no shared reference)", () => {
    const a = createRejectedCounter();
    const b = createRejectedCounter();
    a.nanFields = 5;
    expect(b.nanFields).toBe(0);
  });
});

describe("recordCoordRejection", () => {
  it("returns false and does not mutate on null reason", () => {
    const c = createRejectedCounter();
    expect(recordCoordRejection(c, null)).toBe(false);
    expect(c.nanFields).toBe(0);
  });

  it("increments nanFields for 'nan' reason", () => {
    const c = createRejectedCounter();
    expect(recordCoordRejection(c, "nan")).toBe(true);
    expect(c.nanFields).toBe(1);
  });

  it("increments zeroCoords for 'zero' reason", () => {
    const c = createRejectedCounter();
    recordCoordRejection(c, "zero");
    expect(c.zeroCoords).toBe(1);
  });

  it("increments outOfRange for 'outOfRange' reason", () => {
    const c = createRejectedCounter();
    recordCoordRejection(c, "outOfRange");
    expect(c.outOfRange).toBe(1);
  });

  it("accumulates across calls", () => {
    const c = createRejectedCounter();
    recordCoordRejection(c, "nan");
    recordCoordRejection(c, "nan");
    recordCoordRejection(c, "zero");
    expect(c.nanFields).toBe(2);
    expect(c.zeroCoords).toBe(1);
  });
});
