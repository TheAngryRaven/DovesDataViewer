import { describe, it, expect } from "vitest";
import { wasmResultToRaw, type XrkWasmResult } from "./xrkResample";

function wasm(channels: XrkWasmResult["channels"], laps: XrkWasmResult["laps"] = [], metadata = {}): XrkWasmResult {
  return { channels, laps, metadata };
}

describe("wasmResultToRaw", () => {
  it("uses GPS Latitude timecodes as the shared timebase", () => {
    const raw = wasmResultToRaw(
      wasm([
        { name: "GPS Latitude", units: "deg", interpolate: true, timecodes: [0, 100, 200], values: [45.1, 45.2, 45.3] },
        { name: "RPM", units: "rpm", interpolate: false, timecodes: [0, 1000], values: [5000, 9000] },
      ]),
    );
    expect(Array.from(raw.timecodes)).toEqual([0, 100, 200]);
  });

  it("linearly interpolates interpolate=true channels onto the target", () => {
    const raw = wasmResultToRaw(
      wasm([
        { name: "GPS Latitude", units: "deg", interpolate: true, timecodes: [0, 100, 200], values: [0, 0, 0] },
        { name: "GPS Speed", units: "m/s", interpolate: true, timecodes: [0, 200], values: [0, 40] },
      ]),
    );
    const speed = raw.channels.find((c) => c.name === "GPS Speed")!;
    expect(Array.from(speed.values)).toEqual([0, 20, 40]);
  });

  it("forward-fills interpolate=false channels onto the target", () => {
    const raw = wasmResultToRaw(
      wasm([
        { name: "GPS Latitude", units: "deg", interpolate: true, timecodes: [0, 100, 200], values: [0, 0, 0] },
        { name: "Gear", units: "", interpolate: false, timecodes: [0, 150], values: [2, 3] },
      ]),
    );
    const gear = raw.channels.find((c) => c.name === "Gear")!;
    // t=0 -> 2, t=100 -> still 2 (last <= 100), t=200 -> 3
    expect(Array.from(gear.values)).toEqual([2, 2, 3]);
  });

  it("clamps to edge values outside the channel's range (both fill modes)", () => {
    const raw = wasmResultToRaw(
      wasm([
        { name: "GPS Latitude", units: "deg", interpolate: true, timecodes: [0, 100, 200, 300], values: [0, 0, 0, 0] },
        { name: "Interp", units: "", interpolate: true, timecodes: [100, 200], values: [10, 20] },
        { name: "Fill", units: "", interpolate: false, timecodes: [100, 200], values: [10, 20] },
      ]),
    );
    // target [0,100,200,300]; channel covers [100,200]
    expect(Array.from(raw.channels.find((c) => c.name === "Interp")!.values)).toEqual([10, 10, 20, 20]);
    // forward-fill: t=0 (before first) -> first value 10
    expect(Array.from(raw.channels.find((c) => c.name === "Fill")!.values)).toEqual([10, 10, 20, 20]);
  });

  it("drops channels with no samples or mismatched lengths", () => {
    const raw = wasmResultToRaw(
      wasm([
        { name: "GPS Latitude", units: "deg", interpolate: true, timecodes: [0, 100], values: [1, 2] },
        { name: "Empty", units: "", interpolate: true, timecodes: [], values: [] },
        { name: "Mismatch", units: "", interpolate: true, timecodes: [0, 100], values: [1] },
      ]),
    );
    const names = raw.channels.map((c) => c.name);
    expect(names).toContain("GPS Latitude");
    expect(names).not.toContain("Empty");
    expect(names).not.toContain("Mismatch");
  });

  it("falls back to the longest channel when no GPS channel is present", () => {
    const raw = wasmResultToRaw(
      wasm([
        { name: "RPM", units: "rpm", interpolate: false, timecodes: [0, 10], values: [1, 2] },
        { name: "WT", units: "C", interpolate: true, timecodes: [0, 10, 20, 30], values: [1, 2, 3, 4] },
      ]),
    );
    expect(Array.from(raw.timecodes)).toEqual([0, 10, 20, 30]);
  });

  it("passes laps + metadata through", () => {
    const raw = wasmResultToRaw(
      wasm(
        [{ name: "GPS Latitude", units: "deg", interpolate: true, timecodes: [0, 100], values: [1, 2] }],
        [{ num: 1, start: 0, end: 100 }, { num: 2, start: 100, end: 250 }],
        { Driver: "A.GIARDELLI", Venue: "Adria Kart" },
      ),
    );
    expect(raw.laps).toEqual({ num: [1, 2], start: [0, 100], end: [100, 250] });
    expect(raw.metadata).toEqual({ Driver: "A.GIARDELLI", Venue: "Adria Kart" });
  });
});

// ─── Quality channels are never fabricated (plan 0014) ───────────────────────
//
// A per-fix quality reading must never appear on a row the logger didn't
// record it for. Interpolation invents values no receiver reported (the
// "-1597 satellites" tooltip from the Solo2 poor-signal report); fill carries
// a healthy reading onto a garbage row, hiding it from the GPS quality
// cleanup. Rows without a native sample at their timecode stay NaN (absent).

describe("wasmResultToRaw — quality channels", () => {
  it("assigns quality values only at matching native timecodes (NaN elsewhere)", () => {
    const raw = wasmResultToRaw(
      wasm([
        { name: "GPS Latitude", units: "deg", interpolate: true, timecodes: [0, 100, 200], values: [0, 0, 0] },
        { name: "GPS Nsat", units: "", interpolate: true, timecodes: [0, 200], values: [12, -3000] },
      ]),
    );
    const nsat = raw.channels.find((c) => c.name === "GPS Nsat")!;
    // t=100 has no recorded reading — NOT a fabricated midpoint (-1494) and
    // NOT the previous value carried forward.
    expect(Array.from(nsat.values)).toEqual([12, NaN, -3000]);
  });

  it("matches quality channels tolerantly (case / underscores)", () => {
    const raw = wasmResultToRaw(
      wasm([
        { name: "GPS Latitude", units: "deg", interpolate: true, timecodes: [0, 100, 200], values: [0, 0, 0] },
        { name: "GPS_Position_Accuracy", units: "mm", interpolate: true, timecodes: [0, 200], values: [1000, 5000] },
        { name: "GPS_pDOP", units: "", interpolate: true, timecodes: [100, 200], values: [1, 3] },
      ]),
    );
    expect(Array.from(raw.channels.find((c) => c.name === "GPS_Position_Accuracy")!.values)).toEqual([1000, NaN, 5000]);
    // A quality channel starting later never back-fills earlier rows.
    expect(Array.from(raw.channels.find((c) => c.name === "GPS_pDOP")!.values)).toEqual([NaN, 1, 3]);
  });

  it("tolerates small timecode jitter when matching", () => {
    const raw = wasmResultToRaw(
      wasm([
        { name: "GPS Latitude", units: "deg", interpolate: true, timecodes: [0, 100, 200], values: [0, 0, 0] },
        { name: "GPS Nsat", units: "", interpolate: false, timecodes: [2, 101, 198], values: [10, 11, 12] },
      ]),
    );
    expect(Array.from(raw.channels.find((c) => c.name === "GPS Nsat")!.values)).toEqual([10, 11, 12]);
  });

  it("still interpolates non-quality channels", () => {
    const raw = wasmResultToRaw(
      wasm([
        { name: "GPS Latitude", units: "deg", interpolate: true, timecodes: [0, 100, 200], values: [0, 0, 0] },
        { name: "GPS Speed", units: "m/s", interpolate: true, timecodes: [0, 200], values: [0, 40] },
      ]),
    );
    expect(Array.from(raw.channels.find((c) => c.name === "GPS Speed")!.values)).toEqual([0, 20, 40]);
  });
});

// ─── Timecode repair: 16-bit rollover decoder fault (plan 0014) ───────────────
//
// Some Solo2 logs decode with spurious ±k*65536ms timecode offsets, shuffled
// blocks, and duplicated timestamps (a 16-min race spanning "64 hours").
// Resampling against that clock extrapolated other channels into fabricated
// positions miles off track. The repair unfolds the offsets, orders rows by
// true time, and skips rows that don't advance the clock — values untouched.

describe("wasmResultToRaw — broken timecode repair", () => {
  it("unfolds 65536ms offsets, restores order, and drops duplicate instants", () => {
    // True clock: 0,40,80,120,160,200,240. The decoder stamped rows 3-4 with
    // +65536, row 6 with +2*65536, and duplicated row 6's instant on row 7.
    const raw = wasmResultToRaw(
      wasm([
        {
          name: "GPS Latitude", units: "deg", interpolate: true,
          timecodes: [0, 40, 80, 65656, 65696, 200, 131312, 131312],
          values: [1, 2, 3, 4, 5, 6, 7, 8],
        },
      ]),
    );
    expect(Array.from(raw.timecodes)).toEqual([0, 40, 80, 120, 160, 200, 240]);
    expect(Array.from(raw.channels[0].values)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("repairs every broken channel consistently so cross-channel alignment survives", () => {
    const broken = [0, 40, 80, 65656, 65696, 200, 131312, 131312];
    const raw = wasmResultToRaw(
      wasm([
        { name: "GPS Latitude", units: "deg", interpolate: true, timecodes: [...broken], values: [1, 2, 3, 4, 5, 6, 7, 8] },
        { name: "GPS Nsat", units: "", interpolate: true, timecodes: [...broken], values: [11, 12, 13, 14, 15, 16, 17, 18] },
      ]),
    );
    // Quality channel exact-matches the repaired timebase row-for-row.
    expect(Array.from(raw.channels.find((c) => c.name === "GPS Nsat")!.values)).toEqual([11, 12, 13, 14, 15, 16, 17]);
  });

  it("leaves a healthy channel with a genuine long recording gap untouched", () => {
    // A real 2-minute pit gap is nowhere near an exact 65536 multiple.
    const raw = wasmResultToRaw(
      wasm([
        {
          name: "GPS Latitude", units: "deg", interpolate: true,
          timecodes: [0, 40, 80, 120080, 120120],
          values: [1, 2, 3, 4, 5],
        },
      ]),
    );
    expect(Array.from(raw.timecodes)).toEqual([0, 40, 80, 120080, 120120]);
  });
});
