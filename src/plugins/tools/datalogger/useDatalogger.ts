/**
 * Thin React adapter over `DataloggerSession`. The lifecycle/persistence logic
 * lives in the (unit-tested) controller; this hook just instantiates it with the
 * real browser dependencies (geolocation source, lap timer, IndexedDB save fns),
 * loads tracks, and re-renders on snapshot changes.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CustomGps, RealtimeLapTimer } from "@/lib/gps";
import { loadTracks } from "@/lib/trackStorage";
import { saveFile, saveFileMetadata } from "@/lib/fileStorage";
import {
  DataloggerSession,
  INITIAL_SNAPSHOT,
  type DataloggerSnapshot,
} from "./dataloggerSession";

export interface DataloggerController extends DataloggerSnapshot {
  /** Manually end + save the session (red "End" action). */
  endSession: () => Promise<void>;
  /** Discard the ended session and start a fresh capture. */
  reset: () => void;
}

export function useDatalogger(): DataloggerController {
  const [snapshot, setSnapshot] = useState<DataloggerSnapshot>(INITIAL_SNAPSHOT);
  const sessionRef = useRef<DataloggerSession | null>(null);

  useEffect(() => {
    const timer = new RealtimeLapTimer();
    // Tracks load async + offline-cached; the engine detects once available.
    loadTracks().then((tracks) => timer.setTracks(tracks)).catch(() => { /* offline / no tracks */ });

    // The session keeps its own recorded buffer; don't double-retain in the source.
    const gps = new CustomGps({ retainBuffer: false });
    const session = new DataloggerSession({ gps, timer, saveLog: saveFile, saveMeta: saveFileMetadata });
    sessionRef.current = session;

    const off = session.subscribe(setSnapshot);
    session.start();

    return () => {
      off();
      session.dispose();
    };
  }, []);

  const endSession = useCallback(() => sessionRef.current?.endSession() ?? Promise.resolve(), []);
  const reset = useCallback(() => sessionRef.current?.reset(), []);

  return { ...snapshot, endSession, reset };
}
