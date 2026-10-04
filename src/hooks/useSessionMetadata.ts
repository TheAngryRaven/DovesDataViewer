import { useState, useCallback } from "react";
import { WeatherStation } from "@/lib/weatherService";
import { updateFileMetadata, FileMetadata, PostSessionData } from "@/lib/fileStorage";
import { freezeSetupRevision } from "@/lib/setupRevisionStorage";
import { emitGarageChange } from "@/lib/garageEvents";
import { STORE_NAMES } from "@/lib/dbUtils";

/**
 * Manages session-level metadata: cached weather station, kart/setup
 * associations. Persists to IndexedDB file metadata.
 */
export function useSessionMetadata(currentFileName: string | null) {
  const [cachedWeatherStation, setCachedWeatherStation] = useState<WeatherStation | null>(null);
  const [sessionKartId, setSessionKartId] = useState<string | null>(null);
  const [sessionSetupId, setSessionSetupId] = useState<string | null>(null);
  const [sessionSetupRev, setSessionSetupRev] = useState<string | null>(null);
  const [postSession, setPostSession] = useState<PostSessionData | null>(null);

  const restoreFromMetadata = useCallback((meta: FileMetadata | null) => {
    if (meta) {
      if (meta.weatherStationId) {
        setCachedWeatherStation({
          stationId: meta.weatherStationId,
          name: meta.weatherStationName || meta.weatherStationId,
          distanceKm: meta.weatherStationDistanceKm || 0,
          source: meta.weatherStationSource,
        });
      } else {
        setCachedWeatherStation(null);
      }
      setSessionKartId(meta.sessionKartId ?? null);
      setSessionSetupId(meta.sessionSetupId ?? null);
      setSessionSetupRev(meta.sessionSetupRev ?? null);
      setPostSession(meta.postSession ?? null);
    } else {
      setCachedWeatherStation(null);
      setSessionKartId(null);
      setSessionSetupId(null);
      setSessionSetupRev(null);
      setPostSession(null);
    }
  }, []);

  const handleWeatherStationResolved = useCallback(
    (station: WeatherStation) => {
      setCachedWeatherStation(station);
      if (currentFileName) {
        updateFileMetadata(currentFileName, {
          weatherStationId: station.stationId,
          weatherStationName: station.name,
          weatherStationDistanceKm: station.distanceKm,
          weatherStationSource: station.source,
        });
      }
    },
    [currentFileName]
  );

  const handleSaveSessionSetup = useCallback(
    async (kartId: string | null, setupId: string | null, engine?: string | null) => {
      if (!currentFileName) return;
      // Freeze the assigned setup into an immutable, content-addressed revision
      // so this session keeps the exact setup it ran even if the live setup is
      // edited later. Idempotent: an unchanged setup re-uses its existing hash.
      const rev = setupId ? await freezeSetupRevision(setupId) : null;
      // updateFileMetadata preserves every other tag (track/course, weather,
      // fastest-lap, start time). Engine is snapshotted for browser grouping.
      await updateFileMetadata(currentFileName, {
        sessionKartId: kartId ?? undefined,
        sessionSetupId: setupId ?? undefined,
        sessionSetupRev: rev ?? undefined,
        sessionEngine: engine?.trim() || undefined,
      });
      // The revision is referenced now, so it qualifies for the cloud (the sync
      // plugin only uploads revisions a session points at — plan 0028). Emit after
      // the metadata write so the plugin's referenced check sees it.
      if (rev) emitGarageChange({ store: STORE_NAMES.SETUP_REVISIONS, key: rev, type: "put" });
      setSessionKartId(kartId);
      setSessionSetupId(setupId);
      setSessionSetupRev(rev);
    },
    [currentFileName]
  );

  const handleSavePostSession = useCallback(
    async (data: PostSessionData) => {
      if (!currentFileName) return;
      // updateFileMetadata merges, so this never clobbers track/setup/weather tags.
      await updateFileMetadata(currentFileName, { postSession: data });
      setPostSession(data);
      // Push to the cloud immediately like a note save. Metadata writes don't
      // emit garage events on their own (they'd flood sync on every fastest-lap
      // write), so we emit explicitly here for this deliberate, user-driven save.
      emitGarageChange({ store: STORE_NAMES.METADATA, key: currentFileName, type: "put" });
    },
    [currentFileName]
  );

  return {
    cachedWeatherStation,
    sessionKartId,
    sessionSetupId,
    sessionSetupRev,
    postSession,
    restoreFromMetadata,
    handleWeatherStationResolved,
    handleSaveSessionSetup,
    handleSavePostSession,
  };
}
