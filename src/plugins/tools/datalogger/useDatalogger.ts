/**
 * Orchestration for the Datalogger tool: wires the GPS source, the session gate,
 * and the realtime lap timer, and persists the session as a `.dovep` log on end.
 * All testable logic lives in `@/lib/gps/*` (pure, unit-tested); this hook is the
 * thin browser-facing glue (geolocation + IndexedDB + React state).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CustomGps,
  type GpsObservation,
  RealtimeLapTimer,
  type TimingState,
  EMPTY_TIMING_STATE,
  observationToSample,
  initSessionGate,
  stepSessionGate,
  endSessionGate,
  type SessionPhase,
  serializeDovepBlob,
  buildDovepFileName,
  type DovepSessionMeta,
} from "@/lib/gps";
import type { Lap, Track } from "@/types/racing";
import { loadTracks } from "@/lib/trackStorage";
import { saveFile, saveFileMetadata } from "@/lib/fileStorage";

export interface DataloggerController {
  phase: SessionPhase;
  timing: TimingState;
  /** Completed laps with major-sector rollup (for the Lap Times list). */
  laps: Lap[];
  /** Latest captured observation (live speed/quality). */
  latest: GpsObservation | null;
  /** True while the `.dovep` log is being written to IndexedDB. */
  saving: boolean;
  /** Filename once the session has been saved. */
  savedFileName: string | null;
  error: string | null;
  /** Manually end + save the session (red "End" action). */
  endSession: () => Promise<void>;
  /** Discard the ended session and start a fresh capture. */
  reset: () => void;
}

export function useDatalogger(): DataloggerController {
  const gpsRef = useRef<CustomGps | null>(null);
  const timerRef = useRef<RealtimeLapTimer | null>(null);
  const tracksRef = useRef<Track[]>([]);
  const gateRef = useRef(initSessionGate());
  const recordedRef = useRef<GpsObservation[]>([]);
  const savingRef = useRef(false);

  const [phase, setPhase] = useState<SessionPhase>("waiting");
  const [timing, setTiming] = useState<TimingState>(EMPTY_TIMING_STATE);
  const [laps, setLaps] = useState<Lap[]>([]);
  const [latest, setLatest] = useState<GpsObservation | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedFileName, setSavedFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Serialize the recorded buffer to a `.dovep` log and store it in IndexedDB. */
  const persist = useCallback(async () => {
    if (savingRef.current) return;
    const observations = recordedRef.current;
    if (observations.length === 0) return; // nothing recorded — leave saving false

    savingRef.current = true;
    setSaving(true);

    const timer = timerRef.current;
    const completed = timer ? [...timer.getLaps()] : [];
    const t = timer?.getState() ?? EMPTY_TIMING_STATE;
    const startTs = observations[0].fix.timestamp;
    const fileName = buildDovepFileName(startTs);

    const meta: DovepSessionMeta = {
      course: t.courseName ?? undefined,
      bestLapMs: t.bestLapMs ?? undefined,
      optimalMs: t.optimalMs ?? undefined,
      lapTimesMs: completed.map((l) => l.lapTimeMs),
    };

    try {
      await saveFile(fileName, serializeDovepBlob(observations, meta));
      await saveFileMetadata({
        fileName,
        trackName: t.trackName ?? "",
        courseName: t.courseName ?? "",
        sessionStartTime: startTs,
        fastestLapMs: t.bestLapMs ?? undefined,
      });
      setSavedFileName(fileName);
    } catch (e) {
      setError(`Failed to save session: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }, []);

  const endSession = useCallback(async () => {
    if (gateRef.current.phase === "ended") return;
    gateRef.current = endSessionGate(gateRef.current);
    setPhase("ended");
    gpsRef.current?.stop();
    await persist();
  }, [persist]);

  const reset = useCallback(() => {
    gateRef.current = initSessionGate();
    recordedRef.current = [];
    savingRef.current = false;
    timerRef.current = new RealtimeLapTimer(tracksRef.current);
    setPhase("waiting");
    setTiming(EMPTY_TIMING_STATE);
    setLaps([]);
    setLatest(null);
    setSaving(false);
    setSavedFileName(null);
    setError(null);
    const gps = gpsRef.current;
    if (gps) {
      gps.clear();
      gps.start();
    }
  }, []);

  useEffect(() => {
    const timer = new RealtimeLapTimer();
    timerRef.current = timer;
    // Tracks load async + offline-cached; the engine detects once available.
    loadTracks()
      .then((tracks) => {
        tracksRef.current = tracks;
        timerRef.current?.setTracks(tracks);
      })
      .catch(() => { /* offline / no tracks */ });

    const gps = new CustomGps();
    gpsRef.current = gps;

    const offFix = gps.onFix((obs) => {
      setLatest(obs);
      const speedMph = obs.fix.speed != null ? obs.fix.speed * 2.236936 : (obs.motion.speedMps ?? 0) * 2.236936;
      const step = stepSessionGate(gateRef.current, speedMph, obs.fix.timestamp);
      gateRef.current = step.state;

      if (step.justArmed) setPhase("recording");

      if (gateRef.current.phase === "recording") {
        recordedRef.current.push(obs);
        const t = timerRef.current!.update(observationToSample(obs));
        setTiming(t);
        setLaps([...timerRef.current!.getLaps()]);
      }

      if (step.autoEnded) {
        setPhase("ended");
        gps.stop();
        void persist();
      }
    });

    const offErr = gps.onError((err) => setError(err.message));
    gps.start();

    return () => {
      offFix();
      offErr();
      gps.stop();
    };
  }, [persist]);

  return { phase, timing, laps, latest, saving, savedFileName, error, endSession, reset };
}
