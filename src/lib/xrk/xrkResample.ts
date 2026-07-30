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

// GPS fix-quality channels are per-fix readings, not continuous signals, and
// they must NEVER be fabricated onto rows the logger didn't record them for:
// interpolation invents values no receiver reported (e.g. "-1597 satellites"),
// and forward-fill carries a healthy reading onto a garbage row, hiding it
// from the GPS quality filter (a corrupt fix then shows "15 sats / pDOP 1.2"
// in the tooltip). A row gets a quality value only when the channel has a
// native sample at that row's timecode; everywhere else it stays NaN (absent).
const QUALITY_CHANNELS = new Set([
  "gps nsat",
  "gps satellites",
  "gps posaccuracy",
  "gps pos accuracy",
  "gps position accuracy",
  "gps spdaccuracy",
  "gps spd accuracy",
  "gps velocity accuracy",
  "gps posdop",
  "gps pdop",
  "gps hdop",
  "gps vdop",
]);

function isQualityChannel(name: string): boolean {
  return QUALITY_CHANNELS.has(name.toLowerCase().replace(/[\s_]+/g, " ").trim());
}

// ─── Timecode repair (16-bit rollover decoder fault) ─────────────────────────
//
// Some Solo2 logs come out of the wasm with broken GPS timecodes: the decoder
// mis-unwraps a 16-bit millisecond counter across interleaved sample blocks,
// stamping rows with spurious ±k*65536ms offsets, out-of-order blocks, and
// duplicated timestamps. A real 16-minute race then spans "64 hours", and
// resampling against that clock EXTRAPOLATES other channels into fabricated
// positions miles off track and impossible speeds (user-reported: a 735mph /
// 134-mile Buttonwillow session whose native samples are all healthy and on
// track). The values are real — only the clock is wrong.
//
// Repair (only for channels that provably exhibit the fault): remove the
// spurious 65536ms multiples, order rows by their true recorded time, and skip
// rows that still don't advance the clock. No values are altered or invented.

const WRAP_MS = 65536;
/** A fold only fires within this of an exact k*WRAP_MS — a real gap (pit
 *  stop, logger pause) is nowhere near an exact 16-bit multiple and stays. */
const WRAP_TOL_MS = 1000;

function isWrapMultiple(delta: number): boolean {
  const k = Math.round(delta / WRAP_MS);
  return k !== 0 && Math.abs(delta - k * WRAP_MS) <= WRAP_TOL_MS;
}

/** True when the timecode stream shows the rollover fault: time running
 *  backwards, or repeated deltas sitting exactly on 65536ms multiples. */
function hasBrokenTimecodes(timecodes: number[]): boolean {
  let wrapHits = 0;
  for (let i = 1; i < timecodes.length; i++) {
    const d = timecodes[i] - timecodes[i - 1];
    if (d < 0) return true;
    if (isWrapMultiple(d)) {
      if (++wrapHits >= 3) return true;
    }
  }
  return false;
}

/**
 * Rebuild a broken channel: unfold the spurious 65536ms offsets (tracking
 * against the last true time, so out-of-order straggler rows resolve too),
 * stable-sort rows by true time, and drop rows that don't advance the clock
 * (two rows can't both be real at the same instant). Returns repaired copies.
 */
function repairTimecodes(timecodes: number[], values: number[]): { timecodes: number[]; values: number[] } {
  const n = timecodes.length;
  const trueT = new Float64Array(n);
  trueT[0] = timecodes[0];
  for (let i = 1; i < n; i++) {
    const d = timecodes[i] - trueT[i - 1];
    const k = Math.round(d / WRAP_MS);
    trueT[i] = k !== 0 && Math.abs(d - k * WRAP_MS) <= WRAP_TOL_MS ? timecodes[i] - k * WRAP_MS : timecodes[i];
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => trueT[a] - trueT[b] || a - b);
  const outT: number[] = [];
  const outV: number[] = [];
  let last = -Infinity;
  for (const i of order) {
    if (trueT[i] <= last) continue;
    last = trueT[i];
    outT.push(trueT[i]);
    outV.push(values[i]);
  }
  return { timecodes: outT, values: outV };
}

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
    // Clamp to [0,1]: interpolation must never extrapolate, whatever the
    // input ordering — out-of-range fractions fabricate data.
    const frac = span > 0 ? Math.min(1, Math.max(0, (t - xp[k]) / span)) : 0;
    out[i] = fp[k] + frac * (fp[k + 1] - fp[k]);
  }
}

/**
 * Exact-timecode match onto `target`: a row takes the channel's value only
 * when a native sample exists at (within EXACT_EPS of) that row's timecode;
 * everywhere else NaN — the value is simply not recorded for that row.
 */
const EXACT_EPS = 5; // ms — well under any real sample spacing (25Hz = 40ms)

function exactMatchOnto(
  target: number[],
  xp: number[],
  fp: number[],
  out: Float64Array,
): void {
  const n = xp.length;
  let k = 0;
  for (let i = 0; i < target.length; i++) {
    const t = target[i];
    while (k + 1 < n && xp[k + 1] <= t + EXACT_EPS) k++;
    out[i] = Math.abs(xp[k] - t) <= EXACT_EPS ? fp[k] : NaN;
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
  // Repair any channel whose timecodes exhibit the 16-bit rollover fault
  // BEFORE resampling — every fill mode below assumes an ascending clock, and
  // resampling against a broken one fabricates data.
  const repaired = result.channels.map((c) => {
    if (c.timecodes.length === 0 || c.values.length !== c.timecodes.length) return c;
    if (!hasBrokenTimecodes(c.timecodes)) return c;
    const fixed = repairTimecodes(c.timecodes, c.values);
    return { ...c, timecodes: fixed.timecodes, values: fixed.values };
  });

  const target = pickTimebase(repaired);
  const timecodes = Float64Array.from(target);

  const channels = repaired
    .filter((c) => c.timecodes.length > 0 && c.values.length === c.timecodes.length)
    .map((c) => {
      const out = new Float64Array(target.length);
      if (isQualityChannel(c.name)) exactMatchOnto(target, c.timecodes, c.values, out);
      else if (c.interpolate) interpolateOnto(target, c.timecodes, c.values, out);
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
