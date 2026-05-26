import { describe, it, expect } from "vitest";
import {
  DEFAULT_TRACK_SEARCH_RADIUS_M,
  parseSectorLine,
  abbreviateTrackName,
  getTrackDisplayName,
  findNearestTrack,
  calculatePolylineLength,
  formatTrackLength,
  resamplePolyline,
} from "./trackUtils";
import { haversineDistance } from "./parserUtils";

// ─── DEFAULT_TRACK_SEARCH_RADIUS_M ─────────────────────────────────────────────

describe("DEFAULT_TRACK_SEARCH_RADIUS_M", () => {
  it("is ~5 miles in meters", () => {
    expect(DEFAULT_TRACK_SEARCH_RADIUS_M).toBe(8047);
    // 8047 m ≈ 5.000 mi.
    expect(DEFAULT_TRACK_SEARCH_RADIUS_M / 1609.344).toBeCloseTo(5, 2);
  });
});

// ─── parseSectorLine ──────────────────────────────────────────────────────────

describe("parseSectorLine", () => {
  it("parses numeric string coordinates into a SectorLine", () => {
    const line = parseSectorLine({
      aLat: "28.50100",
      aLon: "-81.40200",
      bLat: "28.50150",
      bLon: "-81.40250",
    });
    expect(line).toEqual({
      a: { lat: 28.501, lon: -81.402 },
      b: { lat: 28.5015, lon: -81.4025 },
    });
  });

  it("returns undefined if any coordinate is non-numeric (NaN)", () => {
    expect(
      parseSectorLine({ aLat: "abc", aLon: "-81.4", bLat: "28.5", bLon: "-81.4" }),
    ).toBeUndefined();
    expect(
      parseSectorLine({ aLat: "28.5", aLon: "", bLat: "28.5", bLon: "-81.4" }),
    ).toBeUndefined();
  });

  it("parses partial-numeric strings via parseFloat (leading number wins)", () => {
    // parseFloat("28.5deg") === 28.5 — documents the lenient parse.
    const line = parseSectorLine({
      aLat: "28.5deg",
      aLon: "-81.4",
      bLat: "28.6",
      bLon: "-81.5",
    });
    expect(line?.a.lat).toBe(28.5);
  });
});

// ─── abbreviateTrackName ───────────────────────────────────────────────────────

describe("abbreviateTrackName", () => {
  it("takes first letter of each word for multi-word names", () => {
    expect(abbreviateTrackName("Orlando Kart Center")).toBe("OKC");
  });

  it("takes the first 4 characters for single-word names", () => {
    expect(abbreviateTrackName("Bushnell")).toBe("BUSH");
  });

  it("uses the whole word uppercased when shorter than 4 chars", () => {
    expect(abbreviateTrackName("Pit")).toBe("PIT");
    expect(abbreviateTrackName("ax")).toBe("AX");
  });

  it("returns empty string for empty / whitespace-only input", () => {
    expect(abbreviateTrackName("")).toBe("");
    expect(abbreviateTrackName("   ")).toBe("");
  });

  it("collapses repeated whitespace between words", () => {
    expect(abbreviateTrackName("Daytona   International  Speedway")).toBe("DIS");
  });

  it("trims surrounding whitespace before abbreviating", () => {
    expect(abbreviateTrackName("  Sebring  ")).toBe("SEBR");
  });
});

// ─── getTrackDisplayName ───────────────────────────────────────────────────────

describe("getTrackDisplayName", () => {
  it("prefers an explicit shortName", () => {
    expect(getTrackDisplayName({ name: "Orlando Kart Center", shortName: "OKC1" })).toBe("OKC1");
  });

  it("falls back to the abbreviation when shortName is absent", () => {
    expect(getTrackDisplayName({ name: "Orlando Kart Center" })).toBe("OKC");
  });

  it("falls back to abbreviation when shortName is an empty string", () => {
    expect(getTrackDisplayName({ name: "Bushnell", shortName: "" })).toBe("BUSH");
  });
});

// ─── findNearestTrack ──────────────────────────────────────────────────────────

describe("findNearestTrack", () => {
  const okc = {
    name: "Orlando Kart Center",
    courses: [{ startFinishA: { lat: 28.5, lon: -81.4 } }],
  };
  const sebring = {
    name: "Sebring",
    courses: [{ startFinishA: { lat: 27.45, lon: -81.35 } }],
  };

  it("returns null for no tracks", () => {
    expect(findNearestTrack(28.5, -81.4, [])).toBeNull();
  });

  it("returns the track when the point sits on its start/finish", () => {
    const t = findNearestTrack(28.5, -81.4, [okc, sebring]);
    expect(t).toBe(okc);
  });

  it("picks the closest of several tracks", () => {
    // A point near Sebring's S/F.
    const t = findNearestTrack(27.451, -81.351, [okc, sebring]);
    expect(t).toBe(sebring);
  });

  it("returns null when the nearest track is beyond the threshold", () => {
    // A point ~50km away from both → outside the 8047m default radius.
    const far = findNearestTrack(29.5, -82.5, [okc, sebring]);
    expect(far).toBeNull();
  });

  it("respects a custom threshold", () => {
    // ~300m from OKC S/F. Within default but outside a tight 100m threshold.
    const near = { lat: 28.5, lon: -81.39695 };
    const dist = haversineDistance(near.lat, near.lon, 28.5, -81.4);
    expect(dist).toBeGreaterThan(100);
    expect(dist).toBeLessThan(DEFAULT_TRACK_SEARCH_RADIUS_M);
    expect(findNearestTrack(near.lat, near.lon, [okc])).toBe(okc);
    expect(findNearestTrack(near.lat, near.lon, [okc], 100)).toBeNull();
  });

  it("scans all courses of a multi-course track", () => {
    const multi = {
      name: "Multi",
      courses: [
        { startFinishA: { lat: 10, lon: 10 } }, // far
        { startFinishA: { lat: 28.5, lon: -81.4 } }, // near our point
      ],
    };
    expect(findNearestTrack(28.5, -81.4, [multi])).toBe(multi);
  });
});

// ─── calculatePolylineLength ───────────────────────────────────────────────────

describe("calculatePolylineLength", () => {
  it("returns 0 for an empty or single-point polyline", () => {
    expect(calculatePolylineLength([])).toBe(0);
    expect(calculatePolylineLength([{ lat: 28.5, lon: -81.4 }])).toBe(0);
  });

  it("sums segment haversine distances", () => {
    // Two ~1° longitude steps at the equator ≈ 2 * 111195 m.
    const pts = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 },
      { lat: 0, lon: 2 },
    ];
    expect(calculatePolylineLength(pts)).toBeCloseTo(2 * 111195, -1);
  });

  it("matches a single segment's haversine distance", () => {
    const a = { lat: 28.5, lon: -81.4 };
    const b = { lat: 28.51, lon: -81.41 };
    expect(calculatePolylineLength([a, b])).toBeCloseTo(
      haversineDistance(a.lat, a.lon, b.lat, b.lon),
      6,
    );
  });
});

// ─── formatTrackLength ─────────────────────────────────────────────────────────

describe("formatTrackLength", () => {
  it("formats meters into ft / m with rounding", () => {
    // 1000 m = 3280.84 ft → "3,281 ft / 1,000 m".
    expect(formatTrackLength(1000)).toBe("3,281 ft / 1,000 m");
  });

  it("handles zero", () => {
    expect(formatTrackLength(0)).toBe("0 ft / 0 m");
  });

  it("rounds fractional meters", () => {
    // 100.4 m → 329.42 ft → "329 ft / 100 m".
    expect(formatTrackLength(100.4)).toBe("329 ft / 100 m");
  });
});

// ─── resamplePolyline ──────────────────────────────────────────────────────────

describe("resamplePolyline", () => {
  it("returns a copy for fewer than 2 points", () => {
    expect(resamplePolyline([])).toEqual([]);
    const single = [{ lat: 28.5, lon: -81.4 }];
    const out = resamplePolyline(single);
    expect(out).toEqual(single);
    expect(out).not.toBe(single); // shallow copy of the array
  });

  it("always includes the first point", () => {
    const pts = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0.01 },
    ];
    const out = resamplePolyline(pts, 100);
    expect(out[0]).toEqual({ lat: 0, lon: 0 });
  });

  it("emits roughly evenly spaced points along a straight segment", () => {
    // ~1112m east at the equator (0.01°). Spacing 100m → ~11 interior points + start.
    const pts = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0.01 },
    ];
    const out = resamplePolyline(pts, 100);
    // First point + floor(1112/100) ≈ 11 emitted points.
    expect(out.length).toBeGreaterThanOrEqual(11);
    // Consecutive emitted points should be ~100m apart (within tolerance).
    for (let i = 1; i < out.length; i++) {
      const d = haversineDistance(out[i - 1].lat, out[i - 1].lon, out[i].lat, out[i].lon);
      expect(d).toBeCloseTo(100, -1);
    }
  });

  it("skips zero-length segments (duplicate points)", () => {
    const pts = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0 }, // duplicate → segDist 0, skipped
      { lat: 0, lon: 0.01 },
    ];
    const out = resamplePolyline(pts, 100);
    expect(out.length).toBeGreaterThan(1);
    expect(out[0]).toEqual({ lat: 0, lon: 0 });
  });

  it("carries leftover distance across a too-short segment (documented quirk)", () => {
    // First segment is ~66.7m — too short to fit a 100m step, so the loop emits
    // nothing and forwards carry = 66.7m. On the long second segment `walked` is
    // SEEDED with that carry (66.7m) and the first emitted point lands at
    // walked = 66.7 + 100 = ~166.7m INTO segment 2 — i.e. ~233m from the polyline
    // start, not 100m. This is a known quirk: the carry shifts the first point of
    // the next segment by the short segment's length rather than continuing
    // seamlessly. Subsequent points are then a clean 100m apart.
    const pts = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0.0006 }, // ~66.7m short hop (no point fits)
      { lat: 0, lon: 0.01 }, // long straight (~1045m) east
    ];
    const out = resamplePolyline(pts, 100);
    expect(out.length).toBeGreaterThanOrEqual(2);
    // First interior point sits ~233m from start (66.7 carry + 100 + 66.7 seg1).
    const firstGap = haversineDistance(out[0].lat, out[0].lon, out[1].lat, out[1].lon);
    expect(firstGap).toBeCloseTo(233, -1);
    // From there, consecutive interior points are a clean ~100m apart.
    for (let i = 2; i < out.length; i++) {
      const step = haversineDistance(out[i - 1].lat, out[i - 1].lon, out[i].lat, out[i].lon);
      expect(step).toBeCloseTo(100, -1);
    }
  });
});
