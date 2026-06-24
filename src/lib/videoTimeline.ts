/**
 * Pure session-time ↔ video-time model.
 *
 * A synced video is anchored to ABSOLUTE session time by `syncOffsetMs` (the
 * session time, ms from session start, that lines up with video virtual time 0)
 * and an optional `syncRate` (how fast video time advances per unit session
 * time; `1` = the clocks tick together). Because `GpsSample.t` is absolute
 * session time, this anchor is fixed for the whole session — switching laps or
 * cropping the range never moves it, so a video is synced once.
 *
 *   videoVirtualSec = syncRate * (sessionMs - syncOffsetMs) / 1000
 *   sessionMs       = syncOffsetMs + (videoVirtualSec / syncRate) * 1000
 *
 * `syncRate` exists because the camera and datalogger clocks can run at slightly
 * different rates: a single offset lines up at one moment but drifts later in the
 * session. The rate is calibrated from extra (sessionMs ↔ videoSec) anchors via
 * `fitVideoTimeline` and defaults to `1` (pure offset — the legacy behaviour),
 * so nothing changes until a second anchor is provided.
 *
 * `syncOffsetMs > 0` means the camera started AFTER the datalogger (the common
 * case — the video covers only a later slice of the session); `< 0` means it
 * started before. The footage therefore covers a finite window of the session
 * timeline, and session times outside it have no video ("partial video").
 */

/** Where a session time falls relative to the video's coverage window. */
export type VideoCoverage = 'before' | 'covered' | 'after';

/** Absolute session time (ms) → video virtual time (seconds). */
export function sessionMsToVideoSec(sessionMs: number, syncOffsetMs: number, syncRate = 1): number {
  return (syncRate * (sessionMs - syncOffsetMs)) / 1000;
}

/** Video virtual time (seconds) → absolute session time (ms). */
export function videoSecToSessionMs(videoSec: number, syncOffsetMs: number, syncRate = 1): number {
  return (videoSec / syncRate) * 1000 + syncOffsetMs;
}

/** The session-time window [startMs, endMs] the footage covers. */
export function videoCoverageMs(
  syncOffsetMs: number,
  durationSec: number,
  syncRate = 1,
): { startMs: number; endMs: number } {
  return { startMs: syncOffsetMs, endMs: syncOffsetMs + (durationSec / syncRate) * 1000 };
}

/**
 * Whether a session time has video, and if not which side it falls off:
 * `before` = footage hasn't started yet, `after` = footage already ended.
 */
export function coverageOf(
  sessionMs: number,
  syncOffsetMs: number,
  durationSec: number,
  syncRate = 1,
): VideoCoverage {
  const videoSec = sessionMsToVideoSec(sessionMs, syncOffsetMs, syncRate);
  if (videoSec < 0) return 'before';
  if (videoSec > durationSec) return 'after';
  return 'covered';
}

/** How much of a lap (by its absolute start/end ms) the footage covers. */
export function lapCoverage(
  lapStartMs: number,
  lapEndMs: number,
  syncOffsetMs: number,
  durationSec: number,
  syncRate = 1,
): 'full' | 'partial' | 'none' {
  const { startMs, endMs } = videoCoverageMs(syncOffsetMs, durationSec, syncRate);
  if (lapEndMs < startMs || lapStartMs > endMs) return 'none';
  if (lapStartMs >= startMs && lapEndMs <= endMs) return 'full';
  return 'partial';
}

/** A known (session time ↔ video virtual time) correspondence. */
export interface VideoTimeAnchor {
  sessionMs: number;
  videoSec: number;
}

/** Plausible bounds for the camera/datalogger clock-rate ratio. */
const MIN_RATE = 0.5;
const MAX_RATE = 2;

/**
 * Derive `{ syncOffsetMs, syncRate }` from a trusted primary anchor (the user's
 * sync point) plus any number of extra calibration anchors (e.g. one per lap
 * the user has fine-aligned). The fit is a slope **constrained to pass through
 * the primary anchor**, so the moment the user originally synced stays pixel-
 * exact while the rate corrects the drift everywhere else; extra anchors beyond
 * the first are folded in by least squares so the estimate refines as more are
 * added. With no extra anchors the rate is `1` (pure offset).
 */
export function fitVideoTimeline(
  primary: VideoTimeAnchor | null,
  extra: VideoTimeAnchor[] = [],
): { syncOffsetMs: number; syncRate: number } {
  if (!primary) return { syncOffsetMs: 0, syncRate: 1 };

  // Slope through the primary anchor: rate = Σ(Δs·Δv) / Σ(Δs²), with Δs in
  // seconds (ΔsessionMs/1000) and Δv in video seconds.
  let num = 0;
  let den = 0;
  for (const a of extra) {
    const ds = (a.sessionMs - primary.sessionMs) / 1000;
    const dv = a.videoSec - primary.videoSec;
    num += ds * dv;
    den += ds * ds;
  }

  let rate = den > 0 ? num / den : 1;
  if (!Number.isFinite(rate) || rate < MIN_RATE || rate > MAX_RATE) rate = 1;

  // Offset so the line videoSec = rate·(sessionMs − offset)/1000 passes the
  // primary anchor exactly.
  const syncOffsetMs = primary.sessionMs - (primary.videoSec / rate) * 1000;
  return { syncOffsetMs, syncRate: rate };
}

