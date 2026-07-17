/**
 * Pure playback model for the firmware simulator (plan 0010, Phase A).
 *
 * Maps parsed session samples (`ParsedData` — the SAME parser output the
 * rest of the app uses; never a second dovex parser) onto the sim's
 * input contract:
 *
 *  - every sample is injected at its own timestamp, with `stepMillis`
 *    advancing virtual time BETWEEN injections (the contract allows at
 *    most one `injectPvt` per step batch);
 *  - the RPM channel rides along with each sample and drives the sim's
 *    real tach ISR;
 *  - a short no-fix "pre-roll" before the session start exercises the
 *    firmware's real GPS-acquisition boot UX.
 *
 * Everything here is pure and Vitest-covered; the rAF loop in
 * `useSimPlayback` just executes the plans this module produces.
 */

import type { GpsSample } from "@/types/racing";

/** injectPvt JSON payload (API contract v1 — see firmware repo API.md). */
export interface SimPvtFrame {
  timestamp: number;
  lat: number;
  lng: number;
  sats: number;
  hdop: number;
  speed_mph: number;
  altitude_m: number;
  heading_deg: number;
  h_acc_m: number;
  fix: boolean;
  accelX: number;
  accelY: number;
  accelZ: number;
}

/** One playback action: optionally inject a frame + rpm, then advance. */
export interface TickAction {
  pvt?: SimPvtFrame;
  rpm?: number;
  stepMs: number;
}

/** Boot pre-roll length: matches the real GPS acquisition feel. */
export const PRE_ROLL_MS = 3000;
/** Pre-roll no-fix frame cadence (the boot status page runs 5 Hz). */
const PRE_ROLL_STEP_MS = 200;

/** Absolute (unix-ms) timestamp of a sample. */
export function sampleTimeMs(sample: GpsSample, epochMs: number): number {
  return epochMs + sample.t;
}

/** RPM channel of a sample (canonical id from channels.ts), 0 when absent. */
export function sampleRpm(sample: GpsSample): number {
  const rpm = sample.extraFields["rpm"];
  return Number.isFinite(rpm) && rpm > 0 ? Math.round(rpm) : 0;
}

/** Map one parsed sample to the sim's injectPvt frame. */
export function sampleToPvt(sample: GpsSample, epochMs: number): SimPvtFrame {
  const f = sample.extraFields;
  return {
    timestamp: sampleTimeMs(sample, epochMs),
    lat: sample.lat,
    lng: sample.lon,
    sats: Number.isFinite(f["satellites"]) ? f["satellites"] : 10,
    hdop: Number.isFinite(f["hdop"]) ? f["hdop"] : 1.0,
    speed_mph: sample.speedMph,
    altitude_m: Number.isFinite(f["altitude"]) ? f["altitude"] : 0,
    heading_deg: sample.heading ?? 0,
    h_acc_m: Number.isFinite(f["h_acc"]) ? f["h_acc"] : 1.0,
    // Rows only exist in a log while the fix was valid.
    fix: true,
    accelX: Number.isFinite(f["accel_x"]) ? f["accel_x"] : 0,
    accelY: Number.isFinite(f["accel_y"]) ? f["accel_y"] : 0,
    accelZ: Number.isFinite(f["accel_z"]) ? f["accel_z"] : 1,
  };
}

/**
 * The no-fix boot pre-roll: frames before `epochMs` so viewers see the
 * real "ACQUIRING" status page, with the satellite count creeping up.
 */
export function preRollFrames(epochMs: number): TickAction[] {
  const actions: TickAction[] = [];
  const count = Math.floor(PRE_ROLL_MS / PRE_ROLL_STEP_MS);
  for (let i = 0; i < count; i++) {
    actions.push({
      pvt: {
        timestamp: epochMs - PRE_ROLL_MS + i * PRE_ROLL_STEP_MS,
        lat: 0,
        lng: 0,
        sats: Math.min(3 + (i >> 2), 7),
        hdop: 9.9,
        speed_mph: 0,
        altitude_m: 0,
        heading_deg: 0,
        h_acc_m: 50,
        fix: false,
        accelX: 0,
        accelY: 0,
        accelZ: 1,
      },
      rpm: 0,
      stepMs: PRE_ROLL_STEP_MS,
    });
  }
  return actions;
}

/**
 * Plan one playback tick: inject every sample with
 * `fromMs < timestamp <= toMs` (absolute unix-ms window) at its own
 * timestamp, stepping virtual time between them, with a final step to
 * land exactly on `toMs`. `startIndex` avoids re-scanning from zero each
 * frame; the returned `nextIndex` is the cursor for the next call.
 */
export function buildTickPlan(
  samples: readonly GpsSample[],
  epochMs: number,
  fromMs: number,
  toMs: number,
  startIndex: number,
): { actions: TickAction[]; nextIndex: number } {
  const actions: TickAction[] = [];
  let cursor = fromMs;
  let i = Math.max(0, startIndex);

  // Skip anything at or before the window start (already injected).
  while (i < samples.length && sampleTimeMs(samples[i], epochMs) <= fromMs) {
    i++;
  }

  while (i < samples.length) {
    const ts = sampleTimeMs(samples[i], epochMs);
    if (ts > toMs) break;
    actions.push({
      pvt: sampleToPvt(samples[i], epochMs),
      rpm: sampleRpm(samples[i]),
      stepMs: Math.max(0, ts - cursor),
    });
    cursor = ts;
    i++;
  }

  if (toMs > cursor) {
    actions.push({ stepMs: toMs - cursor });
  }
  return { actions, nextIndex: i };
}

/** How a seek is executed. */
export interface ScrubPlan {
  /** Rewinds need a true fresh boot (reset + headless fast-replay). */
  reset: boolean;
  /** Absolute ms to fast-replay from (session start after a reset). */
  replayFromMs: number;
}

/**
 * Seeking forward just fast-replays the gap; seeking backward needs a
 * fresh boot first (firmware state is cumulative — there is no rewind).
 */
export function planScrub(
  currentMs: number,
  targetMs: number,
  sessionStartMs: number,
): ScrubPlan {
  if (targetMs >= currentMs) {
    return { reset: false, replayFromMs: currentMs };
  }
  return { reset: true, replayFromMs: sessionStartMs };
}

/** Absolute end of the session (timestamp of the last sample). */
export function sessionEndMs(
  samples: readonly GpsSample[],
  epochMs: number,
): number {
  return samples.length
    ? sampleTimeMs(samples[samples.length - 1], epochMs)
    : epochMs;
}
