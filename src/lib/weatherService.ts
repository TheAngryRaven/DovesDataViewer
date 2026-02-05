// Weather data service using NWS API for station lookup and IEM ASOS for historical data

export interface WeatherStation {
  stationId: string; // e.g., "KOKC"
  name: string; // e.g., "Oklahoma City"
  distanceKm: number;
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

/**
 * Main function to fetch weather for a session
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

  const station = cachedStation ?? (await fetchNearestStation(lat, lon));
  if (!station) {
    return null;
  }

  return fetchWeatherData(station, sessionDate);
}
