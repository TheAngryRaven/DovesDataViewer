import { GpsSample, FieldMapping, ParsedData } from '@/types/racing';
import { applyGForceCalculations } from './gforceCalculation';
import {
  isTeleportation,
  MAX_SPEED_MPS,
  KPH_TO_MPS,
  speedTriple,
  calculateBounds,
  validateGpsCoords,
  normalizeHeading,
} from './parserUtils';

/**
 * VBO Parser for Racelogic VBOX data files
 *
 * VBO format structure:
 * - [header] section with metadata
 * - [column names] section with channel names
 * - [data] section with space-delimited rows
 *
 * Standard VBO columns include:
 * - sats, time, lat, long, velocity, heading, height, etc.
 *
 * Racelogic encoding quirks (per the VBOX file spec):
 * - `time` is UTC time-since-midnight packed as HHMMSS.SS
 * - `lat`/`long` are *total decimal minutes* (+03119.09973 = 51.985°), with
 *   longitude positive WEST of the prime meridian
 * Third-party exporters (e.g. RaceBox) reuse the section layout but write
 * signed decimal degrees instead, so the coordinate encoding is detected once
 * per file (see detectVboCoordinateMode).
 */

// Check if content is VBO format by looking for characteristic sections
export function isVboFormat(content: string): boolean {
  const lowerContent = content.substring(0, 2000).toLowerCase();
  return (
    lowerContent.includes('[header]') ||
    lowerContent.includes('[column names]') ||
    lowerContent.includes('[data]')
  );
}

interface VboColumnInfo {
  name: string;
  index: number;
}

// Standard VBO column mappings (case-insensitive)
const KNOWN_COLUMNS: Record<string, string> = {
  'sats': 'Satellites',
  'satellites': 'Satellites',
  'time': 'time',
  'lat': 'lat',
  'latitude': 'lat',
  'long': 'lon',
  'lon': 'lon',
  'longitude': 'lon',
  'velocity': 'velocity', // km/h in VBO
  'speed': 'velocity',
  'velocity kmh': 'velocity',
  'heading': 'heading',
  'height': 'height', // meters
  'altitude': 'height',
  'vert vel': 'vertVel',
  'vertical velocity': 'vertVel',
  'long accel': 'lonAccel', // g
  'lateral accel': 'latAccel', // g
  'lat accel': 'latAccel',
  'longitudinal accel': 'lonAccel',
  'yaw rate': 'yawRate',
  'slip': 'slip',
  'slip angle': 'slip',
  'distance': 'distance',
};

/**
 * Parse the VBO `time` column. Racelogic packs UTC time-since-midnight as
 * HHMMSS.SS, so the digits must be split relative to the decimal point —
 * splitting by magnitude (the old approach) corrupted every session before
 * 10:00 UTC (read as plain seconds, injecting ~40 phantom seconds per minute
 * boundary) and mis-aligned 2-decimal values at/after 100000.00. A value whose
 * minute/second digit pairs exceed 59 cannot be packed HHMMSS and falls back
 * to plain seconds-since-midnight.
 */
export function parseVboTime(value: string): number {
  const str = value.trim();
  const num = parseFloat(str);
  if (isNaN(num) || num < 0) return 0;

  const dot = str.indexOf('.');
  const intDigits = (dot === -1 ? str : str.slice(0, dot)).replace(/^\+/, '');
  const fraction = dot === -1 ? 0 : parseFloat(`0${str.slice(dot)}`) || 0;

  if (intDigits.length <= 6 && /^\d*$/.test(intDigits)) {
    const padded = intDigits.padStart(6, '0');
    const hours = parseInt(padded.slice(0, 2), 10);
    const minutes = parseInt(padded.slice(2, 4), 10);
    const seconds = parseInt(padded.slice(4, 6), 10);
    if (hours < 24 && minutes < 60 && seconds < 60) {
      return (hours * 3600 + minutes * 60 + seconds + fraction) * 1000;
    }
  }

  // Not valid packed HHMMSS — treat as seconds since midnight.
  return num * 1000;
}

/** How a VBO file encodes lat/long. Decided once per file, never per value. */
export type VboCoordinateMode = 'minutes' | 'degrees';

// Racelogic writes fixed-width zero-padded coordinates (+00031.12345): an
// integer part of 4+ digits with a leading zero never occurs in plain decimal
// degrees, so it identifies the minutes encoding even for values that are
// numerically within degree range.
const ZERO_PADDED_COORD = /^[+-]?0\d{3,}\.\d+$/;

// Total decimal minutes can't exceed 90°/180° × 60. Values beyond that are
// garbage rows, not evidence of the minutes encoding.
const MAX_LAT_MINUTES = 90 * 60;
const MAX_LON_MINUTES = 180 * 60;

/**
 * Decide how a VBO file encodes coordinates.
 *
 * Genuine Racelogic files store *total decimal minutes* (+03119.09973 =
 * 3119.09973′ = 51.985°); some third-party exporters (e.g. RaceBox) write
 * signed decimal degrees. Disambiguation:
 *  - any |lat| > 90 or |lon| > 180 (within plausible minute range) is
 *    impossible in degrees → minutes
 *  - otherwise Racelogic's zero-padded fixed-width integer part → minutes
 *  - otherwise → degrees
 * Only a session within ~1.5° of the equator AND ~3° of the prime meridian
 * (open Atlantic) reaches the zero-padding fallback.
 */
export function detectVboCoordinateMode(coordPairs: Array<{ lat: string; lon: string }>): VboCoordinateMode {
  let sawZeroPadded = false;
  for (const { lat, lon } of coordPairs) {
    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);
    if (isNaN(latNum) || isNaN(lonNum)) continue;
    const latAbs = Math.abs(latNum);
    const lonAbs = Math.abs(lonNum);
    if ((latAbs > 90 && latAbs <= MAX_LAT_MINUTES) || (lonAbs > 180 && lonAbs <= MAX_LON_MINUTES)) {
      return 'minutes';
    }
    if (ZERO_PADDED_COORD.test(lat.trim()) || ZERO_PADDED_COORD.test(lon.trim())) {
      sawZeroPadded = true;
    }
  }
  return sawZeroPadded ? 'minutes' : 'degrees';
}

/**
 * Convert a raw VBO coordinate to signed decimal degrees (east-positive).
 * In minutes mode the value is total decimal minutes and Racelogic longitude
 * is positive WEST of the prime meridian, so longitude is negated.
 */
export function vboCoordinateToDegrees(value: string, mode: VboCoordinateMode, axis: 'lat' | 'lon'): number {
  const num = parseFloat(value);
  if (isNaN(num)) return NaN;
  if (mode === 'degrees') return num;
  const degrees = num / 60;
  return axis === 'lon' ? -degrees : degrees;
}

export function parseVboFile(content: string): ParsedData {
  const lines = content.split(/\r?\n/);
  
  // Find section markers
  let headerStart = -1;
  let columnNamesStart = -1;
  let dataStart = -1;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim().toLowerCase();
    if (line === '[header]') headerStart = i;
    else if (line === '[column names]') columnNamesStart = i;
    else if (line === '[data]') dataStart = i;
  }
  
  if (dataStart === -1) {
    throw new Error('No [data] section found in VBO file');
  }
  
  // Parse column names
  const columns: VboColumnInfo[] = [];
  const columnLine = columnNamesStart >= 0 && columnNamesStart < dataStart
    ? lines.slice(columnNamesStart + 1, dataStart).find(l => l.trim().length > 0)
    : null;
  
  if (columnLine) {
    // Split by whitespace, but handle multi-word column names
    // VBO typically uses space-delimited single words
    const colNames = columnLine.trim().split(/\s+/);
    for (let i = 0; i < colNames.length; i++) {
      columns.push({ name: colNames[i], index: i });
    }
  }
  
  // Map column indices to known fields
  const columnMap: Record<string, number> = {};
  for (const col of columns) {
    const normalized = KNOWN_COLUMNS[col.name.toLowerCase()];
    if (normalized) {
      columnMap[normalized] = col.index;
    }
  }
  
  // Must have at least lat/lon. With no usable [column names] mapping, fall
  // back to the standard VBOX positional order (decided from the first data
  // row): sats, time, lat, long, velocity, heading, height...
  if (columnMap['lat'] === undefined || columnMap['lon'] === undefined) {
    for (let i = dataStart + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('[')) continue;
      const fields = line.split(/\s+/);
      if (fields.length >= 5) {
        columnMap['Satellites'] = 0;
        columnMap['time'] = 1;
        columnMap['lat'] = 2;
        columnMap['lon'] = 3;
        columnMap['velocity'] = 4;
        if (fields.length > 5) columnMap['heading'] = 5;
        if (fields.length > 6) columnMap['height'] = 6;
      }
      break;
    }
  }

  if (columnMap['lat'] === undefined || columnMap['lon'] === undefined) {
    throw new Error('No valid GPS data found in VBO file');
  }

  // Decide once per file how coordinates are encoded (Racelogic decimal
  // minutes vs signed decimal degrees). Capped scan — encoding is uniform,
  // and the zero-padding fallback resolves from the very first row.
  const coordPairs: Array<{ lat: string; lon: string }> = [];
  for (let i = dataStart + 1; i < lines.length && coordPairs.length < 5000; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('[')) continue;
    const fields = line.split(/\s+/);
    const latRaw = fields[columnMap['lat']];
    const lonRaw = fields[columnMap['lon']];
    if (latRaw !== undefined && lonRaw !== undefined) coordPairs.push({ lat: latRaw, lon: lonRaw });
  }
  const coordMode = detectVboCoordinateMode(coordPairs);

  // Parse data rows
  const samples: GpsSample[] = [];
  let baseTimeMs: number | null = null;
  let startDate: Date | undefined;

  for (let i = dataStart + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('[')) continue; // Skip empty lines and section headers

    const fields = line.split(/\s+/);
    if (fields.length < 3) continue;

    const lat = vboCoordinateToDegrees(fields[columnMap['lat']] ?? '', coordMode, 'lat');
    const lon = vboCoordinateToDegrees(fields[columnMap['lon']] ?? '', coordMode, 'lon');

    if (validateGpsCoords(lat, lon) !== null) continue;
    
    // Parse time
    let timeMs = 0;
    if (columnMap['time'] !== undefined && fields[columnMap['time']]) {
      timeMs = parseVboTime(fields[columnMap['time']]);
    }
    
    if (baseTimeMs === null) {
      baseTimeMs = timeMs;
    }
    
    let t = timeMs - baseTimeMs;
    if (t < 0) t += 86400000; // Handle midnight wrap
    
    // Parse velocity (VBO uses km/h)
    let speedKph = 0;
    if (columnMap['velocity'] !== undefined && fields[columnMap['velocity']]) {
      speedKph = parseFloat(fields[columnMap['velocity']]) || 0;
    }
    const speedMps = speedKph * KPH_TO_MPS;

    // Sanity check on speed
    if (speedMps > MAX_SPEED_MPS) continue;

    // Parse heading
    let heading: number | undefined;
    if (columnMap['heading'] !== undefined && fields[columnMap['heading']]) {
      const h = parseFloat(fields[columnMap['heading']]);
      if (!isNaN(h)) heading = normalizeHeading(h);
    }
    
    // Teleportation filter
    if (samples.length > 0) {
      const prev = samples[samples.length - 1];
      if (isTeleportation(prev.lat, prev.lon, prev.t, lat, lon, t, 'VBO')) continue;
    }
    
    // Build extra fields
    const extraFields: Record<string, number> = {};
    
    // Add satellites if present
    if (columnMap['Satellites'] !== undefined && fields[columnMap['Satellites']]) {
      const sats = parseInt(fields[columnMap['Satellites']], 10);
      if (!isNaN(sats)) extraFields['Satellites'] = sats;
    }
    
    // Add height/altitude if present
    if (columnMap['height'] !== undefined && fields[columnMap['height']]) {
      const height = parseFloat(fields[columnMap['height']]);
      if (!isNaN(height)) extraFields['Altitude (m)'] = height;
    }
    
    // Add native accelerometer data if present (already in G)
    if (columnMap['latAccel'] !== undefined && fields[columnMap['latAccel']]) {
      const latAccel = parseFloat(fields[columnMap['latAccel']]);
      if (!isNaN(latAccel)) extraFields['Lat G (Native)'] = latAccel;
    }
    
    if (columnMap['lonAccel'] !== undefined && fields[columnMap['lonAccel']]) {
      const lonAccel = parseFloat(fields[columnMap['lonAccel']]);
      if (!isNaN(lonAccel)) extraFields['Lon G (Native)'] = lonAccel;
    }
    
    // Add yaw rate if present
    if (columnMap['yawRate'] !== undefined && fields[columnMap['yawRate']]) {
      const yawRate = parseFloat(fields[columnMap['yawRate']]);
      if (!isNaN(yawRate)) extraFields['Yaw Rate'] = yawRate;
    }
    
    // Add distance if present
    if (columnMap['distance'] !== undefined && fields[columnMap['distance']]) {
      const distance = parseFloat(fields[columnMap['distance']]);
      if (!isNaN(distance)) extraFields['Distance'] = distance;
    }
    
    samples.push({
      t,
      lat,
      lon,
      ...speedTriple(speedMps),
      heading,
      extraFields
    });
  }

  if (samples.length === 0) {
    throw new Error('No valid GPS data found in VBO file');
  }
  
  // Calculate G-forces from GPS data
  applyGForceCalculations(samples, 5);
  
  // Build field mappings
  const fieldMappings: FieldMapping[] = [
    { index: -10, name: 'Lat G', enabled: true },
    { index: -11, name: 'Lon G', enabled: true },
  ];
  
  // Add native G fields if they exist
  if (samples.some(s => s.extraFields['Lat G (Native)'] !== undefined)) {
    fieldMappings.push({ index: -12, name: 'Lat G (Native)', enabled: true });
  }
  if (samples.some(s => s.extraFields['Lon G (Native)'] !== undefined)) {
    fieldMappings.push({ index: -13, name: 'Lon G (Native)', enabled: true });
  }
  
  // Add other standard fields if present
  if (samples.some(s => s.extraFields['Satellites'] !== undefined)) {
    fieldMappings.push({ index: -1, name: 'Satellites', enabled: true });
  }
  if (samples.some(s => s.extraFields['Altitude (m)'] !== undefined)) {
    fieldMappings.push({ index: -3, name: 'Altitude (m)', enabled: true });
  }
  if (samples.some(s => s.extraFields['Yaw Rate'] !== undefined)) {
    fieldMappings.push({ index: -14, name: 'Yaw Rate', enabled: true });
  }
  if (samples.some(s => s.extraFields['Distance'] !== undefined)) {
    fieldMappings.push({ index: -15, name: 'Distance', enabled: true });
  }
  
  return {
    samples,
    fieldMappings,
    bounds: calculateBounds(samples),
    duration: samples[samples.length - 1].t,
    startDate
  };
}
