import { describe, it, expect, vi } from "vitest";
import { DataloggerSession, type DataloggerSnapshot } from "./dataloggerSession";
import { CustomGps, RealtimeLapTimer, AUTO_END_STOPPED_MS } from "@/lib/gps";

/** Controllable fake Geolocation (mirrors the one in customGps.test.ts). */
class FakeGeo {
  successCb: PositionCallback | null = null;
  errorCb: PositionErrorCallback | null = null;
  watchCalls = 0;
  cleared: number[] = [];
  private nextId = 1;

  watchPosition(s: PositionCallback, e?: PositionErrorCallback | null): number {
    this.watchCalls++;
    this.successCb = s;
    this.errorCb = e ?? null;
    return this.nextId++;
  }
  clearWatch(id: number): void {
    this.cleared.push(id);
  }
  getCurrentPosition(): void { /* unused */ }

  emit(coords: Partial<GeolocationCoordinates>, timestamp: number): void {
    this.successCb?.({
      timestamp,
      coords: {
        latitude: 45,
        longitude: -73,
        altitude: null,
        accuracy: 5,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        ...coords,
      } as GeolocationCoordinates,
    } as GeolocationPosition);
  }
}

const BASE_TS = 1_700_000_000_000;
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function setup(saveLog = vi.fn().mockResolvedValue(undefined)) {
  const geo = new FakeGeo();
  const gps = new CustomGps({ geolocation: geo as unknown as Geolocation, retainBuffer: false });
  const timer = new RealtimeLapTimer();
  const saveMeta = vi.fn().mockResolvedValue(undefined);
  const session = new DataloggerSession({ gps, timer, saveLog, saveMeta });
  const snapshots: DataloggerSnapshot[] = [];
  session.subscribe((s) => snapshots.push(s));
  return { geo, gps, timer, saveLog, saveMeta, session, snapshots };
}

/** Emit `n` moving fixes (speed in m/s; 10 ≈ 22 mph, well above the 5 mph arm). */
function drive(geo: FakeGeo, n: number, speed = 10, startTs = BASE_TS): void {
  for (let i = 0; i < n; i++) geo.emit({ latitude: 45 + i * 0.0001, speed }, startTs + i * 1_000);
}

describe("DataloggerSession", () => {
  it("stays in waiting below the arm speed", () => {
    const { geo, session } = setup();
    session.start();
    geo.emit({ speed: 1 }, BASE_TS); // ~2 mph
    expect(session.getSnapshot().phase).toBe("waiting");
  });

  it("arms and records once above the arm speed", () => {
    const { geo, session } = setup();
    session.start();
    drive(geo, 3);
    const s = session.getSnapshot();
    expect(s.phase).toBe("recording");
    expect(s.latest).not.toBeNull();
  });

  // Regression: ending with nothing recorded must NOT get stuck "saving" and must
  // not write a file.
  it("ends cleanly with no data — not stuck saving, nothing written", async () => {
    const { geo, session, saveLog, saveMeta } = setup();
    session.start();
    geo.emit({ speed: 1 }, BASE_TS); // never arms
    await session.endSession();
    const s = session.getSnapshot();
    expect(s.phase).toBe("ended");
    expect(s.saving).toBe(false);
    expect(s.savedFileName).toBeNull();
    expect(saveLog).not.toHaveBeenCalled();
    expect(saveMeta).not.toHaveBeenCalled();
  });

  it("persists a .dovep log + metadata on manual end", async () => {
    const { geo, session, saveLog, saveMeta } = setup();
    session.start();
    drive(geo, 5);
    await session.endSession();
    const s = session.getSnapshot();
    expect(saveLog).toHaveBeenCalledTimes(1);
    const [name, blob] = saveLog.mock.calls[0];
    expect(name).toMatch(/\.dovep$/);
    expect(blob).toBeInstanceOf(Blob);
    expect(saveMeta).toHaveBeenCalledTimes(1);
    expect(s.savedFileName).toBe(name);
    expect(s.saving).toBe(false);
    expect(s.phase).toBe("ended");
  });

  it("does not double-save when endSession is called twice", async () => {
    const { geo, session, saveLog } = setup();
    session.start();
    drive(geo, 3);
    await session.endSession();
    await session.endSession();
    expect(saveLog).toHaveBeenCalledTimes(1);
  });

  it("reset() returns to waiting and re-arms the GPS for a new session", async () => {
    const { geo, session } = setup();
    session.start();
    drive(geo, 3);
    await session.endSession();

    session.reset();
    expect(session.getSnapshot().phase).toBe("waiting");
    expect(session.getSnapshot().savedFileName).toBeNull();
    expect(geo.watchCalls).toBe(2); // GPS restarted

    drive(geo, 3, 10, BASE_TS + 1_000_000);
    expect(session.getSnapshot().phase).toBe("recording");
  });

  it("surfaces a save error and clears the saving flag", async () => {
    const { geo, session, saveLog } = setup(vi.fn().mockRejectedValue(new Error("disk full")));
    session.start();
    drive(geo, 3);
    await session.endSession();
    const s = session.getSnapshot();
    expect(s.error).toMatch(/disk full/);
    expect(s.saving).toBe(false);
  });

  it("auto-ends and persists after the stopped-idle timeout", async () => {
    const { geo, session, saveLog } = setup();
    session.start();
    drive(geo, 2); // arm + record
    geo.emit({ speed: 0 }, BASE_TS + 5_000); // stopped — idle timer starts
    geo.emit({ speed: 0 }, BASE_TS + 5_000 + AUTO_END_STOPPED_MS + 1_000); // past the timeout
    expect(session.getSnapshot().phase).toBe("ended");
    await flush();
    expect(saveLog).toHaveBeenCalledTimes(1);
  });

  it("forwards a GPS error to the snapshot", () => {
    const { geo, session } = setup();
    session.start();
    geo.errorCb?.({ code: 1, message: "denied" } as GeolocationPositionError);
    expect(session.getSnapshot().error).toBe("denied");
  });
});
