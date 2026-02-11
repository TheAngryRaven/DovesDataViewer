import { useState, useCallback } from "react";
import { CloudSun, Search, MapPin, Loader2, Thermometer, Droplets, Gauge, Wind, Mountain, Navigation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  fetchNearestStation,
  fetchWeatherData,
  calculateDensityAltitude,
  WeatherStation,
  WeatherData,
} from "@/lib/weatherService";
import { toast } from "@/hooks/use-toast";

const knotsToMph = (kts: number) => Math.round(kts * 1.15078);

interface LocalWeatherDialogProps {
  /** If provided, renders in session read-only mode (no search UI) */
  sessionWeather?: WeatherData | null;
  /** External open control */
  externalOpen?: boolean;
  /** External open change handler */
  onExternalOpenChange?: (open: boolean) => void;
}

export function LocalWeatherDialog({ sessionWeather, externalOpen, onExternalOpenChange }: LocalWeatherDialogProps = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [isFetchingWeather, setIsFetchingWeather] = useState(false);
  const [station, setStation] = useState<WeatherStation | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolvedLocation, setResolvedLocation] = useState<string | null>(null);

  const isSessionMode = !!sessionWeather;
  const open = isSessionMode ? (externalOpen ?? false) : internalOpen;
  const setOpen = isSessionMode ? (onExternalOpenChange ?? (() => {})) : setInternalOpen;
  const displayWeather = isSessionMode ? sessionWeather : weather;

  const resetState = useCallback(() => {
    setStation(null);
    setWeather(null);
    setError(null);
    setResolvedLocation(null);
  }, []);

  const fetchWeatherForCoords = useCallback(async (lat: number, lon: number) => {
    setIsFetchingWeather(true);
    setError(null);
    setStation(null);
    setWeather(null);

    try {
      const foundStation = await fetchNearestStation(lat, lon);
      if (!foundStation) {
        setError("No weather station found near this location.");
        return;
      }
      setStation(foundStation);

      const data = await fetchWeatherData(foundStation, new Date());
      if (!data) {
        setError(`Station ${foundStation.stationId} found but no recent METAR data available.`);
        return;
      }
      setWeather(data);
    } catch {
      setError("Failed to fetch weather data. Please try again.");
    } finally {
      setIsFetchingWeather(false);
    }
  }, []);

  const handleLocationSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    resetState();
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery.trim())}`,
        { headers: { "User-Agent": "DovesDataViewer/1.0" } }
      );
      const results = await response.json();

      if (results && results.length > 0) {
        const { lat, lon, display_name } = results[0];
        setResolvedLocation(display_name?.split(",").slice(0, 2).join(",").trim() || searchQuery);
        await fetchWeatherForCoords(parseFloat(lat), parseFloat(lon));
      } else {
        setError("Location not found. Try a different search term.");
      }
    } catch {
      setError("Search failed. Please try again.");
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, fetchWeatherForCoords, resetState]);

  const handleGpsLookup = useCallback(async () => {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser.");
      return;
    }

    setIsLocating(true);
    resetState();

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        setResolvedLocation(`${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
        await fetchWeatherForCoords(latitude, longitude);
        setIsLocating(false);
      },
      (err) => {
        setIsLocating(false);
        if (err.code === err.PERMISSION_DENIED) {
          setError("Location access denied. Please allow GPS access and try again.");
        } else {
          setError("Could not determine your location. Please try again.");
        }
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, [fetchWeatherForCoords, resetState]);

  const loading = isSearching || isLocating || isFetchingWeather;

  const dialogContent = (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <CloudSun className="w-5 h-5 text-primary" />
          {isSessionMode ? "Session Weather (METAR)" : "Local Weather (METAR)"}
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
        {/* Search UI - only in non-session mode */}
        {!isSessionMode && (
          <>
            <div className="flex gap-2">
              <Input
                placeholder="Search address or track name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLocationSearch()}
                disabled={loading}
              />
              <Button
                variant="outline"
                size="icon"
                onClick={handleLocationSearch}
                disabled={loading || !searchQuery.trim()}
              >
                {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              </Button>
            </div>

            <Button
              variant="secondary"
              className="w-full gap-2"
              onClick={handleGpsLookup}
              disabled={loading}
            >
              {isLocating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <MapPin className="w-4 h-4" />
              )}
              {isLocating ? "Getting location..." : "Use My GPS Location"}
            </Button>

            {isFetchingWeather && (
              <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Fetching METAR data...
              </div>
            )}

            {error && !loading && (
              <div className="text-sm text-destructive bg-destructive/10 rounded-md p-3">
                {error}
              </div>
            )}
          </>
        )}

        {/* Weather results */}
        {displayWeather && !loading && (
          <WeatherResultsView weather={displayWeather} resolvedLocation={isSessionMode ? undefined : resolvedLocation} showTuningNote={!isSessionMode} />
        )}
      </div>
    </DialogContent>
  );

  // Session mode: no trigger, externally controlled
  if (isSessionMode) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        {dialogContent}
      </Dialog>
    );
  }

  // Normal mode: with trigger button
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full gap-2">
          <CloudSun className="w-4 h-4" />
          Get Local Weather (METAR)
        </Button>
      </DialogTrigger>
      {dialogContent}
    </Dialog>
  );
}

/** Extracted weather results display */
function WeatherResultsView({ weather, resolvedLocation, showTuningNote = true }: { weather: WeatherData; resolvedLocation?: string | null; showTuningNote?: boolean }) {
  // Compute dew point from temp and humidity (Magnus formula)
  const dewPointC = (() => {
    const a = 17.27;
    const b = 237.7;
    const alpha = (a * weather.temperatureC) / (b + weather.temperatureC) + Math.log(weather.humidity / 100);
    return Math.round(((b * alpha) / (a - alpha)) * 10) / 10;
  })();

  const dewPointF = Math.round((dewPointC * 9) / 5 + 32);
  const pressureAltFt = Math.round((29.92 - weather.altimeterInHg) * 1000);

  const windValue = weather.windSpeedKts !== null
    ? (() => {
        const mph = knotsToMph(weather.windSpeedKts);
        const gustStr = weather.windGustKts ? ` G${knotsToMph(weather.windGustKts)}` : "";
        return `${weather.windDirectionDeg ?? "VRB"}° @ ${mph} mph${gustStr}`;
      })()
    : "Calm";

  return (
    <div className="space-y-3">
      {/* Station info */}
      <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border pb-2">
        <span>
          Station: <span className="font-mono font-medium text-foreground">{weather.station.stationId}</span>
          {" "}({weather.station.distanceKm} km away)
        </span>
        {resolvedLocation && (
          <span className="truncate ml-2 max-w-[150px]" title={resolvedLocation}>
            {resolvedLocation}
          </span>
        )}
      </div>

      {/* Observation time */}
      <div className="text-xs text-muted-foreground">
        Observed: {weather.observationTime.toLocaleString()}
      </div>

      {/* Main weather grid */}
      <div className="grid grid-cols-2 gap-3">
        <WeatherItem
          icon={<Thermometer className="w-4 h-4" />}
          label="Temperature"
          value={`${weather.temperatureF}°F (${weather.temperatureC}°C)`}
        />
        <WeatherItem
          icon={<Droplets className="w-4 h-4" />}
          label="Humidity"
          value={`${weather.humidity}%`}
        />
        <WeatherItem
          icon={<Thermometer className="w-4 h-4" />}
          label="Dew Point"
          value={`${dewPointF}°F (${dewPointC}°C)`}
        />
        <WeatherItem
          icon={<Gauge className="w-4 h-4" />}
          label="Barometer"
          value={`${weather.altimeterInHg} inHg`}
        />
        <WeatherItem
          icon={<Wind className="w-4 h-4" />}
          label="Wind"
          value={windValue}
          extra={
            weather.windSpeedKts !== null && weather.windDirectionDeg !== null ? (
              <Navigation
                className="w-3.5 h-3.5 text-primary shrink-0"
                style={{ transform: `rotate(${weather.windDirectionDeg}deg)` }}
              />
            ) : undefined
          }
        />
        <WeatherItem
          icon={<Mountain className="w-4 h-4" />}
          label="Pressure Alt"
          value={`${pressureAltFt.toLocaleString()} ft`}
        />
        <WeatherItem
          icon={<Mountain className="w-4 h-4" />}
          label="Density Alt"
          value={`${weather.densityAltitudeFt.toLocaleString()} ft`}
          highlight
        />
      </div>

      {/* Racing note - only for current weather */}
      {showTuningNote && (
        <div className="text-xs text-muted-foreground bg-muted/50 rounded-md p-2.5 leading-relaxed border border-border/50">
          <span className="font-medium text-foreground">Tuning note:</span>{" "}
          {weather.densityAltitudeFt > 2000
            ? "High density altitude — engine produces less power. Consider leaning the carb mixture."
            : weather.densityAltitudeFt < 0
              ? "Negative density altitude — engine produces more power than standard. May need to richen mixture."
              : "Moderate density altitude. Standard jetting should be close."}
          {weather.humidity > 70 && " High humidity further reduces effective air density."}
        </div>
      )}
    </div>
  );
}

function WeatherItem({
  icon,
  label,
  value,
  highlight,
  extra,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 p-2 rounded-md bg-muted/30 border border-border/50">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="flex items-center gap-1.5">
        {extra}
        <span className={`text-sm font-mono font-medium ${highlight ? "text-primary" : "text-foreground"}`}>
          {value}
        </span>
      </div>
    </div>
  );
}
