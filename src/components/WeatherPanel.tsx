import { useState, useEffect, useRef } from "react";
import { Cloud, Thermometer, Droplets, Gauge } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchSessionWeather,
  fetchWeatherData,
  fetchNearestStation,
  isValidGpsPoint,
  WeatherData,
  WeatherStation,
} from "@/lib/weatherService";

interface WeatherPanelProps {
  lat?: number;
  lon?: number;
  sessionDate?: Date;
  cachedStation?: WeatherStation | null;
  onStationResolved?: (station: WeatherStation) => void;
  onWeatherLoaded?: (data: WeatherData) => void;
}

export function WeatherPanel({
  lat,
  lon,
  sessionDate,
  cachedStation,
  onStationResolved,
  onWeatherLoaded,
}: WeatherPanelProps) {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const onStationResolvedRef = useRef(onStationResolved);
  onStationResolvedRef.current = onStationResolved;
  const onWeatherLoadedRef = useRef(onWeatherLoaded);
  onWeatherLoadedRef.current = onWeatherLoaded;

  useEffect(() => {
    // Reset state when inputs change
    setWeather(null);
    setError(false);

    // Validate inputs
    if (
      lat === undefined ||
      lon === undefined ||
      !sessionDate ||
      !isValidGpsPoint(lat, lon)
    ) {
      return;
    }

    let cancelled = false;

    const doFetch = async () => {
      setLoading(true);
      try {
        if (cachedStation) {
          // Skip NWS lookup, go straight to weather data
          const data = await fetchWeatherData(cachedStation, sessionDate);
          if (!cancelled) {
            if (data) {
              setWeather(data);
              onWeatherLoadedRef.current?.(data);
              setError(true);
            }
          }
        } else {
          // Full lookup: find station then fetch weather
          const station = await fetchNearestStation(lat, lon);
          if (cancelled) return;
          if (!station) {
            setError(true);
            return;
          }
          // Notify parent so it can cache the station
          onStationResolvedRef.current?.(station);
          const data = await fetchWeatherData(station, sessionDate);
          if (!cancelled) {
            if (data) {
              setWeather(data);
              onWeatherLoadedRef.current?.(data);
              setError(true);
            }
          }
        }
      } catch (e) {
        if (!cancelled) {
          setError(true);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    doFetch();

    return () => {
      cancelled = true;
    };
  }, [lat, lon, sessionDate, cachedStation]);

  // Don't render if no valid GPS
  if (
    lat === undefined ||
    lon === undefined ||
    !sessionDate ||
    !isValidGpsPoint(lat, lon)
  ) {
    return null;
  }

  return (
    <div className="bg-card/90 backdrop-blur-sm border border-border rounded p-2 min-w-[140px]">
      <div className="flex items-center gap-1.5 text-xs font-medium text-foreground mb-2 border-b border-border pb-1.5">
        <Cloud className="w-3.5 h-3.5 text-primary" />
        <span>Weather</span>
        {weather && (
          <span className="text-muted-foreground ml-auto font-mono text-[10px]">
            {weather.station.stationId}
          </span>
        )}
      </div>

      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      )}

      {error && !loading && (
        <div className="text-xs text-muted-foreground">Weather unavailable</div>
      )}

      {weather && !loading && (
        <div className="space-y-1.5 text-xs font-mono">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Thermometer className="w-3 h-3" />
              <span>Temp</span>
            </div>
            <span className="text-foreground">
              {weather.temperatureF}°F ({weather.temperatureC}°C)
            </span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Droplets className="w-3 h-3" />
              <span>Humidity</span>
            </div>
            <span className="text-foreground">{weather.humidity}%</span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Gauge className="w-3 h-3" />
              <span>Pressure</span>
            </div>
            <span className="text-foreground">
              {weather.altimeterInHg} inHg
            </span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Gauge className="w-3 h-3" />
              <span>DA</span>
            </div>
            <span className="text-foreground">
              {weather.densityAltitudeFt.toLocaleString()} ft
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
