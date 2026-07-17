import { describe, expect, it } from "vitest";

import type { GpsSample } from "@/types/racing";
import {
  PRE_ROLL_MS,
  buildTickPlan,
  planScrub,
  preRollFrames,
  sampleRpm,
  sampleTimeMs,
  sampleToPvt,
  sessionEndMs,
} from "./simPlayback";

const EPOCH = 1_775_319_260_000;

function mkSample(t: number, extra: Record<string, number> = {}): GpsSample {
  return {
    t,
    lat: 28.41 + t * 1e-9,
    lon: -81.37,
    speedMps: 10,
    speedMph: 22.37,
    speedKph: 36,
    heading: 90,
    extraFields: {
      satellites: 11,
      hdop: 0.8,
      altitude: 30,
      h_acc: 0.4,
      rpm: 8100.4,
      accel_x: -0.2,
      accel_y: 0.1,
      accel_z: -1.0,
      ...extra,
    },
  };
}

describe("sampleToPvt", () => {
  it("maps a parsed sample onto the injectPvt contract fields", () => {
    const pvt = sampleToPvt(mkSample(40), EPOCH);
    expect(pvt.timestamp).toBe(EPOCH + 40);
    expect(pvt.lat).toBeCloseTo(28.41, 5);
    expect(pvt.lng).toBeCloseTo(-81.37, 5);
    expect(pvt.sats).toBe(11);
    expect(pvt.hdop).toBeCloseTo(0.8);
    expect(pvt.speed_mph).toBeCloseTo(22.37);
    expect(pvt.altitude_m).toBe(30);
    expect(pvt.heading_deg).toBe(90);
    expect(pvt.h_acc_m).toBeCloseTo(0.4);
    expect(pvt.fix).toBe(true);
    expect(pvt.accelX).toBeCloseTo(-0.2);
    expect(pvt.accelZ).toBeCloseTo(-1.0);
  });

  it("fills sane defaults when optional channels are absent", () => {
    const bare: GpsSample = {
      t: 0,
      lat: 1,
      lon: 2,
      speedMps: 0,
      speedMph: 0,
      speedKph: 0,
      extraFields: {},
    };
    const pvt = sampleToPvt(bare, EPOCH);
    expect(pvt.sats).toBe(10);
    expect(pvt.hdop).toBe(1.0);
    expect(pvt.heading_deg).toBe(0);
    expect(pvt.accelZ).toBe(1);
  });
});

describe("sampleRpm", () => {
  it("rounds the rpm channel", () => {
    expect(sampleRpm(mkSample(0))).toBe(8100);
  });
  it("is 0 when the channel is missing or non-positive", () => {
    expect(sampleRpm(mkSample(0, { rpm: -5 }))).toBe(0);
    const s = mkSample(0);
    delete s.extraFields["rpm"];
    expect(sampleRpm(s)).toBe(0);
  });
});

describe("preRollFrames", () => {
  it("emits no-fix frames strictly before the session epoch", () => {
    const frames = preRollFrames(EPOCH);
    expect(frames.length).toBe(PRE_ROLL_MS / 200);
    for (const f of frames) {
      expect(f.pvt!.fix).toBe(false);
      expect(f.pvt!.timestamp).toBeLessThan(EPOCH);
      expect(f.rpm).toBe(0);
      expect(f.stepMs).toBe(200);
    }
    // Satellite count creeps upward but never "locks".
    expect(frames[0].pvt!.sats).toBeLessThanOrEqual(frames.at(-1)!.pvt!.sats);
  });
});

describe("buildTickPlan", () => {
  const samples = [mkSample(0), mkSample(40), mkSample(80), mkSample(120)];

  it("injects every row inside the window at its own timestamp", () => {
    const { actions, nextIndex } = buildTickPlan(
      samples, EPOCH, EPOCH, EPOCH + 100, 0,
    );
    // rows at +40 and +80 land; +0 is at the window start (already done),
    // +120 is beyond it. Final remainder step lands exactly on toMs.
    expect(actions.map((a) => a.pvt?.timestamp)).toEqual([
      EPOCH + 40,
      EPOCH + 80,
      undefined,
    ]);
    expect(actions.map((a) => a.stepMs)).toEqual([40, 40, 20]);
    expect(actions[0].rpm).toBe(8100);
    expect(nextIndex).toBe(3);
  });

  it("resumes from nextIndex without re-scanning", () => {
    const first = buildTickPlan(samples, EPOCH, EPOCH, EPOCH + 100, 0);
    const second = buildTickPlan(
      samples, EPOCH, EPOCH + 100, EPOCH + 200, first.nextIndex,
    );
    expect(second.actions.map((a) => a.pvt?.timestamp)).toEqual([
      EPOCH + 120,
      undefined,
    ]);
    // 20 ms from the window start to the row, 80 ms remainder.
    expect(second.actions.map((a) => a.stepMs)).toEqual([20, 80]);
  });

  it("produces a bare step when no rows fall inside the window", () => {
    const { actions } = buildTickPlan(samples, EPOCH, EPOCH + 130, EPOCH + 150, 4);
    expect(actions).toEqual([{ stepMs: 20 }]);
  });

  it("total stepped time always equals the window span", () => {
    const span = (from: number, to: number) => {
      const { actions } = buildTickPlan(samples, EPOCH, from, to, 0);
      return actions.reduce((ms, a) => ms + a.stepMs, 0);
    };
    expect(span(EPOCH, EPOCH + 100)).toBe(100);
    expect(span(EPOCH - 50, EPOCH + 130)).toBe(180);
    expect(span(EPOCH + 500, EPOCH + 700)).toBe(200);
  });
});

describe("planScrub", () => {
  it("fast-forwards in place when seeking forward", () => {
    expect(planScrub(1000, 5000, 0)).toEqual({
      reset: false,
      replayFromMs: 1000,
    });
  });
  it("requires a fresh boot when seeking backward", () => {
    expect(planScrub(5000, 1000, 100)).toEqual({
      reset: true,
      replayFromMs: 100,
    });
  });
});

describe("sessionEndMs", () => {
  it("is the last sample's absolute timestamp", () => {
    expect(
      sessionEndMs([mkSample(0), mkSample(40)], EPOCH),
    ).toBe(EPOCH + 40);
  });
  it("degrades to the epoch for an empty session", () => {
    expect(sessionEndMs([], EPOCH)).toBe(EPOCH);
  });
});
