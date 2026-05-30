import { useState, useCallback } from "react";
import { WeatherStation } from "@/lib/weatherService";
import { saveFileMetadata, getFileMetadata, FileMetadata } from "@/lib/fileStorage";
import { freezeSetupRevision } from "@/lib/setupRevisionStorage";

/**
 * Manages session-level metadata: cached weather station, kart/setup
 * associations. Persists to IndexedDB file metadata.
 */
export function useSessionMetadata(currentFileName: string | null) {
  const [cachedWeatherStation, setCachedWeatherStation] = useState<WeatherStation | null>(null);
  const [sessionKartId, setSessionKartId] = useState<string | null>(null);
  const [sessionSetupId, setSessionSetupId] = useState<string | null>(null);
  const [sessionSetupRev, setSessionSetupRev] = useState<string | null>(null);

  const restoreFromMetadata = useCallback((meta: FileMetadata | null) => {
    if (meta) {
      if (meta.weatherStationId) {
        setCachedWeatherStation({
          stationId: meta.weatherStationId,
          name: meta.weatherStationName || meta.weatherStationId,
          distanceKm: meta.weatherStationDistanceKm || 0,
        });
      } else {
        setCachedWeatherStation(null);
      }
      setSessionKartId(meta.sessionKartId ?? null);
      setSessionSetupId(meta.sessionSetupId ?? null);
      setSessionSetupRev(meta.sessionSetupRev ?? null);
    } else {
      setCachedWeatherStation(null);
      setSessionKartId(null);
      setSessionSetupId(null);
      setSessionSetupRev(null);
    }
  }, []);

  const handleWeatherStationResolved = useCallback(
    (station: WeatherStation) => {
      setCachedWeatherStation(station);
      if (currentFileName) {
        getFileMetadata(currentFileName).then((existing) => {
          saveFileMetadata({
            fileName: currentFileName,
            trackName: existing?.trackName || "",
            courseName: existing?.courseName || "",
            weatherStationId: station.stationId,
            weatherStationName: station.name,
            weatherStationDistanceKm: station.distanceKm,
          });
        });
      }
    },
    [currentFileName]
  );

  const handleSaveSessionSetup = useCallback(
    async (kartId: string | null, setupId: string | null) => {
      if (!currentFileName) return;
      const existing = await getFileMetadata(currentFileName);
      // Freeze the assigned setup into an immutable, content-addressed revision
      // so this session keeps the exact setup it ran even if the live setup is
      // edited later. Idempotent: an unchanged setup re-uses its existing hash.
      const rev = setupId ? await freezeSetupRevision(setupId) : null;
      // Spread existing first so unrelated cached fields (track/course, weather,
      // fastest-lap) survive a setup change.
      await saveFileMetadata({
        ...(existing ?? {}),
        fileName: currentFileName,
        trackName: existing?.trackName || "",
        courseName: existing?.courseName || "",
        sessionKartId: kartId ?? undefined,
        sessionSetupId: setupId ?? undefined,
        sessionSetupRev: rev ?? undefined,
      });
      setSessionKartId(kartId);
      setSessionSetupId(setupId);
      setSessionSetupRev(rev);
    },
    [currentFileName]
  );

  return {
    cachedWeatherStation,
    sessionKartId,
    sessionSetupId,
    sessionSetupRev,
    restoreFromMetadata,
    handleWeatherStationResolved,
    handleSaveSessionSetup,
  };
}
