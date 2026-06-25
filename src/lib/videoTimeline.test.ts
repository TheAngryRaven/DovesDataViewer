import { describe, it, expect } from "vitest";
import {
  sessionMsToVideoSec,
  videoSecToSessionMs,
  videoCoverageMs,
  coverageOf,
  lapCoverage,
  fitVideoTimeline,
  videoSlaveAction,
  resyncThresholdSec,
  needsResync,
} from "./videoTimeline";

// The video sync anchor is absolute session time: one syncOffsetMs maps the
// whole session timeline onto the recording, so lap/range changes never move it.

describe("sessionMsToVideoSec / videoSecToSessionMs", () => {
  it("round-trips through the offset", () => {
    const offset = 5000; // camera started 5s after the datalogger
    expect(sessionMsToVideoSec(5000, offset)).toBe(0);
    expect(sessionMsToVideoSec(35000, offset)).toBe(30);
    expect(videoSecToSessionMs(30, offset)).toBe(35000);
    expect(videoSecToSessionMs(sessionMsToVideoSec(42000, offset), offset)).toBeCloseTo(42000, 6);
  });

  it("handles a negative offset (camera started before the datalogger)", () => {
    const offset = -2000;
    expect(sessionMsToVideoSec(0, offset)).toBe(2); // session start is 2s into the video
    expect(videoSecToSessionMs(0, offset)).toBe(-2000);
  });

  it("is independent of which lap a sample belongs to (sync once)", () => {
    const offset = 5000;
    // The same absolute sample time maps to the same video time regardless of
    // how the cursor reached it (lap 1 view vs lap 2 view vs all-laps).
    const sampleAbsMs = 95000; // somewhere in a later lap
    expect(sessionMsToVideoSec(sampleAbsMs, offset)).toBe(90);
    // Re-deriving from a different "view" (no offset change) is identical.
    expect(sessionMsToVideoSec(sampleAbsMs, offset)).toBe(90);
  });
});

describe("videoCoverageMs", () => {
  it("returns the session-time window the footage spans", () => {
    expect(videoCoverageMs(5000, 120)).toEqual({ startMs: 5000, endMs: 125000 });
  });
});

describe("coverageOf", () => {
  const offset = 5000;
  const duration = 120; // 2 min of footage starting 5s into the session

  it("flags session times before the footage starts", () => {
    expect(coverageOf(0, offset, duration)).toBe("before");
    expect(coverageOf(4999, offset, duration)).toBe("before");
  });

  it("flags session times within the footage", () => {
    expect(coverageOf(5000, offset, duration)).toBe("covered");
    expect(coverageOf(60000, offset, duration)).toBe("covered");
    expect(coverageOf(125000, offset, duration)).toBe("covered");
  });

  it("flags session times after the footage ends", () => {
    expect(coverageOf(125001, offset, duration)).toBe("after");
    expect(coverageOf(180000, offset, duration)).toBe("after");
  });
});

describe("lapCoverage", () => {
  const offset = 5000;
  const duration = 120; // covers session [5000, 125000] ms

  it("none when the lap is entirely outside the footage", () => {
    expect(lapCoverage(0, 4000, offset, duration)).toBe("none");
    expect(lapCoverage(130000, 140000, offset, duration)).toBe("none");
  });

  it("full when the lap is entirely inside the footage", () => {
    expect(lapCoverage(10000, 90000, offset, duration)).toBe("full");
  });

  it("partial when the lap straddles a footage boundary", () => {
    expect(lapCoverage(0, 60000, offset, duration)).toBe("partial"); // starts before footage
    expect(lapCoverage(100000, 140000, offset, duration)).toBe("partial"); // ends after footage
  });
});

// ─── rate-aware conversion ───────────────────────────────────────────────────

describe("syncRate (clock-rate-aware conversion)", () => {
  it("defaults to rate 1 (legacy pure-offset behaviour)", () => {
    expect(sessionMsToVideoSec(35000, 5000)).toBe(30);
    expect(sessionMsToVideoSec(35000, 5000, 1)).toBe(30);
  });

  it("scales video time by the rate, pivoting at the offset", () => {
    // rate 1.01: video runs 1% fast vs telemetry. At the offset the video is
    // still 0; 30s of telemetry later the video has advanced 30.3s.
    expect(sessionMsToVideoSec(5000, 5000, 1.01)).toBe(0);
    expect(sessionMsToVideoSec(35000, 5000, 1.01)).toBeCloseTo(30.3, 6);
  });

  it("round-trips with a non-unit rate", () => {
    const offset = 5000;
    const rate = 1.013;
    const v = sessionMsToVideoSec(42000, offset, rate);
    expect(videoSecToSessionMs(v, offset, rate)).toBeCloseTo(42000, 6);
  });

  it("shrinks the covered session window when the video runs fast", () => {
    // 60s of footage at rate 1.2 covers only 50s of session time.
    const { startMs, endMs } = videoCoverageMs(0, 60, 1.2);
    expect(startMs).toBe(0);
    expect(endMs).toBeCloseTo(50000, 6);
    expect(coverageOf(49000, 0, 60, 1.2)).toBe("covered");
    expect(coverageOf(51000, 0, 60, 1.2)).toBe("after");
  });
});

// ─── fitVideoTimeline ────────────────────────────────────────────────────────

describe("fitVideoTimeline", () => {
  it("returns the default model with no primary anchor", () => {
    expect(fitVideoTimeline(null)).toEqual({ syncOffsetMs: 0, syncRate: 1 });
  });

  it("with only the primary anchor, gives rate 1 and the offset through it", () => {
    // Primary: session 5000ms ↔ video 0s → offset 5000, rate 1.
    expect(fitVideoTimeline({ sessionMs: 5000, videoSec: 0 })).toEqual({
      syncOffsetMs: 5000,
      syncRate: 1,
    });
    // session 35000ms ↔ video 30s, alone → offset = 35000 - 30000 = 5000.
    const fit = fitVideoTimeline({ sessionMs: 35000, videoSec: 30 });
    expect(fit.syncRate).toBe(1);
    expect(fit.syncOffsetMs).toBeCloseTo(5000, 6);
  });

  it("recovers a known rate from one extra anchor, keeping the primary exact", () => {
    // Truth: video runs 1% fast, offset 5000 → videoSec = 1.01*(sessionMs-5000)/1000.
    const primary = { sessionMs: 5000, videoSec: 0 };
    const extra = { sessionMs: 65000, videoSec: 1.01 * 60 }; // 60.6
    const { syncOffsetMs, syncRate } = fitVideoTimeline(primary, [extra]);
    expect(syncRate).toBeCloseTo(1.01, 6);
    expect(syncOffsetMs).toBeCloseTo(5000, 6);
    // Primary stays pixel-exact; the extra anchor is now predicted correctly.
    expect(sessionMsToVideoSec(5000, syncOffsetMs, syncRate)).toBeCloseTo(0, 9);
    expect(sessionMsToVideoSec(65000, syncOffsetMs, syncRate)).toBeCloseTo(60.6, 6);
  });

  it("least-squares-fits the slope across multiple noisy anchors", () => {
    const primary = { sessionMs: 0, videoSec: 0 };
    // Perfectly rate-1.02 anchors → slope 1.02 exactly.
    const extra = [
      { sessionMs: 10000, videoSec: 10.2 },
      { sessionMs: 20000, videoSec: 20.4 },
      { sessionMs: 30000, videoSec: 30.6 },
    ];
    const { syncRate } = fitVideoTimeline(primary, extra);
    expect(syncRate).toBeCloseTo(1.02, 6);
  });

  it("rejects implausible rates (degenerate/garbage anchors) → rate 1", () => {
    const primary = { sessionMs: 5000, videoSec: 0 };
    // Extra anchor coincides in session time → zero baseline → no slope info.
    expect(fitVideoTimeline(primary, [{ sessionMs: 5000, videoSec: 9 }]).syncRate).toBe(1);
    // Wildly inconsistent anchor would imply a >2× rate → clamped back to 1.
    expect(fitVideoTimeline(primary, [{ sessionMs: 6000, videoSec: 100 }]).syncRate).toBe(1);
  });
});

// ─── playback coordination policy ────────────────────────────────────────────

describe("videoSlaveAction", () => {
  const base = { isLocked: true, dataIsPlaying: true, hasVideo: true, coverage: "covered" as const };

  it("plays the video natively when locked, playing, and over footage", () => {
    expect(videoSlaveAction(base)).toBe("play");
  });

  it("holds (blanks) the video when the cursor is in an uncovered gap", () => {
    expect(videoSlaveAction({ ...base, coverage: "before" })).toBe("hold");
    expect(videoSlaveAction({ ...base, coverage: "after" })).toBe("hold");
  });

  it("is idle when not coordinating (unlocked, not playing, or no video)", () => {
    expect(videoSlaveAction({ ...base, isLocked: false })).toBe("idle");
    expect(videoSlaveAction({ ...base, dataIsPlaying: false })).toBe("idle");
    expect(videoSlaveAction({ ...base, hasVideo: false })).toBe("idle");
  });

  it("idle wins even over a covered cursor (no coordination at all)", () => {
    expect(videoSlaveAction({ isLocked: false, dataIsPlaying: true, hasVideo: true, coverage: "covered" })).toBe("idle");
  });
});

describe("resyncThresholdSec", () => {
  it("is a couple of frames at the given fps", () => {
    expect(resyncThresholdSec(30)).toBeCloseTo(2 / 30, 9);
    expect(resyncThresholdSec(60)).toBeCloseTo(2 / 60, 9);
    expect(resyncThresholdSec(60, 1)).toBeCloseTo(1 / 60, 9);
  });

  it("falls back to 30fps for a garbage fps", () => {
    expect(resyncThresholdSec(0)).toBeCloseTo(2 / 30, 9);
    expect(resyncThresholdSec(Number.NaN)).toBeCloseTo(2 / 30, 9);
    expect(resyncThresholdSec(-5)).toBeCloseTo(2 / 30, 9);
  });
});

describe("needsResync", () => {
  it("ignores sub-threshold jitter", () => {
    expect(needsResync(10.0, 10.02, resyncThresholdSec(30))).toBe(false); // 20ms < ~66ms
  });

  it("triggers once drift exceeds the threshold", () => {
    expect(needsResync(10.0, 10.2, resyncThresholdSec(30))).toBe(true); // 200ms > ~66ms
  });

  it("is symmetric (video ahead or behind)", () => {
    const th = resyncThresholdSec(30);
    expect(needsResync(10.2, 10.0, th)).toBe(true);
    expect(needsResync(9.8, 10.0, th)).toBe(true);
  });
});
