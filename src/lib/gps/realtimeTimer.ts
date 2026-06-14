/**
 * RealtimeLapTimer — an incremental lap-timing engine for a live GPS stream.
 *
 * It reuses the app's pure, batch timing logic (course detection, lap/sector
 * calculation, position delta) by driving them over a growing sample buffer:
 * `calculateLaps` is idempotent, so re-running it as samples arrive yields the
 * same stable completed laps plus any newly-closed lap. At phone GPS rates
 * (~1 Hz) the recompute cost is negligible.
 *
 * Responsibilities:
 *  - auto-detect track/course/direction (or waypoint fallback) once enough
 *    samples exist, then lock the course;
 *  - expose current / last / best / optimal lap times, completed-lap count, and
 *    the major-sector (S1/S2/S3) rollup;
 *  - compute a live delta of the in-progress lap vs the best lap so far
 *    (position-based, via a resampled reference rebuilt when the best improves).
 *
 * This is the timing *engine* only — no UI, no persistence, no GPS I/O.
 */
import type { GpsSample, Track, Course, Lap, CourseDirection } from '@/types/racing';
import { findNearestTrack } from '@/lib/trackUtils';
import { validateGpsCoords } from '@/lib/parserUtils';
import { autoDetectCourse } from '@/lib/courseDetection';
import { calculateLaps, calculateOptimalLap } from '@/lib/lapCalculation';
import {
  resampleByDistance,
  computePositionDelta,
  type ResampledLap,
} from '@/lib/lapDelta';

/** Best + last value for one major sector (ms). */
export interface MajorSectorState {
  last: number | null;
  best: number | null;
}

/** Immutable snapshot of the timer after a sample. */
export interface TimingState {
  trackName: string | null;
  courseName: string | null;
  isWaypointMode: boolean;
  direction: CourseDirection | null;
  /** Completed laps. */
  lapCount: number;
  /** Elapsed time of the in-progress lap (ms), or null before the first crossing. */
  currentLapMs: number | null;
  lastLapMs: number | null;
  bestLapMs: number | null;
  bestLapNumber: number | null;
  /** Theoretical optimal lap (sum of best segments), ms. */
  optimalMs: number | null;
  /** Live gap of the in-progress lap vs the best lap (s); + = slower. */
  deltaSec: number | null;
  /** Major-sector rollup [S1, S2, S3]; empty until a 3-major course is timing. */
  majorSectors: MajorSectorState[];
  /** Latest speed (mph). */
  speedMph: number | null;
  /**
   * Whether the current position is within ~10 mi of any known track. `false`
   * means "nowhere near a track" (no timing context — the UI shows speed + a
   * "logging for post-race analysis" note); `null` until tracks have loaded.
   */
  nearKnownTrack: boolean | null;
  /**
   * Name of the nearest known track within range, or `null` (far / not loaded).
   * Lets the UI confirm which track it recognised *before* logging arms — so a
   * stationary driver sitting at a known track sees it was detected rather than
   * a context-free speedometer.
   */
  nearbyTrackName: string | null;
}

export const EMPTY_TIMING_STATE: TimingState = {
  trackName: null,
  courseName: null,
  isWaypointMode: false,
  direction: null,
  lapCount: 0,
  currentLapMs: null,
  lastLapMs: null,
  bestLapMs: null,
  bestLapNumber: null,
  optimalMs: null,
  deltaSec: null,
  majorSectors: [],
  speedMph: null,
  nearKnownTrack: null,
  nearbyTrackName: null,
};

/** Min samples before attempting detection (mirrors autoDetectCourse). */
const MIN_DETECT_SAMPLES = 10;
/** Re-attempt detection at most this often (in samples) until a course locks. */
const DETECT_EVERY = 5;
/** Arc-length grid spacing (m) for the delta reference. */
const DELTA_SAMPLE_METERS = 2;
/** Beyond this distance (m) from every known track we don't try to time — just
 *  log. 10 miles, wider than the 5 mi detection radius so there's a margin. */
const NEAR_TRACK_RADIUS_M = 16_093;
/**
 * Minimum session-time gap between the two O(n) recomputes (full `calculateLaps`
 * over the buffer + the position-delta search). At phone rates (~1 Hz) every fix
 * already clears this, so behavior is unchanged; it only caps the cost if a
 * higher-rate source (e.g. BLE GPS) is fed in later, keeping per-second work
 * bounded instead of growing with the session.
 */
const HEAVY_RECOMPUTE_MS = 200;

export class RealtimeLapTimer {
  private tracks: Track[];
  private readonly samples: GpsSample[] = [];

  private course: Course | null = null;
  private trackName: string | null = null;
  private direction: CourseDirection | null = null;
  private isWaypointMode = false;
  private waypointCourseName: string | null = null;
  private samplesAtLastDetect = -DETECT_EVERY;
  private tracksLoaded = false;
  private nearKnownTrack: boolean | null = null;

  private laps: Lap[] = [];
  private refLap: ResampledLap | null = null;
  private refForBestLapNumber: number | null = null;

  // Throttle state for the two O(n) recomputes (laps + delta).
  private lastHeavyT = Number.NEGATIVE_INFINITY;
  private cachedDeltaSec: number | null = null;

  private state: TimingState = EMPTY_TIMING_STATE;

  constructor(tracks: Track[] = []) {
    this.tracks = tracks;
  }

  /** Provide/replace the known-tracks list (e.g. once loadTracks resolves). */
  setTracks(tracks: Track[]): void {
    this.tracks = tracks;
    this.tracksLoaded = true;
  }

  /** Clear all session state (keeps the tracks list) so a new session can start. */
  reset(): void {
    this.samples.length = 0;
    this.laps = [];
    this.course = null;
    this.trackName = null;
    this.direction = null;
    this.isWaypointMode = false;
    this.waypointCourseName = null;
    this.samplesAtLastDetect = -DETECT_EVERY;
    this.nearKnownTrack = null;
    this.refLap = null;
    this.refForBestLapNumber = null;
    this.lastHeavyT = Number.NEGATIVE_INFINITY;
    this.cachedDeltaSec = null;
    this.state = EMPTY_TIMING_STATE;
  }

  /** Force a specific course (manual pick / known track), bypassing detection. */
  lockCourse(course: Course, trackName: string | null = null, direction: CourseDirection | null = null): void {
    this.course = course;
    this.trackName = trackName;
    this.direction = direction;
    this.isWaypointMode = false;
  }

  /** Feed one sample (`t` = elapsed ms from session start). Returns the new state. */
  update(sample: GpsSample): TimingState {
    this.samples.push(sample);
    if (!this.course) this.evalNearTrack(sample);

    if (this.course) {
      this.nearKnownTrack = true;
      this.state = this.computeState(sample);
    } else if (this.nearKnownTrack === false) {
      // Nowhere near a known track — don't try to time, just keep logging.
      this.state = { ...EMPTY_TIMING_STATE, speedMph: sample.speedMph, nearKnownTrack: false };
    } else {
      this.tryDetect();
      if (this.course) {
        this.nearKnownTrack = true;
        this.state = this.computeState(sample);
      } else if (this.isWaypointMode) {
        // Waypoint laps are refreshed (throttled) by tryDetect; derive each tick.
        this.state = this.deriveFromLaps(this.waypointCourseName, sample);
      } else {
        this.state = { ...EMPTY_TIMING_STATE, speedMph: sample.speedMph, nearKnownTrack: this.nearKnownTrack };
      }
    }
    return this.state;
  }

  /**
   * Update whether we're within ~10 mi of any known track. Null until tracks
   * have loaded; once loaded, false means "nowhere near a track" (the tool then
   * just logs + shows speed). Cheap haversine over the (small) track list.
   */
  private evalNearTrack(sample: GpsSample): void {
    if (!this.tracksLoaded) {
      this.nearKnownTrack = null;
      return;
    }
    if (validateGpsCoords(sample.lat, sample.lon) !== null) return; // keep prior on a bad fix
    this.nearKnownTrack =
      findNearestTrack(sample.lat, sample.lon, this.tracks, NEAR_TRACK_RADIUS_M) !== null;
  }

  getState(): TimingState {
    return this.state;
  }

  /**
   * Pure proximity probe: is `(lat, lon)` within ~10 mi of any known track?
   * `null` until tracks have loaded (or on a bad fix). Lets a caller surface
   * "no track nearby" *before* recording arms (the engine only evaluates this
   * internally while recording).
   */
  nearTrack(lat: number, lon: number): boolean | null {
    if (!this.tracksLoaded) return null;
    if (validateGpsCoords(lat, lon) !== null) return null;
    return findNearestTrack(lat, lon, this.tracks, NEAR_TRACK_RADIUS_M) !== null;
  }

  /**
   * Name of the nearest known track within ~10 mi of `(lat, lon)`, or `null`
   * (far / not loaded / bad fix). Companion to `nearTrack` so the waiting-state
   * UI can name the recognised track, not just know one is nearby.
   */
  nearestTrackName(lat: number, lon: number): string | null {
    if (!this.tracksLoaded) return null;
    if (validateGpsCoords(lat, lon) !== null) return null;
    return findNearestTrack(lat, lon, this.tracks, NEAR_TRACK_RADIUS_M)?.name ?? null;
  }

  /** All samples fed so far (the would-be log buffer). */
  getSamples(): readonly GpsSample[] {
    return this.samples;
  }

  getLaps(): readonly Lap[] {
    return this.laps;
  }

  private tryDetect(): void {
    if (this.samples.length < MIN_DETECT_SAMPLES || this.tracks.length === 0) return;
    if (this.samples.length - this.samplesAtLastDetect < DETECT_EVERY) return;
    this.samplesAtLastDetect = this.samples.length;

    const result = autoDetectCourse(this.samples, this.tracks);
    if (!result) return;
    if (!result.isWaypointMode) {
      this.course = result.course;
      this.trackName = result.track?.name ?? null;
      this.direction = result.direction ?? null;
      this.isWaypointMode = false;
    } else {
      // Waypoint fallback: surface the rough laps but don't lock a course (its
      // geometry isn't a real start/finish line) — we re-detect periodically.
      this.isWaypointMode = true;
      this.trackName = result.track?.name ?? null;
      this.waypointCourseName = result.course?.name ?? null;
      this.laps = result.laps;
    }
  }

  private computeState(latest: GpsSample): TimingState {
    if (!this.course) return { ...EMPTY_TIMING_STATE, speedMph: latest.speedMph };
    // The two O(n) operations are throttled by session time; everything in
    // deriveFromLaps is O(lapCount) and runs every fix so the readout stays live.
    if (latest.t - this.lastHeavyT >= HEAVY_RECOMPUTE_MS) {
      this.laps = calculateLaps(this.samples, this.course);
      this.updateReference();
      this.cachedDeltaSec = this.computeDelta(this.bestLap());
      this.lastHeavyT = latest.t;
    }
    return this.deriveFromLaps(this.course.name, latest);
  }

  /** Rebuild the delta reference whenever the best lap improves. */
  private updateReference(): void {
    const best = this.bestLap();
    if (!best) {
      this.refLap = null;
      this.refForBestLapNumber = null;
      return;
    }
    if (this.refForBestLapNumber === best.lapNumber) return;
    const refSamples = this.samples.slice(best.startIndex, best.endIndex + 1);
    this.refLap = resampleByDistance(refSamples, DELTA_SAMPLE_METERS);
    this.refForBestLapNumber = best.lapNumber;
  }

  private bestLap(): Lap | null {
    let best: Lap | null = null;
    for (const lap of this.laps) {
      if (lap.lapTimeMs > 0 && (!best || lap.lapTimeMs < best.lapTimeMs)) best = lap;
    }
    return best;
  }

  private deriveFromLaps(courseName: string | null, latest: GpsSample): TimingState {
    const laps = this.laps;
    const best = this.bestLap();
    const last = laps.length > 0 ? laps[laps.length - 1] : null;
    const optimal = calculateOptimalLap(laps);

    // In-progress lap: elapsed since the last completed crossing (or session start).
    const lapStartT = last ? last.endTime : (this.samples[0]?.t ?? 0);
    const currentLapMs = latest.t - lapStartT;

    return {
      trackName: this.trackName,
      courseName,
      isWaypointMode: this.isWaypointMode,
      direction: this.direction,
      lapCount: laps.length,
      currentLapMs: currentLapMs >= 0 ? currentLapMs : null,
      lastLapMs: last ? last.lapTimeMs : null,
      bestLapMs: best ? best.lapTimeMs : null,
      bestLapNumber: best ? best.lapNumber : null,
      optimalMs: optimal ? optimal.optimalTimeMs : null,
      deltaSec: this.cachedDeltaSec,
      majorSectors: this.computeMajorSectors(last),
      speedMph: latest.speedMph,
      nearKnownTrack: this.nearKnownTrack,
      nearbyTrackName: this.trackName,
    };
  }

  /** Live gap of the in-progress lap vs the best lap (seconds; + = slower). */
  private computeDelta(best: Lap | null): number | null {
    if (!best || !this.refLap || this.refLap.xy.length < 2) return null;
    // The in-progress lap starts at the last completed S/F crossing.
    const lapStartIdx = this.laps.length > 0 ? this.laps[this.laps.length - 1].endIndex : 0;
    const current = this.samples.slice(lapStartIdx);
    if (current.length < 2) return null;
    const result = computePositionDelta(current, this.refLap);
    if (result.reversed) return null;
    for (let i = result.delta.length - 1; i >= 0; i--) {
      const d = result.delta[i];
      if (d != null) return d / 1000; // ms → s
    }
    return null;
  }

  /** Best + last value per major sector [S1, S2, S3]. */
  private computeMajorSectors(last: Lap | null): MajorSectorState[] {
    const hasRollup = this.laps.some((l) => l.sectors);
    if (!hasRollup) return [];
    const keys: Array<'s1' | 's2' | 's3'> = ['s1', 's2', 's3'];
    return keys.map((k) => {
      let bestVal: number | null = null;
      for (const lap of this.laps) {
        const v = lap.sectors?.[k];
        if (v != null && (bestVal == null || v < bestVal)) bestVal = v;
      }
      return { last: last?.sectors?.[k] ?? null, best: bestVal };
    });
  }
}
