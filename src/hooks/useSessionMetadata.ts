import { useState, useCallback } from "react";
import { WeatherStation } from "@/lib/weatherService";
import { saveFileMetadata, getFileMetadata, FileMetadata } from "@/lib/fileStorage";

/**
 * Manages session-level metadata: cached weather station, kart/setup
 * associations. Persists to IndexedDB file metadata.
 */
export function useSessionMetadata(currentFileName: string | null) {
  const [cachedWeatherStation, setCachedWeatherStation] = useState<WeatherStation | null>(null);
  const [sessionKartId, setSessionKartId] = useState<string | null>(null);
  const [sessionSetupId, setSessionSetupId] = useState<string | null>(null);

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
    } else {
      setCachedWeatherStation(null);
      setSessionKartId(null);
      setSessionSetupId(null);
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
      await saveFileMetadata({
        fileName: currentFileName,
        trackName: existing?.trackName || "",
        courseName: existing?.courseName || "",
        weatherStationId: existing?.weatherStationId,
        weatherStationName: existing?.weatherStationName,
        weatherStationDistanceKm: existing?.weatherStationDistanceKm,
        sessionKartId: kartId ?? undefined,
        sessionSetupId: setupId ?? undefined,
      });
      setSessionKartId(kartId);
      setSessionSetupId(setupId);
    },
    [currentFileName]
  );

  return {
    cachedWeatherStation,
    sessionKartId,
    sessionSetupId,
    restoreFromMetadata,
    handleWeatherStationResolved,
    handleSaveSessionSetup,
  };
}
