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
