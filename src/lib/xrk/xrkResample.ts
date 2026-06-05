// Pure resample step: libxrk's wasm core returns every channel at its native
// sample rate, so we align them onto a single timebase before the app's
// GpsSample model can consume them. This mirrors what libxrk's Python layer did
// (`resample_to_channel('GPS Latitude')` → `get_channels_as_table()`): pick the
// GPS fix timebase, then for each channel linearly interpolate (continuous
// signals) or forward-fill (discrete signals) onto it.
//
// Kept pure + framework-free so it's fully unit-testable without the wasm module.

import type { XrkRawResult } from "./xrkTypes";

/** One channel exactly as the wasm `parse_xrk` returns it (native rate). */
export interface XrkWasmChannel {
  name: string;
  units: string;
  /** Linear-interpolate on resample when true; forward-fill when false. */
  interpolate: boolean;
  timecodes: number[];
  values: number[];
}

/** The full object returned by the wasm `parse_xrk`. */
export interface XrkWasmResult {
  channels: XrkWasmChannel[];
  laps: { num: number; start: number; end: number }[];
  metadata: Record<string, string>;
}

// GPS position/speed channels, in preference order, used as the shared timebase.
const TIMEBASE_PREFERENCE = ["GPS Latitude", "GPS Longitude", "GPS Speed"];

/**
 * Choose the target timebase: the GPS fix timecodes when available (so every row
 * is one GPS fix, matching the app's model), else the longest channel.
 */
function pickTimebase(channels: XrkWasmChannel[]): number[] {
  for (const name of TIMEBASE_PREFERENCE) {
    const ch = channels.find((c) => c.name === name && c.timecodes.length > 0);
    if (ch) return ch.timecodes;
  }
  let best: number[] = [];
  for (const c of channels) if (c.timecodes.length > best.length) best = c.timecodes;
  return best;
}

/**
 * Linear interpolation onto `target`, clamping to the channel's edge values
 * outside its range (np.interp semantics). Both arrays are ascending, so a
 * single forward walk suffices.
 */
function interpolateOnto(
  target: number[],
  xp: number[],
  fp: number[],
  out: Float64Array,
): void {
  const n = xp.length;
  let k = 0;
  for (let i = 0; i < target.length; i++) {
    const t = target[i];
    if (t <= xp[0]) {
      out[i] = fp[0];
      continue;
    }
    if (t >= xp[n - 1]) {
      out[i] = fp[n - 1];
      continue;
    }
    while (k + 1 < n && xp[k + 1] < t) k++;
    const span = xp[k + 1] - xp[k];
    const frac = span > 0 ? (t - xp[k]) / span : 0;
    out[i] = fp[k] + frac * (fp[k + 1] - fp[k]);
  }
}

/**
 * Forward-fill onto `target`: each target takes the last channel value at or
 * before it; targets before the first sample take the first value (backfill).
 */
function forwardFillOnto(
  target: number[],
  xp: number[],
  fp: number[],
  out: Float64Array,
): void {
  const n = xp.length;
  let k = 0;
  for (let i = 0; i < target.length; i++) {
    const t = target[i];
    if (t < xp[0]) {
      out[i] = fp[0];
      continue;
    }
    while (k + 1 < n && xp[k + 1] <= t) k++;
    out[i] = fp[k];
  }
}

/**
 * Resample every channel onto the GPS timebase and pack into the transport
 * `XrkRawResult` (Float64 columns) consumed by `xrkMapping`. Channels with no
 * samples are dropped.
 */
export function wasmResultToRaw(result: XrkWasmResult): XrkRawResult {
  const target = pickTimebase(result.channels);
  const timecodes = Float64Array.from(target);

  const channels = result.channels
    .filter((c) => c.timecodes.length > 0 && c.values.length === c.timecodes.length)
    .map((c) => {
      const out = new Float64Array(target.length);
      if (c.interpolate) interpolateOnto(target, c.timecodes, c.values, out);
      else forwardFillOnto(target, c.timecodes, c.values, out);
      return { name: c.name, unit: c.units, values: out };
    });

  return {
    timecodes,
    channels,
    metadata: result.metadata,
    laps: {
      num: result.laps.map((l) => l.num),
      start: result.laps.map((l) => l.start),
      end: result.laps.map((l) => l.end),
    },
  };
}
