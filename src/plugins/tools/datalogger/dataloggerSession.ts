/**
 * DataloggerSession — the framework-free orchestration for the Datalogger tool.
 *
 * Holds the session lifecycle that used to live inside the React hook: it drives
 * the GPS source through the session gate (arm above 5 mph / auto-idle), feeds
 * recorded fixes to the realtime timer, and persists the session as a `.dovep`
 * log on end. Every dependency (GPS source, timer, save functions) is injected,
 * so the whole flow is unit-testable with a fake geolocation + fake persistence —
 * the hook is then a thin adapter that subscribes to snapshots.
 */
import {
  type CustomGps,
  type GpsObservation,
  type RealtimeLapTimer,
  type TimingState,
  EMPTY_TIMING_STATE,
  observationToSample,
  initSessionGate,
  stepSessionGate,
  endSessionGate,
  type SessionGateState,
  type SessionPhase,
  serializeDovepBlob,
  buildDovepFileName,
  type DovepSessionMeta,
} from "@/lib/gps";
import type { Lap } from "@/types/racing";
import type { FileMetadata } from "@/lib/fileStorage";
import { MPS_TO_MPH } from "@/lib/parserUtils";

export interface DataloggerSnapshot {
  phase: SessionPhase;
  timing: TimingState;
  /** Completed laps with major-sector rollup. */
  laps: Lap[];
  /** Latest captured observation (live speed/quality). */
  latest: GpsObservation | null;
  /** True while the `.dovep` log is being written. */
  saving: boolean;
  /** Filename once the session has been saved. */
  savedFileName: string | null;
  error: string | null;
}

export const INITIAL_SNAPSHOT: DataloggerSnapshot = {
  phase: "waiting",
  timing: EMPTY_TIMING_STATE,
  laps: [],
  latest: null,
  saving: false,
  savedFileName: null,
  error: null,
};

export interface DataloggerSessionDeps {
  gps: CustomGps;
  timer: RealtimeLapTimer;
  /** Persist the raw log blob (e.g. fileStorage.saveFile). */
  saveLog: (fileName: string, blob: Blob) => Promise<void>;
  /** Persist the file metadata (e.g. fileStorage.saveFileMetadata). */
  saveMeta: (meta: FileMetadata) => Promise<void>;
}

type Listener = (snapshot: DataloggerSnapshot) => void;

export class DataloggerSession {
  private gate: SessionGateState = initSessionGate();
  private recorded: GpsObservation[] = [];
  private snapshot: DataloggerSnapshot = INITIAL_SNAPSHOT;
  private readonly listeners = new Set<Listener>();
  private offFix: (() => void) | null = null;
  private offErr: (() => void) | null = null;

  constructor(private readonly deps: DataloggerSessionDeps) {}

  getSnapshot(): DataloggerSnapshot {
    return this.snapshot;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Subscribe to the GPS source and begin capturing. */
  start(): void {
    this.offFix = this.deps.gps.onFix((obs) => this.handleFix(obs));
    this.offErr = this.deps.gps.onError((err) => this.patch({ error: err.message }));
    this.deps.gps.start();
  }

  /** Manually end the session and persist it. */
  async endSession(): Promise<void> {
    if (this.gate.phase === "ended") return;
    this.gate = endSessionGate(this.gate);
    this.deps.gps.stop();
    this.patch({ phase: "ended" });
    await this.persist();
  }

  /** Discard the ended session and start a fresh capture (reuses GPS + tracks). */
  reset(): void {
    this.gate = initSessionGate();
    this.recorded = [];
    this.deps.timer.reset();
    this.deps.gps.clear();
    this.deps.gps.start();
    this.snapshot = INITIAL_SNAPSHOT;
    this.emit();
  }

  /** Tear down listeners and stop the GPS source. */
  dispose(): void {
    this.offFix?.();
    this.offErr?.();
    this.offFix = null;
    this.offErr = null;
    this.deps.gps.stop();
  }

  private handleFix(obs: GpsObservation): void {
    const speedMps = obs.fix.speed != null ? obs.fix.speed : obs.motion.speedMps ?? 0;
    const step = stepSessionGate(this.gate, speedMps * MPS_TO_MPH, obs.fix.timestamp);
    this.gate = step.state;

    const patch: Partial<DataloggerSnapshot> = { latest: obs };
    if (step.justArmed) patch.phase = "recording";

    if (this.gate.phase === "recording") {
      this.recorded.push(obs);
      patch.timing = this.deps.timer.update(observationToSample(obs));
      // Completed laps are immutable once closed — only swap the array (and
      // re-render the table) when a lap actually completes.
      const completed = this.deps.timer.getLaps();
      if (completed.length !== this.snapshot.laps.length) patch.laps = [...completed];
    } else {
      // Before logging arms, still surface track proximity so the UI can explain
      // speedometer mode — either "no tracks nearby" or, when we *do* recognise a
      // track, confirm it by name (so a stationary driver knows detection worked).
      patch.timing = {
        ...this.snapshot.timing,
        nearKnownTrack: this.deps.timer.nearTrack(obs.fix.lat, obs.fix.lon),
        nearbyTrackName: this.deps.timer.nearestTrackName(obs.fix.lat, obs.fix.lon),
      };
    }
    this.patch(patch);

    if (step.autoEnded) {
      this.deps.gps.stop();
      this.patch({ phase: "ended" });
      void this.persist();
    }
  }

  /** Serialize the recorded buffer to a `.dovep` log and store it. */
  private async persist(): Promise<void> {
    if (this.snapshot.saving || this.recorded.length === 0) return;
    this.patch({ saving: true });

    const t = this.deps.timer.getState();
    const laps = [...this.deps.timer.getLaps()];
    const startTs = this.recorded[0].fix.timestamp;
    const fileName = buildDovepFileName(startTs);
    const meta: DovepSessionMeta = {
      course: t.courseName ?? undefined,
      bestLapMs: t.bestLapMs ?? undefined,
      optimalMs: t.optimalMs ?? undefined,
      lapTimesMs: laps.map((l) => l.lapTimeMs),
    };

    try {
      await this.deps.saveLog(fileName, serializeDovepBlob(this.recorded, meta));
      await this.deps.saveMeta({
        fileName,
        trackName: t.trackName ?? "",
        courseName: t.courseName ?? "",
        sessionStartTime: startTs,
        fastestLapMs: t.bestLapMs ?? undefined,
      });
      this.patch({ saving: false, savedFileName: fileName });
    } catch (e) {
      this.patch({ saving: false, error: `Failed to save session: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  private patch(partial: Partial<DataloggerSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    this.emit();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener(this.snapshot);
  }
}
