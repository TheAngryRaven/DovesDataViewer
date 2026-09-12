/**
 * Drag-run detection: find standing-start straight-line passes ("runs") in a
 * GPS log from an unknown venue, and score them at the traditional drag
 * distances (60 / 330 / 660 / 1000 / 1320 ft).
 *
 * Why this exists: a drag strip is never in the track database, and the return
 * road loops back near the staging lanes — close enough that waypoint mode
 * (courseDetection) happily "detects" out-and-back passes as laps. The caller
 * (useDataLoader) therefore runs this detector BEFORE accepting a waypoint
 * result; the gate at the bottom of `detectDragRuns` is what keeps unknown
 * circuits and autocross runs falling through to waypoint mode.
 *
 * Timing model: t0 is the first sample above LAUNCH_MOTION_MPH after a valid
 * staged period, and that sample's position is distance zero. Interpolating
 * the true "speed leaves zero" instant is noise-dominated (a parked GPS reads
 * 0–2 mph of Doppler wander), while the first confident-motion sample is
 * deterministic and reproducible — and starting the clock a fraction late
 * loosely mimics real strip rollout. The resulting ET approximates a track
 * time slip; it is not sanctioned timing.
 */

import type { GpsSample, Lap } from "@/types/racing";
import { calculateDistanceArray, interpolateSampleByDistance } from "./referenceUtils";
import { haversineDistance } from "./parserUtils";
import { METERS_PER_FOOT, FEET_PER_METER } from "./units";

// ─── Tunables ────────────────────────────────────────────────────────────────

/** "Stopped" amid GPS Doppler wander (sessionGate treats <1 mph as stopped; +1 tolerates staging creep). */
export const STAGE_SPEED_MPH = 2;
/** Must hold at/below STAGE_SPEED_MPH this long (cumulative) to arm a launch. */
export const MIN_STAGED_MS = 3000;
/** First sample above this after a valid stage = t0 and the distance-zero anchor. */
export const LAUNCH_MOTION_MPH = 3;
/** Motion must reach this speed… */
export const LAUNCH_CONFIRM_MPH = 15;
/** …within this window, or the candidate was staging creep / a burnout roll, not a launch. */
export const LAUNCH_CONFIRM_MS = 3000;
/** The run window closes when speed falls back below this. */
export const RUN_END_SPEED_MPH = 5;
/** Hard cap on the window past the lift point, so return-road driving can't stretch an aborted run. */
export const RUN_TAIL_MAX_MS = 10000;
/** Moving-average window (samples) used for lift/peak detection only — raw speeds are reported. */
export const SPEED_SMOOTH_WINDOW = 3;
/** A mark this close past the lift point still scores (driver lifted exactly at the stripe). */
export const MARK_GRACE_M = 10;
/** A candidate run must peak at/above this (and score 60 ft) or it was a pit/staging-lane roll. */
export const MIN_RUN_PEAK_MPH = 30;
/** Gate: net displacement ÷ path distance over launch→660 ft. A real strip is >0.99. */
export const STRAIGHTNESS_MIN = 0.95;
/** Gate: speed floor at the 660 ft mark — filters slow parades that happen to run straight. */
export const MIN_EIGHTH_SPEED_MPH = 40;

/** Every mark a time slip prints, in feet, ascending. */
export const DRAG_MARKS_FT = [60, 330, 660, 1000, 1320] as const;
/** The distances a user can score a session at: 1/8 mi, 1000 ft, 1/4 mi. */
export const DRAG_DISTANCES_FT = [660, 1000, 1320] as const;

export type DragDistanceFt = (typeof DRAG_DISTANCES_FT)[number];

/** Validate an untrusted value (e.g. from FileMetadata) as a scoring distance. */
export function isDragDistanceFt(value: unknown): value is DragDistanceFt {
  return (DRAG_DISTANCES_FT as readonly number[]).includes(value as number);
}

// ─── Result shapes ───────────────────────────────────────────────────────────

/** One scored mark crossing within a run, timed under power (not coast-through). */
export interface DragMarkCrossing {
  /** One of DRAG_MARKS_FT. */
  markFt: number;
  /** Interpolated time from t0 to the mark. */
  elapsedMs: number;
  /** Absolute index of the first sample at/past the mark. */
  sampleIndex: number;
  /** Interpolated speed at the mark (trap-style readout). */
  speedMph: number;
  speedKph: number;
}

/** One standing-start pass. Marks are ascending and only include distances covered under power. */
export interface DragRun {
  /** 1-based, chronological. */
  runNumber: number;
  /** Absolute index of the launch sample; t0 = samples[launchIndex].t, distance 0 = its position. */
  launchIndex: number;
  t0: number;
  /** Absolute index of the end of the run's data window (lift/stop), NOT a timing line. */
  endIndex: number;
  marks: DragMarkCrossing[];
  /** Distance covered under power (at the lift point), in feet. */
  maxScoredFt: number;
  peakSpeedMph: number;
  peakSpeedKph: number;
}

export interface DragDetectionResult {
  runs: DragRun[];
  /** Longest standard scoring distance completed by at least one run (the gate guarantees ≥ 660). */
  suggestedDistanceFt: DragDistanceFt;
}

// ─── Detection ───────────────────────────────────────────────────────────────

/** Centered moving average of speedMph, for lift/peak location only. */
function smoothSpeeds(samples: GpsSample[]): number[] {
  const half = Math.floor(SPEED_SMOOTH_WINDOW / 2);
  const out = new Array<number>(samples.length);
  for (let i = 0; i < samples.length; i++) {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(samples.length - 1, i + half); j++) {
      sum += samples[j].speedMph;
      n++;
    }
    out[i] = sum / n;
  }
  return out;
}

interface CandidateRun {
  launchIndex: number;
  endIndex: number;
  marks: DragMarkCrossing[];
  maxScoredFt: number;
  peakSpeedMph: number;
  peakSpeedKph: number;
  /** Net displacement ÷ path distance over launch→660, when the 660 was scored. */
  straightnessAtEighth?: number;
  /** Interpolated speed at the 660 mark, when scored. */
  speedAtEighthMph?: number;
}

/**
 * Score one confirmed launch: walk the run window, and time every mark the car
 * crossed under power. Returns null when the motion never amounted to a run
 * (no 60 ft, or peak below MIN_RUN_PEAK_MPH).
 */
function scoreRun(samples: GpsSample[], smoothed: number[], launchIndex: number, stopIndex: number): CandidateRun | null {
  if (stopIndex - launchIndex < 2) return null;
  const slice = samples.slice(launchIndex, stopIndex + 1);
  const distances = calculateDistanceArray(slice);
  const t0 = samples[launchIndex].t;

  // Lift = maximum smoothed speed; everything past it (plus a little grace) was coasting.
  let liftLocal = 0;
  let peakSmoothed = -Infinity;
  let peakMph = -Infinity;
  let peakKph = 0;
  for (let k = 0; k < slice.length; k++) {
    const s = smoothed[launchIndex + k];
    if (s > peakSmoothed) {
      peakSmoothed = s;
      liftLocal = k;
    }
    if (slice[k].speedMph > peakMph) {
      peakMph = slice[k].speedMph;
      peakKph = slice[k].speedKph;
    }
  }

  if (peakMph < MIN_RUN_PEAK_MPH) return null;

  const scoredThroughM = distances[liftLocal] + MARK_GRACE_M;
  const totalM = distances[distances.length - 1];

  const marks: DragMarkCrossing[] = [];
  let straightnessAtEighth: number | undefined;
  let speedAtEighthMph: number | undefined;
  let searchFrom = 0;
  for (const markFt of DRAG_MARKS_FT) {
    const markM = markFt * METERS_PER_FOOT;
    if (markM > scoredThroughM || markM > totalM) break;
    const interp = interpolateSampleByDistance(slice, distances, markM);
    while (searchFrom < distances.length && distances[searchFrom] < markM) searchFrom++;
    marks.push({
      markFt,
      elapsedMs: interp.t - t0,
      sampleIndex: launchIndex + Math.min(searchFrom, slice.length - 1),
      speedMph: interp.speedMph,
      speedKph: interp.speedKph,
    });
    if (markFt === 660) {
      const launch = slice[0];
      straightnessAtEighth = haversineDistance(launch.lat, launch.lon, interp.lat, interp.lon) / markM;
      speedAtEighthMph = interp.speedMph;
    }
  }

  if (marks.length === 0 || marks[0].markFt !== 60) return null;

  // Data window ends at the stop, capped RUN_TAIL_MAX_MS past the lift.
  let endLocal = slice.length - 1;
  const liftT = slice[liftLocal].t;
  for (let k = liftLocal; k < slice.length; k++) {
    if (slice[k].t - liftT > RUN_TAIL_MAX_MS) {
      endLocal = k;
      break;
    }
  }

  return {
    launchIndex,
    endIndex: launchIndex + endLocal,
    marks,
    maxScoredFt: distances[liftLocal] * FEET_PER_METER,
    peakSpeedMph: peakMph,
    peakSpeedKph: peakKph,
    straightnessAtEighth,
    speedAtEighthMph,
  };
}

/**
 * Detect standing-start drag runs in a session.
 *
 * Returns null unless the data passes the "is this drag data?" gate: at least
 * one run must cover the 660 ft mark under power, in a near-straight line
 * (STRAIGHTNESS_MIN) and at speed (MIN_EIGHTH_SPEED_MPH) — so unknown circuits
 * and autocross sessions keep falling through to waypoint mode.
 */
export function detectDragRuns(samples: GpsSample[]): DragDetectionResult | null {
  if (samples.length < 10) return null;
  const smoothed = smoothSpeeds(samples);

  const candidates: CandidateRun[] = [];
  let stagedMs = 0;
  let i = 1;
  while (i < samples.length) {
    const v = samples[i].speedMph;
    if (v <= STAGE_SPEED_MPH) {
      // Attribute the interval to stopped time when it connects two stopped samples.
      if (samples[i - 1].speedMph <= STAGE_SPEED_MPH) stagedMs += samples[i].t - samples[i - 1].t;
      i++;
      continue;
    }
    if (v <= LAUNCH_MOTION_MPH) {
      // Neutral band: staging creep pauses the staged clock without disarming.
      i++;
      continue;
    }

    // Motion. Without a full stage behind it, it's just driving.
    if (stagedMs < MIN_STAGED_MS) {
      stagedMs = 0;
      i++;
      continue;
    }

    // Launch candidate: confirm it reaches LAUNCH_CONFIRM_MPH in time, else it
    // was creep / a burnout roll — discard and require a fresh stage, so the
    // scored launch is always the LAST stage before a confirmed acceleration
    // (the pairSprintRuns re-launch rule).
    const t0 = samples[i].t;
    let confirmIdx = -1;
    for (let j = i; j < samples.length && samples[j].t - t0 <= LAUNCH_CONFIRM_MS; j++) {
      if (samples[j].speedMph >= LAUNCH_CONFIRM_MPH) {
        confirmIdx = j;
        break;
      }
    }
    if (confirmIdx === -1) {
      stagedMs = 0;
      i++;
      continue;
    }

    // Confirmed: the run's raw window extends until the car slows back down.
    let stopIdx = samples.length - 1;
    for (let j = confirmIdx; j < samples.length; j++) {
      if (samples[j].speedMph < RUN_END_SPEED_MPH) {
        stopIdx = j;
        break;
      }
    }

    const run = scoreRun(samples, smoothed, i, stopIdx);
    if (run) candidates.push(run);

    stagedMs = 0;
    i = stopIdx + 1;
  }

  // Gate: at least one straight, fast 660 or this isn't drag data.
  const gatePassed = candidates.some(
    (c) =>
      c.straightnessAtEighth !== undefined &&
      c.straightnessAtEighth >= STRAIGHTNESS_MIN &&
      (c.speedAtEighthMph ?? 0) >= MIN_EIGHTH_SPEED_MPH,
  );
  if (!gatePassed) return null;

  let suggested: DragDistanceFt = 660;
  for (const c of candidates) {
    for (const d of DRAG_DISTANCES_FT) {
      if (d > suggested && c.marks.some((m) => m.markFt === d)) suggested = d;
    }
  }

  return {
    runs: candidates.map((c, idx) => ({
      runNumber: idx + 1,
      launchIndex: c.launchIndex,
      t0: samples[c.launchIndex].t,
      endIndex: c.endIndex,
      marks: c.marks,
      maxScoredFt: c.maxScoredFt,
      peakSpeedMph: c.peakSpeedMph,
      peakSpeedKph: c.peakSpeedKph,
    })),
    suggestedDistanceFt: suggested,
  };
}

// ─── Run → Lap mapping ───────────────────────────────────────────────────────

/**
 * Score detected runs at a distance and express them as ordinary `Lap`s, so the
 * whole lap UI (table, map, charts, playback) works unchanged.
 *
 * Timing lines follow the circuit `buildLap` contract: line 0 is the launch
 * (boundary 0 = lap start), lines 1..n-1 are the intermediate marks, and the
 * last segment closes on the scoring mark — so for a 1/4-mile session
 * `sectorTimes`/`sectorBoundaries` have 5 entries (launch→60, 60→330, 330→660,
 * 660→1000, 1000→1320).
 *
 * A run that scored the final mark is complete: `lapTimeMs` is its ET and
 * `endIndex` the sample at the stripe — which also makes the window's top speed
 * the trap-style speed at the mark. A run that lifted early keeps its detector
 * window and reached splits (`undefined` past the lift, which the optimal-lap
 * calc already skips) and is flagged `incomplete` so nothing ranks it fastest.
 *
 * Marks are scored once at detection; switching distance is just re-mapping.
 */
export function dragRunsToLaps(samples: GpsSample[], runs: DragRun[], distanceFt: DragDistanceFt): Lap[] {
  const markFts = DRAG_MARKS_FT.filter((m) => m <= distanceFt);
  const laps: Lap[] = [];

  for (const run of runs) {
    // Marks score strictly in ascending-prefix order (scoring stops at the lift).
    const scored = markFts.map((ft) => run.marks.find((m) => m.markFt === ft));
    const finalMark = scored[markFts.length - 1];

    const sectorTimes: (number | undefined)[] = [];
    const sectorBoundaries: (number | undefined)[] = [];
    sectorBoundaries.push(run.launchIndex);
    for (let k = 0; k < markFts.length; k++) {
      const prevElapsed = k === 0 ? 0 : scored[k - 1]?.elapsedMs;
      const mark = scored[k];
      sectorTimes.push(mark !== undefined && prevElapsed !== undefined ? mark.elapsedMs - prevElapsed : undefined);
      if (k < markFts.length - 1) sectorBoundaries.push(mark?.sampleIndex);
    }

    const endIndex = finalMark ? finalMark.sampleIndex : run.endIndex;
    const endTime = finalMark ? run.t0 + finalMark.elapsedMs : samples[run.endIndex].t;

    let maxSpeedMph = 0;
    let maxSpeedKph = 0;
    let minSpeedMph = Infinity;
    let minSpeedKph = Infinity;
    for (let i = run.launchIndex; i <= endIndex; i++) {
      const s = samples[i];
      if (s.speedMph > maxSpeedMph) {
        maxSpeedMph = s.speedMph;
        maxSpeedKph = s.speedKph;
      }
      if (s.speedMph < minSpeedMph) {
        minSpeedMph = s.speedMph;
        minSpeedKph = s.speedKph;
      }
    }

    laps.push({
      lapNumber: run.runNumber,
      startTime: run.t0,
      endTime,
      lapTimeMs: endTime - run.t0,
      maxSpeedMph,
      maxSpeedKph,
      minSpeedMph,
      minSpeedKph,
      startIndex: run.launchIndex,
      endIndex,
      sectorTimes,
      sectorBoundaries,
      ...(finalMark ? {} : { incomplete: true as const }),
    });
  }

  return laps;
}

/**
 * Cumulative time at each mark of a drag lap (prefix sums of `sectorTimes`) —
 * the numbers a time slip prints. The last entry equals the ET for a complete
 * run; entries past an incomplete run's lift are `undefined`.
 */
export function dragTimeSlipTimes(lap: Lap): (number | undefined)[] {
  const times = lap.sectorTimes ?? [];
  const out: (number | undefined)[] = [];
  let cum: number | undefined = 0;
  for (const t of times) {
    cum = cum !== undefined && t !== undefined ? cum + t : undefined;
    out.push(cum);
  }
  return out;
}
