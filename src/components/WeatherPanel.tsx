import { useState, useEffect, useRef } from "react";
import { Cloud, Thermometer, Droplets, Gauge, Wind, Mountain, Navigation } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchSessionWeather,
  fetchWeatherData,
  fetchNearestStation,
  isValidGpsPoint,
  WeatherData,
  WeatherStation,
} from "@/lib/weatherService";

const knotsToMph = (kts: number) => Math.round(kts * 1.15078);

interface WeatherPanelProps {
  lat?: number;
  lon?: number;
  sessionDate?: Date;
  cachedStation?: WeatherStation | null;
  onStationResolved?: (station: WeatherStation) => void;
  onWeatherLoaded?: (data: WeatherData) => void;
  /** Show full detailed weather (wind, dew point, pressure alt, tuning note) */
  detailed?: boolean;
}

export function WeatherPanel({
  lat,
  lon,
  sessionDate,
  cachedStation,
  onStationResolved,
  onWeatherLoaded,
  detailed = false,
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
          {/* Observation time - detailed only */}
          {detailed && (
            <div className="text-[10px] text-muted-foreground mb-1">
              Observed: {weather.observationTime.toLocaleString()}
            </div>
          )}

          <WeatherRow icon={<Thermometer className="w-3 h-3" />} label="Temp" value={`${weather.temperatureF}°F (${weather.temperatureC}°C)`} />
          <WeatherRow icon={<Droplets className="w-3 h-3" />} label="Humidity" value={`${weather.humidity}%`} />
          <WeatherRow icon={<Gauge className="w-3 h-3" />} label="Pressure" value={`${weather.altimeterInHg} inHg`} />
          <WeatherRow icon={<Gauge className="w-3 h-3" />} label="DA" value={`${weather.densityAltitudeFt.toLocaleString()} ft`} />

          {/* Extended fields - detailed only */}
          {detailed && (
            <>
              <DewPointRow temperatureC={weather.temperatureC} humidity={weather.humidity} />
              <WindRow weather={weather} />
              <PressureAltRow altimeterInHg={weather.altimeterInHg} />
              <TuningNote densityAltitudeFt={weather.densityAltitudeFt} humidity={weather.humidity} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function WeatherRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <span className="text-foreground">{value}</span>
    </div>
  );
}

function DewPointRow({ temperatureC, humidity }: { temperatureC: number; humidity: number }) {
  const a = 17.27, b = 237.7;
  const alpha = (a * temperatureC) / (b + temperatureC) + Math.log(humidity / 100);
  const dewC = Math.round(((b * alpha) / (a - alpha)) * 10) / 10;
  const dewF = Math.round((dewC * 9) / 5 + 32);
  return <WeatherRow icon={<Thermometer className="w-3 h-3" />} label="Dew Pt" value={`${dewF}°F (${dewC}°C)`} />;
}

function WindRow({ weather }: { weather: WeatherData }) {
  const windValue = weather.windSpeedKts !== null
    ? (() => {
        const mph = knotsToMph(weather.windSpeedKts);
        const gustStr = weather.windGustKts ? ` G${knotsToMph(weather.windGustKts)}` : "";
        return `${weather.windDirectionDeg ?? "VRB"}° @ ${mph}${gustStr}`;
      })()
    : "Calm";
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Wind className="w-3 h-3" />
        <span>Wind</span>
      </div>
      <div className="flex items-center gap-1">
        {weather.windSpeedKts !== null && weather.windDirectionDeg !== null && (
          <Navigation className="w-3 h-3 text-primary shrink-0" style={{ transform: `rotate(${weather.windDirectionDeg}deg)` }} />
        )}
        <span className="text-foreground">{windValue}</span>
      </div>
    </div>
  );
}

function PressureAltRow({ altimeterInHg }: { altimeterInHg: number }) {
  const pressureAltFt = Math.round((29.92 - altimeterInHg) * 1000);
  return <WeatherRow icon={<Mountain className="w-3 h-3" />} label="Press Alt" value={`${pressureAltFt.toLocaleString()} ft`} />;
}

function TuningNote({ densityAltitudeFt, humidity }: { densityAltitudeFt: number; humidity: number }) {
  return (
    <div className="text-[10px] text-muted-foreground bg-muted/50 rounded p-1.5 leading-relaxed border border-border/50 mt-1 font-sans">
      <span className="font-medium text-foreground">Tuning:</span>{" "}
      {densityAltitudeFt > 2000
        ? "High DA — less power. Consider leaning mixture."
        : densityAltitudeFt < 0
          ? "Negative DA — more power. May need richer mixture."
          : "Moderate DA. Standard jetting should be close."}
      {humidity > 70 && " High humidity reduces effective air density."}
    </div>
  );
}
