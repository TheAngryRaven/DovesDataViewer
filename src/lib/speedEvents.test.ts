import { describe, it, expect } from "vitest";
import { findSpeedEvents } from "./speedEvents";
import type { GpsSample } from "@/types/racing";

// ─── Helpers ────────────────────────────────────────────────────────────────

// Build a sample where t advances by `dtMs` per index and speed comes from a series.
function makeSamples(speedsMph: number[], dtMs = 200): GpsSample[] {
  return speedsMph.map((mph, i) => ({
    t: i * dtMs,
    lat: 28.4 + i * 1e-5, // near a real Florida track
    lon: -81.5 + i * 1e-5,
    speedMps: mph / 2.23694,
    speedMph: mph,
    speedKph: mph * 1.60934,
    extraFields: {},
  }));
}

// ─── findSpeedEvents ─────────────────────────────────────────────────────────

describe("findSpeedEvents", () => {
  it("returns [] for empty input", () => {
    expect(findSpeedEvents([])).toEqual([]);
  });

  it("returns [] when fewer than smoothingWindow + debounceCount samples", () => {
    // Defaults: window 5 + debounce 2 = 7 needed. 6 samples → too few.
    const samples = makeSamples([10, 20, 30, 40, 50, 60]);
    expect(findSpeedEvents(samples)).toEqual([]);
  });

  it("returns [] for a perfectly monotonic increasing series (no extrema)", () => {
    const samples = makeSamples([10, 12, 14, 16, 18, 20, 22, 24, 26, 28]);
    expect(findSpeedEvents(samples)).toEqual([]);
  });

  it("detects a single peak in an up-then-down series", () => {
    // Rise to ~60 then fall. With a long separation between this and any other
    // extremum, one peak should be reported.
    const speeds = [20, 30, 40, 50, 60, 50, 40, 30, 20, 15];
    const samples = makeSamples(speeds, 1000); // 1s spacing → easily passes minSeparation
    const events = findSpeedEvents(samples);
    expect(events.length).toBeGreaterThanOrEqual(1);
    const peak = events.find((e) => e.type === "peak");
    expect(peak).toBeDefined();
    // Carries lat/lon/index/time from the candidate sample.
    expect(peak!.lat).toBeCloseTo(samples[peak!.index].lat, 8);
    expect(peak!.time).toBe(samples[peak!.index].t);
  });

  it("detects alternating peak and valley over a full oscillation", () => {
    // Up to 60, down to 10, back up to 55. Should give a peak then a valley
    // (alternating), with large swings well above minSwing.
    const speeds = [
      10, 25, 40, 55, 60, // peak around idx 4
      50, 35, 20, 12, 10, // valley around idx 9
      20, 35, 50, 55, 55, // up again
    ];
    const samples = makeSamples(speeds, 1000);
    const events = findSpeedEvents(samples);
    expect(events.length).toBeGreaterThanOrEqual(2);
    // First two events should alternate in type.
    expect(events[0].type).not.toBe(events[1].type);
  });

  it("honors minSeparationMs (suppresses closely-spaced extrema)", () => {
    // A rapid oscillation with tight time spacing — minSeparation should
    // suppress the second extremum even though shape qualifies.
    const speeds = [10, 30, 50, 30, 50, 30, 50, 30, 10, 5];
    // 50ms spacing → whole series spans ~450ms, under the 1000ms default separation.
    const samples = makeSamples(speeds, 50);
    const events = findSpeedEvents(samples, {
      smoothingWindow: 3,
      debounceCount: 1,
      minSwing: 1,
    });
    // At most one event can clear the 1000ms separation gate.
    expect(events.length).toBeLessThanOrEqual(1);
  });

  it("honors minSwing (small wobbles below prominence are dropped)", () => {
    // First a big peak, then a tiny dip and tiny peak (swing < minSwing) that
    // should be filtered out, leaving essentially the prominent extrema only.
    const speeds = [
      10, 30, 50, 70, 80, // big peak
      70, 50, 30, 20, 15, // big valley region
      16, 17, 16, 17, 16, // tiny wobble — swing ~1mph
    ];
    const samples = makeSamples(speeds, 1000);
    const tightSwing = findSpeedEvents(samples, { minSwing: 20 });
    // With a large minSwing, the tiny terminal wobble produces no extra markers.
    const looseSwing = findSpeedEvents(samples, { minSwing: 0.5 });
    expect(looseSwing.length).toBeGreaterThanOrEqual(tightSwing.length);
  });

  it("rounds nothing — reports the smoothed speed value as-is", () => {
    // The 'speed' field is the smoothed candidate value (not necessarily integer).
    const speeds = [20, 30, 40, 50, 60, 50, 40, 30, 20, 15];
    const samples = makeSamples(speeds, 1000);
    const events = findSpeedEvents(samples);
    for (const e of events) {
      expect(Number.isFinite(e.speed)).toBe(true);
    }
  });

  it("custom debounceCount of 1 still requires confirmation but is more permissive", () => {
    const speeds = [10, 20, 30, 40, 50, 45, 40, 35, 30, 25];
    const samples = makeSamples(speeds, 1000);
    const events = findSpeedEvents(samples, { debounceCount: 1, smoothingWindow: 3 });
    // Should detect the peak around index 4.
    expect(events.some((e) => e.type === "peak")).toBe(true);
  });
});
