// Weather data service.
//
// US sessions: NWS API for station lookup + IEM ASOS for historical METAR (precise,
// real nearby station). Everywhere else (NWS is US-only): Open-Meteo's free, keyless,
// global historical reanalysis by lat/lon — see fetchSessionWeather's fallback.

/** Where an observation came from: a real ASOS/METAR station, or Open-Meteo reanalysis. */
export type WeatherSource = "asos" | "open-meteo";

export interface WeatherStation {
  stationId: string; // e.g., "KOKC", or "open-meteo"
  name: string; // e.g., "Oklahoma City", or "Open-Meteo"
  distanceKm: number;
  /** Defaults to "asos" when absent (back-compat with older cached metadata). */
  source?: WeatherSource;
}

export interface WeatherData {
  station: WeatherStation;
  temperatureF: number;
  temperatureC: number;
  humidity: number; // percentage
  altimeterInHg: number; // for DA calculation
  densityAltitudeFt: number;
  windSpeedKts: number | null; // knots
  windDirectionDeg: number | null; // degrees (0-360)
  windGustKts: number | null; // gust speed in knots
  observationTime: Date;
}

/**
 * Validates GPS coordinates - matches pattern used in parsers
 * Rejects invalid coordinates (0,0 is common GPS error) and out-of-bounds values
 */
export function isValidGpsPoint(lat: number, lon: number): boolean {
  // Skip invalid coordinates (0,0 is common GPS error)
  if (lat === 0 || lon === 0) return false;
  // Bounds check
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
  return true;
}

/**
 * Calculate density altitude from weather conditions
 * Uses standard formula: DA = PA + (120 × (OAT°C - ISA_temp))
 */
export function calculateDensityAltitude(
  tempC: number,
  altimeterInHg: number,
  fieldElevationFt: number = 0
): number {
  // Pressure Altitude (ft) = (29.92 - altimeter) × 1000 + field_elevation
  const pressureAltitude = (29.92 - altimeterInHg) * 1000 + fieldElevationFt;

  // ISA temp at altitude: 15°C - (2°C per 1000ft)
  const altitudeThousands = pressureAltitude / 1000;
  const isaTemp = 15 - 2 * altitudeThousands;

  // Density Altitude = PA + (120 × (OAT - ISA_temp))
  const densityAltitude = pressureAltitude + 120 * (tempC - isaTemp);

  return Math.round(densityAltitude);
}

/**
 * Find the nearest ASOS/AWOS weather station using NWS API
 */
export async function fetchNearestStation(
  lat: number,
  lon: number
): Promise<WeatherStation | null> {
  if (!isValidGpsPoint(lat, lon)) {
    return null;
  }

  try {
    // Step 1: Get observation stations URL from NWS points API
    const pointsResponse = await fetch(
      `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
      {
        headers: {
          Accept: "application/geo+json",
          "User-Agent": "DovesDataViewer/1.0",
        },
      }
    );

    if (!pointsResponse.ok) {
      console.warn("NWS points API failed:", pointsResponse.status);
      return null;
    }

    const pointsData = await pointsResponse.json();
    const stationsUrl = pointsData.properties?.observationStations;

    if (!stationsUrl) {
      console.warn("No observation stations URL found");
      return null;
    }

    // Step 2: Fetch station list
    const stationsResponse = await fetch(stationsUrl, {
      headers: {
        Accept: "application/geo+json",
        "User-Agent": "DovesDataViewer/1.0",
      },
    });

    if (!stationsResponse.ok) {
      console.warn("NWS stations API failed:", stationsResponse.status);
      return null;
    }

    const stationsData = await stationsResponse.json();
    const features = stationsData.features;

    if (!features || features.length === 0) {
      console.warn("No weather stations found");
      return null;
    }

    // Find nearest station (first in list is typically nearest)
    const nearestFeature = features[0];
    const stationId = nearestFeature.properties?.stationIdentifier;
    const stationName = nearestFeature.properties?.name;
    const stationCoords = nearestFeature.geometry?.coordinates;

    if (!stationId || !stationCoords) {
      return null;
    }

    // Calculate distance using haversine
    const distanceKm = haversineDistance(
      lat,
      lon,
      stationCoords[1],
      stationCoords[0]
    );

    return {
      stationId,
      name: stationName || stationId,
      distanceKm: Math.round(distanceKm * 10) / 10,
    };
  } catch (error) {
    console.warn("Failed to fetch nearest station:", error);
    return null;
  }
}

/**
 * Fetch weather data from IEM ASOS endpoint for a specific station and time
 */
export async function fetchWeatherData(
  station: WeatherStation,
  sessionDate: Date
): Promise<WeatherData | null> {
  try {
    // Build time range: 1 hour before and after session start
    const startTime = new Date(sessionDate.getTime() - 60 * 60 * 1000);
    const endTime = new Date(sessionDate.getTime() + 60 * 60 * 1000);

    const formatDate = (d: Date) => {
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
    };

    // IEM ASOS endpoint
    const params = new URLSearchParams({
      station: station.stationId,
      data: "tmpf,relh,alti,sknt,drct,gust",
      tz: "UTC",
      format: "comma",
      latlon: "no",
      elev: "no",
      missing: "null",
      trace: "null",
      direct: "no",
      report_type: "3", // METAR reports
    });

    // Add time parameters
    params.append("year1", String(startTime.getUTCFullYear()));
    params.append("month1", String(startTime.getUTCMonth() + 1));
    params.append("day1", String(startTime.getUTCDate()));
    params.append("hour1", String(startTime.getUTCHours()));
    params.append("minute1", String(startTime.getUTCMinutes()));
    params.append("year2", String(endTime.getUTCFullYear()));
    params.append("month2", String(endTime.getUTCMonth() + 1));
    params.append("day2", String(endTime.getUTCDate()));
    params.append("hour2", String(endTime.getUTCHours()));
    params.append("minute2", String(endTime.getUTCMinutes()));

    const iemUrl = `https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?${params.toString()}`;

    const response = await fetch(iemUrl);

    if (!response.ok) {
      console.warn("IEM ASOS API failed:", response.status);
      return null;
    }

    const csvText = await response.text();
    const observation = parseAsosResponse(csvText, sessionDate);

    if (!observation) {
      return null;
    }

    const densityAltitudeFt = calculateDensityAltitude(
      observation.temperatureC,
      observation.altimeterInHg
    );

    return {
      station,
      temperatureF: observation.temperatureF,
      temperatureC: observation.temperatureC,
      humidity: observation.humidity,
      altimeterInHg: observation.altimeterInHg,
      densityAltitudeFt,
      windSpeedKts: observation.windSpeedKts,
      windDirectionDeg: observation.windDirectionDeg,
      windGustKts: observation.windGustKts,
      observationTime: observation.time,
    };
  } catch (error) {
    console.warn("Failed to fetch weather data:", error);
    return null;
  }
}

/**
 * Parse IEM ASOS CSV response and find observation closest to session time
 */
function parseAsosResponse(
  csvText: string,
  targetTime: Date
): {
  temperatureF: number;
  temperatureC: number;
  humidity: number;
  altimeterInHg: number;
  windSpeedKts: number | null;
  windDirectionDeg: number | null;
  windGustKts: number | null;
  time: Date;
} | null {
  const lines = csvText.trim().split("\n");

  if (lines.length < 2) {
    return null;
  }

  // Find header line (skip comment lines starting with #)
  let headerIndex = 0;
  while (headerIndex < lines.length && lines[headerIndex].startsWith("#")) {
    headerIndex++;
  }

  if (headerIndex >= lines.length - 1) {
    return null;
  }

  const headers = lines[headerIndex].split(",").map((h) => h.trim());
  const validIdx = headers.indexOf("valid");
  const tmpfIdx = headers.indexOf("tmpf");
  const relhIdx = headers.indexOf("relh");
  const altiIdx = headers.indexOf("alti");
  const skntIdx = headers.indexOf("sknt");
  const drctIdx = headers.indexOf("drct");
  const gustIdx = headers.indexOf("gust");

  if (validIdx === -1 || tmpfIdx === -1 || relhIdx === -1 || altiIdx === -1) {
    return null;
  }

  let closestObs: {
    temperatureF: number;
    temperatureC: number;
    humidity: number;
    altimeterInHg: number;
    windSpeedKts: number | null;
    windDirectionDeg: number | null;
    windGustKts: number | null;
    time: Date;
  } | null = null;
  let closestDiff = Infinity;

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const values = lines[i].split(",").map((v) => v.trim());

    if (values.length <= Math.max(validIdx, tmpfIdx, relhIdx, altiIdx)) {
      continue;
    }

    const timeStr = values[validIdx];
    const tmpf = parseFloat(values[tmpfIdx]);
    const relh = parseFloat(values[relhIdx]);
    const alti = parseFloat(values[altiIdx]);

    if (isNaN(tmpf) || isNaN(relh) || isNaN(alti)) {
      continue;
    }

    const obsTime = new Date(timeStr + "Z");
    const timeDiff = Math.abs(obsTime.getTime() - targetTime.getTime());

    if (timeDiff < closestDiff) {
      closestDiff = timeDiff;
      closestObs = {
        temperatureF: Math.round(tmpf * 10) / 10,
        temperatureC: Math.round(((tmpf - 32) * 5) / 9 * 10) / 10,
        humidity: Math.round(relh),
        altimeterInHg: Math.round(alti * 100) / 100,
        windSpeedKts: skntIdx !== -1 ? (isNaN(parseFloat(values[skntIdx])) ? null : Math.round(parseFloat(values[skntIdx]))) : null,
        windDirectionDeg: drctIdx !== -1 ? (isNaN(parseFloat(values[drctIdx])) ? null : Math.round(parseFloat(values[drctIdx]))) : null,
        windGustKts: gustIdx !== -1 ? (isNaN(parseFloat(values[gustIdx])) ? null : Math.round(parseFloat(values[gustIdx]))) : null,
        time: obsTime,
      };
    }
  }

  return closestObs;
}

/**
 * Haversine distance calculation (km)
 */
function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ─── Open-Meteo (global, keyless, historical reanalysis) ──────────────────────

const HPA_TO_INHG = 0.0295299830714;

/** The synthetic "station" representing an Open-Meteo point query. */
export const OPEN_METEO_STATION: WeatherStation = {
  stationId: "open-meteo",
  name: "Open-Meteo",
  distanceKm: 0,
  source: "open-meteo",
};

/** Hourly variables requested from Open-Meteo (knots for wind, °C for temp). */
const OPEN_METEO_HOURLY = [
  "temperature_2m",
  "relative_humidity_2m",
  "pressure_msl",
  "surface_pressure",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
].join(",");

function utcDateStamp(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Parse an Open-Meteo UTC hour string ("YYYY-MM-DDTHH:MM") into a Date (cross-browser). */
export function parseOpenMeteoTime(t: string): Date | null {
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
}

/** Index of the hourly sample closest to `target`, or -1 when none parse. */
export function pickNearestHourIndex(times: string[], target: Date): number {
  let best = -1;
  let bestDiff = Infinity;
  for (let i = 0; i < times.length; i++) {
    const d = parseOpenMeteoTime(times[i]);
    if (!d) continue;
    const diff = Math.abs(d.getTime() - target.getTime());
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return best;
}

/**
 * Build the Open-Meteo request URL. Historical reanalysis (ERA5) lags ~5 days, so
 * older sessions use the archive API and recent ones the forecast API (`past_days`).
 */
export function buildOpenMeteoUrl(lat: number, lon: number, date: Date, now: Date = new Date()): string {
  const ageMs = now.getTime() - date.getTime();
  const ARCHIVE_AFTER_MS = 6 * 24 * 60 * 60 * 1000; // ERA5 ~5-day lag
  const common = `latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&hourly=${OPEN_METEO_HOURLY}&timezone=UTC&wind_speed_unit=kn`;
  if (ageMs > ARCHIVE_AFTER_MS) {
    const day = utcDateStamp(date);
    return `https://archive-api.open-meteo.com/v1/archive?${common}&start_date=${day}&end_date=${day}`;
  }
  // Recent past / today: forecast endpoint with enough past_days to cover the date.
  const pastDays = Math.min(92, Math.max(1, Math.ceil(ageMs / (24 * 60 * 60 * 1000)) + 1));
  return `https://api.open-meteo.com/v1/forecast?${common}&past_days=${pastDays}&forecast_days=1`;
}

interface Observation {
  temperatureF: number;
  temperatureC: number;
  humidity: number;
  altimeterInHg: number;
  windSpeedKts: number | null;
  windDirectionDeg: number | null;
  windGustKts: number | null;
  time: Date;
}

/** Parse an Open-Meteo JSON response, picking the hour closest to `target`. Pure. */
export function parseOpenMeteoResponse(json: unknown, target: Date): Observation | null {
  const hourly = (json as { hourly?: Record<string, unknown> })?.hourly;
  const times = hourly?.time as string[] | undefined;
  if (!times || times.length === 0) return null;

  const idx = pickNearestHourIndex(times, target);
  if (idx < 0) return null;

  const num = (key: string): number | null => {
    const arr = hourly?.[key] as (number | null)[] | undefined;
    const v = arr?.[idx];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };

  const tempC = num("temperature_2m");
  const rh = num("relative_humidity_2m");
  const pressureHpa = num("pressure_msl") ?? num("surface_pressure");
  if (tempC === null || rh === null || pressureHpa === null) return null;

  const obsTime = parseOpenMeteoTime(times[idx]) ?? target;
  return {
    temperatureC: Math.round(tempC * 10) / 10,
    temperatureF: Math.round((tempC * 9) / 5 + 32),
    humidity: Math.round(rh),
    altimeterInHg: Math.round(pressureHpa * HPA_TO_INHG * 100) / 100,
    windSpeedKts: num("wind_speed_10m") === null ? null : Math.round(num("wind_speed_10m")!),
    windDirectionDeg: num("wind_direction_10m") === null ? null : Math.round(num("wind_direction_10m")!),
    windGustKts: num("wind_gusts_10m") === null ? null : Math.round(num("wind_gusts_10m")!),
    time: obsTime,
  };
}

/** Fetch global historical weather for a point from Open-Meteo (no API key). */
export async function fetchOpenMeteoWeather(
  lat: number,
  lon: number,
  sessionDate: Date
): Promise<WeatherData | null> {
  try {
    const response = await fetch(buildOpenMeteoUrl(lat, lon, sessionDate));
    if (!response.ok) {
      console.warn("Open-Meteo API failed:", response.status);
      return null;
    }
    const obs = parseOpenMeteoResponse(await response.json(), sessionDate);
    if (!obs) return null;

    return {
      station: OPEN_METEO_STATION,
      temperatureF: obs.temperatureF,
      temperatureC: obs.temperatureC,
      humidity: obs.humidity,
      altimeterInHg: obs.altimeterInHg,
      densityAltitudeFt: calculateDensityAltitude(obs.temperatureC, obs.altimeterInHg),
      windSpeedKts: obs.windSpeedKts,
      windDirectionDeg: obs.windDirectionDeg,
      windGustKts: obs.windGustKts,
      observationTime: obs.time,
    };
  } catch (error) {
    console.warn("Failed to fetch Open-Meteo weather:", error);
    return null;
  }
}

/**
 * Main entry: fetch weather for a session. Tries the precise US path (cached or
 * freshly-looked-up ASOS station → IEM METAR) first, then falls back to
 * Open-Meteo's global reanalysis so non-US (and station-less) sessions still get
 * weather. Returns null only when even the global fallback fails.
 */
export async function fetchSessionWeather(
  lat: number,
  lon: number,
  sessionDate: Date,
  cachedStation?: WeatherStation | null
): Promise<WeatherData | null> {
  if (!isValidGpsPoint(lat, lon)) {
    return null;
  }

  // A cached Open-Meteo marker skips straight to the global path (no point trying
  // ASOS again for a known non-US session).
  if (cachedStation?.source !== "open-meteo") {
    const station = cachedStation ?? (await fetchNearestStation(lat, lon));
    if (station) {
      const data = await fetchWeatherData(station, sessionDate);
      if (data) return data;
    }
  }

  return fetchOpenMeteoWeather(lat, lon, sessionDate);
}
