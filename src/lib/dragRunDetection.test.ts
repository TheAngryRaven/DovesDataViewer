import { describe, it, expect } from "vitest";
import {
  detectDragRuns,
  DRAG_MARKS_FT,
  LAUNCH_MOTION_MPH,
  MIN_RUN_PEAK_MPH,
} from "./dragRunDetection";
import { autoDetectCourse } from "./courseDetection";
import { speedTriple, EARTH_RADIUS_M } from "./parserUtils";
import type { GpsSample, Track } from "@/types/racing";

// ─── Trace builder ───────────────────────────────────────────────────────────
//
// 10 Hz synthetic GPS traces around (0, 0), positions in local meters
// (x = east, y = north) converted through the same equirectangular scale the
// production distance math uses, so distances round-trip exactly.

const DT_MS = 100;
const M_PER_DEG = (Math.PI / 180) * EARTH_RADIUS_M;
/** Reported speed while staged: ~0.5 mph of Doppler wander, below STAGE_SPEED_MPH. */
const IDLE_MPS = 0.22;

function makeTrace() {
  const samples: GpsSample[] = [];
  const state = { t: 0, x: 0, y: 0, heading: 0, v: 0 };

  const emit = (v = state.v, x = state.x, y = state.y) => {
    samples.push({ t: state.t, lat: y / M_PER_DEG, lon: x / M_PER_DEG, ...speedTriple(v), extraFields: {} });
  };

  const api = {
    samples,
    state,
    /** Stationary staging. Optional position jitter simulates GPS wander; the last sample returns to base. */
    idle(seconds: number, jitterM = 0) {
      const baseX = state.x;
      const baseY = state.y;
      state.v = IDLE_MPS;
      const n = Math.round((seconds * 1000) / DT_MS);
      for (let k = 0; k < n; k++) {
        state.t += DT_MS;
        const last = k === n - 1;
        const jx = last ? 0 : jitterM * Math.sin(k * 0.7);
        const jy = last ? 0 : jitterM * Math.cos(k * 1.3);
        emit(IDLE_MPS, baseX + jx, baseY + jy);
      }
      state.x = baseX;
      state.y = baseY;
    },
    /** Constant acceleration until `distM` of travel; curves at `radiusM` when finite (clockwise). */
    accelerate(aMps2: number, distM: number, radiusM = Infinity) {
      let traveled = 0;
      while (traveled < distM) {
        const v0 = state.v;
        state.v = Math.max(0, v0 + (aMps2 * DT_MS) / 1000);
        const d = ((v0 + state.v) / 2) * (DT_MS / 1000);
        if (isFinite(radiusM)) state.heading += d / radiusM;
        state.x += Math.sin(state.heading) * d;
        state.y += Math.cos(state.heading) * d;
        state.t += DT_MS;
        traveled += d;
        emit();
      }
    },
    /** Constant deceleration down to `targetMps`. */
    decelerate(aMps2: number, targetMps: number) {
      while (state.v > targetMps) {
        const v0 = state.v;
        state.v = Math.max(targetMps, v0 - (aMps2 * DT_MS) / 1000);
        const d = ((v0 + state.v) / 2) * (DT_MS / 1000);
        state.x += Math.sin(state.heading) * d;
        state.y += Math.cos(state.heading) * d;
        state.t += DT_MS;
        emit();
      }
    },
    /** Constant-speed travel for `distM`; curves at `radiusM` when finite (clockwise). */
    cruise(speedMps: number, distM: number, radiusM = Infinity) {
      state.v = speedMps;
      let traveled = 0;
      while (traveled < distM) {
        const d = speedMps * (DT_MS / 1000);
        if (isFinite(radiusM)) state.heading += d / radiusM;
        state.x += Math.sin(state.heading) * d;
        state.y += Math.cos(state.heading) * d;
        state.t += DT_MS;
        traveled += d;
        emit();
      }
    },
    /** A constant-radius turn through `deg` degrees (clockwise positive). */
    turn(radiusM: number, deg: number, speedMps: number) {
      api.cruise(speedMps, (Math.abs(deg) * Math.PI / 180) * radiusM, radiusM * Math.sign(deg));
    },
  };
  return api;
}

/** Stage → full quarter-mile pull at `a` m/s² → brake hard to a near-stop. */
function quarterPass(tr: ReturnType<typeof makeTrace>, a = 4) {
  tr.idle(5);
  tr.accelerate(a, 403);
  tr.decelerate(8, 0.1);
}

// A distant track so autoDetectCourse takes its no-nearby-track (waypoint) path
// instead of bailing on an empty track list.
const farTrack: Track = {
  name: "Far Away",
  courses: [
    {
      name: "Main",
      startFinishA: { lat: 1, lon: 0 },
      startFinishB: { lat: 1.0001, lon: 0 },
      isUserDefined: false,
    },
  ],
  isUserDefined: false,
};

// ─── Degenerate inputs ───────────────────────────────────────────────────────

describe("detectDragRuns - degenerate inputs", () => {
  it("returns null for empty samples", () => {
    expect(detectDragRuns([])).toBeNull();
  });

  it("returns null for a fully stationary trace", () => {
    const tr = makeTrace();
    tr.idle(60, 1);
    expect(detectDragRuns(tr.samples)).toBeNull();
  });
});

// ─── Clean pass ──────────────────────────────────────────────────────────────

describe("detectDragRuns - clean quarter pass", () => {
  const tr = makeTrace();
  quarterPass(tr);
  tr.idle(5);
  const result = detectDragRuns(tr.samples);

  it("detects exactly one run with all five marks", () => {
    expect(result).not.toBeNull();
    expect(result!.runs).toHaveLength(1);
    expect(result!.runs[0].marks.map((m) => m.markFt)).toEqual([...DRAG_MARKS_FT]);
  });

  it("suggests the quarter mile", () => {
    expect(result!.suggestedDistanceFt).toBe(1320);
  });

  it("mark times and speeds ascend", () => {
    const marks = result!.runs[0].marks;
    for (let i = 1; i < marks.length; i++) {
      expect(marks[i].elapsedMs).toBeGreaterThan(marks[i - 1].elapsedMs);
      expect(marks[i].speedMph).toBeGreaterThan(marks[i - 1].speedMph);
    }
  });

  it("times match constant-acceleration physics (a = 4 m/s²)", () => {
    const byFt = Object.fromEntries(result!.runs[0].marks.map((m) => [m.markFt, m]));
    // d = ½at² minus the sub-second t0/anchor offset ⇒ generous ±0.4 s bands.
    expect(byFt[60].elapsedMs).toBeGreaterThan(2400);
    expect(byFt[60].elapsedMs).toBeLessThan(3100);
    expect(byFt[660].elapsedMs).toBeGreaterThan(9400);
    expect(byFt[660].elapsedMs).toBeLessThan(10100);
    expect(byFt[1320].elapsedMs).toBeGreaterThan(13500);
    expect(byFt[1320].elapsedMs).toBeLessThan(14300);
    // Trap ≈ a·t ≈ 127 mph at the stripe.
    expect(byFt[1320].speedMph).toBeGreaterThan(120);
    expect(byFt[1320].speedMph).toBeLessThan(133);
  });

  it("each mark's interpolated time falls between its bracketing samples", () => {
    const run = result!.runs[0];
    for (const mark of run.marks) {
      const upper = tr.samples[mark.sampleIndex].t - run.t0;
      const lower = tr.samples[mark.sampleIndex - 1].t - run.t0;
      expect(mark.elapsedMs).toBeLessThanOrEqual(upper);
      expect(mark.elapsedMs).toBeGreaterThanOrEqual(lower);
    }
  });

  it("launches from the first confident-motion sample", () => {
    const run = result!.runs[0];
    expect(tr.samples[run.launchIndex].speedMph).toBeGreaterThan(LAUNCH_MOTION_MPH);
    expect(tr.samples[run.launchIndex - 1].speedMph).toBeLessThanOrEqual(LAUNCH_MOTION_MPH);
  });
});

// ─── Burnout / re-stage ──────────────────────────────────────────────────────

describe("detectDragRuns - burnout then re-stage", () => {
  it("anchors the single run at the last stage before the confirmed launch", () => {
    const tr = makeTrace();
    tr.idle(5);
    // Burnout roll-through: 6 mph for ~2 s never confirms as a launch.
    tr.cruise(2.7, 5.4);
    tr.decelerate(3, 0.1);
    tr.idle(5);
    const restageEndT = tr.state.t;
    tr.accelerate(4, 403);
    tr.decelerate(8, 0.1);
    tr.idle(3);

    const result = detectDragRuns(tr.samples);
    expect(result).not.toBeNull();
    expect(result!.runs).toHaveLength(1);
    // t0 is after the second staging period, not the burnout.
    expect(result!.runs[0].t0).toBeGreaterThanOrEqual(restageEndT);
  });
});

// ─── GPS wander while staged ─────────────────────────────────────────────────

describe("detectDragRuns - staged GPS wander", () => {
  it("position jitter before launch does not leak into the 60 ft time", () => {
    const clean = makeTrace();
    clean.idle(60);
    clean.accelerate(4, 403);
    clean.decelerate(8, 0.1);

    const jittered = makeTrace();
    jittered.idle(60, 1); // ±1 m of wander for a full minute
    jittered.accelerate(4, 403);
    jittered.decelerate(8, 0.1);

    const cleanRun = detectDragRuns(clean.samples)!.runs[0];
    const jitteredRun = detectDragRuns(jittered.samples)!.runs[0];
    const clean60 = cleanRun.marks.find((m) => m.markFt === 60)!.elapsedMs;
    const jittered60 = jitteredRun.marks.find((m) => m.markFt === 60)!.elapsedMs;
    expect(Math.abs(jittered60 - clean60)).toBeLessThanOrEqual(200);
  });
});

// ─── Back-to-back passes with a return road ──────────────────────────────────

function backToBackTrace() {
  const tr = makeTrace();
  for (let pass = 0; pass < 2; pass++) {
    tr.idle(10);
    tr.accelerate(4, 403);
    tr.decelerate(8, 10); // chute out, down to 10 m/s
    tr.turn(10, 180, 8); // turnaround, now heading south offset ~20 m east
    tr.cruise(10, 590); // return road, above RUN_END but below 30 mph
    tr.turn(10, 180, 8); // back onto the strip heading north
    tr.decelerate(3, 0.1);
  }
  tr.idle(3);
  return tr;
}

describe("detectDragRuns - back-to-back passes", () => {
  it("finds both passes and nothing on the return road", () => {
    const result = detectDragRuns(backToBackTrace().samples);
    expect(result).not.toBeNull();
    expect(result!.runs).toHaveLength(2);
    expect(result!.runs.map((r) => r.runNumber)).toEqual([1, 2]);
    expect(result!.runs[1].t0).toBeGreaterThan(result!.runs[0].t0);
    for (const run of result!.runs) {
      expect(run.marks.map((m) => m.markFt)).toEqual([...DRAG_MARKS_FT]);
    }
  });
});

// ─── Aborted / coast-through passes ──────────────────────────────────────────

describe("detectDragRuns - aborted pass", () => {
  it("scores only the marks reached under power", () => {
    const tr = makeTrace();
    quarterPass(tr); // complete sibling keeps the session gated in
    tr.idle(10);
    tr.accelerate(4, 152); // lift at ~500 ft
    tr.decelerate(3, 0.1);
    tr.idle(3);

    const result = detectDragRuns(tr.samples);
    expect(result).not.toBeNull();
    expect(result!.runs).toHaveLength(2);
    const aborted = result!.runs[1];
    expect(aborted.marks.map((m) => m.markFt)).toEqual([60, 330]);
    expect(aborted.maxScoredFt).toBeGreaterThan(450);
    expect(aborted.maxScoredFt).toBeLessThan(560);
  });

  it("does not score marks rolled through while coasting", () => {
    const tr = makeTrace();
    tr.idle(5);
    tr.accelerate(4, 202); // pull to just past the 660 mark…
    tr.accelerate(-2, 250); // …then coast/decelerate through 1000 and 1320
    tr.decelerate(3, 0.1);
    tr.idle(3);

    const result = detectDragRuns(tr.samples);
    expect(result).not.toBeNull();
    expect(result!.runs).toHaveLength(1);
    expect(result!.runs[0].marks.map((m) => m.markFt)).toEqual([60, 330, 660]);
    expect(result!.suggestedDistanceFt).toBe(660);
  });
});

// ─── Why ordering vs waypoint mode matters ───────────────────────────────────

describe("detectDragRuns - waypoint-mode false positive", () => {
  it("a drag session waypoint mode would mis-time is detected as drag runs", () => {
    const samples = backToBackTrace().samples;
    // The return road passes ~20 m from the first ≥30 mph point, so waypoint
    // detection happily makes "laps" out of drag passes…
    const waypoint = autoDetectCourse(samples, [farTrack]);
    expect(waypoint).not.toBeNull();
    expect(waypoint!.isWaypointMode).toBe(true);
    // …which is why useDataLoader must consult detectDragRuns FIRST.
    const drag = detectDragRuns(samples);
    expect(drag).not.toBeNull();
    expect(drag!.runs).toHaveLength(2);
  });
});

// ─── The "is this drag data?" gate ───────────────────────────────────────────

describe("detectDragRuns - gate", () => {
  it("rejects a curvy autocross-style run (straightness)", () => {
    const tr = makeTrace();
    tr.idle(5);
    tr.accelerate(4, 250, 100); // hard launch but on a 100 m-radius arc
    tr.decelerate(3, 0.1);
    tr.idle(3);
    expect(detectDragRuns(tr.samples)).toBeNull();
  });

  it("rejects a straight but slow roll (speed floor at the 660)", () => {
    const tr = makeTrace();
    tr.idle(5);
    tr.accelerate(3, 40); // brisk enough to confirm as a launch, tops out ~35 mph…
    tr.cruise(15.5, 700); // …held straight past the 660
    tr.decelerate(3, 0.1);
    tr.idle(3);
    // Peak clears MIN_RUN_PEAK_MPH but the 660 comes up short of 40 mph.
    expect(15.5 * 2.23694).toBeGreaterThan(MIN_RUN_PEAK_MPH);
    expect(detectDragRuns(tr.samples)).toBeNull();
  });

  it("rejects a staging-lane creep that never becomes a pass", () => {
    const tr = makeTrace();
    tr.idle(10);
    tr.cruise(4, 120); // ~9 mph pit roll
    tr.decelerate(3, 0.1);
    tr.idle(10);
    expect(detectDragRuns(tr.samples)).toBeNull();
  });
});
