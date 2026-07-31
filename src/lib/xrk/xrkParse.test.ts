/**
 * End-to-end parse test for the AiM XRK pipeline against a real .xrk fixture.
 *
 * The production path runs libxrk's Rust→wasm core in a Web Worker, which Vitest
 * (node env) can't spawn. Here we drive the same core directly: instantiate the
 * committed wasm by handing `init()` the raw bytes (it falls through to
 * `WebAssembly.instantiate` for a BufferSource), call `parse_xrk`, then run the
 * exact same pure post-processing the worker does — `wasmResultToRaw`
 * (xrkResample) → `mapXrkToParsedData` (xrkMapping). This guards the whole XRK
 * chain *and* the committed wasm against regressions with real telemetry.
 *
 * Fixture: `__fixtures__/test.xrk` — a ~10 min AiM session (Jan 2016), provided
 * by the maintainer specifically as a parser fixture.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import init, { parse_xrk } from "./wasm/xrk_wasm.js";
import { wasmResultToRaw, type XrkWasmResult } from "./xrkResample";
import { mapXrkToParsedData } from "./xrkMapping";
import type { ParsedData } from "@/types/racing";

const here = dirname(fileURLToPath(import.meta.url));

describe("XRK parse (real fixture, wasm)", () => {
  let parsed: ParsedData;

  beforeAll(async () => {
    const wasmBytes = readFileSync(resolve(here, "wasm/xrk_wasm_bg.wasm"));
    await init({ module_or_path: wasmBytes });
    const fileBytes = readFileSync(resolve(here, "__fixtures__/test.xrk"));
    const wasmResult = parse_xrk(new Uint8Array(fileBytes)) as XrkWasmResult;
    parsed = mapXrkToParsedData(wasmResultToRaw(wasmResult), "test.xrk");
  });

  it("produces a substantial, GPS-bearing sample set", () => {
    // The fixture is a ~10 min session; exact count is wasm/resample-stable.
    expect(parsed.samples.length).toBeGreaterThan(4000);
    for (const s of parsed.samples.slice(0, 50)) {
      expect(Number.isFinite(s.lat)).toBe(true);
      expect(Number.isFinite(s.lon)).toBe(true);
    }
  });

  it("anchors time at zero and runs monotonically to `duration`", () => {
    expect(parsed.samples[0].t).toBe(0);
    const last = parsed.samples[parsed.samples.length - 1];
    expect(last.t).toBe(parsed.duration);
    expect(parsed.duration).toBeGreaterThan(60_000); // > 1 minute
    for (let i = 1; i < parsed.samples.length; i++) {
      expect(parsed.samples[i].t).toBeGreaterThanOrEqual(parsed.samples[i - 1].t);
    }
  });

  it("derives a consistent speed triple on every sample", () => {
    const s = parsed.samples[100];
    expect(s.speedMph).toBeCloseTo(s.speedMps * 2.23694, 3);
    expect(s.speedKph).toBeCloseTo(s.speedMps * 3.6, 3);
    expect(s.speedMps).toBeGreaterThanOrEqual(0);
  });

  it("reads the session start date from the XRK metadata", () => {
    expect(parsed.startDate).toBeInstanceOf(Date);
    // Fixture was logged in 2016 — sanity-check the decoded header date.
    expect(parsed.startDate!.getUTCFullYear()).toBe(2016);
  });

  it("computes bounds that actually contain the samples", () => {
    const { minLat, maxLat, minLon, maxLon } = parsed.bounds;
    expect(minLat).toBeLessThanOrEqual(maxLat);
    expect(minLon).toBeLessThanOrEqual(maxLon);
    for (const s of parsed.samples.slice(0, 200)) {
      expect(s.lat).toBeGreaterThanOrEqual(minLat);
      expect(s.lat).toBeLessThanOrEqual(maxLat);
      expect(s.lon).toBeGreaterThanOrEqual(minLon);
      expect(s.lon).toBeLessThanOrEqual(maxLon);
    }
  });

  it("maps logger channels into field mappings + per-sample extra fields", () => {
    const names = parsed.fieldMappings.map((m) => m.name);
    // The fixture carries IMU, engine, and GPS-quality channels.
    expect(names).toContain("RPM");
    expect(names).toContain("Accel X");
    expect(names).toContain("Satellites");
    // Every mapped field should be backed by data on at least the first sample
    // (XRK forward-fills/interpolates onto the GPS timebase).
    const first = parsed.samples[0].extraFields;
    expect(first["RPM"]).toBeTypeOf("number");
    expect(Object.keys(first).length).toBeGreaterThan(0);
  });
});

// ─── Solo 2 timecode-corruption regression (real fixture, wasm) ───────────────
//
// `__fixtures__/solo2-buttonwillow.xrk` — a full real Solo 2 motorcycle race
// session (May 2026) whose GPS records carry the newer-firmware timecode
// corruption: jittered logger timestamps and every epoch written twice. Shared
// by the reporting user specifically as a validation fixture. Before the libxrk
// timecode fix this decoded as a "64-hour" session with positions miles off
// track and 735 mph speeds; it must now decode to RaceStudio-identical output.

describe("XRK parse (Solo 2 corrupt-timecode fixture, wasm)", () => {
  let parsed: ParsedData;

  beforeAll(async () => {
    const wasmBytes = readFileSync(resolve(here, "wasm/xrk_wasm_bg.wasm"));
    await init({ module_or_path: wasmBytes });
    const fileBytes = readFileSync(resolve(here, "__fixtures__/solo2-buttonwillow.xrk"));
    const wasmResult = parse_xrk(new Uint8Array(fileBytes)) as XrkWasmResult;
    parsed = mapXrkToParsedData(wasmResultToRaw(wasmResult), "solo2-buttonwillow.xrk");
  });

  it("recovers the true 16-minute timeline (one record per GPS epoch)", () => {
    expect(parsed.samples).toHaveLength(24309);
    expect(parsed.duration / 1000).toBeCloseTo(971.7, 0);
    for (let i = 1; i < parsed.samples.length; i++) {
      expect(parsed.samples[i].t).toBeGreaterThan(parsed.samples[i - 1].t);
    }
  });

  it("keeps every position inside the Buttonwillow track box", () => {
    expect(parsed.bounds.minLat).toBeGreaterThan(35.48);
    expect(parsed.bounds.maxLat).toBeLessThan(35.50);
    expect(parsed.bounds.minLon).toBeGreaterThan(-119.56);
    expect(parsed.bounds.maxLon).toBeLessThan(-119.53);
  });

  it("reports sane speeds and a receiver-derived heading on every sample", () => {
    const maxMph = Math.max(...parsed.samples.map((s) => s.speedMph));
    expect(maxMph).toBeGreaterThan(100);
    expect(maxMph).toBeLessThan(112); // native max 110.2 — never 735 again
    expect(parsed.samples.every((s) => s.heading !== undefined && s.heading >= 0 && s.heading < 360)).toBe(true);
  });
});
